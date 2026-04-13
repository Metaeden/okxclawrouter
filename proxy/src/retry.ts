/**
 * Retry Logic for OKXClawRouter
 *
 * Ported from ClawRouter's production-grade retry system.
 * Provides fetch wrapper with exponential backoff for transient errors.
 * Supports Retry-After header parsing (common with 429 rate limits).
 */

import { log } from "./logger.js";

/** Configuration for retry behavior */
export type RetryConfig = {
  /** Maximum number of retries (default: 2) */
  maxRetries: number;
  /** Base delay in ms for exponential backoff (default: 500) */
  baseDelayMs: number;
  /** HTTP status codes that trigger a retry (default: [429, 502, 503, 504]) */
  retryableCodes: number[];
};

/** Default retry configuration */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 500,
  retryableCodes: [429, 502, 503, 504],
};

/** Sleep for a given number of milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a fetch call with retry logic and exponential backoff.
 * Supports Retry-After header for 429 responses.
 * Does NOT retry on 402 (payment required) or other client errors.
 *
 * @param url - URL to fetch
 * @param init - Fetch init options
 * @param config - Retry configuration (optional, uses defaults)
 * @returns Response from successful fetch or last failed attempt
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  config?: Partial<RetryConfig>,
): Promise<Response> {
  const cfg: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: Error | undefined;
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // 402 payment required — never retry, caller handles x402 flow
      if (response.status === 402) {
        return response;
      }

      // Success or non-retryable status — return immediately
      if (!cfg.retryableCodes.includes(response.status)) {
        return response;
      }

      // Retryable status — save response and maybe retry
      lastResponse = response;

      // Only retry if we have attempts left
      if (attempt < cfg.maxRetries) {
        // Check for Retry-After header (common with 429)
        const retryAfter = response.headers.get("retry-after");
        let delay: number;

        if (retryAfter) {
          const seconds = parseInt(retryAfter, 10);
          delay = isNaN(seconds)
            ? cfg.baseDelayMs * Math.pow(2, attempt)
            : seconds * 1000;
        } else {
          delay = cfg.baseDelayMs * Math.pow(2, attempt);
        }

        log.warn(
          `Upstream returned ${response.status}, retrying in ${delay}ms (attempt ${attempt + 1}/${cfg.maxRetries})`,
        );
        await sleep(delay);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Network errors are retryable
      if (attempt < cfg.maxRetries) {
        const delay = cfg.baseDelayMs * Math.pow(2, attempt);
        log.warn(
          `Fetch failed, retrying in ${delay}ms (attempt ${attempt + 1}/${cfg.maxRetries}):`,
          lastError.message,
        );
        await sleep(delay);
      }
    }
  }

  // All retries exhausted — return last response or throw last error
  if (lastResponse) {
    return lastResponse;
  }

  throw lastError ?? new Error("Max retries exceeded");
}

/**
 * Check if an error or response indicates a retryable condition.
 */
export function isRetryable(
  errorOrResponse: Error | Response,
  config?: Partial<RetryConfig>,
): boolean {
  const retryableCodes = config?.retryableCodes ?? DEFAULT_RETRY_CONFIG.retryableCodes;

  if (errorOrResponse instanceof Response) {
    return retryableCodes.includes(errorOrResponse.status);
  }

  // Network errors are generally retryable
  const message = errorOrResponse.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("socket hang up")
  );
}
