import { describe, expect, it } from "vitest";
import { buildTopupWarning } from "../auto-topup.js";

describe("buildTopupWarning", () => {
  it("includes direct wallet recharge guidance when address is available", () => {
    const warning = buildTopupWarning("0.00", "0xabc123");

    expect(warning).toEqual(
      expect.objectContaining({
        type: "insufficient_balance",
        rechargeAddress: "0xabc123",
        network: "X Layer",
        asset: "USDT",
        action: "请通过 OKX Wallet 或 OKX App 向这个地址充值 USDT（X Layer）: 0xabc123",
      }),
    );
  });

  it("falls back to generic guidance when address is unavailable", () => {
    const warning = buildTopupWarning("0.00");

    expect(warning).toEqual(
      expect.objectContaining({
        type: "insufficient_balance",
        rechargeAddress: "0x3e08a5ee55ef0eeaccfd3cd34a4f10c981ca6b55",
        asset: "USDT",
        action: "请通过 OKX Wallet 或 OKX App 向这个地址充值 USDT（X Layer）: 0x3e08a5ee55ef0eeaccfd3cd34a4f10c981ca6b55",
      }),
    );
  });
});
