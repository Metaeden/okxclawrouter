# OKX LLM Router — 完整项目设计方案

> 基于 ClawRouter 开源项目，替换支付链路为 OKX Agentic Wallet + X Layer x402，后端模型服务接入 OpenRouter API。

---

## 一、项目概览

### 做什么

一个面向 AI Agent 的 LLM 智能路由器。用户装完 OpenClaw 后一条命令安装，免费模型开箱即用，付费模型通过 OKX Agentic Wallet 在 X Layer 上用 USDT 微支付。

### 和 ClawRouter 的核心差异

| 维度 | ClawRouter 原版 | 新项目 |
|-----|----------------|--------|
| 钱包 | 本地 BIP-39 生成，用户管助记词 | OKX Agentic Wallet，邮箱登录 |
| 支付链 | Base / Solana，用 @x402/* SDK | X Layer（eip155:196），用 OKX x402 SDK |
| 支付签名 | 进程内用 viem 签名 | 调 `onchainos payment x402-pay` CLI |
| 模型来源 | BlockRun 后端代理（55+ 模型） | 你自己的后端 + OpenRouter API（精简到 6-8 个） |
| 模型档位 | 4 个 tier（SIMPLE / MEDIUM / COMPLEX / REASONING） | 2 个 tier（FREE / PAID） |
| 免费体验 | 无（所有请求都要钱包签名） | 免费模型无需登录、无需钱包 |

---

## 二、系统架构

### 整体链路

```
┌──────────────────────────────────────────────────────────────────┐
│                        用户的 AI Agent                           │
│                   (Cursor / VS Code / OpenClaw)                  │
└───────────────────────────┬──────────────────────────────────────┘
                            │  OpenAI-compatible API
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                     本地路由代理 (localhost:8402)                  │
│                                                                  │
│  ┌─────────────┐    ┌──────────────┐    ┌────────────────────┐  │
│  │ 请求分类器   │───▶│ Tier 路由器   │───▶│ 上游请求转发       │  │
│  │ (简化版)    │    │ FREE / PAID  │    │                    │  │
│  └─────────────┘    └──────────────┘    └─────────┬──────────┘  │
│                                                    │             │
│  ┌─────────────────────────────────────────────────┼──────────┐  │
│  │              x402 支付处理层                      │          │  │
│  │  收到 402 → onchainos payment x402-pay → 重发    │          │  │
│  └─────────────────────────────────────────────────┼──────────┘  │
└────────────────────────────────────────────────────┼─────────────┘
                                                     │  HTTPS
                                                     ▼
┌──────────────────────────────────────────────────────────────────┐
│                     你的后端服务 (your-domain.com)                │
│                                                                  │
│  ┌──────────────────────┐    ┌───────────────────────────────┐  │
│  │ 免费路由              │    │ 付费路由                       │  │
│  │ /v1/free/chat/...    │    │ /v1/paid/chat/completions     │  │
│  │ 无 x402 中间件        │    │ x402 paymentMiddleware        │  │
│  │ 直接转发 OpenRouter   │    │ 验证支付 → 转发 OpenRouter    │  │
│  └──────────┬───────────┘    └──────────────┬────────────────┘  │
│             │                                │                   │
│             └───────────┬────────────────────┘                   │
│                         ▼                                        │
│              ┌─────────────────────┐                             │
│              │  OpenRouter 代理层   │                             │
│              │  API Key: sk-or-... │                             │
│              │  模型映射 + 流式转发  │                             │
│              └─────────────────────┘                             │
└──────────────────────────────────────────────────────────────────┘
```

### 两个独立部署单元

**1. 本地路由代理** — npm 包或安装脚本，跑在用户机器上
**2. 后端服务** — 你部署的 Node.js 服务，接受请求、验证支付、调 OpenRouter

---

## 三、后端服务设计

### 技术栈

```
Node.js + Express
├── @okxweb3/x402-express      — x402 支付中间件
├── @okxweb3/x402-evm          — EVM 支付方案
├── @okxweb3/x402-core          — OKX Facilitator 客户端
└── node-fetch / undici         — 转发到 OpenRouter
```

### 核心代码框架

```typescript
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@okxweb3/x402-express";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";

const app = express();

// ============================================================
// OKX Facilitator 初始化
// ============================================================
const NETWORK = "eip155:196"; // X Layer Mainnet
const PAY_TO = process.env.PAY_TO_ADDRESS!; // 你的收款钱包地址

const facilitatorClient = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY!,
  secretKey: process.env.OKX_SECRET_KEY!,
  passphrase: process.env.OKX_PASSPHRASE!,
});

const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register(NETWORK, new ExactEvmScheme());

// ============================================================
// OpenRouter 代理层
// ============================================================
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY!;

// 模型映射：内部 ID → OpenRouter 模型 ID
const MODEL_MAP: Record<string, string> = {
  // FREE tier
  "free/deepseek-chat":          "deepseek/deepseek-chat-v3-0324:free",
  "free/deepseek-r1":            "deepseek/deepseek-r1:free",
  "free/qwen3":                  "qwen/qwen3-next-80b-a3b-instruct:free",
  // PAID tier
  "paid/claude-sonnet-4":        "anthropic/claude-sonnet-4",
  "paid/gpt-5.4":                "openai/gpt-5.4",
  "paid/gemini-3.1-pro":         "google/gemini-3.1-pro-preview",
};

async function proxyToOpenRouter(req: express.Request, res: express.Response) {
  const body = req.body;
  const internalModel = body.model;
  const openRouterModel = MODEL_MAP[internalModel] || internalModel;

  const upstreamRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "HTTP-Referer": "https://your-domain.com",
    },
    body: JSON.stringify({ ...body, model: openRouterModel }),
  });

  // 流式转发
  res.status(upstreamRes.status);
  for (const [key, value] of upstreamRes.headers.entries()) {
    if (key.toLowerCase() !== "transfer-encoding") {
      res.setHeader(key, value);
    }
  }
  upstreamRes.body?.pipeTo(
    new WritableStream({
      write(chunk) { res.write(chunk); },
      close() { res.end(); },
    })
  );
}

// ============================================================
// 路由定义
// ============================================================

// 免费路由 — 无支付中间件
app.use(express.json({ limit: "10mb" }));

app.post("/v1/free/chat/completions", proxyToOpenRouter);

// 付费路由 — x402 中间件保护
// 动态定价：根据请求的模型设置不同价格
app.use(
  paymentMiddleware(
    {
      "POST /v1/paid/chat/completions": {
        accepts: [{
          scheme: "exact",
          network: NETWORK,
          payTo: PAY_TO,
          price: "$0.01",  // 默认价格，实际可按模型动态调整
        }],
        description: "LLM Chat Completion (Paid Model)",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

app.post("/v1/paid/chat/completions", proxyToOpenRouter);

// 模型列表端点
app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: Object.keys(MODEL_MAP).map(id => ({
      id,
      object: "model",
      owned_by: id.startsWith("free/") ? "free" : "paid",
    })),
  });
});

app.listen(4002, () => {
  console.log("LLM Router Backend running on :4002");
});
```

### 定价策略

按模型设置不同的 x402 价格。下面是参考定价（需要根据 OpenRouter 实际成本 + margin 调整）：

| 模型 | OpenRouter 成本（per M tokens） | x402 收费建议（每请求） | 你的 margin |
|------|-------------------------------|----------------------|------------|
| free/deepseek-chat | 免费 | $0（不走 x402） | 无 |
| free/deepseek-r1 | 免费 | $0（不走 x402） | 无 |
| free/qwen3 | 免费 | $0（不走 x402） | 无 |
| paid/claude-sonnet-4 | $3 / $15 | $0.01 | ~30-70% |
| paid/gpt-5.4 | $2.5 / $15 | $0.01 | ~30-50% |
| paid/gemini-3.1-pro | $2 / $12 | $0.008 | ~30-60% |

> 注意：OpenRouter 的实际成本取决于 token 用量。上面的"每请求"估算基于平均 1000 input tokens + 500 output tokens。真实场景波动大。可以考虑按 token 估算后动态设置 price，或者用固定价格做简化（早期推荐固定价格，降低复杂度）。

### 动态定价方案（进阶，V2 再做）

如果固定价格不够灵活，可以在中间件前加一层逻辑：根据请求 body 里的 token 数量估算成本，动态设置 x402 price。但 OKX 的 `paymentMiddleware` 目前是静态路由配置，动态定价需要自己写中间件逻辑。

建议 **V1 用固定价格**，简单直接，早期验证商业模型。

---

## 四、本地路由代理改造

### 从 ClawRouter 中移除的模块

| 模块 | 文件 | 原因 |
|------|------|------|
| 本地钱包生成 | wallet.ts | 改用 onchainos wallet |
| BIP-39 / BIP-32 | 依赖 @scure/* | 不再需要 |
| Base 链支付 | 依赖 viem, @x402/* | 改用 onchainos CLI |
| Solana 链支付 | solana-balance.ts, @solana/kit | 只支持 X Layer |
| BlockRun 后端 | proxy.ts 中的 blockrun.ai URL | 改指向你的后端 |
| 55+ 模型定义 | models.ts 大部分内容 | 精简到 6 个 |
| 15 维分类器 | router/rules.ts, llm-classifier.ts | 简化为 2 tier 分流 |
| Worker Network | 相关代码 | 不需要 |
| 图片生成 | imagegen 相关 | 不需要（V1） |

### 保留并修改的模块

| 模块 | 改造内容 |
|------|---------|
| proxy.ts | 上游 URL 改指向你的后端，分免费/付费两条路径 |
| router/selector.ts | 只保留 FREE / PAID 两个 tier 的选择逻辑 |
| router/strategy.ts | 简化分类规则：默认 FREE，特定条件触发 PAID |
| config.ts | 改为你的后端地址、模型列表 |
| stats.ts | 保留，显示用量统计 |
| dedup.ts | 保留，请求去重 |
| response-cache.ts | 保留，缓存优化 |
| retry.ts | 保留，fallback 重试 |
| cli.ts | 改造命令系统 |

### 新增的模块

#### 1. onchainos-wallet.ts — Agentic Wallet 集成

```typescript
import { execSync, exec } from "child_process";

interface WalletStatus {
  loggedIn: boolean;
  address?: string;
  email?: string;
}

export function checkWalletStatus(): WalletStatus {
  try {
    const output = execSync("onchainos wallet status", { encoding: "utf-8" });
    const data = JSON.parse(output);
    return {
      loggedIn: data.loggedIn === true,
      address: data.address,
      email: data.email,
    };
  } catch {
    return { loggedIn: false };
  }
}

export function isOnchainosInstalled(): boolean {
  try {
    execSync("onchainos --version", { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 引导用户登录 Agentic Wallet
 * 在 CLI 环境中通过 onchainos wallet login 触发邮箱验证
 */
