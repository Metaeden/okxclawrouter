import { describe, it, expect, beforeEach } from "vitest";
import { stats } from "../stats.js";

describe("stats", () => {
  beforeEach(() => {
    stats.clear();
  });

  it("should start with zero stats", () => {
    const s = stats.getSummary();
    expect(s.totalRequests).toBe(0);
    expect(s.successRate).toBe(0);
  });

  it("should track recorded requests", () => {
    stats.record({
      model: "free/deepseek-chat",
      tier: "FREE",
      timestamp: Date.now(),
      latencyMs: 100,
      success: true,
    });
    stats.record({
      model: "paid/claude-sonnet-4-6",
      tier: "PAID",
      timestamp: Date.now(),
      latencyMs: 200,
      success: true,
    });

    const s = stats.getSummary();
    expect(s.totalRequests).toBe(2);
    expect(s.freeRequests).toBe(1);
    expect(s.paidRequests).toBe(1);
    expect(s.successRate).toBe(100);
    expect(s.avgLatencyMs).toBe(150);
  });

  it("should compute correct success rate with failures", () => {
    stats.record({
      model: "free/deepseek-chat",
      tier: "FREE",
      timestamp: Date.now(),
      latencyMs: 50,
      success: true,
    });
    stats.record({
      model: "free/deepseek-chat",
      tier: "FREE",
      timestamp: Date.now(),
      latencyMs: 50,
      success: false,
    });

    expect(stats.getSummary().successRate).toBe(50);
  });

  it("should track model breakdown", () => {
    stats.record({
      model: "free/deepseek-chat",
      tier: "FREE",
      timestamp: Date.now(),
      latencyMs: 100,
      success: true,
    });
    stats.record({
      model: "free/deepseek-chat",
      tier: "FREE",
      timestamp: Date.now(),
      latencyMs: 100,
      success: true,
    });

    const s = stats.getSummary();
    expect(s.modelBreakdown["free/deepseek-chat"]).toBe(2);
  });
});
