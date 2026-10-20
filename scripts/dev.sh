#!/usr/bin/env bash
# One key: build the board (when it exists), start the MCP server in demo mode,
# start the simulator. Ctrl-C stops both.
#
#   bash scripts/dev.sh          → http://localhost:8080
#
# Reads .env from the repository root (copy .env.example and fill it in).
# The LLM_* keys are optional: without them the simulator opens in direct mode
# and agent mode stays disabled with an explicit hint.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f "${ENV_FILE:-.env}" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${ENV_FILE:-.env}"
  set +a

  # A .env copied from .env.example keeps every key, most of them empty.
  # Empty means "use the default", so drop those instead of exporting "".
  for name in $(sed -nE 's/^([A-Za-z_][A-Za-z0-9_]*)=.*/\1/p' "${ENV_FILE:-.env}"); do
    if [ -z "${!name}" ]; then unset "$name"; fi
  done
else
  echo "No ${ENV_FILE:-.env} — using defaults (copy .env.example to .env to configure)."
fi

export DEMO_MODE="${DEMO_MODE:-1}"
export HOST="${HOST:-127.0.0.1}"
export PORT="${PORT:-3001}"
export MCP_URL="${MCP_URL:-http://localhost:${PORT}/mcp}"
export SIM_PORT="${SIM_PORT:-8080}"
export SANDBOX_PORT="${SANDBOX_PORT:-8081}"

for pkg in server sim; do
  if [ ! -d "$pkg/node_modules" ]; then
    echo "Missing $pkg/node_modules — run: npm --prefix $pkg install" >&2
    exit 1
  fi
done

# The board is T5's package; skip the build until it exists.
if [ -d board ]; then
  if [ ! -d board/node_modules ]; then
    echo "Missing board/node_modules — run: npm --prefix board install" >&2
    exit 1
  fi
  echo "Building the board…"
  npm --prefix board run build
fi

# sim/server.ts serves the built page from sim/dist and answers 503 until it
# exists, so a fresh clone needs this build before the first start.
echo "Building the simulator…"
npm --prefix sim run build

server_pid=""
sim_pid=""

cleanup() {
  # Keep the status we were exiting with: an EXIT trap that just returned would
  # turn a startup failure into a success.
  local code=$?
  trap - INT TERM EXIT
  # Only the processes this script started, by PID — never by name.
  [ -n "$sim_pid" ] && kill "$sim_pid" 2>/dev/null || true
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null || true
  wait 2>/dev/null || true
  echo
  echo "Stopped."
  # Without this, a TERM during startup falls back into the readiness loop and
  # prints a misleading "… exited during startup" afterwards.
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# `exec` keeps the PID we record equal to the process that serves traffic.
( cd server && exec node_modules/.bin/tsx src/index.ts ) &
server_pid=$!
echo "MCP server starting on http://${HOST}:${PORT} (DEMO_MODE=${DEMO_MODE})…"

ready=0
for _ in $(seq 1 80); do
  if curl -fsS "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "MCP server exited during startup" >&2
    exit 1
  fi
  sleep 0.25
done
if [ "$ready" != 1 ]; then
  echo "MCP server did not answer /health within 20 s" >&2
  exit 1
fi

( cd sim && exec node_modules/.bin/tsx server.ts ) &
sim_pid=$!

# Probe the page itself: /api/config answers 200 even when the page is a 503.
ready=0
for _ in $(seq 1 80); do
  if curl -fsS "http://${HOST}:${SIM_PORT}/" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$sim_pid" 2>/dev/null; then
    echo "Simulator server exited during startup" >&2
    exit 1
  fi
  sleep 0.25
done
if [ "$ready" != 1 ]; then
  echo "Simulator page did not load (GET / is not 200) within 20 s" >&2
  exit 1
fi

echo
echo "Dinner Tower is up:"
echo "  Simulator  http://localhost:${SIM_PORT}"
echo "  MCP        ${MCP_URL}"
echo "  Agent mode $([ -n "${LLM_API_KEY:-}" ] && echo "enabled (${LLM_MODEL:-?})" || echo "disabled — set LLM_BASE_URL / LLM_API_KEY / LLM_MODEL in .env")"
echo "Ctrl-C stops both."

wait
