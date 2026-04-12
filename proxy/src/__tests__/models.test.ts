import { describe, it, expect } from "vitest";
import {
  FREE_MODELS,
  PAID_MODELS,
  ALL_MODELS,
  isValidModel,
} from "../models.js";

describe("proxy models", () => {
  it("should have 3 free models", () => {
    expect(FREE_MODELS).toHaveLength(3);
  });

  it("should have 3 paid models", () => {
    expect(PAID_MODELS).toHaveLength(3);
  });

  it("ALL_MODELS should be free + paid combined", () => {
    expect(ALL_MODELS).toHaveLength(6);
  });

  it("should validate known models", () => {
    expect(isValidModel("free/deepseek-chat")).toBe(true);
    expect(isValidModel("paid/claude-sonnet-4")).toBe(true);
  });

  it("should reject unknown models", () => {
    expect(isValidModel("unknown/model")).toBe(false);
  });
});
