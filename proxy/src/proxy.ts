import type { Request, Response } from "express";
import config from "./config.js";
import { route } from "./router/simple-router.js";
import { checkWalletStatus } from "./onchainos-wallet.js";
import { handleX402Payment, InsufficientBalanceError } from "./x402-handler.js";
import { fetchWithRetry } from "./retry.js";
import { RequestDeduplicator, type CachedResponse } from "./dedup.js";
import { ResponseCache } from "./response-cache.js";
import { stats } from "./stats.js";
import { log } from "./logger.js";
import type { ChatMessage } from "./router/types.js";

// Instantiate production-grade cache and deduplicator (ported from ClawRouter)
const responseCache = new ResponseCache({ maxSize: 200, defaultTTL: 300 });
const deduplicator = new RequestDeduplicator(30_000);

let cachedWalletConnected: boolean | null = null;
let walletCheckTimestamp = 0;
const WALLET_CHECK_INTERVAL_MS = 30_000;

function isWalletConnected(): boolean {
  const now = Date.now();
  if (
    cachedWalletConnected === null ||
    now - walletCheckTimestamp > WALLET_CHECK_INTERVAL_MS
  ) {
    const status = checkWalletStatus();
    cachedWalletConnected = status.loggedIn;
    walletCheckTimestamp = now;
  }
  return cachedWalletConnected!;
}

export function invalidateWalletCache(): void {
  cachedWalletConnected = null;
}

/** Expose cache stats for /stats CLI command */
export function getCacheStats() {
  return responseCache.getStats();
}

/**
 * Re-route to free tier when paid model fails due to balance.
 * Returns free-tier fallback models.
 */
function freeFallbackModels(): string[] {
  return ["free/deepseek-chat", "free/deepseek-r1", "free/qwen3"];
}

