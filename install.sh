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
INSTALL_DIR="${HOME}/.okclawrouter"
LEGACY_INSTALL_DIR="${HOME}/.okxclawrouter"

# ── Banner ─────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${C}"
cat << 'BANNER'
    ╔══════════════════════════════════════════════════╗
    ║                                                  ║
    ║       🦞   okclawrouter Installer  🦞           ║
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
  ok "${ONCHAINOS_VER} ${PAID} 付费模型可用"
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

if [ ! -d "$INSTALL_DIR" ] && [ -d "$LEGACY_INSTALL_DIR" ]; then
  warn "检测到旧安装目录，迁移到 ~/.okclawrouter ..."
  if mv "$LEGACY_INSTALL_DIR" "$INSTALL_DIR" 2>/dev/null; then
    ok "旧安装目录已迁移"
  else
    warn "旧安装目录迁移失败，继续复用 ~/.okxclawrouter"
    INSTALL_DIR="$LEGACY_INSTALL_DIR"
  fi
fi

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

LAUNCH_SCRIPT="${HOME}/.local/bin/okclawrouter"
NODE_BIN="$(command -v node)"
mkdir -p "$(dirname "$LAUNCH_SCRIPT")"

cat > "$LAUNCH_SCRIPT" << 'LAUNCHER'
#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="${HOME}/.okclawrouter"
LEGACY_INSTALL_ROOT="${HOME}/.okxclawrouter"

if [ ! -d "$INSTALL_ROOT" ] && [ -d "$LEGACY_INSTALL_ROOT" ]; then
  mv "$LEGACY_INSTALL_ROOT" "$INSTALL_ROOT" 2>/dev/null || true
fi

if [ ! -d "${INSTALL_ROOT}/proxy" ] && [ -d "${LEGACY_INSTALL_ROOT}/proxy" ]; then
  INSTALL_ROOT="$LEGACY_INSTALL_ROOT"
fi

INSTALL_DIR="${INSTALL_ROOT}/proxy"
PID_FILE="${INSTALL_ROOT}/okclawrouter.pid"
LOG_FILE="${INSTALL_ROOT}/okclawrouter.log"
LAUNCHCTL_LABEL="com.metaeden.okclawrouter"
NODE_BIN="__NODE_BIN__"
export OKCLAWROUTER_BACKEND="${OKCLAWROUTER_BACKEND:-${OKX_ROUTER_BACKEND:-http://130.162.140.123:4002}}"
export OKCLAWROUTER_PORT="${OKCLAWROUTER_PORT:-${OKX_ROUTER_PORT:-8402}}"

if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi

if [ -z "$NODE_BIN" ]; then
  echo "Node.js binary not found. Re-run install.sh to refresh the launcher." >&2
  exit 1
fi

is_launchctl_mode() {
  [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1
}

get_launchctl_pid() {
  launchctl list | awk -v label="$LAUNCHCTL_LABEL" '$3 == label { print $1 }'
}

is_running() {
  if is_launchctl_mode; then
    local launchctl_pid
    launchctl_pid="$(get_launchctl_pid)"
    if [ -n "$launchctl_pid" ] && [ "$launchctl_pid" != "-" ] && kill -0 "$launchctl_pid" 2>/dev/null; then
      echo "$launchctl_pid" > "$PID_FILE"
      return 0
    fi
    rm -f "$PID_FILE"
    return 1
  fi

  if [ ! -f "$PID_FILE" ]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -z "$pid" ]; then
    rm -f "$PID_FILE"
    return 1
  fi

  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  rm -f "$PID_FILE"
  return 1
}

wait_until_ready() {
  local tries=0
  while [ "$tries" -lt 20 ]; do
    if curl -fsS "http://127.0.0.1:${OKCLAWROUTER_PORT}/health" >/dev/null 2>&1; then
      return 0
    fi
    tries=$((tries + 1))
    sleep 0.5
  done
  return 1
}

