#!/usr/bin/env bash
# Bygger et MCPB-bundt af MCP-serveren, til Smitherys "Local (MCPB Bundle)"-vej.
#
# Hvorfor det findes: Smithery lister lokale stdio-servere gennem et .mcpb-bundt, ikke gennem
# en hostet adresse. Jeg konkluderede foerst det modsatte ud fra ÉN formular og skrev "vi kan
# ikke listes" i vores egne noter. Gustav sagde imod, og han havde ret: deres dokumentation
# har fire veje, og MCPB-fanen siger ordret "For local stdio servers".
# Se ~/.claude/plans/browsermcp-2026-09-07/DOM-backlinks-2026-09-21.md
#
# ⛔ Bundtet er IKKE hele produktet. Chrome tillader ikke at en udvidelse installeres fra et
# bundt, saa modtageren skal stadig hente udvidelsen i butikken. Det staar i manifestets
# long_description, og det skal blive staaende.
#
#   bash scripts/byg-mcpb.sh            → bygger, validerer, roegtester
#   bash scripts/byg-mcpb.sh --udgiv    → ... og udgiver til Smithery
set -euo pipefail

ROD="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(python3 -c "import json;print(json.load(open('$ROD/mcp-server/package.json'))['version'])")"
BYG="${TMPDIR:-/tmp}/mcpb-bygge-$VERSION"
NOEGLEFIL="$HOME/Library/Application Support/smithery/settings.json"
NAVN="gustav%2Fbrowser-mcp"

echo "-- Bygger MCPB-bundt for $VERSION --"
rm -rf "$BYG"; mkdir -p "$BYG/server/bin"
cp "$ROD/mcp-server/index.js" "$ROD/mcp-server/tools.js" "$ROD/mcp-server/vagt.js" "$BYG/server/"
cp "$ROD/mcp-server/bin/cli.js" "$BYG/server/bin/"
cp -R "$ROD/mcp-server/extension" "$BYG/server/"
cp "$ROD/extension/icons/icon-128.png" "$BYG/icon.png"

python3 - "$ROD" "$BYG" "$VERSION" <<'PY'
import json, sys
rod, byg, version = sys.argv[1], sys.argv[2], sys.argv[3]
p = json.load(open(f'{rod}/mcp-server/package.json'))
json.dump({'name': p['name'], 'version': version, 'type': p.get('type', 'module'),
           'dependencies': p['dependencies']}, open(f'{byg}/server/package.json', 'w'), indent=2)
m = json.load(open(f'{rod}/mcpb-manifest.json')); m['version'] = version
json.dump(m, open(f'{byg}/manifest.json', 'w'), indent=2, ensure_ascii=False)
PY

( cd "$BYG/server" && npm install --omit=dev --no-audit --no-fund --silent )
npx -y @anthropic-ai/mcpb@2.1.2 validate "$BYG/manifest.json"
npx -y @anthropic-ai/mcpb@2.1.2 pack "$BYG" "$BYG/browser-mcp-$VERSION.mcpb"

echo "-- Roegtest: taler med serveren i bundtet --"
node "$ROD/scripts/mcpb-roegtest.mjs" "$BYG"

if [[ "${1:-}" == "--udgiv" ]]; then
  echo "-- Udgiver til Smithery --"
  [[ -f "$NOEGLEFIL" ]] || { echo "Ingen Smithery-noegle. Koer: npx @smithery/cli auth login"; exit 1; }
  KEY="$(python3 -c "import json;print(json.load(open('$NOEGLEFIL'))['apiKey'])")"
  curl -sf -X PUT "https://api.smithery.ai/servers/$NAVN/releases" \
    -H "Authorization: Bearer $KEY" \
    -F "payload=<$BYG/payload.json" -F "bundle=@$BYG/browser-mcp-$VERSION.mcpb" \
    -w "\nHTTP %{http_code}\n"
fi
echo "Faerdig: $BYG/browser-mcp-$VERSION.mcpb"
