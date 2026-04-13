import type { Request, Response } from "express";
import { resolveModel, MODEL_MAP } from "./models.js";

const OPENROUTER_BASE =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

export async function proxyToOpenRouter(
  req: Request,
  res: Response,
): Promise<void> {
  const body = req.body;

  // Basic request validation
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({
      error: "invalid_request",
      message: "Request body must include a non-empty 'messages' array.",
    });
    return;
  }

  const internalModel = body.model;
  if (internalModel && !(internalModel in MODEL_MAP) && !internalModel.includes("/")) {
    res.status(400).json({
      error: "unknown_model",
      message: `Unknown model: ${internalModel}. Use GET /v1/models for available models.`,
    });
    return;
  }

  const openRouterModel = resolveModel(internalModel);

  let upstreamRes: globalThis.Response;
  try {
    upstreamRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "HTTP-Referer": process.env.SITE_URL || "https://github.com/user/okxclawrouter",
      },
      body: JSON.stringify({ ...body, model: openRouterModel }),
      signal: AbortSignal.timeout(120_000), // 2-minute timeout
    });
  } catch (err) {
    const message =
      err instanceof DOMException && err.name === "TimeoutError"
        ? "Upstream request timed out"
        : String(err);
    console.error(`OpenRouter proxy error: ${message}`);
    res.status(502).json({ error: "upstream_error", message });
    return;
  }

  res.status(upstreamRes.status);

  // Forward relevant headers
  const passthroughHeaders = [
    "content-type",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
  ];
  for (const key of passthroughHeaders) {
    const val = upstreamRes.headers.get(key);
    if (val) res.setHeader(key, val);
  }

  if (!upstreamRes.body) {
    res.end();
    return;
  }

  // Stream the response body through — cancel upstream if client disconnects
  const reader = upstreamRes.body.getReader();
  const onClose = () => reader.cancel().catch(() => {});
  res.on("close", onClose);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      res.write(value);
    }
  } catch (err) {
    console.error("Stream relay error:", err);
  } finally {
    res.removeListener("close", onClose);
    if (!res.writableEnded) res.end();
  }
}
