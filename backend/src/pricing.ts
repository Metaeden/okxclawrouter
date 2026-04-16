import { XLAYER_USDT_ADDRESS, XLAYER_USDT_DECIMALS } from "./payment-token.js";

export interface AssetPrice {
  asset: string;
  amount: string;
}

// Per-request fixed pricing denominated in USD / X-Layer USDT.
export const MODEL_PRICES: Record<string, string> = {
  "paid/claude-sonnet-4-6": "$0.01",
  "paid/gpt-5.4": "$0.01",
  "paid/gemini-3.1-pro": "$0.008",
};

export const DEFAULT_PRICE = "$0.01";

export function getPrice(modelId: string): string {
  return MODEL_PRICES[modelId] || DEFAULT_PRICE;
}

function parseUsdAmount(price: string): number {
  return Number(price.replace(/^\$/, ""));
}

export function getAssetPrice(modelId: string): AssetPrice {
  const usd = parseUsdAmount(getPrice(modelId));
  return {
    asset: XLAYER_USDT_ADDRESS,
    amount: BigInt(Math.round(usd * 10 ** XLAYER_USDT_DECIMALS)).toString(),
  };
}