start_bg() {
  mkdir -p "$INSTALL_ROOT"

  if is_running; then
    echo "okclawrouter already running (pid $(cat "$PID_FILE"))."
    exit 0
  fi

  if is_launchctl_mode; then
    launchctl remove "$LAUNCHCTL_LABEL" >/dev/null 2>&1 || true
    launchctl submit -l "$LAUNCHCTL_LABEL" -o "$LOG_FILE" -e "$LOG_FILE" -- \
      /usr/bin/env \
      OKCLAWROUTER_BACKEND="$OKCLAWROUTER_BACKEND" \
      OKCLAWROUTER_PORT="$OKCLAWROUTER_PORT" \
      "$NODE_BIN" "$INSTALL_DIR/dist/index.js"
    sleep 0.2
    get_launchctl_pid > "$PID_FILE" 2>/dev/null || true
  elif command -v setsid >/dev/null 2>&1; then
    setsid "$NODE_BIN" "$INSTALL_DIR/dist/index.js" >>"$LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
  else
    nohup "$NODE_BIN" "$INSTALL_DIR/dist/index.js" >>"$LOG_FILE" 2>&1 < /dev/null &
    echo $! > "$PID_FILE"
  fi

  if wait_until_ready; then
    echo "okclawrouter started on http://127.0.0.1:${OKCLAWROUTER_PORT} (pid $(cat "$PID_FILE"))."
    exit 0
  fi

  echo "Failed to start okclawrouter. Recent logs:" >&2
  tail -n 60 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  exit 1
}

stop_bg() {
  if ! is_running; then
    echo "okclawrouter is not running."
    exit 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"

  if is_launchctl_mode; then
    launchctl remove "$LAUNCHCTL_LABEL" >/dev/null 2>&1 || true

    for _ in $(seq 1 20); do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "okclawrouter stopped."
        exit 0
      fi
      sleep 0.5
    done

    rm -f "$PID_FILE"
    echo "okclawrouter stopped."
    exit 0
  fi

  kill "$pid" 2>/dev/null || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      echo "okclawrouter stopped."
      exit 0
    fi
    sleep 0.5
  done

  echo "okclawrouter did not stop in time; forcing kill." >&2
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
}

show_state() {
  if is_running; then
    echo "status=running pid=$(cat "$PID_FILE") port=${OKCLAWROUTER_PORT} log=${LOG_FILE}"
  else
    echo "status=stopped port=${OKCLAWROUTER_PORT} log=${LOG_FILE}"
  fi
}

cmd="${1:-start}"
case "$cmd" in
  start)
    start_bg
    ;;
  stop)
    stop_bg
    ;;
  restart)
    stop_bg
    start_bg
    ;;
  state|status)
    show_state
    ;;
  run)
    shift || true
    exec "$NODE_BIN" "$INSTALL_DIR/dist/index.js" "$@"
    ;;
  logs)
    touch "$LOG_FILE"
    exec tail -n 100 -f "$LOG_FILE"
    ;;
  *)
    echo "Usage: okclawrouter [start|stop|restart|state|run|logs]" >&2
    exit 1
    ;;
esac
LAUNCHER

python3 - "$LAUNCH_SCRIPT" "$NODE_BIN" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
node_bin = sys.argv[2]
path.write_text(path.read_text().replace('__NODE_BIN__', node_bin))
PY

chmod +x "$LAUNCH_SCRIPT"
rm -f "${HOME}/.local/bin/okxclawrouter"

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

echo -e "    ${DIM}启动本地代理...${RESET}"
if "$LAUNCH_SCRIPT" start; then
  ok "本地代理已启动"
else
  fail "本地代理启动失败"
  echo -e "    ${DIM}查看日志: $HOME/.okclawrouter/okclawrouter.log${RESET}"
  exit 1
