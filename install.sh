#!/usr/bin/env bash
set -euo pipefail

# ── Colors ─────────────────────────────────────────────────────
R='\033[0;31m'     G='\033[0;32m'     Y='\033[1;33m'
B='\033[0;34m'     P='\033[0;35m'     C='\033[0;36m'
W='\033[1;37m'     DIM='\033[2m'     BOLD='\033[1m'
RESET='\033[0m'

# ── Emoji helpers ─────────────────────────────────────────────
LOVE="🦞"   ROCKET="🚀"   CHECK="✅"   FAIL="❌"
GEAR="⚙️"    PACK="📦"     LINK="🔗"    FREE="🆓"
PAID="💰"    STAR="⭐"     BRAIN="🧠"   FIRE="🔥"
WAVE="👋"    BOOK="📖"     DICE="🎲"

REPO_URL="https://github.com/Metaeden/okxclawrouter"
INSTALL_DIR="${HOME}/.okxclawrouter"

# ── Banner ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${C}"
cat << 'BANNER'
    ╔══════════════════════════════════════════════════╗
    ║                                                  ║
    ║       🦞  OKXClawRouter  Installer  🦞           ║
    ║                                                  ║
    ║   AI Router + x402 Micropayments on X-Layer      ║
    ║                                                  ║
    ╚══════════════════════════════════════════════════╝
BANNER
echo -e "${RESET}"
echo ""

# ── Step 1: Check prerequisites ────────────────────────────────
check_command() {
  command -v "$1" &>/dev/null
}

step() { echo -e "  ${BOLD}${2}${1}${RESET}"; }
ok()   { echo -e "    ${CHECK} ${G}${1}${RESET}"; }
warn() { echo -e "    ${Y}${1}${RESET}"; }
fail() { echo -e "    ${FAIL} ${R}${1}${RESET}"; }

step "Step 1/3 — 检查环境" "${GEAR}"
echo ""

# Node.js
if check_command node; then
  NODE_VER=$(node -v)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "Node.js $NODE_VER"
  else
    fail "Node.js 版本太低: $NODE_VER (需要 18+)"
    echo -e "    ${DIM}下载: https://nodejs.org/${RESET}"
    exit 1
  fi
else
  fail "未安装 Node.js"
  echo -e "    ${DIM}请先安装: https://nodejs.org/${RESET}"
  exit 1
fi

# npm
if check_command npm; then
  ok "npm $(npm -v)"
else
  fail "未安装 npm"
  exit 1
fi

# onchainos (optional)
if check_command onchainos; then
  ONCHAINOS_VER=$(onchainos --version 2>/dev/null || echo "?")
  ok "onchainos v${ONCHAINOS_VER} ${PAID} 付费模型可用"
  HAS_ONCHAINOS=true
else
  warn "onchainos 未安装 — 仅免费模型可用"
  echo -e "    ${DIM}付费模型需要: npm install -g onchainos${RESET}"
  HAS_ONCHAINOS=false
fi

echo ""

# ── Step 2: Clone & Build ──────────────────────────────────────
step "Step 2/3 — 安装代理" "${PACK}"
echo ""

if [ -d "$INSTALL_DIR" ]; then
  warn "检测到已有安装，更新中..."
  cd "$INSTALL_DIR"
  git pull --rebase 2>/dev/null || true
else
  echo -e "    ${DIM}从 GitHub 克隆仓库...${RESET}"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
    echo -e "    ${DIM}Git 失败，用 curl 下载...${RESET}"
    mkdir -p "$INSTALL_DIR"
    curl -fsSL "${REPO_URL}/archive/refs/heads/main.tar.gz" | tar xz -C "$INSTALL_DIR" --strip-components=1
  }
  ok "仓库克隆完成"
fi

cd "$INSTALL_DIR/proxy"

echo -e "    ${DIM}安装依赖 (npm install)...${RESET}"
npm install --silent 2>&1 | tail -3

echo -e "    ${DIM}构建 TypeScript (tsc)...${RESET}"
npm run build --silent 2>&1

if [ -f "dist/index.js" ]; then
  ok "构建成功"
else
  fail "构建失败 — dist/index.js 不存在"
  echo -e "    ${DIM}尝试手动: cd $INSTALL_DIR/proxy && npm run build${RESET}"
  exit 1
fi

echo ""

# ── Step 3: Create launcher ────────────────────────────────────
step "Step 3/3 — 创建启动器" "${ROCKET}"
echo ""

LAUNCH_SCRIPT="${HOME}/.local/bin/okxclawrouter"
mkdir -p "$(dirname "$LAUNCH_SCRIPT")"

cat > "$LAUNCH_SCRIPT" << 'LAUNCHER'
#!/usr/bin/env bash
INSTALL_DIR="${HOME}/.okxclawrouter/proxy"
export OKX_ROUTER_BACKEND="${OKX_ROUTER_BACKEND:-http://130.162.140.123:4002}"
export OKX_ROUTER_PORT="${OKX_ROUTER_PORT:-8402}"
node "$INSTALL_DIR/dist/index.js" "$@"
LAUNCHER

chmod +x "$LAUNCH_SCRIPT"

# Ensure ~/.local/bin is in PATH
if [[ ":$PATH:" != *":${HOME}/.local/bin:"* ]]; then
  # Add to shell profile
  for PROFILE in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
    if [ -f "$PROFILE" ]; then
      if ! grep -q '.local/bin' "$PROFILE" 2>/dev/null; then
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$PROFILE"
      fi
      break
    fi
  done
  export PATH="$HOME/.local/bin:$PATH"
fi

ok "启动器已创建: $LAUNCH_SCRIPT"

