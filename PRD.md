# OKXClawRouter — Product Requirements Document (PRD)

> Version: 1.0  
> Date: 2026-04-13  
> Status: Development

---

## 1. Product Overview

### 1.1 What is OKXClawRouter?

OKXClawRouter is an AI Agent-oriented LLM smart router. Based on the ClawRouter open-source project, it replaces the payment pipeline with **OKX Agentic Wallet + X Layer x402**, and the backend model service connects to the **OpenRouter API**.

Users install it with a single command after having OpenClaw. Free models work out of the box; paid models use USDC micropayments on X Layer via OKX Agentic Wallet.

### 1.2 Core Value Proposition

| For Users | For Developers |
|-----------|---------------|
| Free models with zero setup | Simple 2-tier routing (FREE/PAID) |
| Paid models via email login (no seed phrases) | OpenRouter handles 6 models |
| Transparent per-request pricing ($0.01/req) | x402 payment handled by OKX SDK |
| Auto-fallback when balance low | Atomic, stateless architecture |

### 1.3 Key Differences from ClawRouter

| Dimension | ClawRouter (Original) | OKXClawRouter |
|-----------|----------------------|---------------|
| Wallet | Local BIP-39, user manages mnemonic | OKX Agentic Wallet, email login |
| Payment Chain | Base / Solana, @x402/* SDK | X Layer (eip155:196), OKX x402 SDK |
| Payment Signing | In-process viem signing | `onchainos payment x402-pay` CLI |
| Model Source | BlockRun backend (55+ models) | Your backend + OpenRouter API (6 models) |
| Model Tiers | 4 tiers (SIMPLE/MEDIUM/COMPLEX/REASONING) | 2 tiers (FREE / PAID) |
| Free Experience | None (all requests need wallet) | Free models, no login needed |

---

## 2. System Architecture

### 2.1 Overall Flow

```
┌──────────────────────────────────────────────────────────────┐
│                     User's AI Agent                          │
│                (Cursor / VS Code / OpenClaw)                 │
└──────────────────────────┬───────────────────────────────────┘
                           │  OpenAI-compatible API
                           ▼
┌──────────────────────────────────────────────────────────────┐
│               Local Proxy (localhost:8402)                    │
│                                                              │
│  ┌────────────┐   ┌─────────────┐   ┌──────────────────┐   │
│  │  Request    │──▶│ Tier Router │──▶│ Upstream Proxy   │   │
│  │  Classifier │   │ FREE/PAID   │   │ + Dedup + Cache  │   │
│  └────────────┘   └─────────────┘   └────────┬─────────┘   │
│                                                │             │
│  ┌─────────────────────────────────────────────┼───────────┐ │
│  │           x402 Payment Layer                │           │ │
│  │  Receive 402 → onchainos x402-pay → Retry  │           │ │
│  └─────────────────────────────────────────────┼───────────┘ │
└────────────────────────────────────────────────┼─────────────┘
                                                 │  HTTPS
                                                 ▼
┌──────────────────────────────────────────────────────────────┐
│              Backend Service (your-domain.com)                │
│                                                              │
│  ┌──────────────────────┐   ┌───────────────────────────┐   │
│  │ Free Route            │   │ Paid Route                │   │
│  │ /v1/free/chat/...     │   │ /v1/paid/chat/completions │   │
│  │ No x402 middleware    │   │ x402 paymentMiddleware    │   │
│  │ Direct → OpenRouter   │   │ Verify → OpenRouter       │   │
│  └──────────┬────────────┘   └────────────┬──────────────┘  │
│             └──────────┬──────────────────┘                  │
│                        ▼                                     │
│           ┌───────────────────────┐                          │
│           │  OpenRouter Proxy     │                          │
│           │  API Key: sk-or-...   │                          │
│           │  Model Map + Stream   │                          │
│           └───────────────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Two Independent Deployment Units

| Unit | Description | Location |
|------|-------------|----------|
| **Local Proxy** | npm package, runs on user machine | `proxy/` |
| **Backend Service** | Your Node.js server, deployed to cloud | `backend/` |

---

## 3. Model Configuration

### 3.1 Model List

| Internal ID | OpenRouter Model ID | Tier | Use Case | Cost |
|------------|-------------------|------|----------|------|
| `free/deepseek-chat` | `deepseek/deepseek-chat-v3-0324:free` | FREE | General-purpose primary | $0 |
| `free/deepseek-r1` | `deepseek/deepseek-r1:free` | FREE | Reasoning tasks | $0 |
| `free/qwen3` | `qwen/qwen3-next-80b-a3b-instruct:free` | FREE | General fallback | $0 |
| `paid/claude-sonnet-4` | `anthropic/claude-sonnet-4` | PAID | High-quality general + code | $3/$15 per M tokens |
| `paid/gpt-5.4` | `openai/gpt-5.4` | PAID | High-quality general backup | $2.5/$15 per M tokens |
| `paid/gemini-3.1-pro` | `google/gemini-3.1-pro-preview` | PAID | Strong reasoning + long context | $2/$12 per M tokens |

### 3.2 Routing Logic

```
Request arrives
  │
  ├─ User specified a model → Use that model directly
  │
  ├─ User specified "auto" or nothing
  │   │
  │   ├─ No wallet / No balance → FREE tier
  │   │   ├─ Reasoning signals detected → free/deepseek-r1
  │   │   └─ General task → free/deepseek-chat
  │   │       └─ fallback → free/qwen3
  │   │
  │   └─ Wallet connected with balance → PAID tier
  │       ├─ Reasoning signals detected → paid/gemini-3.1-pro
  │       └─ General task → paid/claude-sonnet-4
  │           └─ fallback → paid/gpt-5.4 → free/*
  │
  └─ Paid model request fails (402/balance) → Downgrade to FREE tier
```

### 3.3 Reasoning Detection

Simple regex-based detection on the last user message:
- `step by step`, `think carefully`, `reason`, `prove`, `analyze complex`, `chain of thought`

### 3.4 Pricing

| Model | x402 Charge Per Request | Estimated Margin |
|-------|------------------------|------------------|
| `paid/claude-sonnet-4` | $0.01 | ~30-70% |
| `paid/gpt-5.4` | $0.01 | ~30-50% |
| `paid/gemini-3.1-pro` | $0.008 | ~30-60% |

V1 uses fixed per-request pricing. V2 may introduce dynamic token-based pricing.

---

## 4. Backend Service

### 4.1 Technology Stack

```
Node.js + Express
├── @okxweb3/x402-express    — x402 payment middleware
├── @okxweb3/x402-evm        — EVM payment scheme
├── @okxweb3/x402-core       — OKX Facilitator client
└── native fetch             — Forward to OpenRouter
```

### 4.2 API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | None | Health check |
| `GET` | `/v1/models` | None | List available models (OpenAI-compatible) |
| `POST` | `/v1/free/chat/completions` | None | Free model chat completion |
| `POST` | `/v1/paid/chat/completions` | x402 | Paid model chat completion |

### 4.3 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OKX_API_KEY` | Yes | OKX Facilitator API key |
| `OKX_SECRET_KEY` | Yes | OKX Facilitator secret |
| `OKX_PASSPHRASE` | Yes | OKX Facilitator passphrase |
| `PAY_TO_ADDRESS` | Yes | Your receiving wallet on X Layer |
| `OPENROUTER_API_KEY` | Yes | OpenRouter API key |
| `PORT` | No | Server port (default: 4002) |
| `SITE_URL` | No | Your domain for OpenRouter HTTP-Referer |

### 4.4 Deployment

Docker image via `backend/Dockerfile`. Multi-stage build:
1. Builder stage: compile TypeScript
2. Production stage: only runtime deps + compiled JS

---

## 5. Local Proxy

### 5.1 Architecture

The proxy runs locally on `localhost:8402`, providing an OpenAI-compatible API endpoint. AI tools (Cursor, VS Code, OpenClaw) point to it.

### 5.2 Key Modules

| Module | Purpose |
|--------|---------|
| `proxy.ts` | Core request handler: routing, caching, fallback, x402 handling |
| `router/simple-router.ts` | 2-tier routing (FREE/PAID) with reasoning detection |
| `onchainos-wallet.ts` | Agentic Wallet integration via onchainos CLI |
| `x402-handler.ts` | Handle 402 responses: sign via onchainos, retry |
| `dedup.ts` | Deduplicate identical concurrent requests (500ms window) |
| `response-cache.ts` | Cache non-streaming responses (5min TTL, 200 entries) |
| `retry.ts` | Retry on 429/5xx with exponential backoff |
| `stats.ts` | Usage tracking (requests, latency, model breakdown) |
| `cli.ts` | CLI commands (/wallet, /stats, /models, /tier, /help) |
| `logger.ts` | Structured logging with levels (debug/info/warn/error) |

### 5.3 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completion |
| `GET` | `/v1/models` | List available models |
| `POST` | `/cli` | Execute CLI command |
| `GET` | `/health` | Health check |

### 5.4 Resilience Features

- **Request deduplication**: Identical requests within 500ms share a single upstream call
- **Response caching**: Non-streaming 200 responses cached for 5 minutes
- **Retry with backoff**: 429 and 5xx retried up to 2 times with exponential delay
- **Fallback chain**: If primary model fails, tries alternatives (paid → free)
- **Wallet caching**: Wallet status cached 30s to avoid repeated CLI calls

---

## 6. Payment Flow

### 6.1 x402 Protocol

1. Client sends request to paid route
2. Backend responds with HTTP 402 + payment requirements (PAYMENT-REQUIRED header)
3. Proxy extracts payment details, calls `onchainos payment x402-pay` to sign
4. Proxy retries request with payment signature header
5. Backend verifies payment via OKX Facilitator, forwards to OpenRouter

### 6.2 Insufficient Balance Handling

When payment fails due to low balance:
1. Proxy detects `InsufficientBalanceError`
2. Automatically falls back to free models
3. Adds `X-Router-Warning: insufficient_balance:switched_to_free` header
4. For streaming: injects SSE comment with balance warning
5. For non-streaming: adds `_router_warning` to JSON response

**Warning message format:**
```
USDC balance insufficient. Switched to free model automatically.
Recharge at https://web3.okx.com/onchainos (X Layer network)
```

---

## 7. User Experience

### 7.1 Installation

```bash
curl -fsSL https://raw.githubusercontent.com/<your-org>/okxclawrouter/main/install.sh | bash
```

The install script:
1. Checks Node.js 18+ is installed
2. Checks onchainos CLI (optional — only needed for paid models)
3. Clones/downloads the proxy package
4. Installs dependencies and builds
5. Creates `~/.local/bin/okxclawrouter` launcher script

### 7.2 First Use

```
═══════════════════════════════════════════════════════
  OKXClawRouter v0.1.0
═══════════════════════════════════════════════════════

  Free models ready — use without login:
    DeepSeek V3 / DeepSeek R1 / Qwen3

  Want Claude Sonnet 4, GPT-5.4, Gemini 3.1 Pro?
    1. Login wallet:  /wallet login <your-email>
    2. Fund wallet:   Send USDC on X Layer network
       -> https://web3.okx.com/onchainos
    3. Start using:   Paid models auto-selected when wallet connected
═══════════════════════════════════════════════════════
```

### 7.3 Daily Use — Transparent

Users code normally in Cursor / VS Code / OpenClaw. The router works in the background:
- Simple questions → Free models, no payment
- Complex questions + wallet connected + balance → Paid models, auto x402 signing
- Complex questions + no wallet/balance → Free models, occasional upgrade prompt

### 7.4 CLI Commands

| Command | Function | Requires Login |
|---------|----------|---------------|
| `/wallet login <email>` | Login to Agentic Wallet | No |
| `/wallet status` | Check login status and balance | No |
| `/wallet logout` | Disconnect wallet | No |
| `/stats` | View usage statistics | No |
| `/stats clear` | Reset statistics | No |
| `/models` | List available models | No |
| `/tier free` | Force free models only | No |
| `/tier paid` | Force paid models only | Yes |
| `/tier auto` | Auto routing (default) | No |
| `/help` | Show help | No |

---

## 8. Project Structure

```
okxclawrouter/
├── backend/                          # Backend service (deploy to cloud)
│   ├── src/
│   │   ├── server.ts                 # Express entry point
│   │   ├── payment.ts                # x402 middleware config
│   │   ├── openrouter-proxy.ts       # OpenRouter forwarding
│   │   ├── models.ts                 # Model mapping table
│   │   ├── pricing.ts                # Per-model pricing
│   │   └── __tests__/                # Unit tests
│   ├── Dockerfile                    # Production Docker build
│   ├── .env.example                  # Environment variable template
│   ├── package.json
│   └── tsconfig.json
│
├── proxy/                            # Local routing proxy (user machine)
│   ├── src/
│   │   ├── index.ts                  # Entry point + startup banner
│   │   ├── proxy.ts                  # Core proxy handler
│   │   ├── config.ts                 # Configuration
│   │   ├── cli.ts                    # CLI commands
│   │   ├── onchainos-wallet.ts       # Agentic Wallet integration
│   │   ├── x402-handler.ts           # 402 payment handling
│   │   ├── models.ts                 # Model definitions
│   │   ├── stats.ts                  # Usage statistics
│   │   ├── dedup.ts                  # Request deduplication
│   │   ├── response-cache.ts         # Response caching
│   │   ├── retry.ts                  # Retry with backoff
│   │   ├── logger.ts                 # Structured logging
│   │   ├── router/
│   │   │   ├── simple-router.ts      # 2-tier routing logic
│   │   │   └── types.ts             # Type definitions
│   │   └── __tests__/                # Unit tests
│   ├── package.json
│   └── tsconfig.json
│
├── install.sh                        # One-click install script
├── PRD.md                            # This document
├── project-design.md                 # Original design notes
└── README.md                         # Usage documentation
```

---

## 9. Risks and Mitigations

| # | Risk | Impact | Probability | Mitigation |
|---|------|--------|-------------|------------|
| 1 | onchainos CLI call latency (200-500ms) | Slower paid requests | Medium | Only paid requests trigger signing; free requests bypass entirely |
| 2 | OpenRouter free model rate limiting (429) | Free users hit limits | Medium | 3 free models as fallbacks; auto-rotate on 429 |
| 3 | Fixed pricing vs actual cost mismatch | Loss on long-context requests | Medium | V1 uses conservative pricing ($0.01); collect cost data for V2 dynamic pricing |
| 4 | OpenRouter API key leaked | Financial loss | Low | Env-var only, never in code; set spend limit; rotate regularly |
| 5 | User doesn't install onchainos | Can't use paid models | Medium | install.sh auto-checks; clear prompts; free models always available |
| 6 | USDC balance insufficient mid-session | UX disruption | Medium | Auto-fallback to free with warning message; no hard failure |
| 7 | Network disconnection | Requests fail | Low | Retry with backoff; clear error messages |

---

## 10. Implementation Phases

### Phase 1: Backend Service
- Express server with x402 middleware
- OpenRouter proxy with model mapping and streaming
- Free/paid route separation
- Environment validation, logging, error handling
- Dockerfile for deployment

### Phase 2: Local Proxy
- 2-tier routing (FREE/PAID) with reasoning detection
- onchainos wallet integration
- x402 payment handler (v1 + v2 protocol)
- Request deduplication, response caching, retry
- CLI commands (/wallet, /stats, /models, /tier, /help)
- Balance-insufficient UX with auto-fallback

### Phase 3: Install & Package
- install.sh one-click installer
- Startup banner with onboarding flow
- OpenClaw provider registration

### Phase 4: QA & Launch
- Unit tests (33 tests across both packages)
- TypeScript compilation verification
- End-to-end testing: free flow, paid flow, fallback flow
- README documentation

---

## 11. Success Metrics

| Metric | Target |
|--------|--------|
| Free model availability | >99% uptime (3 fallbacks) |
| Paid request latency (including payment) | <2s p95 |
| Payment success rate | >98% |
| Fallback trigger rate | <5% of paid requests |
| User onboarding completion (free → paid) | >20% |

---

## 12. Future Roadmap (V2)

- **Dynamic pricing**: Token-count-based pricing instead of fixed per-request
- **More models**: Add specialized models (code, vision, long-context)
- **Session-based pricing**: x402 session certificates for reduced per-request overhead
- **Analytics dashboard**: Web UI for usage stats and cost tracking
- **Multi-chain support**: Beyond X Layer to other EVM chains
- **Image generation**: Integrate image models (DALL-E, Stable Diffusion)
