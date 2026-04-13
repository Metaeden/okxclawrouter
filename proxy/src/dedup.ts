/**
 * Request Deduplication
 *
 * Ported from ClawRouter's production-grade deduplication system.
 * Prevents double-charging when retries arrive for an identical in-flight request.
 * Tracks in-flight requests and caches completed responses for a short TTL.
 *
 * Features:
 * - Inflight request coalescing (duplicate requests wait on the first)
 * - Completed response caching with TTL
 * - Canonicalized + timestamp-stripped hashing for consistent keys
 * - Proper waiter notification on failure (503 so they can retry)
 */

import { createHash } from "node:crypto";

export type CachedResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  completedAt: number;
};

type InflightEntry = {
  resolvers: Array<(result: CachedResponse) => void>;
};

const DEFAULT_TTL_MS = 30_000; // 30 seconds
const MAX_BODY_SIZE = 1_048_576; // 1MB

/**
 * Canonicalize JSON by sorting object keys recursively.
 * Ensures identical logical content produces identical string regardless of field order.
 */
function canonicalize(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalize);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = canonicalize((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

/**
 * Strip OpenClaw-injected timestamps from message content.
 * Format: [DAY YYYY-MM-DD HH:MM TZ] at the start of messages.
 * Example: [SUN 2026-02-07 13:30 PST] Hello world
 *
 * This ensures requests with different timestamps but same content hash identically.
 */
const TIMESTAMP_PATTERN = /^\[\w{3}\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+\w+\]\s*/;

function stripTimestamps(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripTimestamps);
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === "content" && typeof value === "string") {
      result[key] = value.replace(TIMESTAMP_PATTERN, "");
    } else {
      result[key] = stripTimestamps(value);
    }
  }
  return result;
}

export class RequestDeduplicator {
  private inflight = new Map<string, InflightEntry>();
  private completed = new Map<string, CachedResponse>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** Hash request body to create a dedup key. */
  static hash(body: string): string {
    let content = body;
    try {
      const parsed = JSON.parse(body);
      const stripped = stripTimestamps(parsed);
      const canonical = canonicalize(stripped);
      content = JSON.stringify(canonical);
    } catch {
      // Not valid JSON, use raw string
    }
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /** Check if a response is cached for this key. */
  getCached(key: string): CachedResponse | undefined {
    const entry = this.completed.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.completedAt > this.ttlMs) {
      this.completed.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Check if a request with this key is currently in-flight. Returns a promise to wait on. */
  getInflight(key: string): Promise<CachedResponse> | undefined {
    const entry = this.inflight.get(key);
    if (!entry) return undefined;
    return new Promise<CachedResponse>((resolve) => {
      entry.resolvers.push(resolve);
    });
  }

  /** Mark a request as in-flight. */
  markInflight(key: string): void {
    this.inflight.set(key, {
      resolvers: [],
    });
  }

  /** Complete an in-flight request — cache result and notify waiters. */
  complete(key: string, result: CachedResponse): void {
    // Only cache responses within size limit
    if (Buffer.byteLength(result.body) <= MAX_BODY_SIZE) {
      this.completed.set(key, result);
    }

    const entry = this.inflight.get(key);
    if (entry) {
      for (const resolve of entry.resolvers) {
        resolve(result);
      }
      this.inflight.delete(key);
    }

    this.prune();
  }

  /**
   * Remove an in-flight entry on error (don't cache failures).
   * Also resolves any waiters with a 503 so they can retry independently.
   */
  removeInflight(key: string): void {
    const entry = this.inflight.get(key);
    if (entry) {
      const errorBody = JSON.stringify({
        error: {
          message: "Original request failed, please retry",
          type: "dedup_origin_failed",
        },
      });
      for (const resolve of entry.resolvers) {
        resolve({
          status: 503,
          headers: { "content-type": "application/json" },
          body: errorBody,
          completedAt: Date.now(),
        });
      }
      this.inflight.delete(key);
    }
  }

  /** Prune expired completed entries. */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.completed) {
      if (now - entry.completedAt > this.ttlMs) {
        this.completed.delete(key);
      }
    }
  }
}
