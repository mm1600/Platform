#!/bin/bash
# Scope launcher for macOS: double-click in Finder.
# With Node.js installed it serves the folder on http://localhost:8130 (all CSV demo files load from disk);
# without Node.js it opens index.html directly, which runs fully offline on the embedded demo data.
cd "$(dirname "$0")" || exit 1
if command -v node >/dev/null 2>&1; then
  echo "Starting Scope on http://localhost:8130  (close this window or press Ctrl+C to stop)"
  (sleep 1; open "http://localhost:8130/") &
  exec node tools/serve.js 8130
else
  echo "Node.js not found: opening index.html directly (embedded demo data)."
  open "index.html"
fi
