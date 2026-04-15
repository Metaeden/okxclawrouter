import type { Request, Response } from "express";
import config from "./config.js";
import { filterSupportedModels } from "./backend-models.js";
import { route } from "./router/simple-router.js";
import { checkWalletStatus, getXLayerUsdcBalance } from "./onchainos-wallet.js";
import {
  handleX402Payment,
  InsufficientBalanceError,
  PaymentBlockedByScanError,
  PaymentReplayRejectedError,
} from "./x402-handler.js";
import { fetchWithRetry } from "./retry.js";
import { RequestDeduplicator, type CachedResponse } from "./dedup.js";
import { ResponseCache } from "./response-cache.js";
import { categorizeError, recordModelError, isModelAvailable, getCooldownStatus } from "./error-categorizer.js";
import { SpendControl } from "./spend-control.js";
import { stats } from "./stats.js";
import { log } from "./logger.js";
import { loadPolicy } from "./policy.js";
import { executeAutoTopup, buildTopupWarning } from "./auto-topup.js";
import type { ChatMessage } from "./router/types.js";

// --- Production-grade modules ---
const responseCache = new ResponseCache({ maxSize: 200, defaultTTL: 300 });
const deduplicator = new RequestDeduplicator(30_000);

// 从持久化 policy 加载 spend limits，而非纯内存默认值
const _initialPolicy = loadPolicy();
const spendControl = new SpendControl(_initialPolicy.spendLimits);

// --- SSE heartbeat interval (ms) ---
const HEARTBEAT_INTERVAL_MS = 2_000;

// --- Message truncation limit ---
const MAX_MESSAGES = 200;

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

/** Expose cooldown status for /stats CLI command */
export function getModelCooldowns() {
  return getCooldownStatus();
}

/** Expose spend control for /stats and /spend CLI commands */
export function getSpendSummary() {
  return spendControl.getSummary();
}

/** Set spend limits from CLI */
export function setSpendLimits(limits: Parameters<SpendControl["setLimits"]>[0]) {
  spendControl.setLimits(limits);
}

/**
 * Re-route to free tier when paid model fails due to balance.
 */
function freeFallbackModels(): string[] {
  return ["openrouter/free", "qwen/qwen3-coder:free"];
}

function isFreeModel(model: string): boolean {
  return model === "openrouter/free" || model.endsWith(":free");
}

/**
 * Truncate messages to stay under the limit while preserving system messages.
 * Ported from ClawRouter's production pattern.
 */
function truncateMessages(messages: ChatMessage[]): {
  messages: ChatMessage[];
  wasTruncated: boolean;
} {
  if (messages.length <= MAX_MESSAGES) {
    return { messages, wasTruncated: false };
  }

  const systemMsgs = messages.filter((m) => m.role === "system");
  const conversationMsgs = messages.filter((m) => m.role !== "system");
  const maxConversation = MAX_MESSAGES - systemMsgs.length;
  const truncated = conversationMsgs.slice(-maxConversation);

  log.info(
    `Truncated messages: ${messages.length} → ${systemMsgs.length + truncated.length} (kept ${systemMsgs.length} system + ${truncated.length} conversation)`,
  );

  return {
    messages: [...systemMsgs, ...truncated],
    wasTruncated: true,
  };
}

/** Per-model price lookup for spend control */
const MODEL_PRICES: Record<string, number> = {
  "paid/claude-sonnet-4-6": 0.01,
  "paid/gpt-5.4": 0.01,
  "paid/gemini-3.1-pro": 0.008,
};

