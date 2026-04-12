import { log } from "./logger.js";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Retry a fetch with exponential backoff.
 * Retries on 429 (rate limit) and 5xx (server errors).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);

      // Don't retry on 402 (payment required) or client errors
      if (res.status === 402 || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        return res;
      }

      // Retry on 429 or 5xx
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          log.warn(
            `Upstream returned ${res.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        log.warn(
          `Fetch failed, retrying in ${delay}ms (attempt ${attempt + 1}/${retries}):`,
          err,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}
