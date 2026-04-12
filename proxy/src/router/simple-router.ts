import type { ChatMessage, RoutingDecision } from "./types.js";
import config from "../config.js";

const FREE = {
  general: "free/deepseek-chat",
  reasoning: "free/deepseek-r1",
  fallbacks: ["free/qwen3"],
};

const PAID = {
  general: "paid/claude-sonnet-4",
  reasoning: "paid/gemini-3.1-pro",
  fallbacks: ["paid/gpt-5.4"],
};

const REASONING_SIGNALS = [
  /step.?by.?step/i,
  /think.*carefully/i,
  /reason/i,
  /prove/i,
  /analyze.*complex/i,
  /chain.?of.?thought/i,
];

function needsReasoning(text: string): boolean {
  return REASONING_SIGNALS.some((r) => r.test(text));
}

export function route(
  messages: ChatMessage[],
  requestedModel?: string,
  walletConnected?: boolean,
): RoutingDecision {
  // User explicitly specified a model
  if (requestedModel && requestedModel !== "auto") {
    const tier = requestedModel.startsWith("paid/") ? "PAID" : "FREE";
    return { tier, model: requestedModel, fallbacks: [] } as RoutingDecision;
  }

  // Forced tier override from CLI
  if (config.forcedTier === "free") {
    const last = messages[messages.length - 1]?.content || "";
    return {
      tier: "FREE",
      model: needsReasoning(last) ? FREE.reasoning : FREE.general,
      fallbacks: FREE.fallbacks,
    };
  }
  if (config.forcedTier === "paid") {
    const last = messages[messages.length - 1]?.content || "";
    return {
      tier: "PAID",
      model: needsReasoning(last) ? PAID.reasoning : PAID.general,
      fallbacks: [...PAID.fallbacks, ...FREE.fallbacks],
    };
  }

  const lastMessage = messages[messages.length - 1]?.content || "";
  const reasoning = needsReasoning(lastMessage);

  // No wallet → free only
  if (!walletConnected) {
    return {
      tier: "FREE",
      model: reasoning ? FREE.reasoning : FREE.general,
      fallbacks: FREE.fallbacks,
    };
  }

  // Wallet connected → paid with free fallback
  return {
    tier: "PAID",
    model: reasoning ? PAID.reasoning : PAID.general,
    fallbacks: [...PAID.fallbacks, ...FREE.fallbacks],
  };
}
