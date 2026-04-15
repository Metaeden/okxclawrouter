import { execFileSync } from "child_process";
import { log } from "./logger.js";
import { scanPaymentTransaction, extractPaymentTarget } from "./security-scanner.js";
import { loadPolicy } from "./policy.js";
import { checkWalletStatus } from "./onchainos-wallet.js";
import { getOnchainosBin } from "./onchainos-bin.js";

interface PaymentResult {
  signature: string;
  authorization: object;
  sessionCert?: string;
}

interface PaymentRequirement {
  x402Version?: number;
  resource?: unknown;
  accepted?: unknown;
  accepts?: unknown[];
}

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly required?: string,
    public readonly available?: string,
  ) {
    super("USDC 余额不足，无法完成支付");
    this.name = "InsufficientBalanceError";
  }
}

export class PaymentBlockedByScanError extends Error {
  constructor(public readonly reason: string) {
    super(`支付被安全扫描拦截: ${reason}`);
    this.name = "PaymentBlockedByScanError";
  }
}

export class PaymentReplayRejectedError extends Error {
  constructor(public readonly status: number) {
    super(`支付已签名，但后端未接受支付凭证（重放后仍返回 ${status}）`);
    this.name = "PaymentReplayRejectedError";
  }
}

/**
 * 处理 HTTP 402 响应：提取支付要求 → 安全扫描 → onchainos 签名 → 带支付头重试。
 *
 * 安全扫描（onchainos security tx-scan）在签名前执行：
 *   - action=block → 抛出 PaymentBlockedByScanError，终止支付
 *   - action=warn  → 记录警告，根据 policy.security.allowWarnLevel 决定是否继续
 *   - 扫描失败    → 根据 policy.security.blockOnScanFailure 决定是否拦截
 */
export async function handleX402Payment(
  response: Response,
  originalUrl: string,
  originalHeaders: Record<string, string>,
  originalBody: string,
): Promise<Response> {
  const policy = loadPolicy();
  const paymentStart = Date.now();

  // Step 1: 解析 402 payload（支持 v2 header 和 v1 body 两种协议）
  let accepts: unknown[];
  let requirement: PaymentRequirement | undefined;

  const paymentRequired = response.headers.get("PAYMENT-REQUIRED");
  if (paymentRequired) {
    requirement = JSON.parse(
      Buffer.from(paymentRequired, "base64").toString(),
    ) as PaymentRequirement;
    accepts = requirement.accepted
      ? [requirement.accepted]
      : (requirement.accepts ?? []);
  } else {
    requirement = (await response.json()) as PaymentRequirement;
    accepts = requirement.accepts ?? [];
  }

  // Step 2: 支付前安全扫描（如 policy 开启）
  if (policy.security.scanPayments) {
    const walletStatus = checkWalletStatus();
    const fromAddress = walletStatus.address;

    if (fromAddress) {
      const target = extractPaymentTarget(accepts as any[], fromAddress);
      if (target) {
        log.info(`安全扫描: chain=${target.chain} to=${target.to}`);
        const scanResult = scanPaymentTransaction(target);

        if (scanResult.action === "block") {
          throw new PaymentBlockedByScanError(
            scanResult.reason ?? "目标地址被标记为高风险",
          );
        }

        if (scanResult.action === "warn") {
          log.warn(`支付扫描 WARN: ${scanResult.reason}`);
          if (!policy.security.allowWarnLevel) {
            throw new PaymentBlockedByScanError(
              `风险提示（policy 配置为拒绝 warn 级别）: ${scanResult.reason}`,
            );
          }
        }
      } else {
        log.debug("无法提取支付目标，跳过安全扫描");
      }
    } else {
      log.debug("未获取到钱包地址，跳过安全扫描");
    }
  }

  // Step 3: 通过 onchainos 签名
  const acceptsJson = JSON.stringify(accepts);
  log.debug("x402 支付请求:", acceptsJson);
  log.info("开始 x402 签名");

  let paymentResult: PaymentResult;
  try {
    const output = execFileSync(
      getOnchainosBin(),
      ["payment", "x402-pay", "--accepts", acceptsJson],
      { encoding: "utf-8", stdio: "pipe", timeout: 15_000 },
    );
    paymentResult = JSON.parse(output);
    log.info(`x402 签名完成 (${Date.now() - paymentStart}ms)`);
  } catch (err: any) {
    const stderr = err?.stderr?.toString() || err?.message || "";
    log.error("x402 签名失败:", stderr);

    if (
      stderr.includes("insufficient") ||
      stderr.includes("balance") ||
      stderr.includes("not enough") ||
      stderr.includes("余额")
    ) {
      const price = (accepts[0] as any)?.price ?? (accepts[0] as any)?.maxAmountRequired;
      throw new InsufficientBalanceError(price);
    }

    throw new Error("支付签名失败。请运行 /wallet status 检查钱包状态。");
  }

  // Step 4: 构造支付请求头
  let headerName: string;
  let headerValue: string;

  if (paymentRequired) {
    // v2 协议
    headerName = "PAYMENT-SIGNATURE";
    headerValue = Buffer.from(
      JSON.stringify({
        x402Version: requirement?.x402Version ?? 2,
        resource: requirement?.resource ?? { url: originalUrl },
        accepted: accepts[0],
        payload: paymentResult,
      }),
    ).toString("base64");
  } else {
    // v1 协议
    headerName = "X-PAYMENT";
    headerValue = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: (accepts[0] as any).scheme,
        network: (accepts[0] as any).network,
        payload: paymentResult,
      }),
    ).toString("base64");
  }

  // Step 5: 带支付凭证重试原始请求（120s 超时）
  log.info("开始重放付费请求");
  const replayResponse = await fetch(originalUrl, {
    method: "POST",
    headers: {
      ...originalHeaders,
      [headerName]: headerValue,
    },
    body: originalBody,
    signal: AbortSignal.timeout(120_000),
  });
  log.info(
    `付费请求重放完成: status=${replayResponse.status} elapsed=${Date.now() - paymentStart}ms`,
  );
  if (replayResponse.status === 402) {
    throw new PaymentReplayRejectedError(replayResponse.status);
  }
  return replayResponse;
}
