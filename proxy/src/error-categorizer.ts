/**
 * Error Categorization with Per-Model Cooldowns
 *
 * Ported from ClawRouter's production-grade error handling.
 * Categorizes upstream API errors and tracks per-model cooldowns
 * to avoid thrashing failed models.
 */

import { log } from "./logger.js";

export type ErrorCategory =
  | "auth_failure"
  | "rate_limited"
  | "overloaded"
  | "quota_exceeded"
  | "server_error"
  | "payment_error"
  | "config_error";

/** Cooldown durations by error category (ms) */
const COOLDOWN_MS: Record<ErrorCategory, number> = {
  auth_failure: 300_000, // 5 min — won't fix itself
  rate_limited: 60_000,  // 60s — standard rate limit window
  overloaded: 15_000,    // 15s — recover quickly
  quota_exceeded: 300_000, // 5 min — billing issue
  server_error: 30_000,  // 30s — transient
  payment_error: 60_000, // 60s — x402 retry window
  config_error: 600_000, // 10 min — needs human fix
};

/** Per-model cooldown state */
const modelCooldowns = new Map<string, { category: ErrorCategory; until: number }>();

/**
 * Categorize an HTTP error response from upstream.
 */
export function categorizeError(
  status: number,
  body?: string,
): ErrorCategory | null {
  // Auth failures
  if (status === 401 || status === 403) return "auth_failure";

  // Rate limiting
  if (status === 429) return "rate_limited";

  // Overloaded (Anthropic uses 529)
  if (status === 529) return "overloaded";

  // Payment required — x402 flow
  if (status === 402) return "payment_error";

  // Server errors
  if (status >= 500) {
    // Check body for quota/billing indicators
    if (body) {
      const lower = body.toLowerCase();
      if (
        lower.includes("quota") ||
        lower.includes("billing") ||
        lower.includes("insufficient_quota")
      ) {
        return "quota_exceeded";
      }
    }
    return "server_error";
  }

  // Client errors — check for config issues
  if (status === 404 || status === 422) return "config_error";

  return null;
}

/**
 * Record that a model hit an error — enters cooldown.
 */
export function recordModelError(modelId: string, category: ErrorCategory): void {
  const cooldown = COOLDOWN_MS[category];
  const until = Date.now() + cooldown;

  modelCooldowns.set(modelId, { category, until });
  log.warn(
    `Model ${modelId} entered cooldown: ${category} (${cooldown / 1000}s)`,
  );
}

/**
 * Check if a model is currently in cooldown.
 * Returns the error category if in cooldown, null otherwise.
 */
export function getModelCooldown(modelId: string): ErrorCategory | null {
  const entry = modelCooldowns.get(modelId);
  if (!entry) return null;

  if (Date.now() >= entry.until) {
    modelCooldowns.delete(modelId);
    return null;
  }

  return entry.category;
}

/**
 * Check if a model is available (not in cooldown).
 */
export function isModelAvailable(modelId: string): boolean {
  return getModelCooldown(modelId) === null;
}

/**
 * Clear all cooldowns (for testing or manual reset).
 */
export function clearCooldowns(): void {
  modelCooldowns.clear();
}

/**
 * Get cooldown status for all models (for /stats display).
 */
export function getCooldownStatus(): Array<{
  model: string;
  category: ErrorCategory;
  remainingMs: number;
}> {
  const now = Date.now();
  const result: Array<{ model: string; category: ErrorCategory; remainingMs: number }> = [];

  for (const [model, entry] of modelCooldowns) {
    if (now < entry.until) {
      result.push({
        model,
        category: entry.category,
        remainingMs: entry.until - now,
      });
    } else {
      modelCooldowns.delete(model);
    }
  }

  return result;
}
