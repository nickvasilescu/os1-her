#!/bin/bash
# Launch UAOS1: self-hosted LiveKit (dev) + orchestrator (:8787) + voice worker + desktop app.
# macOS: double-click in Finder.  Linux (Omarchy/Hyprland): run it, or pick "UAOS1" in the app launcher.
# Ctrl+C stops everything this script started.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
STARTED=()

envval() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^["'\'']//; s/["'\'']$//' | xargs; }
OS="$(uname -s)"
listening() {
  if command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; fi
}
portpids() {
  if command -v lsof >/dev/null 2>&1; then lsof -ti tcp:"$1" -sTCP:LISTEN 2>/dev/null
  else ss -ltnpH "sport = :$1" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u; fi
}
hashit() { if command -v shasum >/dev/null 2>&1; then shasum; else sha1sum; fi; }
install_livekit() {
  if [ "$OS" = "Darwin" ]; then
    echo "Installing LiveKit server with Homebrew (first run only)…"
    brew install livekit
  else
    echo "Installing LiveKit server into ~/.local/bin (first run only, no sudo)…"
    local ver arch tmp
    ver=$(curl -fsSL https://api.github.com/repos/livekit/livekit/releases/latest | grep -oE '"tag_name": *"v[^"]+' | grep -oE '[0-9][^"]*')
    case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) arch=amd64 ;; esac
    tmp=$(mktemp -d) && mkdir -p "$HOME/.local/bin" \
      && curl -fsSL "https://github.com/livekit/livekit/releases/download/v${ver}/livekit_${ver}_linux_${arch}.tar.gz" | tar -xz -C "$tmp" \
      && install -m 755 "$tmp/livekit-server" "$HOME/.local/bin/livekit-server"
    rm -rf "$tmp"
  fi
}
cleanup() {
  echo; echo "Stopping what this launcher started…"
  for pid in "${STARTED[@]}"; do kill "$pid" 2>/dev/null; done
}
trap cleanup EXIT INT TERM

export OS1_CLIENT_TOKEN="${OS1_CLIENT_TOKEN:-$(envval OS1_CLIENT_TOKEN)}"
export OS1_ORCHESTRATOR_URL="${OS1_ORCHESTRATOR_URL:-http://127.0.0.1:8787}"
LIVEKIT_URL="$(envval LIVEKIT_URL)"
# Shared mode: UAOS1_SERVER_URL in .env points every device at one orchestrator on the home
# server (which also runs LiveKit + the voice worker). Nothing else is started on this machine.
SERVER_URL="$(envval UAOS1_SERVER_URL)"

start_app() {
  [ -d node_modules ] || npm install
  node -e "require('electron')" >/dev/null 2>&1 || node node_modules/electron/install.js
  # Hyprland / Wayland: run Electron natively rather than through XWayland.
  [ "$OS" = "Linux" ] && export ELECTRON_OZONE_PLATFORM_HINT="${ELECTRON_OZONE_PLATFORM_HINT:-auto}"
  echo "Starting the UAOS1 desktop app…"
  npm run dev
}

if [ -n "$SERVER_URL" ]; then
  export OS1_ORCHESTRATOR_URL="${SERVER_URL%/}"
  export OS1_CLIENT_TOKEN="$(envval UAOS1_SERVER_TOKEN)"
  echo "== UAOS1 (shared server: $OS1_ORCHESTRATOR_URL) =="
  [ -n "$OS1_CLIENT_TOKEN" ] || { echo "UAOS1_SERVER_TOKEN is empty in .env."; exit 1; }
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 -H "Authorization: Bearer $OS1_CLIENT_TOKEN" "$OS1_ORCHESTRATOR_URL/os1/state")
  case "$code" in
    200) echo "Server reachable." ;;
    401|403) echo "The server refused the token (UAOS1_SERVER_TOKEN)."; exit 1 ;;
    *) echo "Can't reach the UAOS1 server ($code). Is Tailscale connected?"; exit 1 ;;
  esac
  # Stop a local orchestrator/voice worker from the old per-machine setup so nothing answers twice.
  kill $(portpids 8787) 2>/dev/null
  pkill -f "os1_voice.worker" 2>/dev/null
  start_app
  exit $?
fi

echo "== UAOS1 =="
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv (Python package manager) into ~/.local/bin (first run only, no sudo)…"
  curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null || { echo "Could not install uv."; exit 1; }
fi
if [ -z "$OS1_CLIENT_TOKEN" ]; then
  echo "OS1_CLIENT_TOKEN is empty in .env — set it (any long random string) and run again."; exit 1
