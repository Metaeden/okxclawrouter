import express from "express";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { createResourceServer, NETWORK } from "./payment.js";
import { proxyToOpenRouter } from "./openrouter-proxy.js";
import { MODEL_LIST } from "./models.js";
import { getPrice } from "./pricing.js";

const app = express();
const PORT = parseInt(process.env.PORT || "4002", 10);
const PAY_TO = process.env.PAY_TO_ADDRESS!;

app.use(express.json({ limit: "10mb" }));

// ── Health check ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Model list (OpenAI-compatible) ─────────────────────────────
app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: MODEL_LIST.map((m) => ({
      id: m.id,
      object: "model",
      owned_by: m.tier,
    })),
  });
});

// ── Free route — no payment middleware ─────────────────────────
app.post("/v1/free/chat/completions", proxyToOpenRouter);

// ── Paid route — x402 payment wall ────────────────────────────
const resourceServer = createResourceServer();

app.use(
  paymentMiddleware(
    {
      "POST /v1/paid/chat/completions": {
        accepts: [
          {
            scheme: "exact",
            network: NETWORK,
            payTo: PAY_TO,
            price: getPrice("paid/claude-sonnet-4"), // default price
          },
        ],
        description: "LLM Chat Completion (Paid Model)",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.post("/v1/paid/chat/completions", proxyToOpenRouter);

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`LLM Router Backend running on :${PORT}`);
});

export default app;
