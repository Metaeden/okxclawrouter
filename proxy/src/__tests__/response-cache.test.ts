import { describe, it, expect, beforeEach } from "vitest";
import { getCached, setCache, clearCache } from "../response-cache.js";

describe("response-cache", () => {
  beforeEach(() => {
    clearCache();
  });

  it("should return null for uncached entry", () => {
    expect(getCached("model", "messages")).toBeNull();
  });

  it("should cache and retrieve a response", () => {
    setCache("model", "messages", '{"response": "ok"}', 200, {
      "content-type": "application/json",
    });

    const cached = getCached("model", "messages");
    expect(cached).not.toBeNull();
    expect(cached!.body).toBe('{"response": "ok"}');
    expect(cached!.status).toBe(200);
  });

  it("should not cache non-200 responses", () => {
    setCache("model", "messages", "error", 500, {});
    expect(getCached("model", "messages")).toBeNull();
  });

  it("should clear all cache entries", () => {
    setCache("m1", "msg1", "body1", 200, {});
    setCache("m2", "msg2", "body2", 200, {});
    clearCache();
    expect(getCached("m1", "msg1")).toBeNull();
    expect(getCached("m2", "msg2")).toBeNull();
  });
});
