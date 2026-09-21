#!/usr/bin/env bash
# Beviskort for browser-mcp, skrevet 20/9-2026 ved chat-signoff.
#
# Formaal: den naeste chat arver mine paastande. Den skal kunne KOERE dem i stedet for at tro
# paa en tabel skrevet af nogen der gerne ville have at den var groen.
#
# Koer:  bash scripts/beviskort.sh
# Alt der ikke kan maales her, printes som UMAALT - aldrig som groent.
set -uo pipefail
cd "$(dirname "$0")/.."
gr() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
ro() { printf '  \033[31m✗\033[0m %s\n' "$*"; FEJL=1; }
um() { printf '  \033[33m?\033[0m UMAALT: %s\n' "$*"; }
FEJL=0

echo "── Kode ──"
[ "$(git branch --show-current)" = main ] && gr "paa main" || ro "ikke paa main"
[ -z "$(git status --porcelain)" ] && gr "traeet er rent" || ro "ucommitteret arbejde"
[ "$(git rev-list --left-right --count HEAD...origin/main)" = "$(printf '0\t0')" ] \
  && gr "i sync med origin" || ro "ude af sync med origin"

echo "── Udgivet (spurgt, ikke husket) ──"
NPM=$(curl -s https://registry.npmjs.org/@agent360/browser-mcp/latest | python3 -c 'import sys,json;print(json.load(sys.stdin)["version"])' 2>/dev/null)
MAN=$(python3 -c 'import json;print(json.load(open("extension/manifest.json"))["version"])')
[ "$NPM" = "$MAN" ] && gr "npm $NPM == manifest $MAN" || ro "npm $NPM != manifest $MAN"
REG=$(curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.Agent360dk/browser-mcp" | python3 -c '
import sys,json;d=json.load(sys.stdin)
r=[s for s in d.get("servers",[]) if s.get("_meta",{}).get("io.modelcontextprotocol.registry/official",{}).get("isLatest")]
print(r[0]["server"]["version"] if r else "-")' 2>/dev/null)
[ "$REG" = "$NPM" ] && gr "MCP-registret $REG" || ro "registret $REG != npm $NPM"
CWS=$(curl -s -L --max-time 20 "https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl" | grep -oE '"nBZElf">[0-9.]+' | head -1 | sed 's/.*>//')
[ "$CWS" = "$NPM" ] && gr "butikken $CWS" || printf '  \033[33m?\033[0m butikken er %s mod npm %s - review tager 1-3 dage\n' "$CWS" "$NPM"

echo "── Husets vagter ──"
npm --prefix mcp-server test >/tmp/bevis-test.log 2>&1
P=$(grep -cE '^# pass' /tmp/bevis-test.log); F=$(grep -E '^# fail' /tmp/bevis-test.log | tail -1 | grep -oE '[0-9]+')
[ "${F:-1}" = 0 ] && gr "proever groenne ($(grep -E '^# pass' /tmp/bevis-test.log | tail -1 | grep -oE '[0-9]+'))" || ro "$F proever roede - se /tmp/bevis-test.log"
python3 scripts/check-docs.py >/tmp/bevis-docs.log 2>&1 && gr "docs-gate groen" || ro "docs-gate roed"

echo "── Mutationsbevis: sover vagten? ──"
# Plant en dansk streng i et svar. Vagten SKAL blive roed. Goer den ikke, er kortet vaerdiloest.
cp mcp-server/index.js /tmp/bevis.bak
perl -0pi -e 's/other chats are using the browser right now/andre chats bruger browseren i oejeblikket/' mcp-server/index.js
if node --test test/intet-dansk-i-svar.test.mjs >/dev/null 2>&1; then
  ro "MUTATIONEN BLEV IKKE FANGET - vagten sover, og resten af kortet er ikke til at stole paa"
else
  gr "mutationen blev fanget - vagten maaler noget"
fi
cp /tmp/bevis.bak mcp-server/index.js

echo "── Det kortet IKKE kan svare paa ──"
um "om nogen af npm-tallene er mennesker (ingen geografi, ingen user-agent)"
um "om foerste koersel virker for en ny bruger - 1.000 installationer, 0 anmeldelser (butikstallet er rundet)"
um "om de 40 sider rammer - sitet har ingen analytics"
# ⛔ 21/9: den her linje sagde "kraever Gustavs skaerm". Det er ikke sandt laengere, og en
# UMAALT-linje der er foraeldet er praecis den fejlklasse kortet findes for at fange.
um "de 12 vaerktoejer der kraever et vindue med fokus - baggrunds-koerslen springer dem over.
     baggrund:  FLOW_KUN_BAGGRUND=1 npm --prefix mcp-server run flow   (40/40 beroert, 0 fejl 21/9)
     fuld:      npm --prefix mcp-server run flow                        (tager skaermen)
     ⛔ anden skaerm VIRKER IKKE (maalt 21/9): FLOW_VINDUE_X faar vaerktoejet til at svare
        eget_vindue:true, fokuseret:true og placeret:{left:-3840} - og vinduet er der ikke.
        Set efter paa alle tre skaerme mens det koerte: ingen af dem havde det. Det fejler
        sikkert (menneskets vindue roeres ikke), men fokus-tilstanden kan ikke bruges blindt.
        De 12 vaerktoejer er derfor UMAALTE indtil nogen koerer den fulde spaerre paa en
        skaerm der er fri."

exit $FEJL
