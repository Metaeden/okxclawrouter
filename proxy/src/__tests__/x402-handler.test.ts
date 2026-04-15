import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  execFileSyncMock,
  loadPolicyMock,
  checkWalletStatusMock,
  extractPaymentTargetMock,
  scanPaymentTransactionMock,
  getOnchainosBinMock,
  logMock,
} = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  loadPolicyMock: vi.fn(),
  checkWalletStatusMock: vi.fn(),
  extractPaymentTargetMock: vi.fn(),
  scanPaymentTransactionMock: vi.fn(),
  getOnchainosBinMock: vi.fn(),
  logMock: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("../policy.js", () => ({
  loadPolicy: loadPolicyMock,
}));

vi.mock("../onchainos-wallet.js", () => ({
  checkWalletStatus: checkWalletStatusMock,
}));

vi.mock("../security-scanner.js", () => ({
  extractPaymentTarget: extractPaymentTargetMock,
  scanPaymentTransaction: scanPaymentTransactionMock,
}));

vi.mock("../onchainos-bin.js", () => ({
  getOnchainosBin: getOnchainosBinMock,
}));

vi.mock("../logger.js", () => ({
  log: logMock,
}));

import {
  handleX402Payment,
  InsufficientBalanceError,
  PaymentBlockedByScanError,
  PaymentReplayRejectedError,
} from "../x402-handler.js";

function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