export async function handleChatCompletion(
  req: Request,
  res: Response,
): Promise<void> {
  const startTime = Date.now();
  const body = req.body;
  const rawMessages: ChatMessage[] = body.messages || [];
  const requestedModel: string | undefined = body.model;
  const isStream = body.stream === true;

  // Basic request validation
  if (!rawMessages.length) {
    res.status(400).json({
      error: "invalid_request",
      message: "Request body must include a non-empty 'messages' array.",
    });
    return;
  }

  // Truncate messages if over limit (preserves system prompts)
  const { messages, wasTruncated } = truncateMessages(rawMessages);

  // Route the request
  const walletOk = isWalletConnected();
  const decision = route(messages, requestedModel, walletOk);
  const requestedExplicitly = requestedModel !== undefined && requestedModel !== "auto";

  log.info(
    `Routing: tier=${decision.tier} model=${decision.model} wallet=${walletOk} stream=${isStream}${wasTruncated ? " [truncated]" : ""}`,
  );

  // Check non-streaming response cache
  const bodyStr = JSON.stringify({ ...body, model: decision.model, messages });
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

  // Build model fallback chain
  const modelsToTry = await filterSupportedModels([
    decision.model,
    ...decision.fallbacks,
  ]);

  if (requestedExplicitly && modelsToTry.length === 0) {
    res.status(503).json({
      error: "unsupported_model",
      message: `Model ${decision.model} is not currently supported by backend ${config.backendUrl}.`,
    });
    return;
  }

  if (modelsToTry.length === 0) {
    res.status(503).json({
      error: "no_supported_models",
      message: `No supported models are currently available from backend ${config.backendUrl}.`,
    });
    return;
  }

  let balanceWarningEmitted = false;
  let balanceWarningDetail: object | undefined;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    const tier = model.startsWith("paid/") ? "paid" : "free";

    // Skip models in cooldown (ported from ClawRouter)
    if (!isModelAvailable(model)) {
      log.info(`Skipping ${model} — in cooldown`);
      continue;
    }

    // Spend control check for paid models
    if (tier === "paid") {
      const estimatedCost = MODEL_PRICES[model] ?? 0.01;
      const spendCheck = spendControl.check(estimatedCost);
      if (!spendCheck.allowed) {
        log.warn(`Spend limit blocked ${model}: ${spendCheck.message}`);
        // Fall back to free if spend limit hit
        if (!modelsToTry.some((m, j) => j > i && isFreeModel(m))) {
          modelsToTry.push(...freeFallbackModels());
        }
        continue;
      }
    }

    const path =
      tier === "free"
        ? "/v1/free/chat/completions"
        : "/v1/paid/chat/completions";
    const upstreamUrl = `${config.backendUrl}${path}`;
    const upstreamBody = JSON.stringify({ ...body, model, messages });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    try {
      let upstreamRes: globalThis.Response;

      if (!isStream) {
        // ===== Non-streaming path: dedup + cache =====
        const dedupKey = RequestDeduplicator.hash(upstreamBody);

        const cachedResult = deduplicator.getCached(dedupKey);
        if (cachedResult) {
          log.debug(`Dedup cache hit: ${model}`);
          sendCachedResponse(res, cachedResult, model, decision.tier, startTime, balanceWarningEmitted);
          return;
        }

        const inflightPromise = deduplicator.getInflight(dedupKey);
        if (inflightPromise) {
          log.debug(`Dedup inflight hit: ${model} — waiting`);
          const result = await inflightPromise;
          sendCachedResponse(res, result, model, decision.tier, startTime, balanceWarningEmitted);
          return;
        }

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
            if (upstreamRes.status >= 200 && upstreamRes.status < 300) {
              const cost = MODEL_PRICES[model] ?? 0.01;
              spendControl.record(cost, model);
            }
          } catch (payErr) {
            if (payErr instanceof InsufficientBalanceError) {
              log.warn("USDC 余额不足，尝试自动补仓...");
              const policy = loadPolicy();

              // 尝试 auto-topup（如 policy 开启）
              if (policy.autoTopup.enabled) {
                const walletStatus = checkWalletStatus();
                if (walletStatus.address) {
                  const topupResult = await executeAutoTopup(
                    walletStatus.address,
                    policy.autoTopup,
                  );
                  if (topupResult.success) {
                    log.info(`自动补仓成功: $${topupResult.amountUsd} USDC，重试付费模型`);
                    // 补仓后重试当前模型（重新加入队列头部）
                    modelsToTry.splice(i, 0, model);
                    continue;
                  }
                  log.warn(`自动补仓失败: ${topupResult.error}，降级至免费模型`);
                }
              }

              balanceWarningEmitted = true;
              const walletStatus = checkWalletStatus();
              const currentBalance = getXLayerUsdcBalance();
              balanceWarningDetail = buildTopupWarning(
                currentBalance,
                walletStatus.address,
              ) as any;
              const remaining = modelsToTry.slice(i + 1);
              if (!remaining.some((m) => isFreeModel(m))) {
                modelsToTry.push(...freeFallbackModels());
              }
              continue;
            }

            if (payErr instanceof PaymentBlockedByScanError) {
              log.error(`支付被安全扫描拦截: ${payErr.reason}`);
              deduplicator.removeInflight(dedupKey);
              res.status(403).json({
                error: "payment_blocked_by_security_scan",
                message: payErr.message,
                action: "运行 /wallet status 检查钱包，或通过 /policy security.scanPayments=false 临时关闭扫描",
              });
              return;
            }

            if (payErr instanceof PaymentReplayRejectedError) {
              log.error(`支付重放失败: ${payErr.message}`);
              deduplicator.removeInflight(dedupKey);
              res.status(402).json({
                error: "payment_rejected_after_signing",
                message: payErr.message,
              });
              return;
            }

            log.warn("支付失败，尝试降级:", payErr);
            continue;
          }
        }

        // 按错误类型分类并加入冷却
        if (upstreamRes.status >= 400) {
          const errorBody = await upstreamRes.clone().text().catch(() => "");
          const category = categorizeError(upstreamRes.status, errorBody);
          if (category && category !== "payment_error") {
            recordModelError(model, category);
          }

          if (i < modelsToTry.length - 1) {
            deduplicator.removeInflight(dedupKey);
            log.warn(`模型 ${model} 返回 ${upstreamRes.status} (${category})，切换备用`);
            continue;
          }
        }

        // Read full body for caching + dedup
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

        // 注入余额不足警告（含 auto-topup 提示）
        if (balanceWarningEmitted) {
          try {
            const parsed = JSON.parse(responseBody);
            parsed._router_warning = {
              ...(balanceWarningDetail ?? {}),
              actual_model: model,
            };
            responseBody = JSON.stringify(parsed);
          } catch {
            // 非 JSON 响应，忽略
          }
        }

        // Complete dedup
        deduplicator.complete(dedupKey, {
          status: upstreamRes.status,
          headers: responseHeaders,
          body: responseBody,
          completedAt: Date.now(),
        });

        // Populate response cache
        responseCache.set(ResponseCache.generateKey(upstreamBody), {
          body: responseBody,
          status: upstreamRes.status,
          headers: responseHeaders,
          model,
        });

        // Send response
        res.status(upstreamRes.status);
        for (const [k, v] of Object.entries(responseHeaders)) {
          res.setHeader(k, v);
        }
        if (balanceWarningEmitted) {
          res.setHeader("X-Router-Warning", "insufficient_balance:switched_to_free");
        }
        if (wasTruncated) {
          res.setHeader("X-Router-Truncated", "true");
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
        // ===== Streaming path: heartbeat + relay =====
        upstreamRes = await fetchWithRetry(upstreamUrl, {
          method: "POST",
          headers,
          body: upstreamBody,
        });

        // Handle 402
        if (upstreamRes.status === 402) {
          log.info("Received 402 (stream), initiating x402 payment...");
          try {
            upstreamRes = await handleX402Payment(
              upstreamRes,
              upstreamUrl,
              headers,
              upstreamBody,
            );
            if (upstreamRes.status >= 200 && upstreamRes.status < 300) {
              const cost = MODEL_PRICES[model] ?? 0.01;
              spendControl.record(cost, model);
            }
          } catch (payErr) {
            if (payErr instanceof InsufficientBalanceError) {
              log.warn("USDC 余额不足（流式），降级至免费模型");
              balanceWarningEmitted = true;
              const walletStatus = checkWalletStatus();
              balanceWarningDetail = buildTopupWarning(
                getXLayerUsdcBalance(),
                walletStatus.address,
              ) as any;
              const remaining = modelsToTry.slice(i + 1);
              if (!remaining.some((m) => isFreeModel(m))) {
                modelsToTry.push(...freeFallbackModels());
              }
              continue;
            }
            if (payErr instanceof PaymentBlockedByScanError) {
              log.error(`支付被安全扫描拦截（流式）: ${payErr.reason}`);
              if (!res.headersSent) {
                res.status(403).json({
                  error: "payment_blocked_by_security_scan",
                  message: payErr.message,
                });
              }
              return;
            }
            if (payErr instanceof PaymentReplayRejectedError) {
              log.error(`支付重放失败（流式）: ${payErr.message}`);
              if (!res.headersSent) {
                res.status(402).json({
                  error: "payment_rejected_after_signing",
                  message: payErr.message,
                });
              }
              return;
            }
            log.warn("支付失败（流式），尝试降级:", payErr);
            continue;
          }
        }

        // 按错误类型分类（流式）
        if (upstreamRes.status >= 400) {
          const category = categorizeError(upstreamRes.status);
          if (category && category !== "payment_error") {
            recordModelError(model, category);
          }
          if (i < modelsToTry.length - 1) {
            log.warn(`模型 ${model} 返回 ${upstreamRes.status} (${category})，切换备用`);
            continue;
          }
        }

        // Set SSE headers and start streaming
        res.status(upstreamRes.status);
        for (const [key, value] of upstreamRes.headers.entries()) {
          if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
            res.setHeader(key, value);
          }
        }
        if (balanceWarningEmitted) {
          res.setHeader("X-Router-Warning", "insufficient_balance:switched_to_free");
        }
        if (wasTruncated) {
          res.setHeader("X-Router-Truncated", "true");
        }

        if (!upstreamRes.body) {
          res.end();
          return;
        }

        // Inject balance warning as SSE comment
        if (balanceWarningEmitted) {
          res.write(buildBalanceWarningSSE(model, checkWalletStatus().address));
        }

        // Start SSE heartbeat to prevent client timeout (ported from ClawRouter)
        let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
        if (!res.destroyed) {
          res.write(": heartbeat\n\n");
          heartbeatInterval = setInterval(() => {
            if (!res.destroyed && !res.writableEnded) {
              res.write(": heartbeat\n\n");
            } else {
              clearInterval(heartbeatInterval);
              heartbeatInterval = undefined;
            }
          }, HEARTBEAT_INTERVAL_MS);
        }

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
          log.debug("Stream relay interrupted:", err);
        } finally {
          if (heartbeatInterval) clearInterval(heartbeatInterval);
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

      // Detect backend unreachable
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

function buildBalanceWarningSSE(
  fallbackModel: string,
  walletAddress?: string,
): string {
  return [
    `: [OKX Router] USDC 余额不足 — 已切换至免费模型: ${fallbackModel}`,
    walletAddress
      ? `: [OKX Router] 请向该地址充值 X-Layer USDC: ${walletAddress}`
      : `: [OKX Router] 充值地址: https://web3.okx.com/onchainos（X Layer 网络）`,
    `: [OKX Router] 开启自动补仓: /policy autoTopup.enabled=true`,
    "",
  ].join("\n");
}
