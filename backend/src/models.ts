export interface ModelDef {
  id: string;
  openRouterId: string;
  tier: "free" | "paid";
  description: string;
}

export const MODEL_MAP: Record<string, string> = {
  // FREE tier
  "free/deepseek-chat": "deepseek/deepseek-chat-v3-0324:free",
  "free/deepseek-r1": "deepseek/deepseek-r1:free",
  "free/qwen3": "qwen/qwen3-next-80b-a3b-instruct:free",
  // PAID tier
  "paid/claude-sonnet-4-6": "anthropic/claude-sonnet-4-6",
  "paid/gpt-5.4": "openai/gpt-5.4",
  "paid/gemini-3.1-pro": "google/gemini-3.1-pro-preview",
};

export const MODEL_LIST: ModelDef[] = Object.entries(MODEL_MAP).map(
  ([id, openRouterId]) => ({
    id,
    openRouterId,
    tier: id.startsWith("free/") ? ("free" as const) : ("paid" as const),
    description: id,
  }),
);

export function resolveModel(internalId: string): string {
  return MODEL_MAP[internalId] || internalId;
}
