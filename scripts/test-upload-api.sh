#!/usr/bin/env bash
# Quick test that POST /api/jobs returns JSON (not HTML or empty).
# Usage: ./scripts/test-upload-api.sh [base_url]
# Example: ./scripts/test-upload-api.sh http://localhost:3000
set -e
BASE="${1:-http://localhost:3000}"
TMP=$(mktemp).mp3
echo -n "x" > "$TMP"
trap "rm -f $TMP" EXIT

echo "POST $BASE/api/jobs (tiny file)..."
STATUS=$(curl -s -o /tmp/test-upload-response.json -w "%{http_code}" -X POST \
  -F "file=@$TMP" -F "languageHint=" -F "knownSpeakerNames=" "$BASE/api/jobs")
CT=$(curl -s -I -X POST -F "file=@$TMP" -F "languageHint=" -F "knownSpeakerNames=" "$BASE/api/jobs" | grep -i content-type || true)
BODY=$(cat /tmp/test-upload-response.json)

echo "HTTP $STATUS"
echo "Body: $BODY"
if echo "$BODY" | grep -q '^{'; then
  echo "OK: Response is JSON (client will parse it)."
  [ "$STATUS" -ge 400 ] && echo "Server error (e.g. REDIS_URL not set) - check .env or Railway vars."
  exit 0
else
  echo "FAIL: Response is not JSON - client would show 'Invalid response from server'."
  exit 1
fi
