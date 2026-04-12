# OKXClawRouter

AI Agent LLM smart router with OKX Agentic Wallet + x402 micropayments on X Layer.

Free models (DeepSeek, Qwen) work out of the box. Paid models (Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro) pay per-request via USDC on X Layer.

## Quick Start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/<your-org>/okxclawrouter/main/install.sh | bash

# Start the router
okxclawrouter

# Point your AI tool to:
# API Base URL: http://localhost:8402/v1
```

## Architecture

```
AI Agent (Cursor/VS Code) → Local Proxy (:8402) → Backend (:4002) → OpenRouter
                                  ↕
                          onchainos CLI (x402 payment)
```

**Two deployment units:**
- `proxy/` — Local proxy on user machine (localhost:8402)
- `backend/` — Your cloud server with x402 payment wall (port 4002)

## Models

| Model | Tier | Cost |
|-------|------|------|
| `free/deepseek-chat` | FREE | $0 |
| `free/deepseek-r1` | FREE | $0 |
| `free/qwen3` | FREE | $0 |
| `paid/claude-sonnet-4-6` | PAID | $0.01/req |
| `paid/gpt-5.4` | PAID | $0.01/req |
| `paid/gemini-3.1-pro` | PAID | $0.008/req |

## Using Paid Models

1. Install onchainos: `npm install -g onchainos`
2. Login: `/wallet login <your-email>`
3. Fund: Send USDC to your wallet on X Layer → https://web3.okx.com/onchainos
4. Use: Paid models auto-selected when wallet is connected

~$1 USDC = ~100 requests to Claude Sonnet 4.6.

## Commands

| Command | Description |
|---------|-------------|
| `/wallet login <email>` | Login to OKX Agentic Wallet |
| `/wallet status` | Check wallet and balance |
| `/wallet logout` | Disconnect wallet |
| `/stats` | View usage statistics |
| `/models` | List all models |
| `/tier [free\|paid\|auto]` | Force tier or auto-route |
| `/help` | Show help |

## Development

```bash
# Backend
cd backend
npm install
cp .env.example .env  # Fill in your keys
npm run dev

# Proxy
cd proxy
npm install
npm run dev

# Tests
cd backend && npm test
cd proxy && npm test
```

### Backend Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OKX_API_KEY` | Yes | OKX Facilitator API key |
| `OKX_SECRET_KEY` | Yes | OKX Facilitator secret |
| `OKX_PASSPHRASE` | Yes | OKX Facilitator passphrase |
| `PAY_TO_ADDRESS` | Yes | Your wallet address on X Layer |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `PORT` | No | Server port (default: 4002) |

### Proxy Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OKX_ROUTER_PORT` | 8402 | Local proxy port |
| `OKX_ROUTER_BACKEND` | `https://your-domain.com` | Backend URL |

## Deploy Backend

```bash
cd backend
docker build -t okxclawrouter-backend .
docker run -p 4002:4002 --env-file .env okxclawrouter-backend
```

## License

MIT
