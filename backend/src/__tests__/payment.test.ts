import { afterEach, describe, expect, it, vi } from "vitest";

describe("payment scheme config", () => {
  afterEach(() => {
    delete process.env.OKCLAWROUTER_PAYMENT_SCHEME;
    vi.resetModules();
  });

  it("defaults to aggr_deferred", async () => {
    const { getConfiguredPaymentScheme } = await import("../payment.js");
    expect(getConfiguredPaymentScheme()).toBe("aggr_deferred");
  });

  it("accepts exact when explicitly configured", async () => {
    process.env.OKCLAWROUTER_PAYMENT_SCHEME = "exact";
    const { getConfiguredPaymentScheme } = await import("../payment.js");
    expect(getConfiguredPaymentScheme()).toBe("exact");
  });

  it("rejects unsupported values", async () => {
    process.env.OKCLAWROUTER_PAYMENT_SCHEME = "batch";
    const { getConfiguredPaymentScheme } = await import("../payment.js");
    expect(() => getConfiguredPaymentScheme()).toThrow(
      /Invalid OKCLAWROUTER_PAYMENT_SCHEME/,
    );
  });
});
