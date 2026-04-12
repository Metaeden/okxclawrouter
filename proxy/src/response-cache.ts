import crypto from "crypto";

interface CacheEntry {
  body: string;
  status: number;
  headers: Record<string, string>;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 200;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheKey(model: string, messages: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${model}:${messages}`)
    .digest("hex")
    .slice(0, 20);
  return hash;
}

export function getCached(
  model: string,
  messages: string,
): CacheEntry | null {
  const key = cacheKey(model, messages);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function setCache(
  model: string,
  messages: string,
  body: string,
  status: number,
  headers: Record<string, string>,
): void {
  // Only cache successful, non-streaming responses
  if (status !== 200) return;

  const key = cacheKey(model, messages);

  // Evict oldest if full
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    )[0];
    if (oldest) cache.delete(oldest[0]);
  }

  cache.set(key, { body, status, headers, timestamp: Date.now() });
}

export function clearCache(): void {
  cache.clear();
}
