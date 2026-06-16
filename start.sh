#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_ENV="$BACKEND_DIR/.env"

load_backend_env() {
  if [[ -f "$BACKEND_ENV" ]]; then
    while IFS= read -r line; do
      [[ -z "$line" ]] && continue
      [[ "$line" =~ ^[[:space:]]*# ]] && continue
      if [[ "$line" == *=* ]]; then
        export "$line"
      fi
    done < "$BACKEND_ENV"
  fi
}

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

load_backend_env

# Keep the backend port aligned with the current Vite proxy when the env file
# does not specify a port explicitly.
export BACKEND_PORT="${BACKEND_PORT:-8002}"
export BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"

PYTHON_BIN="$BACKEND_DIR/.venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3)"
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "frontend/node_modules is missing. Run 'cd frontend && npm install' first."
  exit 1
fi

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "python3 not found."
  exit 1
fi

echo "Starting backend on ${BACKEND_HOST}:${BACKEND_PORT}..."
(cd "$BACKEND_DIR" && "$PYTHON_BIN" app/main.py) &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:5173..."
cd "$FRONTEND_DIR"
npm run dev
