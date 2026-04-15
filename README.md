# OKXClawRouter 🦞

**AI 智能路由器 + X-Layer 链上微支付**

免费模型即开即用，付费模型按次付费 (USDC on X-Layer)

## 🚀 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/Metaeden/okxclawrouter/main/install.sh | bash
```

然后启动：
```bash
okxclawrouter
```

AI 工具配置 (Cursor / VS Code / 任何 OpenAI 兼容工具)：
```
API Base URL: http://localhost:8402/v1
```

## 🧠 智能路由

自动选择最优模型 — 免费模型免费用，付费模型按需付费。余额不足自动 fallback 到免费模型。

### OpenClaw 接入

先启动本地代理：
```bash
okxclawrouter
```

在 OpenClaw 里切换模型：
```
/model okxclawrouter/openrouter/free            # 免费
/model okxclawrouter/qwen/qwen3-coder:free      # 免费
/model okxclawrouter/paid/claude-sonnet-4-6     # 付费
/model okxclawrouter/paid/gpt-5.4               # 付费
/model okxclawrouter/paid/gemini-3.1-pro        # 付费
```

> 💡 选付费模型时，如果余额不足会自动 fallback 到免费模型，无需手动切换。

### Cursor / VS Code

```
API Base URL → http://localhost:8402/v1
```

| 模型 | 层级 | 费用 |
|------|------|------|
| `openrouter/free` | 🆓 FREE | $0 |
| `qwen/qwen3-coder:free` | 🆓 FREE | $0 |
| `paid/claude-sonnet-4-6` | 💰 PAID | $0.01/req |
| `paid/gpt-5.4` | 💰 PAID | $0.01/req |
| `paid/gemini-3.1-pro` | 💰 PAID | $0.008/req |

## 💰 解锁付费模型

1. 安装 onchainos: `npm install -g onchainos`
2. 登录: `/wallet login <你的邮箱>`
3. 充值: 发送 USDC 到 X-Layer 钱包 → https://web3.okx.com/onchainos
4. 使用: 连接钱包后付费模型自动生效

> 约 $1 USDC ≈ 100 次 Claude Sonnet 请求

## ⚙️ 命令

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助 |
| `/models` | 查看模型列表 |
| `/wallet status` | 钱包状态 |
| `/wallet login <email>` | 登录钱包 |
| `/wallet logout` | 断开钱包 |
| `/stats` | 使用统计 |
| `/tier [free\|paid\|auto]` | 切换路由模式 |

## 🏗️ 架构

```
AI Agent (Cursor/VS Code) → Local Proxy (:8402) → Backend (:4002) → OpenRouter
                                  ↕
                          onchainos CLI (x402 payment)
```

两个部署单元：
- `proxy/` — 本地代理 (用户机器, localhost:8402)
- `backend/` — 云端服务 + x402 支付网关 (port 4002)

## 🛠️ 开发

```bash
# Backend
cd backend
npm install
cp .env.example .env  # 填入你的密钥
npm run dev

# Proxy
cd proxy
npm install
npm run dev

# 测试
cd backend && npm test
cd proxy && npm test
```

### Backend 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `OKX_API_KEY` | ✅ | OKX Facilitator API key |
| `OKX_SECRET_KEY` | ✅ | OKX Facilitator secret |
| `OKX_PASSPHRASE` | ✅ | OKX Facilitator passphrase |
| `PAY_TO_ADDRESS` | ✅ | X-Layer 收款钱包地址 |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter API key |
| `PORT` | ❌ | 端口 (默认: 4002) |

### Proxy 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `OKX_ROUTER_BACKEND` | `http://130.162.140.123:4002` | 后端地址 (已预配置) |
| `OKX_ROUTER_PORT` | 8402 | 本地代理端口 |

## License

MIT
