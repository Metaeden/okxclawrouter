import { describe, it, expect, beforeEach } from "vitest";
import { SpendControl } from "../spend-control.js";

describe("SpendControl", () => {
  let sc: SpendControl;

  beforeEach(() => {
    sc = new SpendControl({
      perRequest: 0.05,
      hourly: 1.0,
      daily: 10.0,
      session: 5.0,
    });
  });

  it("should allow requests within limits", () => {
    const result = sc.check(0.01);
    expect(result.allowed).toBe(true);
  });

  it("should block requests exceeding per-request limit", () => {
    const result = sc.check(0.10);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe("perRequest");
  });

  it("should block when session limit is exceeded", () => {
    // Use a spend control with only session limit to isolate the test
    const sessionOnly = new SpendControl({
      perRequest: undefined,
      hourly: undefined,
      daily: undefined,
      session: 0.05,
    });

    sessionOnly.record(0.04);
    expect(sessionOnly.check(0.01).allowed).toBe(true);

    sessionOnly.record(0.01);
    expect(sessionOnly.check(0.01).allowed).toBe(false);
    expect(sessionOnly.check(0.01).blockedBy).toBe("session");
  });

  it("should track spending in getSummary", () => {
    sc.record(0.01, "paid/claude-sonnet-4-6");
    sc.record(0.01, "paid/gpt-5.4");

    const summary = sc.getSummary();
    expect(summary.sessionSpent).toBeCloseTo(0.02);
    expect(summary.hourlySpent).toBeCloseTo(0.02);
    expect(summary.dailySpent).toBeCloseTo(0.02);
  });

  it("should allow updating limits at runtime", () => {
    sc.setLimits({ perRequest: 1.0 });
    expect(sc.check(0.50).allowed).toBe(true);
  });

  it("should reset session spending", () => {
    sc.record(4.0);
    expect(sc.check(2.0).allowed).toBe(false); // over session limit

    sc.resetSession();
    // hourly/daily still have the $4.0 record, but session is reset
    const summary = sc.getSummary();
    expect(summary.sessionSpent).toBe(0);
  });

  it("should work with no limits (unlimited)", () => {
    const unlimited = new SpendControl({
      perRequest: undefined,
      hourly: undefined,
      daily: undefined,
      session: undefined,
    });

    expect(unlimited.check(1000).allowed).toBe(true);
  });

  it("should include resetIn for rolling window limits", () => {
    // Fill up hourly limit
    for (let i = 0; i < 100; i++) {
      sc.record(0.01);
    }

    const result = sc.check(0.01);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toBe("hourly");
    expect(result.resetIn).toBeGreaterThan(0);
    expect(result.resetIn).toBeLessThanOrEqual(3600);
  });
});
