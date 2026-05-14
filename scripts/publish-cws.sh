#!/usr/bin/env bash
# Chrome Web Store auto-publish for Agent360 Browser MCP.
#
# Reads OAuth credentials from .env (gitignored). Builds zip from extension/,
# uploads via CWS Publish API, then publishes (or leaves in draft if --draft).
#
# Usage:
#   ./scripts/publish-cws.sh              # upload + publish to 'default' (public)
#   ./scripts/publish-cws.sh --draft      # upload only, leave as draft for manual review
#   ./scripts/publish-cws.sh --trusted    # publish to trusted-testers track instead
#
# One-time setup: see docs/CWS_PUBLISH_SETUP.md

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Parse args
MODE="default"
DRAFT_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --draft)    DRAFT_ONLY=1 ;;
    --trusted)  MODE="trustedTesters" ;;
    --default)  MODE="default" ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# Load .env if present
if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

# Required env vars
: "${CWS_CLIENT_ID:?missing in .env — see docs/CWS_PUBLISH_SETUP.md}"
: "${CWS_CLIENT_SECRET:?missing in .env}"
: "${CWS_REFRESH_TOKEN:?missing in .env}"
: "${CWS_EXTENSION_ID:?missing in .env — find at chrome.google.com/webstore/devconsole}"

# Read version from extension manifest
VERSION="$(node -p "require('./extension/manifest.json').version")"
ZIP="/tmp/agent360-browser-mcp-${VERSION}.zip"

echo "→ Building zip: $ZIP (version $VERSION)"
rm -f "$ZIP"
(cd extension && zip -qr "$ZIP" . -x "*.DS_Store")
echo "  Zip ready: $(du -h "$ZIP" | cut -f1)"

# Step 1: exchange refresh_token → access_token
echo "→ Refreshing OAuth access token"
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${CWS_CLIENT_ID}" \
  -d "client_secret=${CWS_CLIENT_SECRET}" \
  -d "refresh_token=${CWS_REFRESH_TOKEN}" \
  -d "grant_type=refresh_token" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.access_token){console.error('OAuth failed:',JSON.stringify(d));process.exit(1)}; console.log(d.access_token)")

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "✗ Failed to get access token"
  exit 1
fi
echo "  Access token acquired"

# Step 2: upload zip to CWS
echo "→ Uploading zip to Chrome Web Store"
UPLOAD_RESP=$(curl -s -X PUT \
  "https://www.googleapis.com/upload/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "x-goog-api-version: 2" \
  -T "$ZIP")

UPLOAD_STATE=$(echo "$UPLOAD_RESP" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.uploadState||'UNKNOWN'); if(d.itemError){console.error('Errors:',JSON.stringify(d.itemError,null,2))}")

if [[ "$UPLOAD_STATE" != "SUCCESS" ]]; then
  echo "✗ Upload failed: $UPLOAD_STATE"
  echo "$UPLOAD_RESP" | node -e "console.error(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')),null,2))"
  exit 1
fi
echo "  Upload SUCCESS"

# Step 3: publish (unless --draft)
if [[ "$DRAFT_ONLY" == "1" ]]; then
  echo "→ --draft flag set; leaving in draft (manual publish via dashboard required)"
  echo "✓ Done — view at https://chrome.google.com/webstore/devconsole/"
  exit 0
fi

echo "→ Publishing (target: $MODE)"
PUBLISH_RESP=$(curl -s -X POST \
  "https://www.googleapis.com/chromewebstore/v1.1/items/${CWS_EXTENSION_ID}/publish?publishTarget=${MODE}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "x-goog-api-version: 2" \
  -H "Content-Length: 0")

PUBLISH_STATUS=$(echo "$PUBLISH_RESP" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log((d.status||['UNKNOWN'])[0]); if(d.statusDetail){console.error('Detail:',JSON.stringify(d.statusDetail))}")

case "$PUBLISH_STATUS" in
  OK)
    echo "  Publish OK — review queue entered"
    ;;
  ITEM_PENDING_REVIEW)
    echo "  Already pending review — uploaded version replaced previous draft"
    ;;
  *)
    echo "✗ Publish status: $PUBLISH_STATUS"
    echo "$PUBLISH_RESP" | node -e "console.error(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')),null,2))"
    exit 1
    ;;
esac

echo ""
echo "✓ Done. v${VERSION} submitted to Chrome Web Store."
echo "  Review typically takes 1-3 days. You'll get email on approval/rejection."
echo "  Status: https://chrome.google.com/webstore/devconsole/"
