import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer } from "@okxweb3/x402-express";
import { registerExactEvmScheme } from "@okxweb3/x402-evm/exact/server";

const NETWORK = "eip155:196"; // X Layer Mainnet

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
  registerExactEvmScheme(server);

  console.log(`x402 resource server initialized (network: ${NETWORK})`);
  return server;
}

export { NETWORK };
