import { describe, it, expect, vi } from "vitest";
import { fetchWithRetry, isRetryable } from "../retry.js";

// Mock logger to silence test output
vi.mock("../logger.js", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("fetchWithRetry", () => {
  it("should return immediately on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const res = await fetchWithRetry("http://test.com", { method: "POST" });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("should not retry on 402 (payment required)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("payment", { status: 402 }));
    vi.stubGlobal("fetch", mockFetch);

    const res = await fetchWithRetry("http://test.com", { method: "POST" });
    expect(res.status).toBe(402);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("should retry on 429 and respect Retry-After header", async () => {
    const headers429 = new Headers({ "Retry-After": "1" });
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: headers429 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const res = await fetchWithRetry("http://test.com", { method: "POST" }, {
      maxRetries: 1,
      baseDelayMs: 10,
    });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("should retry on 5xx errors", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("error", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const res = await fetchWithRetry("http://test.com", { method: "POST" }, {
      maxRetries: 1,
      baseDelayMs: 10,
    });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("should return last response after exhausting retries", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("error", { status: 503 }));
    vi.stubGlobal("fetch", mockFetch);

    const res = await fetchWithRetry("http://test.com", { method: "POST" }, {
      maxRetries: 1,
      baseDelayMs: 10,
    });
    expect(res.status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("should retry on network errors", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const res = await fetchWithRetry("http://test.com", { method: "POST" }, {
      maxRetries: 1,
      baseDelayMs: 10,
    });
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("should throw after exhausting retries on network errors", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      fetchWithRetry("http://test.com", { method: "POST" }, {
        maxRetries: 1,
        baseDelayMs: 10,
      }),
    ).rejects.toThrow("connection refused");
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("should not retry on client errors (4xx except 429)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", mockFetch);

    const res = await fetchWithRetry("http://test.com", { method: "POST" });
    expect(res.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});

describe("isRetryable", () => {
  it("should return true for 429 and 5xx responses", () => {
    expect(isRetryable(new Response("", { status: 429 }))).toBe(true);
    expect(isRetryable(new Response("", { status: 502 }))).toBe(true);
    expect(isRetryable(new Response("", { status: 503 }))).toBe(true);
    expect(isRetryable(new Response("", { status: 504 }))).toBe(true);
  });

  it("should return false for 200 and 400 responses", () => {
    expect(isRetryable(new Response("", { status: 200 }))).toBe(false);
    expect(isRetryable(new Response("", { status: 400 }))).toBe(false);
  });

  it("should return true for network-related errors", () => {
    expect(isRetryable(new Error("network error"))).toBe(true);
    expect(isRetryable(new Error("timeout"))).toBe(true);
    expect(isRetryable(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryable(new Error("socket hang up"))).toBe(true);
  });

  it("should return false for non-network errors", () => {
    expect(isRetryable(new Error("syntax error"))).toBe(false);
  });
});
