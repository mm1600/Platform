#!/usr/bin/env sh
# Scope launcher for Linux and macOS terminals: ./start.sh [port]
# Serves the folder with Node.js when available; otherwise opens index.html directly (offline, embedded demo data).
cd "$(dirname "$0")" || exit 1
PORT="${1:-8130}"
URL="http://localhost:${PORT}/"
opener() { if command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"; elif command -v open >/dev/null 2>&1; then open "$1"; else echo "Open $1 in a browser"; fi; }
if command -v node >/dev/null 2>&1; then
  echo "Starting Scope on ${URL}  (Ctrl+C to stop)"
  (sleep 1; opener "${URL}") &
  exec node tools/serve.js "${PORT}"
else
  echo "Node.js not found: opening index.html directly (embedded demo data)."
  opener "index.html"
fi
