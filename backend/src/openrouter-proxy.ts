import type { Request, Response } from "express";
import { resolveModel } from "./models.js";

const OPENROUTER_BASE = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

export async function proxyToOpenRouter(req: Request, res: Response): Promise<void> {
  const body = req.body;
  const internalModel = body.model;
  const openRouterModel = resolveModel(internalModel);

  const isStream = body.stream === true;

  let upstreamRes: globalThis.Response;
  try {
    upstreamRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "HTTP-Referer": process.env.SITE_URL || "https://okx-llm-router.example.com",
      },
      body: JSON.stringify({ ...body, model: openRouterModel }),
    });
  } catch (err) {
    res.status(502).json({ error: "upstream_error", message: String(err) });
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

  // Stream the response body through
  const reader = upstreamRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch {
    // Client may have disconnected
  } finally {
    res.end();
  }
}
