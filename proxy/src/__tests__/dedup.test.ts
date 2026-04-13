import { describe, it, expect } from "vitest";
import { RequestDeduplicator } from "../dedup.js";

describe("RequestDeduplicator", () => {
  it("should generate consistent hashes for identical JSON regardless of key order", () => {
    const hash1 = RequestDeduplicator.hash('{"model":"test","messages":[]}');
    const hash2 = RequestDeduplicator.hash('{"messages":[],"model":"test"}');
    expect(hash1).toBe(hash2);
  });

  it("should generate different hashes for different content", () => {
    const hash1 = RequestDeduplicator.hash('{"model":"a"}');
    const hash2 = RequestDeduplicator.hash('{"model":"b"}');
    expect(hash1).not.toBe(hash2);
  });

  it("should strip timestamps for consistent hashing", () => {
    const hash1 = RequestDeduplicator.hash(
      '{"messages":[{"role":"user","content":"[SUN 2026-02-07 13:30 PST] Hello"}]}',
    );
    const hash2 = RequestDeduplicator.hash(
      '{"messages":[{"role":"user","content":"[MON 2026-02-08 10:00 EST] Hello"}]}',
    );
    expect(hash1).toBe(hash2);
  });

  it("should coalesce inflight requests — second waiter gets same result", async () => {
    const dedup = new RequestDeduplicator(5000);
    const key = "test-key";

    // Mark as inflight
    dedup.markInflight(key);

    // Second request arrives and waits
    const waiterPromise = dedup.getInflight(key);
    expect(waiterPromise).toBeDefined();

    // Complete the original request
    const result = {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"result": "ok"}',
      completedAt: Date.now(),
    };
    dedup.complete(key, result);

    // Waiter should get the same result
    const waiterResult = await waiterPromise!;
    expect(waiterResult.status).toBe(200);
    expect(waiterResult.body).toBe('{"result": "ok"}');
  });

  it("should return cached completed response within TTL", () => {
    const dedup = new RequestDeduplicator(5000);
    const key = "cached-key";

    dedup.markInflight(key);
    dedup.complete(key, {
      status: 200,
      headers: {},
      body: "cached",
      completedAt: Date.now(),
    });

    const cached = dedup.getCached(key);
    expect(cached).toBeDefined();
    expect(cached!.body).toBe("cached");
  });

  it("should resolve waiters with 503 when inflight request fails", async () => {
    const dedup = new RequestDeduplicator(5000);
    const key = "fail-key";

    dedup.markInflight(key);

    const waiterPromise = dedup.getInflight(key);
    expect(waiterPromise).toBeDefined();

    // Remove inflight (error path)
    dedup.removeInflight(key);

    const result = await waiterPromise!;
    expect(result.status).toBe(503);
    expect(JSON.parse(result.body).error.type).toBe("dedup_origin_failed");
  });

  it("should return undefined for expired completed entries", () => {
    const dedup = new RequestDeduplicator(0); // 0ms TTL — immediately expires
    const key = "expire-key";

    dedup.markInflight(key);
    dedup.complete(key, {
      status: 200,
      headers: {},
      body: "old",
      completedAt: Date.now() - 1000,
    });

    expect(dedup.getCached(key)).toBeUndefined();
  });
});
