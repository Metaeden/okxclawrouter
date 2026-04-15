import { execFileSync } from "child_process";
import { log } from "./logger.js";
import { getOnchainosBin } from "./onchainos-bin.js";

export type ScanAction = "safe" | "warn" | "block";

export interface ScanResult {
  safe: boolean;
  action: ScanAction;
  reason?: string;
}

export interface PaymentTarget {
  chain: string;      // e.g. "xlayer", "base", "solana"
  from: string;       // 支付方钱包地址
  to: string;         // 收款方地址（ClawRouter 后端）
  amount?: string;    // 支付金额（可选，用于展示）
}

/**
 * 支付前安全扫描 — 对每笔 x402 链上支付执行 onchainos security tx-scan。
 *
 * 安全原则（fail-safe）：扫描失败 = 拒绝支付，不允许在扫描结果缺失时放行。
 * 对应 OKX wallet-security SKILL.md 中 "Fail-safe principle" 规定。
 */
export function scanPaymentTransaction(target: PaymentTarget): ScanResult {
  const { chain, from, to } = target;

  try {
    const args = [
      "security", "tx-scan",
      "--chain", chain,
      "--from", from,
      "--to", to,
    ];

    log.debug(`安全扫描: onchainos ${args.join(" ")}`);

    const output = execFileSync(getOnchainosBin(), args, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    });

    const parsed = JSON.parse(output);
    const action: ScanAction = parsed?.data?.action ?? "safe";
    const riskItems: any[] = parsed?.data?.riskItemDetail ?? [];
    const topRisk = riskItems[0];

    if (action === "block") {
      log.warn(`安全扫描 BLOCK: ${topRisk?.desc ?? "未知风险"} — 支付已拦截`);
      return {
        safe: false,
        action: "block",
        reason: topRisk?.desc ?? "目标地址被标记为高风险",
      };
    }

    if (action === "warn") {
      log.warn(`安全扫描 WARN: ${topRisk?.desc ?? "存在风险提示"}`);
      return {
        safe: true,  // warn 级别允许继续，但会在响应中注入警告
        action: "warn",
        reason: topRisk?.desc,
      };
    }

    log.debug(`安全扫描通过: ${chain} → ${to}`);
    return { safe: true, action: "safe" };
  } catch (err: any) {
    const msg = err?.stderr?.toString() || err?.message || "未知错误";
    log.error("安全扫描执行失败:", msg);

    // Fail-safe: 扫描失败时一律拦截支付
    return {
      safe: false,
      action: "block",
      reason: `安全扫描失败（${msg.slice(0, 80)}）— 为保护资产已阻止支付`,
    };
  }
}

/**
 * 从 x402 accepts payload 中提取 PaymentTarget。
 * accepts[0] 标准结构: { network, payTo, asset, maxAmountRequired }
 */
export function extractPaymentTarget(
  accepts: any[],
  fromAddress: string,
): PaymentTarget | null {
  const a = accepts?.[0];
  if (!a) return null;

  // x402 network 字段映射到 onchainos chain 名
  const networkMap: Record<string, string> = {
    "xlayer": "xlayer",
    "x-layer": "xlayer",
    "xlayer-mainnet": "xlayer",
    "base": "base",
    "base-mainnet": "base",
    "base-sepolia": "base",
    "solana": "solana",
    "solana-mainnet": "solana",
    "ethereum": "ethereum",
    "arbitrum": "arbitrum",
    "bsc": "bsc",
  };

  const network = a.network ?? "xlayer";
  const chain = networkMap[network.toLowerCase()] ?? "xlayer";
  const to = a.payTo ?? a.to ?? a.address;

  if (!to) {
    log.warn("无法从 x402 payload 提取收款地址，跳过安全扫描");
    return null;
  }

  return {
    chain,
    from: fromAddress,
    to,
    amount: a.maxAmountRequired,
  };
}
