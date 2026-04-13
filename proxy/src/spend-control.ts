/**
 * Spend Control with Rolling Window Limits
 *
 * Ported from ClawRouter's production-grade spend control.
 * Enforces multi-tier spending limits (per-request, hourly, daily, session)
 * to prevent USDC budget overruns on paid models.
 *
 * Features:
 * - Rolling window limits (hourly, daily)
 * - Per-request ceiling
 * - Session-scoped budget
 * - Reset-time calculation for client retry logic
 */

import { log } from "./logger.js";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface SpendLimits {
  /** Maximum cost per single request in USD. Default: no limit */
  perRequest?: number;
  /** Maximum spend in rolling 1-hour window in USD. Default: no limit */
  hourly?: number;
  /** Maximum spend in rolling 24-hour window in USD. Default: no limit */
  daily?: number;
  /** Maximum spend for entire session in USD. Default: no limit */
  session?: number;
}

export interface CheckResult {
  allowed: boolean;
  blockedBy?: "perRequest" | "hourly" | "daily" | "session";
  /** Remaining budget in the blocked window (USD) */
  remaining?: number;
  /** Seconds until the blocking window resets (for rolling limits) */
  resetIn?: number;
  message?: string;
}

interface SpendRecord {
  timestamp: number;
  amount: number;
  model?: string;
}

const DEFAULT_LIMITS: SpendLimits = {
  perRequest: 0.05, // $0.05 max per request
  hourly: 1.0,      // $1/hour
  daily: 10.0,      // $10/day
  session: undefined, // No session limit by default
};

export class SpendControl {
  private limits: SpendLimits;
  private history: SpendRecord[] = [];
  private sessionSpent = 0;

  constructor(limits?: Partial<SpendLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  /**
   * Check if a request with estimated cost is allowed.
   */
  check(estimatedCost: number): CheckResult {
    const now = Date.now();

    // Per-request check
    if (this.limits.perRequest !== undefined) {
      if (estimatedCost > this.limits.perRequest) {
        return {
          allowed: false,
          blockedBy: "perRequest",
          remaining: this.limits.perRequest,
          message: `Request cost $${estimatedCost.toFixed(4)} exceeds per-request limit $${this.limits.perRequest.toFixed(4)}`,
        };
      }
    }

    // Hourly rolling window
    if (this.limits.hourly !== undefined) {
      const windowStart = now - HOUR_MS;
      const hourlySpent = this.getSpendingInWindow(windowStart, now);
      const remaining = this.limits.hourly - hourlySpent;

      if (estimatedCost > remaining) {
        const oldestInWindow = this.getOldestInWindow(windowStart, now);
        const resetIn = oldestInWindow
          ? Math.ceil((oldestInWindow.timestamp + HOUR_MS - now) / 1000)
          : 3600;

        return {
          allowed: false,
          blockedBy: "hourly",
          remaining: Math.max(0, remaining),
          resetIn,
          message: `Hourly limit reached ($${hourlySpent.toFixed(4)}/$${this.limits.hourly.toFixed(4)}). Resets in ${resetIn}s`,
        };
      }
    }

    // Daily rolling window
    if (this.limits.daily !== undefined) {
      const windowStart = now - DAY_MS;
      const dailySpent = this.getSpendingInWindow(windowStart, now);
      const remaining = this.limits.daily - dailySpent;

      if (estimatedCost > remaining) {
        const oldestInWindow = this.getOldestInWindow(windowStart, now);
        const resetIn = oldestInWindow
          ? Math.ceil((oldestInWindow.timestamp + DAY_MS - now) / 1000)
          : 86400;

        return {
          allowed: false,
          blockedBy: "daily",
          remaining: Math.max(0, remaining),
          resetIn,
          message: `Daily limit reached ($${dailySpent.toFixed(4)}/$${this.limits.daily.toFixed(4)}). Resets in ${resetIn}s`,
        };
      }
    }

    // Session limit
    if (this.limits.session !== undefined) {
      const remaining = this.limits.session - this.sessionSpent;
      if (estimatedCost > remaining) {
        return {
          allowed: false,
          blockedBy: "session",
          remaining: Math.max(0, remaining),
          message: `Session limit reached ($${this.sessionSpent.toFixed(4)}/$${this.limits.session.toFixed(4)})`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a completed spend.
   */
  record(amount: number, model?: string): void {
    this.history.push({ timestamp: Date.now(), amount, model });
    this.sessionSpent += amount;
    this.cleanup();

    log.debug(
      `Spend recorded: $${amount.toFixed(4)} (session total: $${this.sessionSpent.toFixed(4)})`,
    );
  }

  /**
   * Get total spending in a time window.
   */
  private getSpendingInWindow(from: number, to: number): number {
    return this.history
      .filter((r) => r.timestamp >= from && r.timestamp <= to)
      .reduce((sum, r) => sum + r.amount, 0);
  }

  /**
   * Get oldest record in a time window (for reset-time calculation).
   */
  private getOldestInWindow(from: number, to: number): SpendRecord | undefined {
    return this.history.find((r) => r.timestamp >= from && r.timestamp <= to);
  }

  /**
   * Remove records older than 24 hours (no longer relevant).
   */
  private cleanup(): void {
    const cutoff = Date.now() - DAY_MS;
    this.history = this.history.filter((r) => r.timestamp >= cutoff);
  }

  /**
   * Get spending summary.
   */
  getSummary(): {
    sessionSpent: number;
    hourlySpent: number;
    dailySpent: number;
    limits: SpendLimits;
  } {
    const now = Date.now();
    return {
      sessionSpent: this.sessionSpent,
      hourlySpent: this.getSpendingInWindow(now - HOUR_MS, now),
      dailySpent: this.getSpendingInWindow(now - DAY_MS, now),
      limits: { ...this.limits },
    };
  }

  /**
   * Update limits at runtime (e.g., from CLI command).
   */
  setLimits(limits: Partial<SpendLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }

  /**
   * Reset session spending counter.
   */
  resetSession(): void {
    this.sessionSpent = 0;
  }
}
