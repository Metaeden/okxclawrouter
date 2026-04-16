import config from "./config.js";
import {
  isOnchainosInstalled,
  checkWalletStatus,
  getXLayerUsdtBalance,
  getWalletPortfolio,
  formatPortfolio,
  walletLogin,
  walletLogout,
} from "./onchainos-wallet.js";
import { stats } from "./stats.js";
import { getAdvertisedModels } from "./backend-models.js";
import { invalidateWalletCache, getCacheStats, getModelCooldowns, getSpendSummary, setSpendLimits } from "./proxy.js";
import { loadPolicy, savePolicy, DEFAULT_POLICY, formatPolicy, parseAndApplyPolicySetting } from "./policy.js";
import { getTopupQuote } from "./auto-topup.js";

export async function handleCliCommand(command: string): Promise<string | null> {
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
    case "/policy":
      return handlePolicy(sub, parts.slice(2).join(" "));
    case "/security":
      return handleSecurity();
    case "/topup":
      return handleTopup(sub);
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
        "onchainos is not installed on this client machine.",
        "Free models still work without it.",
        "Install the OKX Onchain OS / Agentic Wallet environment locally, then run: /wallet login",
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
      return "onchainos 未安装。免费模型可直接使用，无需钱包。";
    }
    const status = checkWalletStatus();
    if (!status.loggedIn) {
      return [
        "钱包: 未登录",
        "免费模型可直接使用。登录后可使用付费模型:",
        "  /wallet login <邮箱>",
      ].join("\n");
    }
    const usdtBalance = getXLayerUsdtBalance();
    return [
      `钱包: 已连接`,
      `邮箱: ${status.email}`,
      `X-Layer 地址: ${status.address}`,
      usdtBalance !== undefined ? `X-Layer USDT 余额: ${usdtBalance}` : "",
      "",
      `在 X Layer 网络充值 USDT 以解锁付费模型:`,
      `  https://web3.okx.com/onchainos`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (sub === "portfolio") {
    if (!isOnchainosInstalled()) {
      return "onchainos 未安装，无法查询 portfolio。";
    }
    const status = checkWalletStatus();
    if (!status.loggedIn) {
      return "请先登录钱包: /wallet login <邮箱>";
    }
    const portfolio = getWalletPortfolio();
    return formatPortfolio(portfolio);
  }

  if (sub === "logout") {
    try {
      walletLogout();
      invalidateWalletCache();
      return "钱包已退出登录。免费模型仍然可用。";
    } catch (err) {
      return `退出失败: ${err}`;
    }
  }

  return "用法: /wallet [login <邮箱> | status | portfolio | logout]";
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

async function handleModels(): Promise<string> {
  const lines = ["Available models:", ""];
  const models = await getAdvertisedModels();
  const free = models.filter((m) => m.tier === "free");
  const paid = models.filter((m) => m.tier === "paid");

  lines.push("FREE (no wallet needed):");
  for (const m of free) {
    lines.push(`  ${m.id}`);
  }
  lines.push("");
  lines.push("PAID (requires wallet + USDT on X Layer):");
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

function handlePolicy(sub: string | undefined, arg: string): string {
  if (!sub || sub === "status") {
    const policy = loadPolicy();
    return formatPolicy(policy);
  }

  if (sub === "set" && arg) {
    const result = parseAndApplyPolicySetting(arg);
    return result.message;
  }

  if (sub === "reset") {
    savePolicy(DEFAULT_POLICY);
    return "Policy 已重置为默认配置。";
  }

  return [
    "用法: /policy [status | set <key=value> | reset]",
    "",
    "示例:",
    "  /policy status                          查看当前配置",
    "  /policy set security.scanPayments=true  开启支付安全扫描",
    "  /policy set security.scanPayments=false 关闭支付安全扫描",
    "  /policy set autoTopup.enabled=true      开启自动换币补仓",
    "  /policy set autoTopup.maxTopupUsd=10    设置最大补仓金额 $10",
    "  /policy set spendLimits.hourly=5        设置每小时支出上限 $5",
    "  /policy set spendLimits.daily=20        设置每日支出上限 $20",
    "  /policy reset                           重置为默认配置",
  ].join("\n");
}

function handleSecurity(): string {
  const policy = loadPolicy();
  const status = checkWalletStatus();

  return [
    "─── 安全状态 ───────────────────────────────",
    `  onchainos 安装:     ${isOnchainosInstalled() ? "✅ 已安装" : "❌ 未安装"}`,
    `  钱包已连接:         ${status.loggedIn ? `✅ ${status.address ?? ""}` : "❌ 未登录"}`,
    `  支付前扫描:         ${policy.security.scanPayments ? "✅ 开启" : "❌ 关闭"}`,
    `  扫描失败拦截:       ${policy.security.blockOnScanFailure ? "✅ 开启" : "❌ 关闭"}`,
    `  允许 warn 级继续:   ${policy.security.allowWarnLevel ? "✅ 是" : "❌ 否"}`,
    "",
    "修改安全设置: /policy set security.<key>=<value>",
    "示例: /policy set security.scanPayments=true",
  ].join("\n");
}

function handleTopup(sub: string | undefined): string {
  if (sub === "quote") {
    const status = checkWalletStatus();
    if (!status.loggedIn || !status.address) {
      return "请先登录钱包: /wallet login <邮箱>";
    }
    const policy = loadPolicy();
    const quote = getTopupQuote(status.address, policy.autoTopup.maxTopupUsd);
    if (!quote.feasible) {
      return `无法获取报价，请检查 OKB 余额或网络连接。`;
    }
    return [
      `换币报价 (X-Layer):`,
      `  换出: ${quote.fromAmount} OKB（原生）`,
      `  换入: 约 $${policy.autoTopup.maxTopupUsd} USDT`,
      `  链: ${quote.chain}`,
      "",
      `执行: /policy set autoTopup.enabled=true 后，余额不足时自动触发`,
    ].join("\n");
  }

  const policy = loadPolicy();
  return [
    `自动补仓状态: ${policy.autoTopup.enabled ? "✅ 开启" : "❌ 关闭"}`,
    `触发余额: $${policy.autoTopup.triggerBelowUsd}`,
    `最大补仓: $${policy.autoTopup.maxTopupUsd}`,
    `换出代币: ${policy.autoTopup.fromToken === "native" ? "OKB（原生）" : "USDT"}`,
    "",
    "用法: /topup [quote]",
    "  /topup quote   查询换币报价（不执行）",
    "  /policy set autoTopup.enabled=true   开启自动补仓",
  ].join("\n");
}

function handleHelp(): string {
  return [
    "okclawrouter 命令列表:",
    "",
    "  /wallet login <邮箱>         登录 OKX Agentic Wallet",
    "  /wallet status               查看钱包状态和余额",
    "  /wallet portfolio            查看多链资产 portfolio",
    "  /wallet logout               退出登录",
    "",
    "  /policy status               查看安全策略和支出限额",
    "  /policy set <key=val>        修改策略（持久化保存）",
    "  /policy reset                重置为默认配置",
    "",
    "  /security                    查看安全状态总览",
    "",
    "  /topup                       查看自动补仓状态",
    "  /topup quote                 查询 OKB→USDT 换币报价",
    "",
    "  /stats                       查看请求统计 + 缓存 + 冷却",
    "  /stats clear                 重置统计",
    "  /spend status                查看 USDT 支出摘要",
    "  /spend limit key=val         设置支出限额",
    "  /models                      列出可用模型",
    "  /tier [free|paid|auto]       设置模型层级偏好",
    "  /help                        显示帮助",
    "",
    `代理地址: localhost:${config.port}`,
    `后端地址: ${config.backendUrl}`,
  ].join("\n");
}
