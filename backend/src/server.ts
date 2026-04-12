import express from "express";
import type { Request, Response, NextFunction } from "express";
import { paymentMiddleware } from "@okxweb3/x402-express";
import { createResourceServer, NETWORK } from "./payment.js";
import { proxyToOpenRouter } from "./openrouter-proxy.js";
import { MODEL_MAP, MODEL_LIST } from "./models.js";
import { getPrice } from "./pricing.js";

// ── Env validation ────────────────────────────────────────────
const REQUIRED_ENV = [
  "PAY_TO_ADDRESS",
  "OPENROUTER_API_KEY",
  "OKX_API_KEY",
  "OKX_SECRET_KEY",
  "OKX_PASSPHRASE",
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required env var: ${key}`);
    console.error("See .env.example for required configuration.");
    process.exit(1);
  }
}

const PORT = parseInt(process.env.PORT || "4002", 10);
const PAY_TO = process.env.PAY_TO_ADDRESS!;

const app = express();
app.use(express.json({ limit: "10mb" }));

// ── Request logging ───────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  _res.on("finish", () => {
    const ms = Date.now() - start;
    console.log(
      `${req.method} ${req.path} ${_res.statusCode} ${ms}ms` +
        (req.body?.model ? ` model=${req.body.model}` : ""),
    );
  });
  next();
});

// ── Health check ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Model list (OpenAI-compatible) ─────────────────────────────
app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: MODEL_LIST.map((m) => ({
      id: m.id,
      object: "model",
      created: 1700000000,
      owned_by: m.tier,
    })),
  });
});

// ── Free route — no payment middleware ─────────────────────────
app.post("/v1/free/chat/completions", (req: Request, res: Response) => {
  // Validate the model is actually free
  const model = req.body?.model;
  if (model && !model.startsWith("free/") && MODEL_MAP[model] !== undefined) {
    res.status(400).json({
      error: "invalid_model",
      message: `Model ${model} is not available on the free route. Use /v1/paid/chat/completions.`,
    });
    return;
  }
  proxyToOpenRouter(req, res);
});

// ── Paid route — x402 payment wall ────────────────────────────
const resourceServer = createResourceServer();

// Dynamic pricing middleware: read model from body, set x402 price accordingly
app.use("/v1/paid", (req: Request, _res: Response, next: NextFunction) => {
  const model = req.body?.model;
  if (model) {
    // Store the per-model price for the payment middleware to pick up
    (req as any).__x402Price = getPrice(model);
  }
  next();
});

app.use(
  paymentMiddleware(
    {
      "POST /v1/paid/chat/completions": {
        accepts: [
          {
            scheme: "exact",
            network: NETWORK,
            payTo: PAY_TO,
            price: getPrice("paid/claude-sonnet-4"), // default, overridden per-request in V2
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

// ── Error handler ─────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error", message: "Internal server error" });
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`OKXClawRouter Backend running on :${PORT}`);
  console.log(`  Free route:  POST /v1/free/chat/completions`);
  console.log(`  Paid route:  POST /v1/paid/chat/completions (x402)`);
  console.log(`  Models:      GET  /v1/models`);
  console.log(`  Health:      GET  /health`);
});

export default app;
