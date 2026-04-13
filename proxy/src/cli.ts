import config from "./config.js";
import {
  isOnchainosInstalled,
  checkWalletStatus,
  walletLogin,
  walletLogout,
} from "./onchainos-wallet.js";
import { stats } from "./stats.js";
import { ALL_MODELS } from "./models.js";
import { invalidateWalletCache, getCacheStats, getModelCooldowns, getSpendSummary, setSpendLimits } from "./proxy.js";

export function handleCliCommand(command: string): string | null {
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  const sub = parts[1]?.toLowerCase();

  switch (cmd) {
    case "/wallet":
      return handleWallet(sub, parts[2]);
    case "/stats":
      return handleStats(sub);
    case "/spend":
      return handleSpend(sub, parts[2]);
    case "/models":
      return handleModels();
    case "/tier":
      return handleTier(sub);
    case "/help":
      return handleHelp();
    default:
      return null; // Not a CLI command
  }
}

function handleWallet(sub: string | undefined, arg?: string): string {
  if (sub === "login") {
    if (!isOnchainosInstalled()) {
      return [
        "onchainos is not installed.",
        "Install it first: npm install -g onchainos",
        "Then run: /wallet login",
      ].join("\n");
    }
    if (!arg) {
      return "Usage: /wallet login <email>";
    }
    try {
      walletLogin(arg);
      invalidateWalletCache();
      return "Wallet login initiated. Check your email for the verification code.";
    } catch (err) {
      return `Wallet login failed: ${err}`;
    }
  }

  if (sub === "status") {
    if (!isOnchainosInstalled()) {
      return "onchainos not installed. Free models are available without a wallet.";
    }
    const status = checkWalletStatus();
    if (!status.loggedIn) {
      return [
        "Wallet: Not logged in",
        "Free models available. Login to use paid models:",
        "  /wallet login <email>",
      ].join("\n");
    }
    return [
      `Wallet: Connected`,
      `Address: ${status.address}`,
      `Email: ${status.email}`,
      status.balance ? `Balance: ${status.balance}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (sub === "logout") {
    try {
      walletLogout();
      invalidateWalletCache();
      return "Wallet logged out. You can still use free models.";
    } catch (err) {
      return `Logout failed: ${err}`;
    }
  }

  return "Usage: /wallet [login <email> | status | logout]";
}

function handleStats(sub: string | undefined): string {
  if (sub === "clear") {
    stats.clear();
    return "Stats cleared.";
  }

  const s = stats.getSummary();
  if (s.totalRequests === 0) {
    return "No requests yet.";
  }

  const c = getCacheStats();
  const lines = [
    `Total requests: ${s.totalRequests}`,
    `  Free: ${s.freeRequests} | Paid: ${s.paidRequests}`,
    `  Success rate: ${s.successRate}%`,
    `  Avg latency: ${s.avgLatencyMs}ms`,
    "",
    `Cache: ${c.size}/${c.maxSize} entries, hit rate ${c.hitRate} (${c.hits}H/${c.misses}M/${c.evictions}E)`,
    "",
    "Model breakdown:",
  ];

  for (const [model, count] of Object.entries(s.modelBreakdown)) {
    lines.push(`  ${model}: ${count} requests`);
  }

  // Model cooldowns
  const cooldowns = getModelCooldowns();
  if (cooldowns.length > 0) {
    lines.push("");
    lines.push("Model cooldowns:");
    for (const cd of cooldowns) {
      lines.push(`  ${cd.model}: ${cd.category} (${Math.ceil(cd.remainingMs / 1000)}s remaining)`);
    }
  }

  // Spend summary
  const spend = getSpendSummary();
  lines.push("");
  lines.push(`Spend: session=$${spend.sessionSpent.toFixed(4)} hourly=$${spend.hourlySpent.toFixed(4)} daily=$${spend.dailySpent.toFixed(4)}`);
  if (spend.limits.hourly !== undefined) {
    lines.push(`  Limits: hourly=$${spend.limits.hourly} daily=${spend.limits.daily ?? "none"}`);
  }

  return lines.join("\n");
}

function handleSpend(sub: string | undefined, arg?: string): string {
  if (sub === "status") {
    const spend = getSpendSummary();
    return [
      `Session: $${spend.sessionSpent.toFixed(4)}`,
      `Hourly:  $${spend.hourlySpent.toFixed(4)} / $${spend.limits.hourly ?? "unlimited"}`,
      `Daily:   $${spend.dailySpent.toFixed(4)} / $${spend.limits.daily ?? "unlimited"}`,
      spend.limits.perRequest !== undefined ? `Per-req: max $${spend.limits.perRequest}` : "",
    ].filter(Boolean).join("\n");
  }

  if (sub === "limit" && arg) {
    // Parse "hourly=5" or "daily=20"
    const [key, val] = arg.split("=");
    const amount = parseFloat(val);
    if (isNaN(amount) || !["hourly", "daily", "session", "perRequest"].includes(key)) {
      return "Usage: /spend limit <hourly|daily|session|perRequest>=<amount>";
    }
    setSpendLimits({ [key]: amount });
    return `Spend limit updated: ${key} = $${amount}`;
  }

  return [
    "Usage: /spend [status | limit <key>=<amount>]",
    "",
    "  /spend status                View current spending",
    "  /spend limit hourly=5        Set hourly limit to $5",
    "  /spend limit daily=20        Set daily limit to $20",
    "  /spend limit perRequest=0.1  Set per-request limit to $0.10",
  ].join("\n");
}

function handleModels(): string {
  const lines = ["Available models:", ""];
  const free = ALL_MODELS.filter((m) => m.tier === "free");
  const paid = ALL_MODELS.filter((m) => m.tier === "paid");

  lines.push("FREE (no wallet needed):");
  for (const m of free) {
    lines.push(`  ${m.id}`);
  }
  lines.push("");
  lines.push("PAID (requires wallet + USDC on X Layer):");
  for (const m of paid) {
    lines.push(`  ${m.id}`);
  }

  return lines.join("\n");
}

function handleTier(sub: string | undefined): string {
  if (sub === "free") {
    config.forcedTier = "free";
    return "Tier locked to FREE. All requests will use free models.";
  }
  if (sub === "paid") {
    const status = checkWalletStatus();
    if (!status.loggedIn) {
      return "Cannot lock to paid tier: wallet not connected. Run /wallet login first.";
    }
    config.forcedTier = "paid";
    return "Tier locked to PAID. All requests will use paid models.";
  }
  if (sub === "auto") {
    config.forcedTier = null;
    return "Tier set to AUTO. Router will decide based on wallet status and request.";
  }
  return `Current tier: ${config.forcedTier || "auto"}\nUsage: /tier [free | paid | auto]`;
}

function handleHelp(): string {
  return [
    "OKXClawRouter Commands:",
    "",
    "  /wallet login <email>  Login to Agentic Wallet",
    "  /wallet status         Check wallet status and balance",
    "  /wallet logout         Disconnect wallet",
    "  /stats                 View usage statistics + cache + cooldowns",
    "  /stats clear           Reset statistics",
    "  /spend status          View USDC spending summary",
    "  /spend limit key=val   Set spend limits (hourly, daily, perRequest)",
    "  /models                List available models",
    "  /tier [free|paid|auto] Set model tier preference",
    "  /help                  Show this help",
    "",
    `Proxy running on: localhost:${config.port}`,
    `Backend: ${config.backendUrl}`,
  ].join("\n");
}
