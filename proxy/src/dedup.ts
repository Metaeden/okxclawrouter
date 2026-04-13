import crypto from "crypto";

interface PendingRequest {
  promise: Promise<Response>;
  timestamp: number;
}

const pending = new Map<string, PendingRequest>();
const DEDUP_WINDOW_MS = 500; // Deduplicate identical requests within 500ms

function hashRequest(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/**
 * Deduplicate identical requests arriving within a short window.
 * Returns cached promise if a duplicate is in-flight, or null if this is new.
 */
export function dedup(
  body: string,
  executor: () => Promise<Response>,
): Promise<Response> {
  const key = hashRequest(body);
  const now = Date.now();

  // Clean expired entries
  for (const [k, v] of pending) {
    if (now - v.timestamp > DEDUP_WINDOW_MS) {
      pending.delete(k);
    }
  }

  const existing = pending.get(key);
  if (existing && now - existing.timestamp < DEDUP_WINDOW_MS) {
    return existing.promise;
  }

  const promise = executor()
    .catch((err: unknown) => {
      // On rejection, immediately remove so next caller retries fresh
      pending.delete(key);
      throw err;
    })
    .finally(() => {
      setTimeout(() => pending.delete(key), DEDUP_WINDOW_MS);
    });

  pending.set(key, { promise, timestamp: now });
  return promise;
}