describe("handleX402Payment", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);

    getOnchainosBinMock.mockReturnValue("/mock/onchainos");
    loadPolicyMock.mockReturnValue({
      security: {
        scanPayments: true,
        allowWarnLevel: true,
      },
    });
    checkWalletStatusMock.mockReturnValue({
      loggedIn: true,
      address: "0xfrom",
    });
    extractPaymentTargetMock.mockReturnValue({
      chain: "xlayer",
      from: "0xfrom",
      to: "0xto",
      amount: "0.01",
    });
    scanPaymentTransactionMock.mockReturnValue({
      safe: true,
      action: "safe",
    });
    execFileSyncMock.mockReturnValue(
      JSON.stringify({
        signature: "sig",
        authorization: { from: "0xfrom" },
      }),
    );
  });

  it("replays v2 payments with PAYMENT-SIGNATURE", async () => {
    const accepted = {
      scheme: "exact",
      network: "base",
      payTo: "0xto",
      maxAmountRequired: "0.01",
    };
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = new Response(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          x402Version: 2,
          resource: { url: "https://paid.example/v1/chat" },
          accepted,
        }),
      },
    });

    const replay = await handleX402Payment(
      response,
      "https://paid.example/v1/chat",
      { "content-type": "application/json" },
      '{"prompt":"hello"}',
    );

    expect(replay.status).toBe(200);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/mock/onchainos",
      ["payment", "x402-pay", "--accepts", JSON.stringify([accepted])],
      expect.objectContaining({ encoding: "utf-8", timeout: 15_000 }),
    );

    const [, replayInit] = fetchMock.mock.calls[0];
    const paymentHeader = (replayInit?.headers as Record<string, string>)["PAYMENT-SIGNATURE"];
    expect(paymentHeader).toBeTruthy();

    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
    expect(decoded).toMatchObject({
      x402Version: 2,
      resource: { url: "https://paid.example/v1/chat" },
      accepted,
      payload: {
        signature: "sig",
        authorization: { from: "0xfrom" },
      },
    });
  });

  it("unwraps onchainos CLI envelope before building PAYMENT-SIGNATURE", async () => {
    const accepted = {
      scheme: "exact",
      network: "eip155:196",
      payTo: "0xto",
      amount: "10000",
    };
    execFileSyncMock.mockReturnValue(
      JSON.stringify({
        ok: true,
        data: {
          signature: "sig",
          authorization: { from: "0xfrom", to: "0xto", value: "10000" },
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = new Response(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          x402Version: 2,
          resource: { url: "https://paid.example/v1/chat" },
          accepted,
        }),
      },
    });

    await handleX402Payment(
      response,
      "https://paid.example/v1/chat",
      { "content-type": "application/json" },
      '{"prompt":"hello"}',
    );

    const [, replayInit] = fetchMock.mock.calls[0];
    const paymentHeader = (replayInit?.headers as Record<string, string>)["PAYMENT-SIGNATURE"];
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
    expect(decoded.payload).toEqual({
      signature: "sig",
      authorization: { from: "0xfrom", to: "0xto", value: "10000" },
    });
  });

  it("moves aggr_deferred sessionCert into accepted.extra", async () => {
    const accepted = {
      scheme: "aggr_deferred",
      network: "eip155:196",
      payTo: "0xto",
      amount: "10000",
      extra: {
        name: "USDC",
        version: "2",
      },
    };
    execFileSyncMock.mockReturnValue(
      JSON.stringify({
        ok: true,
        data: {
          signature: "sig",
          authorization: { from: "0xfrom", to: "0xto", value: "10000" },
          sessionCert: "session-cert-123",
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = new Response(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          x402Version: 2,
          resource: { url: "https://paid.example/v1/chat" },
          accepted,
        }),
      },
    });

    await handleX402Payment(
      response,
      "https://paid.example/v1/chat",
      { "content-type": "application/json" },
      '{"prompt":"hello"}',
    );

    const [, replayInit] = fetchMock.mock.calls[0];
    const paymentHeader = (replayInit?.headers as Record<string, string>)["PAYMENT-SIGNATURE"];
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());

    expect(decoded.accepted).toEqual({
      ...accepted,
      extra: {
        name: "USDC",
        version: "2",
        sessionCert: "session-cert-123",
      },
    });
    expect(decoded.payload).toEqual({
      signature: "sig",
      authorization: { from: "0xfrom", to: "0xto", value: "10000" },
    });
  });

  it("replays v1 payments with X-PAYMENT", async () => {
    loadPolicyMock.mockReturnValue({
      security: {
        scanPayments: false,
        allowWarnLevel: true,
      },
    });
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 201 }));

    const response = new Response(
      JSON.stringify({
        accepts: [
          {
            scheme: "exact",
            network: "solana",
            payTo: "merchant",
            maxAmountRequired: "0.50",
          },
        ],
      }),
      {
        status: 402,
        headers: {
          "content-type": "application/json",
        },
      },
    );

    const replay = await handleX402Payment(
      response,
      "https://paid.example/v1/legacy",
      { authorization: "Bearer token" },
      '{"legacy":true}',
    );

    expect(replay.status).toBe(201);
    const [, replayInit] = fetchMock.mock.calls[0];
    const headers = replayInit?.headers as Record<string, string>;
    expect(headers["X-PAYMENT"]).toBeTruthy();
    expect(headers["PAYMENT-SIGNATURE"]).toBeUndefined();

    const decoded = JSON.parse(Buffer.from(headers["X-PAYMENT"], "base64").toString());
    expect(decoded).toMatchObject({
      x402Version: 1,
      scheme: "exact",
      network: "solana",
      payload: {
        signature: "sig",
        authorization: { from: "0xfrom" },
      },
    });
  });

  it("blocks warn-level payments when policy forbids them", async () => {
    loadPolicyMock.mockReturnValue({
      security: {
        scanPayments: true,
        allowWarnLevel: false,
      },
    });
    scanPaymentTransactionMock.mockReturnValue({
      safe: true,
      action: "warn",
      reason: "receiver has medium risk",
    });

    const response = new Response(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          accepted: { network: "base", payTo: "0xto", maxAmountRequired: "0.01" },
        }),
      },
    });

    await expect(
      handleX402Payment(
        response,
        "https://paid.example/v1/chat",
        {},
        '{"prompt":"hello"}',
      ),
    ).rejects.toBeInstanceOf(PaymentBlockedByScanError);

    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps signer balance failures to InsufficientBalanceError", async () => {
    loadPolicyMock.mockReturnValue({
      security: {
        scanPayments: false,
        allowWarnLevel: true,
      },
    });
    execFileSyncMock.mockImplementation(() => {
      const error = new Error("command failed") as Error & { stderr: Buffer };
      error.stderr = Buffer.from("insufficient balance");
      throw error;
    });

    const response = new Response(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          accepted: {
            network: "base",
            payTo: "0xto",
            maxAmountRequired: "1.23",
          },
        }),
      },
    });

    await expect(
      handleX402Payment(response, "https://paid.example/v1/chat", {}, "{}"),
    ).rejects.toEqual(expect.objectContaining<Partial<InsufficientBalanceError>>({
      name: "InsufficientBalanceError",
      required: "1.23",
    }));
  });

  it("maps replay insufficient_balance failures to InsufficientBalanceError", async () => {
    loadPolicyMock.mockReturnValue({
      security: {
        scanPayments: false,
        allowWarnLevel: true,
      },
    });
    fetchMock.mockResolvedValueOnce(new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          error: "insufficient_balance",
          accepted: { network: "base", payTo: "0xto", maxAmountRequired: "1.23" },
        }),
      },
    }));

    const response = new Response(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          accepted: { network: "base", payTo: "0xto", maxAmountRequired: "1.23" },
        }),
      },
    });

    await expect(
      handleX402Payment(response, "https://paid.example/v1/chat", {}, "{}"),
    ).rejects.toEqual(expect.objectContaining<Partial<InsufficientBalanceError>>({
      name: "InsufficientBalanceError",
      required: "1.23",
    }));
  });

  it("throws when replay still returns 402", async () => {
    loadPolicyMock.mockReturnValue({
      security: {
        scanPayments: false,
        allowWarnLevel: true,
      },
    });
    fetchMock.mockResolvedValueOnce(new Response("{}", {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          error: "invalid_session_cert",
          accepted: { network: "base", payTo: "0xto", maxAmountRequired: "0.01" },
        }),
      },
    }));

    const response = new Response(null, {
      status: 402,
      headers: {
        "PAYMENT-REQUIRED": encodeBase64Json({
          accepted: { network: "base", payTo: "0xto", maxAmountRequired: "0.01" },
        }),
      },
    });

    await expect(
      handleX402Payment(response, "https://paid.example/v1/chat", {}, "{}"),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PaymentReplayRejectedError>>({
        name: "PaymentReplayRejectedError",
        status: 402,
        responseBody: "error=invalid_session_cert",
      }),
    );
  });
});
