import { execSync, execFileSync } from "child_process";
import { log } from "./logger.js";
import { getOnchainosBin } from "./onchainos-bin.js";
import { isXLayerUsdtAsset } from "./payment-token.js";

export interface WalletStatus {
  loggedIn: boolean;
  address?: string;      // X-Layer EVM 地址（支付主链）
  email?: string;
  balance?: string;
}

export interface ChainBalance {
  chainIndex: string;
  chainName: string;
  symbol: string;
  balance: string;
  usdValue?: string;
}

export interface WalletPortfolio {
  totalUsdValue?: string;
  xlayerUsdt?: string;        // X-Layer USDT 余额（支付用）
  allChainBalances: ChainBalance[];
}

// onchainos 支持的链名映射（chainIndex → 可读名）
const CHAIN_NAMES: Record<string, string> = {
  "196": "X-Layer",
  "1":   "Ethereum",
  "56":  "BSC",
  "137": "Polygon",
  "42161": "Arbitrum",
  "8453":  "Base",
  "10":    "Optimism",
  "501":   "Solana",
};

export function isOnchainosInstalled(): boolean {
  try {
    execFileSync(getOnchainosBin(), ["--version"], { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function checkWalletStatus(): WalletStatus {
  try {
    const onchainosBin = getOnchainosBin();
    const [statusOut, addrsOut] = [
      execFileSync(onchainosBin, ["wallet", "status"], { encoding: "utf-8", stdio: "pipe" }),
      execFileSync(onchainosBin, ["wallet", "addresses"], { encoding: "utf-8", stdio: "pipe" }),
    ];
    const status = JSON.parse(statusOut);
    const addrs = JSON.parse(addrsOut);
    const inner = status?.data;
    const xlayerAddr = addrs?.data?.xlayer?.[0]?.address;
    return {
      loggedIn: inner?.loggedIn === true,
      address: xlayerAddr || inner?.evmAddress,
      email: inner?.email,
      balance: undefined,
    };
  } catch (err) {
    log.debug("钱包状态检查失败:", err);
    return { loggedIn: false };
  }
}

/**
 * 获取 X-Layer USDT 余额（支付用）。
 * chainIndex "196" = X-Layer。
 */
export function getXLayerUsdtBalance(): string | undefined {
  try {
    const output = execFileSync(getOnchainosBin(), ["wallet", "balance"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    const data = JSON.parse(output);
    const details: any[] = data?.data?.details || [];
    const assets = details.flatMap((detail) => detail?.tokenAssets || []);
    const usdt = assets.find(isXLayerUsdtAsset);
    return usdt?.balance;
  } catch {
    return undefined;
  }
}

/**
 * 获取完整多链 portfolio，包含所有链上的 USDT 和主流代币余额。
 * 利用 onchainos wallet balance 返回的 details 数组。
 */
export function getWalletPortfolio(): WalletPortfolio {
  try {
    const output = execFileSync(getOnchainosBin(), ["wallet", "balance"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 15_000,
    });
    const data = JSON.parse(output);
    const details: any[] = data?.data?.details || [];
    const totalUsdValue: string | undefined = data?.data?.totalUsdValue;

    const allChainBalances: ChainBalance[] = [];
    let xlayerUsdt: string | undefined;

    for (const detail of details) {
      const tokenAssets: any[] = detail?.tokenAssets || [];
      for (const asset of tokenAssets) {
        const chainIdx = asset.chainIndex;
        const balance = asset.balance;
        const symbol = asset.symbol ?? asset.tokenSymbol ?? "";
        if (!balance || parseFloat(balance) === 0) continue;

        allChainBalances.push({
          chainIndex: chainIdx,
          chainName: CHAIN_NAMES[chainIdx] ?? `Chain-${chainIdx}`,
          symbol,
          balance,
          usdValue: asset.usdValue,
        });

        // 记录 X-Layer USDT（支付用）
        if (isXLayerUsdtAsset(asset)) {
          xlayerUsdt = balance;
        }
      }
    }

    return { totalUsdValue, xlayerUsdt, allChainBalances };
  } catch (err) {
    log.warn("获取 portfolio 失败:", err);
    return { allChainBalances: [] };
  }
}

/**
 * 格式化 portfolio 为可读文本（用于 /wallet portfolio CLI 命令）。
 */
export function formatPortfolio(portfolio: WalletPortfolio): string {
  const lines: string[] = [];
  if (portfolio.totalUsdValue) {
    lines.push(`总资产: $${portfolio.totalUsdValue}`);
  }
  if (portfolio.xlayerUsdt) {
    lines.push(`X-Layer USDT（支付余额）: ${portfolio.xlayerUsdt}`);
  }
  lines.push("");
  lines.push("多链余额明细:");
  if (portfolio.allChainBalances.length === 0) {
    lines.push("  （暂无资产）");
  } else {
    for (const b of portfolio.allChainBalances) {
      const usd = b.usdValue ? ` ≈ $${b.usdValue}` : "";
      lines.push(`  [${b.chainName}] ${b.balance} ${b.symbol}${usd}`);
    }
  }
  return lines.join("\n");
}

export function walletLogin(email: string): void {
  execFileSync(getOnchainosBin(), ["wallet", "login", email], { stdio: "inherit" });
}

export function walletLogout(): void {
  execFileSync(getOnchainosBin(), ["wallet", "logout"], { stdio: "inherit" });
}
