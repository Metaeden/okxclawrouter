import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer } from "@okxweb3/x402-express";
import { AggrDeferredEvmScheme } from "@okxweb3/x402-evm/deferred/server";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { XLAYER_NETWORK } from "./payment-token.js";

export type PaymentScheme = "exact" | "aggr_deferred";

export function getConfiguredPaymentScheme(): PaymentScheme {
  const raw = (process.env.OKCLAWROUTER_PAYMENT_SCHEME || "aggr_deferred").trim();
  if (raw === "exact" || raw === "aggr_deferred") {
    return raw;
  }
  throw new Error(
    `Invalid OKCLAWROUTER_PAYMENT_SCHEME: ${raw}. Expected "exact" or "aggr_deferred".`,
  );
}
const NETWORK = XLAYER_NETWORK;

export function createResourceServer(): x402ResourceServer {
  const apiKey = process.env.OKX_API_KEY;
  const secretKey = process.env.OKX_SECRET_KEY;
  const passphrase = process.env.OKX_PASSPHRASE;

  if (!apiKey || !secretKey || !passphrase) {
    throw new Error(
      "Missing OKX credentials. Set OKX_API_KEY, OKX_SECRET_KEY, OKX_PASSPHRASE.",
    );
  }

  const facilitatorClient = new OKXFacilitatorClient({
    apiKey,
    secretKey,
    passphrase,
  });

  const server = new x402ResourceServer(facilitatorClient);
  const scheme = getConfiguredPaymentScheme();

  if (scheme === "aggr_deferred") {
    server.register(NETWORK, new AggrDeferredEvmScheme());
  } else {
    registerExactEvmScheme(server, { networks: [NETWORK] });
  }

  console.log(`x402 resource server initialized (network: ${NETWORK}, scheme: ${scheme})`);
  return server;
}

export { NETWORK };