fi

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
    delete cfg.models.providers.okxclawrouter;
    cfg.models.providers.okclawrouter = {
      baseUrl: 'http://127.0.0.1:8402/v1',
      api: 'openai-completions',
      apiKey: 'sk-okclawrouter',
      models: [
        { id: 'openrouter/free',          name: '[okclawrouter] OpenRouter Free',    api: 'openai-completions', reasoning: false, input: ['text'], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 128000,  maxTokens: 8192 },
        { id: 'qwen/qwen3-coder:free',    name: '[okclawrouter] Qwen3 Coder',        api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 128000,  maxTokens: 8192 },
        { id: 'paid/claude-sonnet-4-6',   name: '[okclawrouter] Claude Sonnet 4.6',  api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0.01, output:0.01,  cacheRead:0, cacheWrite:0}, contextWindow: 200000,  maxTokens: 64000 },
        { id: 'paid/gpt-5.4',             name: '[okclawrouter] GPT-5.4',            api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0.01, output:0.01,  cacheRead:0, cacheWrite:0}, contextWindow: 400000,  maxTokens: 128000 },
        { id: 'paid/gemini-3.1-pro',      name: '[okclawrouter] Gemini 3.1 Pro',     api: 'openai-completions', reasoning: true,  input: ['text'], cost: {input:0.008,output:0.008, cacheRead:0, cacheWrite:0}, contextWindow: 1050000, maxTokens: 65536 }
      ]
    };
    if (!cfg.agents) cfg.agents = {};
    if (!cfg.agents.defaults) cfg.agents.defaults = {};
    if (!cfg.agents.defaults.models) cfg.agents.defaults.models = {};

    for (const key of Object.keys(cfg.agents.defaults.models)) {
      if (key.startsWith('okxclawrouter/')) {
        delete cfg.agents.defaults.models[key];
      }
    }

    cfg.agents.defaults.models['okclawrouter/openrouter/free'] = { alias: '[okclawrouter] OpenRouter Free' };
    cfg.agents.defaults.models['okclawrouter/qwen/qwen3-coder:free'] = { alias: '[okclawrouter] Qwen3 Coder' };
    cfg.agents.defaults.models['okclawrouter/paid/claude-sonnet-4-6'] = { alias: '[okclawrouter] Claude Sonnet 4.6' };
    cfg.agents.defaults.models['okclawrouter/paid/gpt-5.4'] = { alias: '[okclawrouter] GPT-5.4' };
    cfg.agents.defaults.models['okclawrouter/paid/gemini-3.1-pro'] = { alias: '[okclawrouter] Gemini 3.1 Pro' };

    if (!cfg.meta) cfg.meta = {};
    cfg.meta.lastTouchedAt = new Date().toISOString();
    fs.writeFileSync('$OPENCLAW_CONFIG', JSON.stringify(cfg, null, 2));
    console.log('OK');
  " 2>&1

  ok "OpenClaw 已配置完成"

  # Show wallet address and X Layer USDC balance if onchainos is installed
  if [ "$HAS_ONCHAINOS" = true ]; then
    node -e "
      const { execSync } = require('child_process');
      try {
        const addrData = JSON.parse(execSync('onchainos wallet addresses', { encoding: 'utf8', stdio: 'pipe' }));
        const balData = JSON.parse(execSync('onchainos wallet balance', { encoding: 'utf8', stdio: 'pipe' }));
        const xlAddr = addrData?.data?.xlayer?.[0]?.address || addrData?.data?.evmAddress;
        // Find USDC on X Layer (chainIndex 196)
        const usdcAsset = balData?.data?.details?.[0]?.tokenAssets?.find(t => t.chainIndex === '196');
        const usdcBalance = usdcAsset?.balance || '0';
        const usdcSymbol = usdcAsset?.symbol || 'USDC';
        if (xlAddr) {
          console.log('');
          console.log('  💰 Wallet address: ' + xlAddr);
          if (usdcBalance !== '0') {
            console.log('  💰 X Layer USDC: ' + usdcBalance + ' ' + usdcSymbol);
          }
        }
      } catch(e) {}
    " 2>&1
  fi
else
  warn "未检测到 OpenClaw — 安装后运行 okclawrouter 再手动接入"
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
echo -e "    ${FREE} OpenRouter Free  /  Qwen3 Coder"
echo ""
echo -e "  ${BOLD}${STAR} 启动代理:${RESET}"
echo -e "    ${W} okclawrouter${RESET}"
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
echo -e "    /model okclawrouter/openrouter/free           ${DIM}(免费)${RESET}"
echo -e "    /model okclawrouter/paid/claude-sonnet-4-6   ${DIM}(付费)${RESET}"
echo ""
echo -e "  ${BOLD}${LINK} Cursor / VS Code:${RESET}"
echo -e "    API Base URL → ${BOLD}http://localhost:8402/v1${RESET}"
echo ""
echo -e "  ${BOLD}${LINK} 运维命令:${RESET}"
echo -e "    ${W}okclawrouter${RESET}        启动代理（后台运行）"
echo -e "    ${W}okclawrouter state${RESET}  查看运行状态"
echo -e "    ${W}okclawrouter stop${RESET}   停止代理"
echo ""
echo -e "  ${BOLD}${LINK} 测试代理:${RESET}"
echo -e "    ${DIM}curl http://localhost:8402/v1/models${RESET}"
echo ""
echo -e "  ${DIM}GitHub: ${REPO_URL}${RESET}"
echo ""
echo -e "  ${BOLD}${LOVE} Happy Clawing! ${LOVE}${RESET}"
echo ""
