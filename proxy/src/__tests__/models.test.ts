import { describe, it, expect } from "vitest";
import {
  FREE_MODELS,
  PAID_MODELS,
  ALL_MODELS,
  isValidModel,
} from "../models.js";

describe("proxy models", () => {
  it("should have 1 free model", () => {
    expect(FREE_MODELS).toHaveLength(1);
  });

  it("should have 3 paid models", () => {
    expect(PAID_MODELS).toHaveLength(3);
  });

  it("ALL_MODELS should be free + paid combined", () => {
    expect(ALL_MODELS).toHaveLength(4);
  });

  it("should validate known models", () => {
    expect(isValidModel("openrouter/free")).toBe(true);
    expect(isValidModel("paid/claude-sonnet-4-6")).toBe(true);
  });

  it("should reject unknown models", () => {
    expect(isValidModel("unknown/model")).toBe(false);
  });
});
