import { describe, it, expect, beforeEach } from "vitest";
import { route } from "../router/simple-router.js";
import config from "../config.js";

describe("simple-router", () => {
  beforeEach(() => {
    config.forcedTier = null;
  });

  it("should route to free model when wallet not connected", () => {
    const decision = route(
      [{ role: "user", content: "Hello" }],
      undefined,
      false,
    );
    expect(decision.tier).toBe("FREE");
    expect(decision.model).toBe("free/deepseek-chat");
  });

  it("should route to paid model when wallet is connected", () => {
    const decision = route(
      [{ role: "user", content: "Hello" }],
      undefined,
      true,
    );
    expect(decision.tier).toBe("PAID");
    expect(decision.model).toBe("paid/claude-sonnet-4");
  });

  it("should detect reasoning signals and pick reasoning model", () => {
    const decision = route(
      [{ role: "user", content: "Please think step by step about this problem" }],
      undefined,
      false,
    );
    expect(decision.tier).toBe("FREE");
    expect(decision.model).toBe("free/deepseek-r1");
  });

  it("should pick paid reasoning model when wallet connected", () => {
    const decision = route(
      [{ role: "user", content: "Prove this theorem carefully" }],
      undefined,
      true,
    );
    expect(decision.tier).toBe("PAID");
    expect(decision.model).toBe("paid/gemini-3.1-pro");
  });

  it("should use explicitly requested model", () => {
    const decision = route(
      [{ role: "user", content: "Hello" }],
      "paid/gpt-5.4",
      true,
    );
    expect(decision.tier).toBe("PAID");
    expect(decision.model).toBe("paid/gpt-5.4");
    expect(decision.fallbacks).toHaveLength(0);
  });

  it("should respect forcedTier=free", () => {
    config.forcedTier = "free";
    const decision = route(
      [{ role: "user", content: "Hello" }],
      undefined,
      true,
    );
    expect(decision.tier).toBe("FREE");
    expect(decision.model).toBe("free/deepseek-chat");
  });

  it("should respect forcedTier=paid", () => {
    config.forcedTier = "paid";
    const decision = route(
      [{ role: "user", content: "Hello" }],
      undefined,
      false,
    );
    expect(decision.tier).toBe("PAID");
    expect(decision.model).toBe("paid/claude-sonnet-4");
  });

  it("should include fallbacks", () => {
    const decision = route(
      [{ role: "user", content: "Hello" }],
      undefined,
      true,
    );
    expect(decision.fallbacks.length).toBeGreaterThan(0);
  });

  it("should handle auto model same as undefined", () => {
    const d1 = route([{ role: "user", content: "Hi" }], "auto", false);
    const d2 = route([{ role: "user", content: "Hi" }], undefined, false);
    expect(d1.model).toBe(d2.model);
  });
});
