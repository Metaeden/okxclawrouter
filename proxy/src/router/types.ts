export type Tier = "FREE" | "PAID";

export interface RoutingDecision {
  tier: Tier;
  model: string;
  fallbacks: string[];
}

export interface ChatMessage {
  role: string;
  content: string;
}
