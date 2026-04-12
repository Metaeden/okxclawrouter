import type { Request, Response } from "express";
import config from "./config.js";
import { route } from "./router/simple-router.js";
import { checkWalletStatus } from "./onchainos-wallet.js";
import { handleX402Payment } from "./x402-handler.js";
import { fetchWithRetry } from "./retry.js";
import { stats } from "./stats.js";
import { getCached, setCache } from "./response-cache.js";
import { log } from "./logger.js";
import type { ChatMessage } from "./router/types.js";

let cachedWalletConnected: boolean | null = null;
let walletCheckTimestamp = 0;
const WALLET_CHECK_INTERVAL_MS = 30_000; // Re-check wallet every 30s

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

export async function handleChatCompletion(
  req: Request,
  res: Response,
): Promise<void> {
  const startTime = Date.now();
  const body = req.body;
  const messages: ChatMessage[] = body.messages || [];
  const requestedModel: string | undefined = body.model;
  const isStream = body.stream === true;

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

  // Try primary model, then fallbacks
  const modelsToTry = [decision.model, ...decision.fallbacks];

  for (const model of modelsToTry) {
    const tier = model.startsWith("paid/") ? "paid" : "free";
    const path = tier === "free" ? "/v1/free/chat/completions" : "/v1/paid/chat/completions";
    const upstreamUrl = `${config.backendUrl}${path}`;
    const upstreamBody = JSON.stringify({ ...body, model });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    try {
      let upstreamRes = await fetchWithRetry(upstreamUrl, {
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
          log.warn("Payment failed, falling back:", payErr);
          continue; // Try next model in fallback list
        }
      }

      // If still not 2xx after payment, try next fallback
      if (upstreamRes.status >= 400 && modelsToTry.indexOf(model) < modelsToTry.length - 1) {
        log.warn(`Model ${model} returned ${upstreamRes.status}, trying fallback`);
        continue;
      }

      // Forward response to client
      res.status(upstreamRes.status);
      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of upstreamRes.headers.entries()) {
        if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
          res.setHeader(key, value);
          responseHeaders[key] = value;
        }
      }

      if (!upstreamRes.body) {
        res.end();
        return;
      }

      if (isStream) {
        // Stream through directly
        const reader = upstreamRes.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch {
          // Client disconnected
        } finally {
          res.end();
        }
      } else {
        // Buffer for caching
        const chunks: Uint8Array[] = [];
        const reader = upstreamRes.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const responseBody = Buffer.concat(chunks).toString();
        setCache(model, messagesKey, responseBody, upstreamRes.status, responseHeaders);
        res.end(responseBody);
      }

      stats.record({
        model,
        tier: decision.tier,
        timestamp: Date.now(),
        latencyMs: Date.now() - startTime,
        success: upstreamRes.status >= 200 && upstreamRes.status < 300,
      });

      return;
    } catch (err) {
      log.error(`Error with model ${model}:`, err);
      if (modelsToTry.indexOf(model) < modelsToTry.length - 1) {
        continue;
      }
      // Last resort — return error
      res.status(502).json({ error: "all_models_failed", message: String(err) });
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
