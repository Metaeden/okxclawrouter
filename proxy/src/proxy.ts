import type { Request, Response } from "express";
import config from "./config.js";
import { route } from "./router/simple-router.js";
import { checkWalletStatus } from "./onchainos-wallet.js";
import { handleX402Payment, InsufficientBalanceError } from "./x402-handler.js";
import { fetchWithRetry } from "./retry.js";
import { dedup } from "./dedup.js";
import { stats } from "./stats.js";
import { getCached, setCache } from "./response-cache.js";
import { log } from "./logger.js";
import type { ChatMessage } from "./router/types.js";

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

  // Check non-streaming cache
  const messagesKey = JSON.stringify(messages);
  if (!isStream) {
    const cached = getCached(decision.model, messagesKey);
    if (cached) {
      log.debug("Cache hit:", decision.model);
      res.status(cached.status);
      for (const [k, v] of Object.entries(cached.headers)) {
        res.setHeader(k, v);
      }
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
      // Use dedup for non-streaming requests
      let upstreamRes: globalThis.Response;
      if (!isStream) {
        upstreamRes = await dedup(upstreamBody, () =>
          fetchWithRetry(upstreamUrl, {
            method: "POST",
            headers,
            body: upstreamBody,
          }),
        );
      } else {
        upstreamRes = await fetchWithRetry(upstreamUrl, {
          method: "POST",
          headers,
          body: upstreamBody,
        });
      }

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

            // Ensure free models are in the fallback chain
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
        log.warn(
          `Model ${model} returned ${upstreamRes.status}, trying fallback`,
        );
        continue;
      }

      // Forward response to client
      res.status(upstreamRes.status);
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of upstreamRes.headers.entries()) {
        if (
          !["transfer-encoding", "connection"].includes(key.toLowerCase())
        ) {
          res.setHeader(key, value);
          responseHeaders[key] = value;
        }
      }

      // If we fell back to free due to balance, add a warning header
      if (balanceWarningEmitted) {
        res.setHeader(
          "X-Router-Warning",
          "insufficient_balance:switched_to_free",
        );
      }

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      if (isStream) {
        // Inject balance warning as a SSE comment before stream data
        if (balanceWarningEmitted) {
          const warning = buildBalanceWarningSSE(model);
          res.write(warning);
        }
        const reader = upstreamRes.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch (err) {
          log.debug("Stream relay interrupted:", err);
        } finally {
          res.end();
        }
      } else {
        const chunks: Uint8Array[] = [];
        const reader = upstreamRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const responseBody = Buffer.concat(chunks).toString();

        // Inject balance warning into non-streaming JSON response
        if (balanceWarningEmitted) {
          try {
            const parsed = JSON.parse(responseBody);
            parsed._router_warning = {
              type: "insufficient_balance",
              message:
                "USDC balance insufficient. Switched to free model automatically.",
              action: "Recharge at https://web3.okx.com/onchainos (X Layer network)",
              actual_model: model,
            };
            const enriched = JSON.stringify(parsed);
            setCache(model, messagesKey, enriched, upstreamRes.status, responseHeaders);
            res.end(enriched);
          } catch {
            setCache(model, messagesKey, responseBody, upstreamRes.status, responseHeaders);
            res.end(responseBody);
          }
        } else {
          setCache(model, messagesKey, responseBody, upstreamRes.status, responseHeaders);
          res.end(responseBody);
        }
      }

      stats.record({
        model,
        tier: tier === "free" ? "FREE" : "PAID",
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
        success: upstreamRes.status >= 200 && upstreamRes.status < 300,
      });
      return;
    } catch (err) {
      log.error(`Error with model ${model}:`, err);
      if (i < modelsToTry.length - 1) continue;

      res.status(502).json({
        error: "all_models_failed",
        message:
          "All models are currently unavailable. Please try again later.",
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

function buildBalanceWarningSSE(fallbackModel: string): string {
  // SSE comment lines (: prefix) — parsed by well-behaved SSE clients as comments
  return [
    `: [OKX Router] USDC balance insufficient — switched to free model: ${fallbackModel}`,
    `: [OKX Router] Recharge at https://web3.okx.com/onchainos (X Layer network)`,
    "",
  ].join("\n");
}
