export interface Model {
  id: string;
  tier: "free" | "paid";
}

export const FREE_MODELS: Model[] = [
  { id: "free/deepseek-chat", tier: "free" },
  { id: "free/deepseek-r1", tier: "free" },
  { id: "free/qwen3", tier: "free" },
];

export const PAID_MODELS: Model[] = [
  { id: "paid/claude-sonnet-4", tier: "paid" },
  { id: "paid/gpt-5.4", tier: "paid" },
  { id: "paid/gemini-3.1-pro", tier: "paid" },
];

export const ALL_MODELS: Model[] = [...FREE_MODELS, ...PAID_MODELS];

export function isValidModel(id: string): boolean {
  return ALL_MODELS.some((m) => m.id === id);
}
