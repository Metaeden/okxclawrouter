import { execFileSync } from "child_process";
import { log } from "./logger.js";
import { getOnchainosBin } from "./onchainos-bin.js";

// X-Layer 上 USDC 合约地址
const XLAYER_USDC = "0x74b7f16337b8972027f6196a17a631ac6de26d22";
// X-Layer 原生 OKB（native token）
const XLAYER_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
// USDC 精度 6 位
const USDC_DECIMALS = 6;

export interface TopupConfig {
  /** 是否启用自动换币补仓 */
  enabled: boolean;
  /** USDC 余额低于此阈值时触发（美元单位） */
  triggerBelowUsd: number;
  /** 单次最大换入 USDC 金额（美元单位） */
  maxTopupUsd: number;
  /** 换出来源：native = OKB，usdt = USDT on XLayer */
  fromToken: "native" | "usdt";
}

export const DEFAULT_TOPUP_CONFIG: TopupConfig = {
  enabled: false,
  triggerBelowUsd: 0.5,
  maxTopupUsd: 5.0,
  fromToken: "native",
};

export interface TopupResult {
  success: boolean;
  txHash?: string;
  amountUsd?: number;
  error?: string;
}

/**
 * 获取换币报价（只查不执行）。
 * 返回: 能换到多少 USDC（美元值），以及所需 OKB 数量。
 */
export function getTopupQuote(
  walletAddress: string,
  targetUsd: number,
): { feasible: boolean; fromAmount?: string; toAmount?: string; chain: string } {
  try {
    const toAmount = BigInt(Math.round(targetUsd * 10 ** USDC_DECIMALS)).toString();

    const args = [
      "swap", "quote",
      "--from", XLAYER_NATIVE,
      "--to", XLAYER_USDC,
      "--amount", toAmount,
      "--chain", "xlayer",
    ];

    log.debug(`查询换币报价: onchainos ${args.join(" ")}`);
    const output = execFileSync(getOnchainosBin(), args, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 15_000,
    });

    const parsed = JSON.parse(output);
    const fromAmount = parsed?.data?.fromTokenAmount ?? parsed?.data?.routerResult?.fromTokenAmount;

    if (!fromAmount) {
      return { feasible: false, chain: "xlayer" };
    }

    return {
      feasible: true,
      fromAmount,
      toAmount,
      chain: "xlayer",
    };
  } catch (err: any) {
    log.warn("获取换币报价失败:", err?.message);
    return { feasible: false, chain: "xlayer" };
  }
}

/**
 * 执行自动补仓：将 OKB 换成 USDC。
 * 使用 onchainos agentic wallet 会话直接执行，无需手动签名。
 *
 * 注意：仅当 policy.autoTopup.enabled = true 时调用。
 */
export async function executeAutoTopup(
  walletAddress: string,
  config: TopupConfig,
): Promise<TopupResult> {
  if (!config.enabled) {
    return { success: false, error: "自动补仓未启用" };
  }

  const targetUsd = config.maxTopupUsd;
  const toAmount = BigInt(Math.round(targetUsd * 10 ** USDC_DECIMALS)).toString();

  try {
    // Step 1: 获取 swap 数据
    const swapArgs = [
      "swap", "swap",
      "--from", XLAYER_NATIVE,
      "--to", XLAYER_USDC,
      "--amount", toAmount,
      "--chain", "xlayer",
      "--wallet", walletAddress,
    ];

    log.info(`自动补仓: onchainos ${swapArgs.join(" ")}`);
    const swapOutput = execFileSync(getOnchainosBin(), swapArgs, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });

    const swapData = JSON.parse(swapOutput);
    const tx = swapData?.data?.tx ?? swapData?.data;

    if (!tx?.to || !tx?.data) {
      return { success: false, error: "swap 返回的交易数据不完整" };
    }

    // Step 2: 广播交易（agentic wallet 直接签名）
    const broadcastArgs = [
      "wallet", "contract-call",
      "--to", tx.to,
      "--chain", "xlayer",
      "--input-data", tx.data,
      ...(tx.value && tx.value !== "0" ? ["--value", tx.value] : []),
    ];

    log.info(`广播补仓交易: onchainos ${broadcastArgs.join(" ")}`);
    const broadcastOutput = execFileSync(getOnchainosBin(), broadcastArgs, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60_000,
    });

    const broadcastResult = JSON.parse(broadcastOutput);
    const txHash = broadcastResult?.data?.txHash ?? broadcastResult?.data?.orderId;

    if (!txHash) {
      return { success: false, error: "广播成功但未返回 txHash" };
    }

    log.info(`自动补仓成功: 换入约 $${targetUsd} USDC，txHash=${txHash}`);
    return {
      success: true,
      txHash,
      amountUsd: targetUsd,
    };
  } catch (err: any) {
    const msg = err?.stderr?.toString() || err?.message || "未知错误";
    log.error("自动补仓失败:", msg);
    return { success: false, error: msg.slice(0, 200) };
  }
}

/**
 * 构造余额不足时的提示信息（用于注入响应）。
 */
export function buildTopupWarning(
  currentBalance: string | undefined,
  walletAddress?: string,
  topupResult?: TopupResult,
): object {
  if (topupResult?.success) {
    return {
      type: "auto_topup_success",
      message: `自动补仓成功：换入约 $${topupResult.amountUsd} USDC`,
      txHash: topupResult.txHash,
    };
  }

  return {
    type: "insufficient_balance",
    message: walletAddress
      ? `USDC 余额不足（当前: ${currentBalance ?? "未知"}）。请向下方地址充值 X-Layer USDC，充值后重试。`
      : `USDC 余额不足（当前: ${currentBalance ?? "未知"}）。请充值 X-Layer USDC 后重试。`,
    rechargeAddress: walletAddress,
    network: "X Layer",
    asset: "USDC",
    action: walletAddress
      ? `请通过 OKX Wallet 或 OKX App 向该地址充值 USDC（X Layer）: ${walletAddress}`
      : "请通过 OKX Wallet 或 OKX App 充值 X Layer USDC",
    topupHint: "设置 /policy topup.enabled=true 可开启自动换币补仓",
  };
}
