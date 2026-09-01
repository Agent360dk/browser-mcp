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

# ── Flow-spaerre (30/8) ─────────────────────────────────────────────────────
#
# Flow-testen stod kun i CONTRIBUTING.md. Man kunne udgive uden nogensinde at have
# roert en browser — og det var praecis saadan en klik-fejl naaede GitHub.
#
# Den kan ikke koere i CI (kraever Chrome + udvidelsen indlaest), saa den hoerer til
# her, hvor udgivelsen faktisk sker.
#
# KENDTE FEJL staar navngivet nedenfor. En spaerre der er roed ved foedslen bliver
# slaaet fra foerste gang den er i vejen; en der kun reagerer paa NYE fejl bliver
# staaende. Luk en kendt fejl -> slet den fra listen, saa den ikke kan komme igen.
# TOM 31/8 — og saadan skal den helst blive.
#
# Her stod browser_handle_dialog som accepteret undtagelse. Den er vaek, fordi
# flow-testen nu maaler det den faktisk kan bevise (at klikket ikke haenger) i stedet
# for noget den ikke kan (at dialogen besvares i denne opsaetning). Selve
# dialog-logikken er daekket af fem tests i udvidelse-klik.test.mjs.
#
# Hver linje her er en roed lampe nogen har vaennet sig til. Tilfoej kun en med en
# dato og en grund — og slet den saa snart den kan lukkes.
KENDTE_FEJL=()

# ── Automatiske tests (30/8) ────────────────────────────────────────────────
#
# Spaerren nedenfor koerer flow-testen mod en aegte Chrome. Den koerte IKKE `npm test`
# — og det var et hul: `release-coherence` (som bl.a. tjekker at mcp-server/extension/
# er en tro kopi af extension/) ligger netop der. MAALT 31/8: traeet stod roedt paa
# praecis den test, mens spaerren ville have sagt groent lys — og npm-pakken ville
# have faaet en foraeldet udvidelse med.
#
# En port med en aaben doer ved siden af er ingen port.
echo "→ Automatiske tests"
if ! npm --prefix mcp-server test > /tmp/bmcp-unit.log 2>&1; then
  echo "  ⛔ automatiske tests fejler — udgivelsen er stoppet:"
  grep -E "^not ok|^# (pass|fail)" /tmp/bmcp-unit.log | head -12 | sed 's/^/     /'
  exit 1
fi
grep -E "^# (pass|fail)" /tmp/bmcp-unit.log | sed 's/^/  /'
echo "  ✅ alle groenne"

if [[ "${SPRING_FLOW_OVER:-}" == "1" ]]; then
  echo "⚠  Flow-spaerren sprunget over (SPRING_FLOW_OVER=1) — du udgiver i blinde"
else
  echo "→ Flow-test mod en aegte Chrome (spaerre foer udgivelse)"
  FLOW_UD="$(mktemp)"
  # Flow-testen returnerer en fejlkode naar der ER fejl. Det er IKKE det samme som at
  # den ikke kunne koere — den skelnen kostede en blokeret udgivelse 30/8. DAEKNING-
  # linjen er beviset paa at den naaede hele vejen igennem.
  npm --prefix mcp-server run flow > "$FLOW_UD" 2>&1 || true
  if ! grep -q "^DAEKNING:" "$FLOW_UD"; then
    echo "  Flow-testen kunne slet ikke koere:"; tail -20 "$FLOW_UD"
    echo "  Er Chrome aaben med udvidelsen indlaest?"; exit 1
  fi
  tail -6 "$FLOW_UD" | sed 's/^/  /'
  UVENTEDE=0
  while IFS= read -r linje; do
    navn="$(echo "$linje" | sed 's/^  //; s/:.*//')"
    [[ -z "$navn" ]] && continue
    kendt=0
    for k in "${KENDTE_FEJL[@]}"; do [[ "$navn" == "$k" ]] && kendt=1; done
    if [[ $kendt -eq 1 ]]; then
      echo "  ◦ kendt fejl, accepteret: $navn"
    else
      echo "  ✗ NY fejl: $navn"; UVENTEDE=$((UVENTEDE+1))
    fi
  done < <(sed -n '/^FEJL:/,/^====/p' "$FLOW_UD" | sed '1d; /^====/d')
  if [[ $UVENTEDE -gt 0 ]]; then
    echo ""
    echo "⛔ $UVENTEDE ny(e) fejl i flow-testen — udgivelsen er stoppet."
    echo "   Ret dem, eller tilfoej dem bevidst til KENDTE_FEJL i dette script."
    echo "   Hastesag: SPRING_FLOW_OVER=1 $0 $*"
    exit 1
  fi
  echo "  ✅ ingen nye fejl — spaerren giver groent lys"
fi

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
