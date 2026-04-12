#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/your-org/okxclawrouter"
INSTALL_DIR="${HOME}/.okxclawrouter"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  OKXClawRouter — Installer"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── Step 1: Check prerequisites ────────────────────────────────
check_command() {
  if ! command -v "$1" &>/dev/null; then
    return 1
  fi
  return 0
}

if ! check_command node; then
  echo "ERROR: Node.js is required but not installed."
  echo "Install it from https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required. Found: $(node -v)"
  exit 1
fi

# ── Step 2: Check onchainos ────────────────────────────────────
if check_command onchainos; then
  echo "  onchainos: found ($(onchainos --version 2>/dev/null || echo 'unknown version'))"
else
  echo "  onchainos: not found"
  echo ""
  echo "  onchainos is needed for paid models (wallet + payment)."
  echo "  Free models work without it."
  echo ""
  echo "  Install onchainos:"
  echo "    npm install -g onchainos"
  echo ""
  read -p "  Continue without onchainos? [Y/n] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Nn]$ ]]; then
    echo "Install onchainos first, then re-run this script."
    exit 0
  fi
fi

# ── Step 3: Install the proxy ──────────────────────────────────
echo ""
echo "  Installing OKXClawRouter proxy..."

if [ -d "$INSTALL_DIR" ]; then
  echo "  Updating existing installation..."
  cd "$INSTALL_DIR/proxy"
  git pull --rebase 2>/dev/null || true
else
  git clone "$REPO_URL" "$INSTALL_DIR" 2>/dev/null || {
    echo "  Git clone failed. Downloading as archive..."
    mkdir -p "$INSTALL_DIR"
    curl -fsSL "${REPO_URL}/archive/refs/heads/main.tar.gz" | tar xz -C "$INSTALL_DIR" --strip-components=1
  }
fi

cd "$INSTALL_DIR/proxy"
npm install --production --silent
npm run build --silent 2>/dev/null || true

# ── Step 4: Create launch script ──────────────────────────────
LAUNCH_SCRIPT="${HOME}/.local/bin/okxclawrouter"
mkdir -p "$(dirname "$LAUNCH_SCRIPT")"

cat > "$LAUNCH_SCRIPT" << 'LAUNCHER'
#!/usr/bin/env bash
INSTALL_DIR="${HOME}/.okxclawrouter/proxy"
export OKX_ROUTER_BACKEND="${OKX_ROUTER_BACKEND:-https://your-domain.com}"
export OKX_ROUTER_PORT="${OKX_ROUTER_PORT:-8402}"
node "$INSTALL_DIR/dist/index.js" "$@"
LAUNCHER

chmod +x "$LAUNCH_SCRIPT"

# ── Done ──────────────────────────────────────────────────────
ONCHAINOS_STATUS="not installed"
if check_command onchainos; then
  ONCHAINOS_STATUS="installed"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  OKXClawRouter installed successfully!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Free models ready — use without login:"
echo "    DeepSeek V3 / DeepSeek R1 / Qwen3"
echo ""
echo "  Start the router:"
echo "    okxclawrouter"
echo ""
echo "  Configure your AI tool to use:"
echo "    API Base URL: http://localhost:8402/v1"
echo ""
if [ "$ONCHAINOS_STATUS" = "installed" ]; then
  echo "  Want paid models (Claude Sonnet 4, GPT-5.4, Gemini 3.1 Pro)?"
  echo "    1. Login:   /wallet login <email>"
  echo "    2. Fund:    Send USDC to your wallet on X Layer"
  echo "       -> https://web3.okx.com/onchainos"
  echo "    3. Use:     Paid models auto-selected when wallet connected"
  echo ""
  echo "    ~\$1 USDC = ~100 requests to Claude Sonnet 4"
else
  echo "  Install onchainos for paid model access:"
  echo "    npm install -g onchainos"
fi
echo ""
echo "  Commands: /help, /stats, /models, /wallet status"
echo "═══════════════════════════════════════════════════════"
echo ""
