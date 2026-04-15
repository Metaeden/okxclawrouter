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
        asset: "USDC",
        action: "向该地址充值 USDC（X Layer）: 0xabc123",
      }),
    );
  });

  it("falls back to generic guidance when address is unavailable", () => {
    const warning = buildTopupWarning("0.00");

    expect(warning).toEqual(
      expect.objectContaining({
        type: "insufficient_balance",
        rechargeAddress: undefined,
        action: "前往 https://web3.okx.com/onchainos 充值 USDC（X Layer 网络）",
      }),
    );
  });
});
