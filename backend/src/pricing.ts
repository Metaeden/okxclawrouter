// Per-request fixed pricing (V1 — simple, revisit in V2 for dynamic token-based pricing)
export const MODEL_PRICES: Record<string, string> = {
  "paid/claude-sonnet-4": "$0.01",
  "paid/gpt-5.4": "$0.01",
  "paid/gemini-3.1-pro": "$0.008",
};

export const DEFAULT_PRICE = "$0.01";

export function getPrice(modelId: string): string {
  return MODEL_PRICES[modelId] || DEFAULT_PRICE;
}
