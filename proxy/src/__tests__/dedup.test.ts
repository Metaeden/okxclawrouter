import { describe, it, expect, vi } from "vitest";
import { dedup } from "../dedup.js";

describe("dedup", () => {
  it("should return the same promise for identical concurrent requests", async () => {
    let callCount = 0;
    const executor = () => {
      callCount++;
      return Promise.resolve(new Response("ok"));
    };

    const body = JSON.stringify({ model: "test", messages: [{ role: "user", content: "hi" }] });
    const [r1, r2] = await Promise.all([dedup(body, executor), dedup(body, executor)]);

    expect(callCount).toBe(1);
  });

  it("should execute separately for different request bodies", async () => {
    let callCount = 0;
    const executor = () => {
      callCount++;
      return Promise.resolve(new Response("ok"));
    };

    const body1 = JSON.stringify({ model: "a" });
    const body2 = JSON.stringify({ model: "b" });
    await Promise.all([dedup(body1, executor), dedup(body2, executor)]);

    expect(callCount).toBe(2);
  });
});
