#!/usr/bin/env node
import express from "express";
import config from "./config.js";
import { handleChatCompletion } from "./proxy.js";
import { ALL_MODELS } from "./models.js";
import { handleCliCommand } from "./cli.js";
import { isOnchainosInstalled, checkWalletStatus } from "./onchainos-wallet.js";
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

  console.log(`
═══════════════════════════════════════════════════════
  OKX LLM Router v0.1.0
═══════════════════════════════════════════════════════

  Proxy:     http://localhost:${config.port}
  Backend:   ${config.backendUrl}
  onchainos: ${onchainos ? "installed" : "not found"}
  Wallet:    ${wallet.loggedIn ? `connected (${wallet.address})` : "not connected"}

  FREE models ready — use without login:
    free/deepseek-chat | free/deepseek-r1 | free/qwen3

  ${
    wallet.loggedIn
      ? "PAID models ready — Claude Sonnet 4, GPT-5.4, Gemini 3.1 Pro"
      : "Login for paid models: /wallet login <email>"
  }
═══════════════════════════════════════════════════════
`);

  log.info(`Proxy listening on :${config.port}`);
});

export default app;
