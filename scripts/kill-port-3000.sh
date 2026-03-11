#!/usr/bin/env bash
# Free port 3000 so next dev can bind to it.
set -e
PIDS=$(lsof -ti :3000 2>/dev/null || true)
if [ -n "$PIDS" ]; then
  echo "$PIDS" | xargs kill -9 2>/dev/null || true
  sleep 1
fi
