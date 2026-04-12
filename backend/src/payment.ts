import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer } from "@okxweb3/x402-express";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/server";

const NETWORK = "eip155:196"; // X Layer Mainnet

export function createResourceServer(): x402ResourceServer {
  const facilitatorClient = new OKXFacilitatorClient({
    apiKey: process.env.OKX_API_KEY!,
    secretKey: process.env.OKX_SECRET_KEY!,
    passphrase: process.env.OKX_PASSPHRASE!,
  });

  const server = new x402ResourceServer(facilitatorClient);
  registerExactEvmScheme(server);
  return server;
}

export { NETWORK };
