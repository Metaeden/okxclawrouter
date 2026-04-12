#!/usr/bin/env node
import express from "express";
import config from "./config.js";
import { handleChatCompletion } from "./proxy.js";
import { ALL_MODELS } from "./models.js";
import { handleCliCommand } from "./cli.js";
import {
  isOnchainosInstalled,
  checkWalletStatus,
} from "./onchainos-wallet.js";
import { log } from "./logger.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// ── OpenAI-compatible endpoints ───────────────────────────────
app.post("/v1/chat/completions", handleChatCompletion);

app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: ALL_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      owned_by: m.tier,
    })),
  });
});

// ── CLI command endpoint (for integration with OpenClaw / agents) ──
app.post("/cli", (req, res) => {
  const { command } = req.body;
  if (!command) {
    res.status(400).json({ error: "missing_command" });
    return;
  }
  const result = handleCliCommand(command);
  if (result === null) {
    res.status(404).json({ error: "unknown_command", command });
    return;
  }
  res.json({ result });
});

// ── Health ─────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", port: config.port, backend: config.backendUrl });
});

// ── Start ──────────────────────────────────────────────────────
app.listen(config.port, () => {
  const onchainos = isOnchainosInstalled();
  const wallet = onchainos ? checkWalletStatus() : { loggedIn: false };

  if (!onchainos) {
    console.warn(
      "\n  [WARN] onchainos CLI not found. Paid models require onchainos for wallet & payment.",
    );
    console.warn(
      "         Install: npm install -g onchainos\n",
    );
  }

  console.log(`
═══════════════════════════════════════════════════════
  OKXClawRouter v0.1.0
═══════════════════════════════════════════════════════

  Proxy:     http://localhost:${config.port}
  Backend:   ${config.backendUrl}
  onchainos: ${onchainos ? "installed" : "NOT FOUND (only free models available)"}
  Wallet:    ${wallet.loggedIn ? `connected (${wallet.address})` : "not connected"}

  FREE models ready — use without login:
    DeepSeek V3 / DeepSeek R1 / Qwen3

${
  wallet.loggedIn
    ? `  PAID models ready:
    Claude Sonnet 4.6 / GPT-5.4 / Gemini 3.1 Pro`
    : `  Want Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro?
    1. Login wallet:  /wallet login <your-email>
    2. Fund wallet:   Send USDC on X Layer network
       -> https://web3.okx.com/onchainos
    3. Start using:   Paid models auto-selected when wallet connected`
}

  Usage stats: /stats    Models: /models    Help: /help
═══════════════════════════════════════════════════════
`);

  log.info(`OKXClawRouter proxy listening on :${config.port}`);
});

export default app;
