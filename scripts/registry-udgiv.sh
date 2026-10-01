#!/bin/bash
# registry-udgiv.sh <version> [--ship] - udgiv MCP-registret som EGET trin, efter det kolde tjek (Astra runde 4-6, 1/10-2026).
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
PAUSE="${REGISTRY_PAUSE:-3}"
BUDGET="${REGISTRY_BUDGET:-240}"    # samlet tid til at vente paa at registret viser versionen efter publish (jobbets graense er 15 min)
NAVN="io.github.Agent360dk/browser-mcp"
NAVN_URL="${NAVN//\//%2F}"
URL="https://registry.modelcontextprotocol.io/v0/servers/${NAVN_URL}/versions/latest"

# 1 · server.json skal baere netop den version der udgives - baade foerst og i HVER pakke - og det rigtige servernavn, ellers publicerer vi
# noget andet end vi har proevet. Hvert felt sammenlignes HELT i Node (Astra runde 6: join/ordopdeling lod « » og «1.30.1 1.30.1» passere).
# REGISTRY_SERVER_JSON er kun til proever; publicering bruger altid mcp-server/server.json, saa overstyringen maa ikke bruges med --ship.
SJ="${REGISTRY_SERVER_JSON:-$REPO_ROOT/mcp-server/server.json}"
if [[ $SHIP == 1 && -n "${REGISTRY_SERVER_JSON:-}" ]]; then die "REGISTRY_SERVER_JSON er kun til proever og maa ikke bruges med --ship (validering og publicering skal vaere samme fil)"; fi
[[ -f "$SJ" ]] || die "server.json findes ikke: $SJ"
node -e '
const [fil, forventet, navn] = process.argv.slice(1);
const d = JSON.parse(require("fs").readFileSync(fil, "utf8"));
const pakker = Array.isArray(d.packages) ? d.packages : [];
const fejl = [];
if (d.name !== navn) fejl.push(`name er ${JSON.stringify(d.name)}, ikke ${navn}`);
if (d.version !== forventet) fejl.push(`version er ${JSON.stringify(d.version)}, ikke ${forventet}`);
if (pakker.length === 0) fejl.push("packages mangler eller er tom");
pakker.forEach((p, i) => { if (!p || p.version !== forventet) fejl.push(`packages[${i}].version er ${JSON.stringify(p && p.version)}, ikke ${forventet}`); });
if (fejl.length) { console.error(fejl.join("; ")); process.exit(2); }' "$SJ" "$V" "$NAVN" \
  || die "server.json passer ikke til det der udgives ($V, $NAVN): registret ville faa en anden version end npm"
ok "server.json baerer $V"

# 2 · hvad viser registret nu? Opslag paa PRAECIST servernavn (Astra runde 6): ingen substring-soegning, ingen paginering.
#   404            = serveren findes ikke endnu -> tom version (ikke en fejl)
#   200 + vores    = versionen
#   alt andet      = FEJLET opslag (netfejl, 5xx, fejlobjekt, anden server, forkert form) -> exit 1; aldrig tolket som «ingen version»
# MAALT 1/10: det aegte register har en koldstart paa op til 27 s paa det foerste opslag (derefter ~1 s): 45 s og op til tre forsoeg.
registrets_version() {
  local max="${1:-3}" forsoeg=0 tmp http rc
  tmp="$(mktemp)"
  while (( forsoeg < max )); do
    forsoeg=$((forsoeg + 1))
    http="$(curl -sS --connect-timeout 10 --max-time 45 -o "$tmp" -w '%{http_code}' "$URL" 2>/dev/null)"; rc=$?
    if [[ $rc -eq 0 && "$http" == 404 ]]; then rm -f "$tmp"; echo ""; return 0; fi
    [[ $rc -eq 0 && "$http" == 200 ]] && break
    http=""
    [[ $forsoeg -lt $max ]] && sleep "$PAUSE"
  done
  if [[ "$http" != 200 ]]; then rm -f "$tmp"; return 1; fi
  python3 - "$tmp" "$NAVN" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    s = d["server"]
    assert isinstance(s, dict) and s.get("name") == sys.argv[2], "forkert servernavn"
    v = s.get("version")
    assert isinstance(v, str) and v, "version mangler"
except Exception as e:
    print(f"uventet svar fra registret: {e}", file=sys.stderr)
    sys.exit(1)
print(v)
PY
  rc=$?; rm -f "$tmp"; return $rc
}
LIVE="$(registrets_version)" || die "registret kunne ikke laeses (eller svarede med noget der ikke er vores server) - kan hverken afgoere om $V allerede er udgivet eller bevise kontakt til registret"
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

# Registret indekserer IKKE med det samme (maalt 7/9: 1.29.0 stod i registret 6 sekunder senere). Derfor pollet, ikke ét kig - inden for ET samlet
# budget (Astra runde 6: 20 runder a op til 141 s kunne overstige jobbets 15 min og lade runneren afbryde EFTER en faktisk publicering).
EFTER=""; START=$SECONDS
while :; do
  sleep "$PAUSE"
  EFTER="$(registrets_version 1)" || EFTER=""
  [[ "$EFTER" == "$V" ]] && break
  (( SECONDS - START >= BUDGET )) && break
done
[[ "$EFTER" == "$V" ]] || die "registry still advertises '${EFTER:-ukendt}' ${BUDGET} s efter publish - paastaa IKKE at udgivelsen er ude"
ok "registret viser nu v$V (laest tilbage)"
