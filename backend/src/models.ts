export interface ModelDef {
  id: string;
  openRouterId: string;
  tier: "free" | "paid";
  description: string;
}

export const MODEL_MAP: Record<string, string> = {
  // FREE tier — explicitly zero-cost models on OpenRouter
  "openrouter/free": "openrouter/free",
  "qwen/qwen3-coder:free": "qwen/qwen3-coder:free",
  // PAID tier
  "paid/claude-sonnet-4-6": "anthropic/claude-sonnet-4-6",
  "paid/gpt-5.4": "openai/gpt-5.4",
  "paid/gemini-3.1-pro": "google/gemini-3.1-pro-preview",
};

export const MODEL_LIST: ModelDef[] = Object.entries(MODEL_MAP).map(
  ([id, openRouterId]) => ({
    id,
    openRouterId,
    tier: id.startsWith("paid/") ? ("paid" as const) : ("free" as const),
    description: id,
  }),
);

export function resolveModel(internalId: string): string {
  return MODEL_MAP[internalId] || internalId;
}
