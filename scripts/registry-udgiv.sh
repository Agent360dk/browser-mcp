#!/bin/bash
# registry-udgiv.sh <version> [--ship] - udgiv MCP-registret som EGET trin, efter det kolde tjek (Astra runde 4, 1/10-2026).
#
#   bash scripts/registry-udgiv.sh 1.30.1          # proevekoersel: tjekker og melder hvad der ville ske, skriver intet
#   bash scripts/registry-udgiv.sh 1.30.1 --ship   # logger ind med GitHubs id-token, publicerer og laeser tilbage
#
# Foer 1/10 laa registret (5b) i udgivelsesscriptet EFTER det kolde tjek (5c); scriptet standsede foer registret hvis den udgivne pakke
# ikke svarede. Det kolde tjek koerer nu i et job uden rettigheder (`efter`), saa registret ligger her, i et job der venter paa det.
# Samme logik som trin 5b i runbrowsermcpupdate.sh (id-token-vejen); det trin springes over i workflowet med --skip-registry.
set -uo pipefail
V="${1:?brug: registry-udgiv.sh <version> [--ship]}"
SHIP=0; [[ "${2:-}" == "--ship" ]] && SHIP=1
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORSOEG="${REGISTRY_FORSOEG:-20}"; PAUSE="${REGISTRY_PAUSE:-3}"
ok()  { echo "✓ $*"; }
say() { echo "→ $*"; }
die() { echo "✗ $*" >&2; exit 1; }

# 1 · server.json skal baere netop den version der udgives (baade foerst og i pakken), ellers publicerer vi noget andet end vi har proevet.
SJ="$REPO_ROOT/mcp-server/server.json"
[[ -f "$SJ" ]] || die "mcp-server/server.json findes ikke"
SJ_VERSIONER="$(node -e '
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log([d.version, ...(d.packages || []).map((p) => p.version)].join(" "));' "$SJ")" || die "kunne ikke laese mcp-server/server.json"
for v in $SJ_VERSIONER; do
  [[ "$v" == "$V" ]] || die "mcp-server/server.json siger ${SJ_VERSIONER// /, } men der udgives $V - registret ville faa en anden version end npm"
done
ok "server.json baerer $V"

# 2 · hvad viser registret nu?
registrets_version() {
  curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.Agent360dk/browser-mcp" 2>/dev/null \
    | python3 -c "import json,sys;print(next((e['server']['version'] for e in json.load(sys.stdin).get('servers',[]) if e.get('_meta',{}).get('io.modelcontextprotocol.registry/official',{}).get('isLatest')),''))" 2>/dev/null || true
}
LIVE="$(registrets_version)"
if [[ "$LIVE" == "$V" ]]; then ok "registret viser allerede v$V - intet at gore (genoptagelse)"; exit 0; fi
say "registret viser '${LIVE:-ukendt}'"

if [[ $SHIP != 1 ]]; then
  say "ville: mcp-publisher login github-oidc -> mcp-publisher publish server.json -> laese tilbage til registret viser v$V"
  command -v mcp-publisher >/dev/null 2>&1 || die "mcp-publisher findes ikke paa maskinen - en rigtig udgivelse ville fejle her"
  ok "proevekoersel: mcp-publisher findes ($(mcp-publisher --version 2>&1 | head -1))"
  exit 0
fi

command -v mcp-publisher >/dev/null 2>&1 || die "mcp-publisher findes ikke - registret ville blive staaende paa '${LIVE:-ukendt}'"
[[ "${GITHUB_ACTIONS:-}" == "true" && -n "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]] \
  || die "kraever GitHub Actions med permissions: id-token: write (ACTIONS_ID_TOKEN_REQUEST_URL mangler)"
mcp-publisher login github-oidc || die "registret afviste GitHubs id-token (kraever permissions: id-token: write)"
( cd "$REPO_ROOT/mcp-server" && mcp-publisher publish server.json ) \
  || die "registry publish failed - se fejlen ovenfor (beskrivelsen maa hoejst vaere 100 tegn)"

# Registret indekserer IKKE med det samme (maalt 7/9: 1.29.0 stod i registret 6 sekunder senere). Derfor pollet, ikke ét kig.
EFTER=""
for _ in $(seq 1 "$FORSOEG"); do
  sleep "$PAUSE"
  EFTER="$(registrets_version)"
  [[ "$EFTER" == "$V" ]] && break
done
[[ "$EFTER" == "$V" ]] || die "registry still advertises '${EFTER:-ukendt}' efter publish - paastaa IKKE at udgivelsen er ude"
ok "registret viser nu v$V (laest tilbage)"
