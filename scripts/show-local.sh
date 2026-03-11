#!/usr/bin/env bash
# Start dev server (if not running) and open app in browser.
# Usage: ./scripts/show-local.sh
set -e
cd "$(dirname "$0")/.."
PORT=3000
URL="http://localhost:$PORT"

# Start dev server in background if not already responding
if ! curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null | grep -q 200; then
  echo "Starting dev server on port $PORT..."
  (export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 22 2>/dev/null; npx next dev -p "$PORT") &
  PID=$!
  for i in {1..30}; do
    sleep 1
    if curl -s -o /dev/null "$URL" 2>/dev/null; then break; fi
    if [ $i -eq 30 ]; then kill $PID 2>/dev/null; echo "Server did not start in time."; exit 1; fi
  done
fi

# Open in Simple Browser (Cursor) and system browser
cursor --command "simpleBrowser.show" "$URL" 2>/dev/null || true
open "$URL" 2>/dev/null || true
echo "App at $URL"
