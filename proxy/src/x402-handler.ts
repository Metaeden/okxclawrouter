import { execSync } from "child_process";
import { log } from "./logger.js";

interface PaymentResult {
  signature: string;
  authorization: object;
  sessionCert?: string;
}

/**
 * Handle HTTP 402 response: extract payment requirements, sign via onchainos CLI,
 * then retry the original request with payment headers.
 */
export async function handleX402Payment(
  response: Response,
  originalUrl: string,
  originalHeaders: Record<string, string>,
  originalBody: string,
): Promise<Response> {
  // Step 1: Decode 402 payload — supports v2 (header) and v1 (body)
  let accepts: unknown[];

  const paymentRequired = response.headers.get("PAYMENT-REQUIRED");
  if (paymentRequired) {
    const decoded = JSON.parse(
      Buffer.from(paymentRequired, "base64").toString(),
    );
    accepts = decoded.accepted ? [decoded.accepted] : decoded.accepts;
  } else {
    const body = await response.json();
    accepts = body.accepts;
  }

  // Step 2: Sign via onchainos CLI
  const acceptsJson = JSON.stringify(accepts);
  log.debug("x402 payment request:", acceptsJson);

  let paymentResult: PaymentResult;
  try {
    const output = execSync(
      `onchainos payment x402-pay --accepts '${acceptsJson}'`,
      { encoding: "utf-8", stdio: "pipe" },
    );
    paymentResult = JSON.parse(output);
  } catch (err) {
    log.error("x402 payment signing failed:", err);
    throw new Error("Payment signing failed — is your wallet logged in with sufficient balance?");
  }

  // Step 3: Build payment header
  let headerName: string;
  let headerValue: string;

  if (paymentRequired) {
    // v2 protocol
    headerName = "PAYMENT-SIGNATURE";
    headerValue = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        resource: originalUrl,
        accepted: accepts[0],
        payload: paymentResult,
      }),
    ).toString("base64");
  } else {
    // v1 protocol
    headerName = "X-PAYMENT";
    headerValue = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: (accepts[0] as any).scheme,
        network: (accepts[0] as any).network,
        payload: paymentResult,
      }),
    ).toString("base64");
  }

  // Step 4: Retry with payment credential
  return fetch(originalUrl, {
    method: "POST",
    headers: {
      ...originalHeaders,
      [headerName]: headerValue,
    },
    body: originalBody,
  });
}