export async function handleChatCompletion(
  req: Request,
  res: Response,
): Promise<void> {
  const startTime = Date.now();
  const body = req.body;
  const messages: ChatMessage[] = body.messages || [];
  const requestedModel: string | undefined = body.model;
  const isStream = body.stream === true;

  // Basic request validation
  if (!messages.length) {
    res.status(400).json({
      error: "invalid_request",
      message: "Request body must include a non-empty 'messages' array.",
    });
    return;
  }

  // Route the request
  const walletOk = isWalletConnected();
  const decision = route(messages, requestedModel, walletOk);

  log.info(
    `Routing: tier=${decision.tier} model=${decision.model} wallet=${walletOk} stream=${isStream}`,
  );

  // Check non-streaming response cache (using canonical key from body)
  const bodyStr = JSON.stringify({ ...body, model: decision.model });
  if (!isStream) {
    const cacheKey = ResponseCache.generateKey(bodyStr);
    const cached = responseCache.get(cacheKey);
    if (cached) {
      log.debug(`Cache hit: ${decision.model} (key=${cacheKey.slice(0, 8)})`);
      res.status(cached.status);
      for (const [k, v] of Object.entries(cached.headers)) {
        res.setHeader(k, v);
      }
      res.setHeader("X-Cache", "HIT");
      res.end(cached.body);
      stats.record({
        model: decision.model,
        tier: decision.tier,
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
        success: true,
      });
      return;
    }
  }

  // Build model fallback chain.
  // If paid model fails due to insufficient balance, append free models.
  const modelsToTry = [decision.model, ...decision.fallbacks];
  let balanceWarningEmitted = false;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const tier = model.startsWith("paid/") ? "paid" : "free";
    const path =
      tier === "free"
        ? "/v1/free/chat/completions"
        : "/v1/paid/chat/completions";
    const upstreamUrl = `${config.backendUrl}${path}`;
    const upstreamBody = JSON.stringify({ ...body, model });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    try {
      let upstreamRes: globalThis.Response;

      if (!isStream) {
        // Use request deduplication for non-streaming requests
        const dedupKey = RequestDeduplicator.hash(upstreamBody);

        // Check completed cache first
        const cachedResult = deduplicator.getCached(dedupKey);
        if (cachedResult) {
          log.debug(`Dedup cache hit: ${model} (key=${dedupKey.slice(0, 8)})`);
          sendCachedResponse(res, cachedResult, model, decision.tier, startTime, balanceWarningEmitted);
          return;
        }

        // Check if in-flight
        const inflightPromise = deduplicator.getInflight(dedupKey);
        if (inflightPromise) {
          log.debug(`Dedup inflight hit: ${model} — waiting on original`);
          const result = await inflightPromise;
          sendCachedResponse(res, result, model, decision.tier, startTime, balanceWarningEmitted);
          return;
        }

        // Mark as in-flight and execute
        deduplicator.markInflight(dedupKey);
        try {
          upstreamRes = await fetchWithRetry(upstreamUrl, {
            method: "POST",
            headers,
            body: upstreamBody,
          });
        } catch (fetchErr) {
          deduplicator.removeInflight(dedupKey);
          throw fetchErr;
        }

        // Handle 402 — payment required
        if (upstreamRes.status === 402) {
          deduplicator.removeInflight(dedupKey);
          log.info("Received 402, initiating x402 payment...");
          try {
            upstreamRes = await handleX402Payment(
              upstreamRes,
              upstreamUrl,
              headers,
              upstreamBody,
            );
          } catch (payErr) {
            if (payErr instanceof InsufficientBalanceError) {
              log.warn("Insufficient balance, falling back to free models");
              balanceWarningEmitted = true;
              const remaining = modelsToTry.slice(i + 1);
              const hasFree = remaining.some((m) => m.startsWith("free/"));
              if (!hasFree) {
                modelsToTry.push(...freeFallbackModels());
              }
              continue;
            }
            log.warn("Payment failed, trying fallback:", payErr);
            continue;
          }
        }

        // If still not 2xx, complete dedup with error and try fallback
        if (upstreamRes.status >= 400 && i < modelsToTry.length - 1) {
          deduplicator.removeInflight(dedupKey);
          log.warn(`Model ${model} returned ${upstreamRes.status}, trying fallback`);
          continue;
        }

        // Read full response body for caching + dedup completion
        const chunks: Uint8Array[] = [];
        if (upstreamRes.body) {
          const reader = upstreamRes.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
        }
        let responseBody = Buffer.concat(chunks).toString();
        const responseHeaders: Record<string, string> = {};
        for (const [key, value] of upstreamRes.headers.entries()) {
          if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
            responseHeaders[key] = value;
          }
        }

        // Inject balance warning into JSON response
        if (balanceWarningEmitted) {
          try {
            const parsed = JSON.parse(responseBody);
            parsed._router_warning = {
              type: "insufficient_balance",
              message: "USDC balance insufficient. Switched to free model automatically.",
              action: "Recharge at https://web3.okx.com/onchainos (X Layer network)",
              actual_model: model,
            };
            responseBody = JSON.stringify(parsed);
          } catch {
            // Not JSON, leave as-is
          }
        }

        // Complete dedup — notify waiters
        const dedupResult: CachedResponse = {
          status: upstreamRes.status,
          headers: responseHeaders,
          body: responseBody,
          completedAt: Date.now(),
        };
        deduplicator.complete(dedupKey, dedupResult);

        // Also populate response cache
        const cacheKey = ResponseCache.generateKey(upstreamBody);
        responseCache.set(cacheKey, {
          body: responseBody,
          status: upstreamRes.status,
          headers: responseHeaders,
          model,
        });

        // Send response to client
        res.status(upstreamRes.status);
        for (const [k, v] of Object.entries(responseHeaders)) {
          res.setHeader(k, v);
        }
        if (balanceWarningEmitted) {
          res.setHeader("X-Router-Warning", "insufficient_balance:switched_to_free");
        }
        res.setHeader("X-Cache", "MISS");
        res.end(responseBody);

        stats.record({
          model,
          tier: tier === "free" ? "FREE" : "PAID",
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
          success: upstreamRes.status >= 200 && upstreamRes.status < 300,
        });
        return;
      } else {
        // Streaming — no dedup or caching
        upstreamRes = await fetchWithRetry(upstreamUrl, {
          method: "POST",
          headers,
          body: upstreamBody,
        });

        // Handle 402 — payment required
        if (upstreamRes.status === 402) {
          log.info("Received 402, initiating x402 payment...");
          try {
            upstreamRes = await handleX402Payment(
              upstreamRes,
              upstreamUrl,
              headers,
              upstreamBody,
            );
          } catch (payErr) {
            if (payErr instanceof InsufficientBalanceError) {
              log.warn("Insufficient balance, falling back to free models");
              balanceWarningEmitted = true;
              const remaining = modelsToTry.slice(i + 1);
              const hasFree = remaining.some((m) => m.startsWith("free/"));
              if (!hasFree) {
                modelsToTry.push(...freeFallbackModels());
              }
              continue;
            }
            log.warn("Payment failed, trying fallback:", payErr);
            continue;
          }
        }

        // If still not 2xx, try next fallback
        if (upstreamRes.status >= 400 && i < modelsToTry.length - 1) {
          log.warn(`Model ${model} returned ${upstreamRes.status}, trying fallback`);
          continue;
        }

        // Forward streaming response to client
        res.status(upstreamRes.status);
        for (const [key, value] of upstreamRes.headers.entries()) {
          if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
            res.setHeader(key, value);
          }
        }
        if (balanceWarningEmitted) {
          res.setHeader("X-Router-Warning", "insufficient_balance:switched_to_free");
        }

        if (!upstreamRes.body) {
          res.end();
          return;
        }

        // Inject balance warning as SSE comment before stream data
        if (balanceWarningEmitted) {
          const warning = buildBalanceWarningSSE(model);
          res.write(warning);
        }

        const reader = upstreamRes.body.getReader();
        // Cancel upstream reader if client disconnects
        const onClose = () => reader.cancel().catch(() => {});
        res.on("close", onClose);
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || res.destroyed) break;
            res.write(value);
          }
        } catch (err) {
          log.debug("Stream relay interrupted:", err);
        } finally {
          res.removeListener("close", onClose);
          if (!res.writableEnded) res.end();
        }

        stats.record({
          model,
          tier: tier === "free" ? "FREE" : "PAID",
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
          success: upstreamRes.status >= 200 && upstreamRes.status < 300,
        });
        return;
      }
    } catch (err: any) {
      log.error(`Error with model ${model}:`, err);

      // Detect backend unreachable — no point trying other models on same backend
      const isConnErr =
        err?.cause?.code === "ECONNREFUSED" ||
        err?.cause?.code === "ECONNRESET" ||
        err?.cause?.code === "ENOTFOUND";
      if (isConnErr) {
        res.status(503).json({
          error: "backend_unavailable",
          message: `Backend at ${config.backendUrl} is unreachable. Check your deployment.`,
        });
        stats.record({
          model,
          tier: decision.tier,
          timestamp: Date.now(),
          latencyMs: Date.now() - startTime,
          success: false,
        });
        return;
      }

      if (i < modelsToTry.length - 1) continue;

      res.status(502).json({
        error: "all_models_failed",
        message: "All models are currently unavailable. Please try again later.",
      });
      stats.record({
        model,
        tier: decision.tier,
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
        success: false,
      });
      return;
    }
  }
}

/**
 * Send a cached/dedup response to the client.
 */
function sendCachedResponse(
  res: Response,
  cached: CachedResponse,
  model: string,
  tier: string,
  startTime: number,
  balanceWarning: boolean,
): void {
  res.status(cached.status);
  for (const [k, v] of Object.entries(cached.headers)) {
    res.setHeader(k, v);
  }
  if (balanceWarning) {
    res.setHeader("X-Router-Warning", "insufficient_balance:switched_to_free");
  }
  res.setHeader("X-Cache", "HIT");
  res.end(cached.body);
  stats.record({
    model,
    tier,
    timestamp: Date.now(),
    latencyMs: Date.now() - startTime,
    success: cached.status >= 200 && cached.status < 300,
  });
}

function buildBalanceWarningSSE(fallbackModel: string): string {
  return [
    `: [OKX Router] USDC balance insufficient — switched to free model: ${fallbackModel}`,
    `: [OKX Router] Recharge at https://web3.okx.com/onchainos (X Layer network)`,
    "",
  ].join("\n");
}
