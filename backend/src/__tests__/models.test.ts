import { describe, it, expect } from "vitest";
import { MODEL_MAP, MODEL_LIST, resolveModel } from "../models.js";

describe("models", () => {
  it("should have 5 models defined", () => {
    expect(Object.keys(MODEL_MAP)).toHaveLength(5);
  });

  it("should have 2 free and 3 paid models", () => {
    const free = MODEL_LIST.filter((m) => m.tier === "free");
    const paid = MODEL_LIST.filter((m) => m.tier === "paid");
    expect(free).toHaveLength(2);
    expect(paid).toHaveLength(3);
  });

  it("should resolve known models to OpenRouter IDs", () => {
    expect(resolveModel("openrouter/free")).toBe(
      "openrouter/free",
    );
    expect(resolveModel("paid/claude-sonnet-4-6")).toBe(
      "anthropic/claude-sonnet-4-6",
    );
  });

  it("should pass through unknown models unchanged", () => {
    expect(resolveModel("custom/model")).toBe("custom/model");
  });

  it("should have all free model IDs start with 'free/'", () => {
    for (const m of MODEL_LIST.filter((m) => m.tier === "free")) {
      expect(
        m.id === "openrouter/free" || m.id.endsWith(":free"),
      ).toBe(true);
    }
  });

  it("should have all paid model IDs start with 'paid/'", () => {
    for (const m of MODEL_LIST.filter((m) => m.tier === "paid")) {
      expect(m.id).toMatch(/^paid\//);
    }
  });
});
