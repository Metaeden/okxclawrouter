import { describe, it, expect } from "vitest";
import { getPrice, DEFAULT_PRICE, MODEL_PRICES } from "../pricing.js";

describe("pricing", () => {
  it("should return specific price for known paid models", () => {
    expect(getPrice("paid/claude-sonnet-4-6")).toBe("$0.01");
    expect(getPrice("paid/gpt-5.4")).toBe("$0.01");
    expect(getPrice("paid/gemini-3.1-pro")).toBe("$0.008");
  });

  it("should return default price for unknown models", () => {
    expect(getPrice("unknown/model")).toBe(DEFAULT_PRICE);
  });

  it("should have prices for all paid models", () => {
    const paidModels = [
      "paid/claude-sonnet-4-6",
      "paid/gpt-5.4",
      "paid/gemini-3.1-pro",
    ];
    for (const m of paidModels) {
      expect(MODEL_PRICES[m]).toBeDefined();
    }
  });
});