export async function promptWalletLogin(email: string): Promise<void> {
  execSync(`onchainos wallet login ${email}`, { stdio: "inherit" });
  // 用户收到验证码后需要手动输入
  // onchainos wallet verify <code> — 由 CLI 交互处理
}
```

#### 2. x402-handler.ts — 处理 402 支付流程

```typescript
import { execSync } from "child_process";

interface PaymentResult {
  signature: string;
  authorization: object;
  sessionCert?: string;
}

/**
 * 处理 HTTP 402 响应，调用 onchainos 完成支付签名
 */
export async function handleX402Payment(
  response: Response,
  originalRequest: RequestInit,
  originalUrl: string,
): Promise<Response> {
  // Step 1: 解码 402 payload
  // 支持 v2（PAYMENT-REQUIRED header）和 v1（response body）
  let accepts: any[];

  const paymentRequired = response.headers.get("PAYMENT-REQUIRED");
  if (paymentRequired) {
    // v2 协议
    const decoded = JSON.parse(Buffer.from(paymentRequired, "base64").toString());
    accepts = decoded.accepted ? [decoded.accepted] : decoded.accepts;
  } else {
    // v1 协议
    const body = await response.json();
    accepts = body.accepts;
  }

  // Step 2: 调用 onchainos CLI 签名
  const acceptsJson = JSON.stringify(accepts);
  const output = execSync(
    `onchainos payment x402-pay --accepts '${acceptsJson}'`,
    { encoding: "utf-8" },
  );
  const paymentResult: PaymentResult = JSON.parse(output);

  // Step 3: 组装支付头，重发请求
  let paymentHeader: string;
  if (paymentRequired) {
    // v2: PAYMENT-SIGNATURE header
    const payload = {
      x402Version: 2,
      resource: originalUrl,
      accepted: accepts[0],
      payload: paymentResult,
    };
    paymentHeader = Buffer.from(JSON.stringify(payload)).toString("base64");
  } else {
    // v1: X-PAYMENT header
    const payload = {
      x402Version: 1,
      scheme: accepts[0].scheme,
      network: accepts[0].network,
      payload: paymentResult,
    };
    paymentHeader = Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  // Step 4: 带支付凭证重发
  const retryHeaders = new Headers(originalRequest.headers);
  if (paymentRequired) {
    retryHeaders.set("PAYMENT-SIGNATURE", paymentHeader);
  } else {
    retryHeaders.set("X-PAYMENT", paymentHeader);
  }

  return fetch(originalUrl, {
    ...originalRequest,
    headers: retryHeaders,
  });
}
```

#### 3. 简化路由逻辑

```typescript
// router/simple-router.ts

type Tier = "FREE" | "PAID";

interface RoutingDecision {
  tier: Tier;
  model: string;
  fallbacks: string[];
}

const FREE_MODELS = {
  general: "free/deepseek-chat",
  reasoning: "free/deepseek-r1",
  fallbacks: ["free/qwen3"],
};

const PAID_MODELS = {
  general: "paid/claude-sonnet-4",
  reasoning: "paid/gemini-3.1-pro",
  fallbacks: ["paid/gpt-5.4"],
};

// 简化的推理检测：只看几个关键信号
const REASONING_SIGNALS = [
  /step.?by.?step/i,
  /think.*carefully/i,
  /reason/i,
  /prove/i,
  /analyze.*complex/i,
  /chain.?of.?thought/i,
];

export function route(
  messages: Array<{ role: string; content: string }>,
  requestedModel?: string,
  walletConnected?: boolean,
): RoutingDecision {
  // 用户明确指定了模型
  if (requestedModel && requestedModel !== "auto") {
    const tier = requestedModel.startsWith("paid/") ? "PAID" : "FREE";
    return { tier, model: requestedModel, fallbacks: [] };
  }

  // 判断是否需要推理模型
  const lastMessage = messages[messages.length - 1]?.content || "";
  const needsReasoning = REASONING_SIGNALS.some(r => r.test(lastMessage));

  // 没有钱包 → 只能用免费
  if (!walletConnected) {
    return {
      tier: "FREE",
      model: needsReasoning ? FREE_MODELS.reasoning : FREE_MODELS.general,
      fallbacks: FREE_MODELS.fallbacks,
    };
  }

  // 有钱包 → 默认走付费（质量更好），fallback 到免费
  return {
    tier: "PAID",
    model: needsReasoning ? PAID_MODELS.reasoning : PAID_MODELS.general,
    fallbacks: [...PAID_MODELS.fallbacks, ...FREE_MODELS.fallbacks],
  };
}
```

---

## 五、模型配置

### 最终模型列表

| 内部 ID | OpenRouter 模型 ID | Tier | 用途 | 成本 |
|---------|-------------------|------|------|------|
| free/deepseek-chat | `deepseek/deepseek-chat-v3-0324:free` | FREE | 通用主力 | $0 |
| free/deepseek-r1 | `deepseek/deepseek-r1:free` | FREE | 推理任务 | $0 |
| free/qwen3 | `qwen/qwen3-next-80b-a3b-instruct:free` | FREE | 通用 fallback | $0 |
| paid/claude-sonnet-4 | `anthropic/claude-sonnet-4` | PAID | 高质量通用 + 代码 | $3/$15 per M tokens |
| paid/gpt-5.4 | `openai/gpt-5.4` | PAID | 高质量通用备选 | $2.5/$15 per M tokens |
| paid/gemini-3.1-pro | `google/gemini-3.1-pro-preview` | PAID | 强推理 + 长上下文 | $2/$12 per M tokens |

> 免费模型 3 个互为 fallback 保证可用率，付费模型 3 个覆盖通用、代码、推理三个核心场景。

### 路由逻辑说明

```
用户请求进来
  │
  ├─ 用户指定了具体模型 → 直接用该模型
  │
  ├─ 用户没指定 / 指定 "auto"
  │   │
  │   ├─ 没登录钱包 / 没余额 → FREE tier
  │   │   ├─ 检测到推理需求 → free/deepseek-r1
  │   │   └─ 普通任务 → free/deepseek-chat
  │   │       └─ fallback → free/qwen3
  │   │
  │   └─ 已登录且有余额 → PAID tier
  │       ├─ 检测到推理需求 → paid/gemini-3.1-pro
  │       └─ 普通任务 → paid/claude-sonnet-4
  │           └─ fallback → paid/gpt-5.4 → free/*
  │
  └─ 付费模型请求失败（402支付失败/余额不足）→ 降级到 FREE tier 对应模型
```

---

## 六、用户体验流程

### 安装流程

```bash
# 前提：用户已安装 OpenClaw
# 一键安装（从你的 GitHub 仓库）
curl -fsSL https://raw.githubusercontent.com/<your-org>/<your-repo>/main/install.sh | bash
```

install.sh 做三件事：
1. 检测 onchainos 是否已安装，没有则提示安装
2. 下载你的路由代理包（npm package 或 binary）
3. 写入 OpenClaw 配置，注册为 provider

### 首次使用流程

```
═══════════════════════════════════════════════════════
  🎉  OKX LLM Router 安装成功！
═══════════════════════════════════════════════════════

  ✅  免费模型已就绪 — 可以直接使用
      DeepSeek V3 / DeepSeek R1 / Qwen3

  💡  想用 Claude Sonnet 4、GPT-4o 等高质量模型？
      只需 3 步：

      1. 登录钱包:  /wallet login
      2. 充值 USDT:  前往 X Layer 网络充值
         → https://web3.okx.com/onchainos
      3. 开始使用:   付费模型会自动按请求扣费

  📊  查看用量:     /stats
  ❓  帮助:         /help

═══════════════════════════════════════════════════════
```

### /wallet login 交互流程

```
> /wallet login

检查 onchainos 状态...

📧  请输入你的邮箱地址: user@example.com

正在发送验证码到 user@example.com ...
✅  验证码已发送！

🔑  请输入收到的验证码: 123456

正在验证...
✅  登录成功！

钱包地址: 0x1234...abcd
X Layer USDT 余额: $0.00

💡  充值提示：
    前往 https://web3.okx.com/onchainos 给这个地址充值 USDT
    网络选择: X Layer (Chain ID: 196)
    充 $1 大约可以调用 ~100 次 Claude Sonnet 4
```

### 日常使用——用户无感

用户正常在 Cursor / VS Code / OpenClaw 里写代码。路由代理在后台自动工作：

- 简单问题 → 走免费模型，没有任何支付动作
- 复杂问题 + 已登录有余额 → 走付费模型，后台自动 x402 签名扣款
- 复杂问题 + 没登录/没余额 → 走免费模型，偶尔提示升级

### 余额不足提示

```
⚠️  USDT 余额不足，已自动切换到免费模型 (Gemini 2.5 Flash)
    当前余额: $0.002 | 本次请求需要: $0.01

    充值: https://web3.okx.com/onchainos
    或继续使用免费模型（不影响基本功能）
```

---

## 七、CLI 命令设计

| 命令 | 功能 | 需要登录 |
|------|------|---------|
| `/wallet login` | 邮箱登录 Agentic Wallet | 否 |
| `/wallet status` | 查看登录状态和余额 | 否 |
| `/wallet logout` | 退出登录 | 否 |
| `/stats` | 查看模型调用统计和花费 | 否 |
| `/stats clear` | 清空统计 | 否 |
| `/models` | 列出可用模型 | 否 |
| `/tier free` | 强制使用免费模型 | 否 |
| `/tier paid` | 强制使用付费模型 | 是 |
| `/tier auto` | 自动路由（默认） | 否 |
| `/help` | 帮助信息 | 否 |

---

## 八、需要从 ClawRouter 删除的依赖

### 移除的 npm 依赖

```diff
- @scure/bip32        # 本地密钥派生 → 不需要
- @scure/bip39        # 助记词 → 不需要
- @solana/kit         # Solana 链 → 只用 X Layer
- @x402/core          # BlockRun x402 SDK → 改用 OKX SDK
- @x402/evm           # BlockRun EVM 签名 → 改用 onchainos CLI
- @x402/fetch         # BlockRun 402 处理 → 自己实现
- @x402/svm           # Solana 签名 → 不需要
- viem                # EVM 交互库 → 不需要（签名交给 onchainos）
```

### 不需要新增的 npm 依赖（本地代理侧）

本地代理通过 `child_process.execSync` 调用 `onchainos` CLI，不需要引入 OKX 的 npm SDK。这样的好处：

- 不增加包体积
- onchainos 的更新和你的代理解耦
- 签名逻辑由 OKX 的 TEE 环境处理，安全性更高

### 后端新增的 npm 依赖

```json
{
  "@okxweb3/x402-express": "latest",
  "@okxweb3/x402-evm": "latest",
  "@okxweb3/x402-core": "latest"
}
```

---

## 九、项目文件结构（改造后）

```
your-llm-router/
├── backend/                          # 后端服务（独立部署）
│   ├── src/
│   │   ├── server.ts                 # Express 主入口
│   │   ├── payment.ts                # x402 中间件配置
│   │   ├── openrouter-proxy.ts       # OpenRouter 转发逻辑
│   │   ├── models.ts                 # 模型映射表
│   │   └── pricing.ts                # 定价配置
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile                    # 部署用
│
├── proxy/                            # 本地路由代理（fork from ClawRouter）
│   ├── src/
│   │   ├── index.ts                  # 入口（保留，改注册逻辑）
│   │   ├── proxy.ts                  # 代理核心（改上游 URL）
│   │   ├── config.ts                 # 配置（改后端地址）
│   │   ├── cli.ts                    # CLI 命令（改命令集）
│   │   ├── stats.ts                  # 用量统计（保留）
│   │   ├── dedup.ts                  # 请求去重（保留）
│   │   ├── response-cache.ts         # 响应缓存（保留）
│   │   ├── retry.ts                  # 重试逻辑（保留）
│   │   ├── logger.ts                 # 日志（保留）
│   │   ├── onchainos-wallet.ts       # 新增：Agentic Wallet 集成
│   │   ├── x402-handler.ts           # 新增：402 支付处理
│   │   ├── router/
│   │   │   ├── simple-router.ts      # 新增：简化路由（替代原 15 维分类器）
│   │   │   └── types.ts              # 保留，简化
│   │   └── models.ts                 # 精简模型定义
│   ├── package.json
│   └── tsconfig.json
│
├── install.sh                        # 一键安装脚本
├── README.md
└── LICENSE
```

---

## 十、实施步骤

### Phase 1: 后端服务搭建（预计 2-3 天）

1. 初始化 Express 项目，集成 OKX x402-express SDK
2. 实现 OpenRouter 代理层（模型映射、流式转发、错误处理）
3. 配置免费路由（无 x402）和付费路由（有 x402）
4. 部署到你的服务器，确认 x402 支付流程跑通
5. 验证：用 curl 模拟请求，确认免费路由直接返回、付费路由返回 402

### Phase 2: 本地代理改造（预计 3-5 天）

1. Fork ClawRouter，删除不需要的模块和依赖
2. 实现 onchainos-wallet.ts（钱包登录/状态检查）
3. 实现 x402-handler.ts（402 响应处理 + onchainos 签名）
4. 改 proxy.ts，上游 URL 指向你的后端，分免费/付费路径
5. 实现简化路由器（2 tier）
6. 改 CLI 命令（/wallet login, /stats, /models, /tier）
7. 测试：本地启动代理，接 Agent 跑通免费 + 付费全链路

### Phase 3: 安装脚本 & 打包（预计 1-2 天）

1. 写 install.sh（检查 onchainos、下载代理、注册 OpenClaw provider）
2. 写首次使用引导文案
3. 测试：从零开始走一遍安装 → 免费使用 → 登录 → 充值 → 付费使用

### Phase 4: 测试 & 上线（预计 1-2 天）

1. 端到端测试：Cursor / VS Code / OpenClaw 各跑一遍
2. 边界情况：网络断开、余额不足、onchainos 未安装、模型不可用
3. 上传 GitHub，README 写清楚安装和使用方式

---

## 十一、风险点和缓解措施

### 1. onchainos CLI 调用延迟

**风险：** `execSync` 调用 onchainos CLI 做签名，每次可能有 200-500ms 延迟。
**缓解：** 只有付费请求才需要签名。免费请求完全绕过。而且 x402 是先请求再支付，签名只在收到 402 后才触发。

### 2. OpenRouter 免费模型限流

**风险：** OpenRouter 的 `:free` 后缀模型有速率限制，高并发时可能被 429。
**缓解：** 保留 3 个免费模型做 fallback 轮换。一个被限了自动切下一个。

### 3. 固定定价 vs 实际成本不匹配

**风险：** x402 收 $0.01，但某些长上下文请求在 OpenRouter 上实际花 $0.05。
**缓解：** V1 先用保守定价（比如 $0.015 覆盖大部分场景）。后端记录每次请求的实际 OpenRouter 成本，积累数据后 V2 做动态定价。

### 4. OpenRouter API Key 泄露

**风险：** Key 存在你的后端服务器上，服务器被攻击可能泄露。
**缓解：** 环境变量注入，不写入代码。设置 OpenRouter 的 spend limit。定期轮换 Key。

### 5. 用户不装 onchainos

**风险：** 用户没装 onchainos 但想用付费模型。
**缓解：** install.sh 里检测 onchainos，没装就自动安装。实在装不上的用户只能用免费模型，给出明确提示。

---

## 十二、安全提醒

**你在上一条消息里发了 OpenRouter API Key。** 这个 Key 相当于你的钱——别人拿到可以直接用你的额度调模型。建议：

1. 立即去 OpenRouter 后台把这个 Key 轮换掉（revoke + 生成新 Key）
2. 新 Key 只放在服务器环境变量里，不要出现在任何代码、文档、聊天记录中
3. 在 OpenRouter 设置 monthly spend limit，防止异常调用