fi

# --- 1. LiveKit (self-hosted, dev mode, this Mac only) ---------------------------------
if [[ "$LIVEKIT_URL" == ws://127.0.0.1:7880* || "$LIVEKIT_URL" == ws://localhost:7880* ]]; then
  if listening 7880; then
    echo "LiveKit already running on :7880."
  else
    if ! command -v livekit-server >/dev/null 2>&1; then
      install_livekit || { echo "Could not install livekit-server (macOS: brew install livekit)."; exit 1; }
    fi
    echo "Starting LiveKit (log: uaos1-livekit.log)…"
    nohup livekit-server --dev >"$ROOT/uaos1-livekit.log" 2>&1 &
    STARTED+=($!)
    for _ in $(seq 1 20); do listening 7880 && break; sleep 0.5; done
    listening 7880 && echo "LiveKit up." || { echo "LiveKit did not start:"; tail -20 "$ROOT/uaos1-livekit.log"; }
  fi
elif [ -z "$LIVEKIT_URL" ]; then
  echo "LIVEKIT_URL is empty — UAOS1 will open with voice off."
else
  echo "Using LiveKit at $LIVEKIT_URL."
fi

# --- 2. Orchestrator -------------------------------------------------------------------
code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 -H "Authorization: Bearer $OS1_CLIENT_TOKEN" http://127.0.0.1:8787/os1/uao/config)
health=$(curl -s -m 3 http://127.0.0.1:8787/health)
lk=$(echo "$health" | grep -o '"livekit":[a-z]*' | cut -d: -f2)
cx=$(echo "$health" | grep -o '"composio":[a-z]*' | cut -d: -f2)
# Restart when any setting the orchestrator reads has changed since this launcher last started it.
envhash=$(grep -E "^(OS1_|LIVEKIT_|COMPOSIO_|UAO_|ATLAS_|SUNSHINE_|HERMES_|ORGO_)" .env 2>/dev/null | hashit | cut -c1-16)
oldhash=$(cat .git/uaos1-env.hash 2>/dev/null)
if [ "$code" = "404" ] || [ "$code" = "401" ] || [ "$code" = "503" ] \
  || { [ -n "$LIVEKIT_URL" ] && [ "$lk" = "false" ]; } \
  || { [ -n "$(envval COMPOSIO_API_KEY)" ] && [ "$cx" = "false" ]; } \
  || { [ "$code" != "000" ] && [ "$envhash" != "$oldhash" ]; }; then
  echo "The orchestrator on :8787 is outdated or has old settings — restarting it."
  kill $(portpids 8787) 2>/dev/null; sleep 1
  code=000
fi
if [ "$code" = "000" ]; then
  echo "Starting orchestrator (log: uaos1-orchestrator.log)…"
  (cd services/orchestrator && exec uv run uvicorn os1_orchestrator.app:app --host 127.0.0.1 --port 8787) \
    >"$ROOT/uaos1-orchestrator.log" 2>&1 &
  STARTED+=($!)
  for _ in $(seq 1 60); do curl -sf -m 2 http://127.0.0.1:8787/health >/dev/null && break; sleep 1; done
  echo "$envhash" > .git/uaos1-env.hash
fi
curl -sf -m 2 http://127.0.0.1:8787/health >/dev/null && echo "Orchestrator up." \
  || { echo "Orchestrator did not start — see uaos1-orchestrator.log"; tail -20 "$ROOT/uaos1-orchestrator.log"; }

# --- 3. Voice worker (free providers: your UAO server's Jarvis listen / speak / brain) -
if [ -n "$LIVEKIT_URL" ]; then
  pkill -f "os1_voice.worker" 2>/dev/null && sleep 1
  echo "Starting voice worker (log: uaos1-voice.log; first run downloads its Python packages)…"
  # onnxruntime (voice activity) has no wheels for the newest Python yet, so pin 3.13.
  (cd services/voice && exec uv run --python 3.13 python -m os1_voice.worker start) >"$ROOT/uaos1-voice.log" 2>&1 &
  STARTED+=($!)
  for _ in $(seq 1 90); do grep -qiE "registered worker|worker registered" "$ROOT/uaos1-voice.log" && break; sleep 1; done
  grep -qiE "registered worker|worker registered" "$ROOT/uaos1-voice.log" && echo "Voice worker registered." \
    || { echo "Voice worker not registered yet — see uaos1-voice.log"; tail -15 "$ROOT/uaos1-voice.log"; }
fi

# --- 4. Desktop app --------------------------------------------------------------------
start_app
