import type { Request, Response } from "express";
import { resolveModel, MODEL_MAP } from "./models.js";

const OPENROUTER_BASE =
  process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

function stripReasoningDetails(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripReasoningDetails);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "reasoning_details")
      .map(([key, child]) => [key, stripReasoningDetails(child)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export function sanitizeOpenRouterJsonText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  try {
    const parsed = JSON.parse(trimmed);
    return JSON.stringify(stripReasoningDetails(parsed));
  } catch {
    return text;
  }
}

export function sanitizeSseEvent(event: string): string | null {
  const normalized = event.replace(/\r\n/g, "\n").trim();
  if (!normalized) return null;

  // OpenRouter emits comment-only processing frames before the first token.
  // Drop them to reduce client-side parser edge cases.
  if (normalized.startsWith(":")) {
    return null;
  }

  const lines = normalized.split("\n");
  const sanitizedLines = lines.map((line) => {
    if (!line.startsWith("data:")) {
      return line;
    }

    const payload = line.slice(5).trimStart();
    if (payload === "[DONE]") {
      return "data: [DONE]";
    }

    try {
      const parsed = JSON.parse(payload);
      return `data: ${JSON.stringify(stripReasoningDetails(parsed))}`;
    } catch {
      return line;
    }
  });

  return sanitizedLines.join("\n");
}

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
        "HTTP-Referer": process.env.SITE_URL || "https://github.com/user/okclawrouter",
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

  const contentType = upstreamRes.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const text = await upstreamRes.text();
    res.end(sanitizeOpenRouterJsonText(text));
    return;
  }

  // Stream SSE through while stripping OpenRouter processing comments and
  // large reasoning_details payloads that can break some clients.
  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onClose = () => reader.cancel().catch(() => {});
  res.on("close", onClose);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const sanitized = sanitizeSseEvent(event);
        if (sanitized) {
          res.write(`${sanitized}\n\n`);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    const tail = sanitizeSseEvent(buffer);
    if (tail) {
      res.write(`${tail}\n\n`);
    }
  } catch (err) {
    console.error("Stream relay error:", err);
  } finally {
    res.removeListener("close", onClose);
    if (!res.writableEnded) res.end();
  }
}
