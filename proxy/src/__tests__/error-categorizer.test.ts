import { describe, it, expect, beforeEach } from "vitest";
import {
  categorizeError,
  recordModelError,
  isModelAvailable,
  getModelCooldown,
  clearCooldowns,
  getCooldownStatus,
} from "../error-categorizer.js";

describe("error-categorizer", () => {
  beforeEach(() => {
    clearCooldowns();
  });

  it("should categorize 401 as auth_failure", () => {
    expect(categorizeError(401)).toBe("auth_failure");
  });

  it("should categorize 429 as rate_limited", () => {
    expect(categorizeError(429)).toBe("rate_limited");
  });

  it("should categorize 529 as overloaded", () => {
    expect(categorizeError(529)).toBe("overloaded");
  });

  it("should categorize 402 as payment_error", () => {
    expect(categorizeError(402)).toBe("payment_error");
  });

  it("should categorize 500 as server_error", () => {
    expect(categorizeError(500)).toBe("server_error");
  });

  it("should categorize 500 with quota body as quota_exceeded", () => {
    expect(categorizeError(500, "insufficient_quota limit reached")).toBe("quota_exceeded");
  });

  it("should categorize 404 as config_error", () => {
    expect(categorizeError(404)).toBe("config_error");
  });

  it("should return null for 200", () => {
    expect(categorizeError(200)).toBeNull();
  });

  it("should put model in cooldown after error", () => {
    expect(isModelAvailable("test-model")).toBe(true);

    recordModelError("test-model", "rate_limited");

    expect(isModelAvailable("test-model")).toBe(false);
    expect(getModelCooldown("test-model")).toBe("rate_limited");
  });

  it("should list active cooldowns", () => {
    recordModelError("model-a", "rate_limited");
    recordModelError("model-b", "overloaded");

    const cooldowns = getCooldownStatus();
    expect(cooldowns.length).toBe(2);
    expect(cooldowns.find((c) => c.model === "model-a")?.category).toBe("rate_limited");
  });

  it("should clear all cooldowns", () => {
    recordModelError("model-a", "rate_limited");
    clearCooldowns();
    expect(isModelAvailable("model-a")).toBe(true);
  });
});
