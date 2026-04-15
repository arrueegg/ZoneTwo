#!/usr/bin/env bash
# start.sh — first-time setup + launch for ZoneTwo
# Works on Linux and macOS. Run from the repo root: ./start.sh

set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── colour helpers ────────────────────────────────────────────────────────────
green()  { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red()    { printf '\033[0;31m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n'   "$*"; }

# ── prerequisite checks ───────────────────────────────────────────────────────
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    red "Error: '$1' is not installed or not on PATH."
    echo "  $2"
    exit 1
  fi
}

check_cmd python3  "Install Python 3.11+ from https://python.org or via your package manager."
check_cmd node     "Install Node.js 18+ from https://nodejs.org or via nvm."
check_cmd npm      "npm ships with Node.js — reinstall Node."

PYTHON_OK=$(python3 -c "import sys; print(1 if sys.version_info >= (3,11) else 0)")
if [[ "$PYTHON_OK" != "1" ]]; then
  red "Error: Python 3.11 or newer is required (found $(python3 --version))."
  exit 1
fi

# ── .env setup ────────────────────────────────────────────────────────────────
ENV_FILE="$REPO_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  yellow "No .env found — copying from .env.example."
  cp "$REPO_ROOT/.env.example" "$ENV_FILE"
  echo ""
  bold "  ACTION NEEDED: open .env and fill in your credentials, then re-run this script."
  echo "  Minimum required: SECRET_KEY (any random string), DATABASE_URL (default SQLite is fine)"
  echo ""
  exit 0
fi

# Warn if SECRET_KEY is still the placeholder
if grep -q "your-secret-key-here" "$ENV_FILE"; then
  yellow "Warning: SECRET_KEY in .env is still the placeholder. Set it to a random string."
fi

# ── backend setup ─────────────────────────────────────────────────────────────
VENV="$REPO_ROOT/backend/.venv"
bold "==> Backend"

if [[ ! -d "$VENV" ]]; then
  green "  Creating Python virtual environment..."
  python3 -m venv "$VENV"
fi

# Activate
source "$VENV/bin/activate"

green "  Installing/updating Python dependencies..."
pip install -q --upgrade pip
pip install -q -r "$REPO_ROOT/backend/requirements.txt"

# ── frontend setup ────────────────────────────────────────────────────────────
bold "==> Frontend"
if [[ ! -d "$REPO_ROOT/frontend/node_modules" ]]; then
  green "  Installing Node dependencies..."
  npm install --prefix "$REPO_ROOT/frontend" --silent
else
  green "  Node dependencies already installed."
fi

# ── launch ────────────────────────────────────────────────────────────────────
bold "==> Starting ZoneTwo"
echo ""
green "  Backend  → http://localhost:8000"
green "  Frontend → http://localhost:3000"
echo ""

# Trap Ctrl-C so both children are killed cleanly
cleanup() {
  echo ""
  yellow "Shutting down..."
  kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Start backend
cd "$REPO_ROOT/backend"
uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!

# Give the backend a moment before opening the browser / starting the frontend
sleep 1

# Start frontend
cd "$REPO_ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

# Wait for both — script exits when either dies
wait "$BACKEND_PID" "$FRONTEND_PID"
