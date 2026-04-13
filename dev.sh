#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_DIR="$ROOT_DIR/bot-server"
ROOT_ENV="$ROOT_DIR/.env"
ROOT_ENV_EXAMPLE="$ROOT_DIR/.env.example"

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[dev]${NC} $*"; }
warn() { echo -e "${YELLOW}[dev]${NC} $*"; }
ok()   { echo -e "${GREEN}[dev]${NC} $*"; }
err()  { echo -e "${RED}[dev]${NC} $*" >&2; }

# ── Prefixed process output ───────────────────────────────────────────────────
prefix_output() {
    local prefix="$1"
    local color="$2"
    while IFS= read -r line; do
        echo -e "${color}[${prefix}]${NC} $line"
    done
}

# ── Cleanup on exit ───────────────────────────────────────────────────────────
BOT_PID=""
WEB_PID=""

cleanup() {
    echo ""
    log "Shutting down..."
    [[ -n "$WEB_PID" ]] && kill "$WEB_PID" 2>/dev/null || true
    [[ -n "$BOT_PID" ]] && kill "$BOT_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    ok "Done."
}
trap cleanup INT TERM EXIT

# ── 0. Node compatibility ────────────────────────────────────────────────────
# The project wants Node >=22.18 for native TypeScript support. On older 22.x
# we enable the experimental flags so webpack can load .ts configs that use
# import attributes (e.g. `with { type: "json" }`).
NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".").map(Number).join(" "))')"
read -r MAJOR MINOR PATCH <<< "$NODE_MAJOR"
if (( MAJOR == 22 && MINOR < 18 )); then
    warn "Node $(node -v) detected (project wants >=22.18) — enabling experimental TypeScript flags"
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--experimental-strip-types --experimental-transform-types --disable-warning=ExperimentalWarning"
fi

# ── 0b. Kill stale processes on needed ports ─────────────────────────────────
kill_port() {
    local port="$1"
    local pids
    pids="$(lsof -ti :"$port" 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
        warn "Killing existing processes on port $port (PIDs: $(echo $pids | tr '\n' ' '))"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 0.5
    fi
}
kill_port 8080
kill_port 3001

# Kill stale nx processes that can block the dev server
stale_nx="$(pgrep -f 'nx (start|run)' 2>/dev/null || true)"
if [[ -n "$stale_nx" ]]; then
    warn "Killing stale nx processes (PIDs: $(echo $stale_nx | tr '\n' ' '))"
    echo "$stale_nx" | xargs kill -9 2>/dev/null || true
    sleep 0.5
fi

# ── 1. Install root dependencies ──────────────────────────────────────────────
# --ignore-scripts skips the postinstall (scripts/pnpm-link.ts) which requires
# Node >=22.18 for native TypeScript support. That script is only needed when
# using a .link-config for local SDK development.
log "Installing workspace dependencies..."
pnpm install --ignore-scripts

# ── 2. .env setup ────────────────────────────────────────────────────────────
if [[ ! -f "$ROOT_ENV" ]]; then
    warn "No .env found — copying from .env.example"
    cp "$ROOT_ENV_EXAMPLE" "$ROOT_ENV"
    warn "Edit .env and set MATRIX_BOT_TOKEN and MATRIX_BOT_USER_ID, then re-run this script."
    exit 0
fi

# Warn if token looks like a placeholder
if grep -qE 'MATRIX_BOT_TOKEN=$' "$ROOT_ENV"; then
    warn ".env has an empty MATRIX_BOT_TOKEN — the bot may not connect."
    warn "Edit .env and set MATRIX_BOT_TOKEN and MATRIX_BOT_USER_ID."
fi

# ── 3. Bot server: install dependencies ──────────────────────────────────────
log "Installing bot-server dependencies..."
(cd "$BOT_DIR" && npm install --silent)

# ── 3b. Detect local network IP and export service URLs ───────────────────────
LOCAL_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1)"
if [[ -n "$LOCAL_IP" ]]; then
    export BUNDLE_BASE_URL="http://${LOCAL_IP}:3001"
    export GENERATE_API_URL="http://${LOCAL_IP}:3001/generate"
    ok "Detected network IP: ${LOCAL_IP}"
    ok "Services will be accessible to others on your network"
else
    warn "Could not detect local network IP — services will only be accessible on this machine"
fi

# ── 4. Start services in parallel ────────────────────────────────────────────
ok "Starting services..."
echo ""

# Element Web (webpack dev server with HMR)
pnpm --filter element-web run start 2>&1 | prefix_output "element-web" '\033[0;34m' &
WEB_PID=$!

# Generation server — run directly with node (no tsx watch/restart).
# Load root .env, then re-apply the network-accessible URLs so .env doesn't override them.
(cd "$BOT_DIR" && set -a && source "$ROOT_ENV" && set +a && \
  [[ -n "${LOCAL_IP:-}" ]] && export BUNDLE_BASE_URL="http://${LOCAL_IP}:3001" GENERATE_API_URL="http://${LOCAL_IP}:3001/generate"; \
  node --import tsx/esm src/index.ts 2>&1) | prefix_output "gen-server" '\033[0;35m' &
BOT_PID=$!

ok "Element Web       → http://127.0.0.1:8080 (localhost)"
[[ -n "$LOCAL_IP" ]] && ok "Element Web       → http://${LOCAL_IP}:8080 (network)"
ok "Generation server → http://localhost:3001"
[[ -n "$LOCAL_IP" ]] && ok "Generation server → http://${LOCAL_IP}:3001 (network)"
ok "Press Ctrl+C to stop both services."
echo ""

# Wait for either process to exit unexpectedly
wait -n 2>/dev/null || wait
