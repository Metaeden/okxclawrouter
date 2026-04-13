import { describe, it, expect, beforeEach } from "vitest";
import { ResponseCache } from "../response-cache.js";

describe("ResponseCache", () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache({ maxSize: 10, defaultTTL: 60 });
  });

  it("should return undefined for uncached entry", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("should cache and retrieve a response", () => {
    const key = ResponseCache.generateKey('{"model":"test","messages":[]}');
    cache.set(key, {
      body: '{"response": "ok"}',
      status: 200,
      headers: { "content-type": "application/json" },
      model: "test",
    });

    const cached = cache.get(key);
    expect(cached).toBeDefined();
    expect(cached!.body).toBe('{"response": "ok"}');
    expect(cached!.status).toBe(200);
    expect(cached!.model).toBe("test");
  });

  it("should not cache error responses (status >= 400)", () => {
    const key = "error-key";
    cache.set(key, {
      body: "error",
      status: 500,
      headers: {},
      model: "test",
    });
    expect(cache.get(key)).toBeUndefined();
  });

  it("should clear all cache entries", () => {
    cache.set("k1", { body: "b1", status: 200, headers: {}, model: "m1" });
    cache.set("k2", { body: "b2", status: 200, headers: {}, model: "m2" });
    cache.clear();
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("k2")).toBeUndefined();
  });

  it("should generate consistent canonical keys regardless of field order", () => {
    const key1 = ResponseCache.generateKey(
      '{"model":"test","messages":[{"role":"user","content":"hello"}]}',
    );
    const key2 = ResponseCache.generateKey(
      '{"messages":[{"content":"hello","role":"user"}],"model":"test"}',
    );
    expect(key1).toBe(key2);
  });

  it("should strip stream/user/request_id from cache key", () => {
    const key1 = ResponseCache.generateKey(
      '{"model":"test","messages":[],"stream":true,"user":"abc","request_id":"123"}',
    );
    const key2 = ResponseCache.generateKey(
      '{"model":"test","messages":[]}',
    );
    expect(key1).toBe(key2);
  });

  it("should evict entries when at capacity", () => {
    const smallCache = new ResponseCache({ maxSize: 2, defaultTTL: 60 });
    smallCache.set("k1", { body: "b1", status: 200, headers: {}, model: "m1" });
    smallCache.set("k2", { body: "b2", status: 200, headers: {}, model: "m2" });
    smallCache.set("k3", { body: "b3", status: 200, headers: {}, model: "m3" });

    // k1 should have been evicted
    const stats = smallCache.getStats();
    expect(stats.size).toBeLessThanOrEqual(2);
    expect(stats.evictions).toBeGreaterThan(0);
  });

  it("should track hit/miss stats", () => {
    cache.set("k1", { body: "b1", status: 200, headers: {}, model: "m1" });
    cache.get("k1"); // hit
    cache.get("k1"); // hit
    cache.get("nonexistent"); // miss

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe("66.7%");
  });

  it("should respect shouldCache with cache-control header", () => {
    expect(cache.shouldCache("{}", { "cache-control": "no-cache" })).toBe(false);
    expect(cache.shouldCache("{}", {})).toBe(true);
  });

  it("should respect shouldCache with body params", () => {
    expect(cache.shouldCache('{"cache":false}')).toBe(false);
    expect(cache.shouldCache('{"no_cache":true}')).toBe(false);
    expect(cache.shouldCache('{"model":"test"}')).toBe(true);
  });

  it("should not cache items exceeding maxItemSize", () => {
    const tinyCache = new ResponseCache({ maxSize: 10, maxItemSize: 10 });
    tinyCache.set("k1", {
      body: "x".repeat(100),
      status: 200,
      headers: {},
      model: "m1",
    });
    expect(tinyCache.get("k1")).toBeUndefined();
  });
});