# ── Step 3.5: Auto-configure OpenClaw ──────────────────────────
OPENCLAW_CONFIG="$HOME/.openclaw/openclaw.json"
if [ -f "$OPENCLAW_CONFIG" ]; then
  echo ""
  echo -e "    ${DIM}检测到 OpenClaw，自动配置 provider...${RESET}"

  # Use node to safely modify JSON (preserves formatting/comments-free)
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('$OPENCLAW_CONFIG', 'utf8'));
    if (!cfg.models) cfg.models = { mode: 'merge', providers: {} };
    if (!cfg.models.providers) cfg.models.providers = {};
    cfg.models.providers.okxclawrouter = {
      baseUrl: 'http://127.0.0.1:8402/v1',
      api: 'openai-completions',
      apiKey: 'sk-okxclawrouter',
      models: [
        { id: 'free/deepseek-chat',     name: 'okxclawrouter 🆓 DeepSeek Chat',     api: 'openai-completions', reasoning: false, input: ['text'], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 128000, maxTokens: 8192 },
        { id: 'free/deepseek-r1',       name: 'okxclawrouter 🆓 DeepSeek R1',       api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 128000, maxTokens: 8192 },
        { id: 'free/qwen3',             name: 'okxclawrouter 🆓 Qwen3',             api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 128000, maxTokens: 8192 },
        { id: 'paid/claude-sonnet-4-6',  name: 'okxclawrouter 💰 Claude Sonnet 4.6', api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0.01,output:0.01,cacheRead:0,cacheWrite:0}, contextWindow: 200000, maxTokens: 64000 },
        { id: 'paid/gpt-5.4',           name: 'okxclawrouter 💰 GPT-5.4',           api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0.01,output:0.01,cacheRead:0,cacheWrite:0}, contextWindow: 400000, maxTokens: 128000 },
        { id: 'paid/gemini-3.1-pro',    name: 'okxclawrouter 💰 Gemini 3.1 Pro',    api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0.008,output:0.008,cacheRead:0,cacheWrite:0}, contextWindow: 1050000, maxTokens: 65536 }
      ]
    };
    // Register models in agents.defaults.models so OpenClaw shows them in the UI
    if (!cfg.agents) cfg.agents = {};
    if (!cfg.agents.defaults) cfg.agents.defaults = {};
    if (!cfg.agents.defaults.models) cfg.agents.defaults.models = {};
    cfg.models.providers.okxclawrouter.models.forEach(function(m) {
      cfg.agents.defaults.models['okxclawrouter/' + m.id] = {};
    });
    fs.writeFileSync('$OPENCLAW_CONFIG', JSON.stringify(cfg, null, 2));
    console.log('OK');
  " 2>&1

  ok "OpenClaw 已配置完成"
else
  warn "未检测到 OpenClaw — 安装后运行 okxclawrouter 再手动接入"
fi

echo ""

# ── Done! ──────────────────────────────────────────────────────
echo -e "${BOLD}${G}"
cat << 'DONE'
    ╔══════════════════════════════════════════════════╗
    ║                                                  ║
    ║        🎉  安装完成！准备起飞！🦞               ║
    ║                                                  ║
    ╚══════════════════════════════════════════════════╝
DONE
echo -e "${RESET}"

echo -e "  ${BOLD}${FIRE} 免费模型 (即开即用):${RESET}"
echo -e "    ${FREE} DeepSeek V3  /  DeepSeek R1  /  Qwen3"
echo ""
echo -e "  ${BOLD}${STAR} 启动代理:${RESET}"
echo -e "    ${W} okxclawrouter${RESET}"
echo ""

if [ "$HAS_ONCHAINOS" = true ]; then
echo -e "  ${BOLD}${PAID} 解锁付费模型 (Claude / GPT-5.4 / Gemini Pro):${RESET}"
echo -e "    1. 登录钱包:  /wallet login <你的邮箱>"
echo -e "    2. 充值 USDC: 发送到 X Layer 钱包"
echo -e "       ${LINK} https://web3.okx.com/onchainos"
echo -e "    3. 自动使用:  连接钱包后付费模型自动生效"
echo -e "    ${DIM}约 \$1 USDC ≈ 100 次 Claude Sonnet 请求${RESET}"
else
echo -e "  ${BOLD}${PAID} 想用付费模型？${RESET}"
echo -e "    npm install -g onchainos"
echo -e "    然后重新运行: curl -fsSL ${REPO_URL}/raw/main/install.sh | bash"
fi

echo ""
echo -e "  ${BOLD}${BRAIN} OpenClaw 已自动配置，直接用:${RESET}"
echo -e "    /model okxclawrouter/free/deepseek-chat     ${DIM}(免费)${RESET}"
echo -e "    /model okxclawrouter/paid/claude-sonnet-4-6  ${DIM}(付费)${RESET}"
echo ""
echo -e "  ${BOLD}${LINK} Cursor / VS Code:${RESET}"
echo -e "    API Base URL → ${BOLD}http://localhost:8402/v1${RESET}"
echo ""
echo -e "  ${BOLD}${LINK} 运维命令:${RESET}"
echo -e "    ${W}okxclawrouter${RESET}        启动代理（后台运行）"
echo -e "    ${W}okxclawrouter state${RESET}  查看运行状态"
echo -e "    ${W}okxclawrouter stop${RESET}   停止代理"
echo ""
echo -e "  ${BOLD}${LINK} 测试代理:${RESET}"
echo -e "    ${DIM}curl http://localhost:8402/v1/models${RESET}"
echo ""
echo -e "  ${DIM}GitHub: ${REPO_URL}${RESET}"
echo ""
echo -e "  ${BOLD}${LOVE} Happy Clawing! ${LOVE}${RESET}"
echo ""
