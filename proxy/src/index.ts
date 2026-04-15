#!/usr/bin/env node
import express from "express";
import config from "./config.js";
import { handleChatCompletion } from "./proxy.js";
import { getAdvertisedModels } from "./backend-models.js";
import { handleCliCommand } from "./cli.js";
import {
  isOnchainosInstalled,
  checkWalletStatus,
} from "./onchainos-wallet.js";
import { log } from "./logger.js";
import { loadPolicy } from "./policy.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

// ── OpenAI-compatible endpoints ───────────────────────────────
app.post("/v1/chat/completions", handleChatCompletion);

app.get("/v1/models", async (_req, res) => {
  const models = await getAdvertisedModels();
  res.json({
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      owned_by: m.tier,
    })),
  });
});

// ── CLI command endpoint (for integration with OpenClaw / agents) ──
app.post("/cli", async (req, res) => {
  const { command } = req.body;
  if (!command) {
    res.status(400).json({ error: "missing_command" });
    return;
  }
  const result = await handleCliCommand(command);
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
  const policy = loadPolicy();

  void (async () => {
    const models = await getAdvertisedModels();
    const freeModels = models
      .filter((model) => model.tier === "free")
      .map((model) => model.id)
      .join(" / ");
    const paidModels = models
      .filter((model) => model.tier === "paid")
      .map((model) => model.id)
      .join(" / ");
    const secScan = policy.security.scanPayments ? "✅ 开启" : "❌ 关闭";
    const autoTopup = policy.autoTopup.enabled
      ? `✅ 开启 (触发≤$${policy.autoTopup.triggerBelowUsd})`
      : "❌ 关闭";

    if (!onchainos) {
      console.warn(
        "\n  [警告] onchainos CLI 未找到。付费模型需要 onchainos 支持钱包和支付。",
      );
      console.warn(
        "         安装: npm install -g onchainos\n",
      );
    }

    console.log(`
═══════════════════════════════════════════════════════
  okclawrouter v0.2.0  (Powered by OKX OnchainOS)
═══════════════════════════════════════════════════════

  代理地址:   http://localhost:${config.port}
  后端地址:   ${config.backendUrl}
  onchainos:  ${onchainos ? "✅ 已安装" : "❌ 未找到（仅免费模型可用）"}
  钱包状态:   ${wallet.loggedIn ? `✅ 已连接 (${wallet.address})` : "❌ 未连接"}
  安全扫描:   ${secScan}     自动补仓: ${autoTopup}

  免费模型（无需登录）:
    ${freeModels || "(none advertised by backend)"}

${
  wallet.loggedIn
    ? `  付费模型已就绪:
    ${paidModels || "(none advertised by backend)"}`
    : `  解锁 Claude / GPT-5.4 / Gemini:
    1. /wallet login <邮箱>   登录 OKX Agentic Wallet
    2. 充值 USDC（X Layer 网络） → https://web3.okx.com/onchainos
    3. 付费模型自动解锁`
}

  /stats   /models   /policy   /security   /help
═══════════════════════════════════════════════════════
`);

    log.info(`okclawrouter proxy listening on :${config.port}`);
  })().catch((err) => {
    console.error("Failed to load advertised model list:", err);
  });
});

export default app;
