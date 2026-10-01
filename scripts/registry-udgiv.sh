#!/bin/bash
# registry-udgiv.sh <version> [--ship] - udgiv MCP-registret som EGET trin, efter det kolde tjek (Astra runde 4 og 5, 1/10-2026).
#
#   bash scripts/registry-udgiv.sh 1.30.1          # proevekoersel: tjekker og melder hvad der ville ske, skriver intet
#   bash scripts/registry-udgiv.sh 1.30.1 --ship   # logger ind med GitHubs id-token, publicerer og laeser tilbage
#
# Foer 1/10 laa registret (5b) i udgivelsesscriptet EFTER det kolde tjek (5c); scriptet standsede foer registret hvis den udgivne pakke
# ikke svarede. Det kolde tjek koerer nu i et job uden rettigheder (`efter`), saa registret ligger her, i et job der venter paa det.
# Samme logik som trin 5b i runbrowsermcpupdate.sh (id-token-vejen); det trin springes over i workflowet med --registry-eget-job.
set -uo pipefail
ok()  { echo "✓ $*"; }
say() { echo "→ $*"; }
die() { echo "✗ $*" >&2; exit 1; }

# Astra runde 5: ukendte argumenter blev stiltiende accepteret (`1.30.1 --typo --ship` gav en vellykket proevekoersel).
V="${1:?brug: registry-udgiv.sh <version> [--ship]}"
SHIP=0
if [[ $# -eq 2 && "$2" == "--ship" ]]; then SHIP=1
elif [[ $# -ne 1 ]]; then die "ukendte argumenter: ${*:2} (brug: registry-udgiv.sh <version> [--ship])"; fi
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORSOEG="${REGISTRY_FORSOEG:-20}"; PAUSE="${REGISTRY_PAUSE:-3}"
NAVN="io.github.Agent360dk/browser-mcp"

# 1 · server.json skal baere netop den version der udgives (baade foerst og i hver pakke), ellers publicerer vi noget andet end vi har proevet.
# Astra runde 5: `{}`, manglende topversion, en pakke uden version og manglende `packages` gav alle groen proeve, fordi de manglende
# vaerdier forsvandt i join()/ordopdelingen. Nu KRAEVES felterne foer lighed testes.
SJ="${REGISTRY_SERVER_JSON:-$REPO_ROOT/mcp-server/server.json}"
[[ -f "$SJ" ]] || die "server.json findes ikke: $SJ"
SJ_VERSIONER="$(node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const pakker = Array.isArray(d.packages) ? d.packages : [];
const alle = [d.version, ...pakker.map((p) => p && p.version)];
if (pakker.length === 0 || !alle.every((x) => typeof x === "string" && x !== "")) { console.error("version mangler i server.json (topniveau eller en pakke), eller packages er tom"); process.exit(2); }
console.log(alle.join(" "));' "$SJ")" || die "server.json kunne ikke laeses eller mangler versionsfelter ($SJ)"
for v in $SJ_VERSIONER; do
  [[ "$v" == "$V" ]] || die "server.json siger ${SJ_VERSIONER// /, } men der udgives $V - registret ville faa en anden version end npm"
done
ok "server.json baerer $V"

# 2 · hvad viser registret nu? Astra runde 5: (a) opslaget er en SUBSTRING-soegning, saa en anden server (`...browser-mcp-other`) kunne taelle som vores;
# nu kraeves det praecise servernavn. (b) et opslag der fejler er IKKE «ukendt version»: det giver en fejl (kun «serveren findes ikke endnu» er tom).
# (c) curl havde ingen tidsfrister.
# (d) MAALT 1/10: det aegte register har en koldstart paa op til 27 s paa det foerste opslag (derefter ~1 s). 20 s uden gentagelse ville have faaet
# foerste opslag i en rigtig koersel til at fejle. Nu 45 s og op til tre forsoeg.
registrets_version() {
  local ud="" forsoeg
  for forsoeg in 1 2 3; do
    ud="$(curl -fsS --connect-timeout 10 --max-time 45 "https://registry.modelcontextprotocol.io/v0/servers?search=${NAVN}&limit=100" 2>/dev/null)" && [[ -n "$ud" ]] && break
    ud=""; [[ $forsoeg -lt 3 ]] && sleep "$PAUSE"
  done
  [[ -n "$ud" ]] || return 1
  printf '%s' "$ud" | python3 -c "
import json, sys
d = json.load(sys.stdin)
navn = sys.argv[1]
print(next((e['server']['version'] for e in d.get('servers', [])
            if e.get('server', {}).get('name') == navn
            and e.get('_meta', {}).get('io.modelcontextprotocol.registry/official', {}).get('isLatest')), ''))" "$NAVN" 2>/dev/null
}
LIVE="$(registrets_version)" || die "registret kunne ikke laeses - kan hverken afgoere om $V allerede er udgivet eller bevise kontakt til registret"
if [[ "$LIVE" == "$V" ]]; then ok "registret viser allerede v$V - intet at goere (genoptagelse)"; exit 0; fi
say "registret viser '${LIVE:-ingen version endnu}'"

if [[ $SHIP != 1 ]]; then
  say "ville: mcp-publisher login github-oidc -> mcp-publisher publish server.json -> laese tilbage til registret viser v$V"
  command -v mcp-publisher >/dev/null 2>&1 || die "mcp-publisher findes ikke paa maskinen - en rigtig udgivelse ville fejle her"
  # Astra runde 5: `ok "...($(mcp-publisher --version))"` meldte groent selv naar kommandoen fejlede (substitutionens exit blev til et argument).
  PUB_V="$(mcp-publisher --version 2>&1)" || die "mcp-publisher kan ikke koeres: $PUB_V"
  ok "proevekoersel: mcp-publisher koerer ($(printf '%s' "$PUB_V" | head -1))"
  exit 0
fi

command -v mcp-publisher >/dev/null 2>&1 || die "mcp-publisher findes ikke - registret ville blive staaende paa '${LIVE:-ingen version}'"
[[ "${GITHUB_ACTIONS:-}" == "true" && -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]] \
  || die "kraever GitHub Actions med permissions: id-token: write (ACTIONS_ID_TOKEN_REQUEST_URL mangler)"
mcp-publisher login github-oidc || die "registret afviste GitHubs id-token (kraever permissions: id-token: write)"
( cd "$REPO_ROOT/mcp-server" && mcp-publisher publish server.json ) \
  || die "registry publish failed - se fejlen ovenfor (beskrivelsen maa hoejst vaere 100 tegn)"

# Registret indekserer IKKE med det samme (maalt 7/9: 1.29.0 stod i registret 6 sekunder senere). Derfor pollet, ikke ét kig.
EFTER=""
for _ in $(seq 1 "$FORSOEG"); do
  sleep "$PAUSE"
  EFTER="$(registrets_version)" || EFTER=""
  [[ "$EFTER" == "$V" ]] && break
done
[[ "$EFTER" == "$V" ]] || die "registry still advertises '${EFTER:-ukendt}' efter publish - paastaa IKKE at udgivelsen er ude"
ok "registret viser nu v$V (laest tilbage)"
