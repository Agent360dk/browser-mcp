#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# runbrowsermcpupdate.sh - one-command release for Agent360 Browser MCP
#
# Ships a single version across EVERY channel, in sync. The steps run in THIS order - the two gates sit where
# they do on purpose, and moving either one breaks the release (measured 13/9, twice):
#   Pre-flight       → clean tree, tags, npm token, gh auth, docs in sync, node --test test/*.test.mjs
#   2b. Flow gate    → npm run flow against a real Chrome. BEFORE the bump, because the bump writes the new
#                      version into the manifest on disk while the LOADED extension still answers the old one.
#                      Proves the code being shipped: the bump touches no file the fingerprint hashes.
#   1. Version-bump  → extension/manifest.json, mcp-server/extension/manifest.json, mcp-server/package.json,
#                      mcp-server/server.json (×2 fields), sync extension/ → mcp-server/extension/, README link
#   2. Pack check    → npm pack → unpack → start the packed server and talk to it
#   3. Chrome Web Store → scripts/publish-cws.sh (Google review queue, 1-3 days)
#   4. GitHub        → commit, tag vX.Y.Z, push, gh release create + zip asset
#   5. npm           → npm publish  ← LAST irreversible step
#   5c. Cold check   → npx the PUBLISHED package from the registry and talk to it (3 tries, 15s apart)
#   5b. MCP registry → mcp-publisher publish (what MCP clients/directories discover)
#   6. Local install → refresh ~/.browser-mcp/extension/ (then reload chrome://extensions)
#
# SAFE BY DEFAULT: runs as a DRY-RUN unless you pass --ship.
#
# Usage:
#   ./runbrowsermcpupdate.sh 1.23.0            # dry-run: show the full plan, change nothing
#   ./runbrowsermcpupdate.sh 1.23.0 --ship     # execute the release
#
# Flags:
#   --ship            Actually do it (default is dry-run)
#   --skip-npm        Don't publish to npm (e.g. token expired - fix with `npm login`)
#   --skip-registry   Don't publish to the MCP registry (needs mcp-publisher + gh read:org)
#   --skip-cws        Don't publish to Chrome Web Store
#   --skip-flow       Skip the live browser gate in step 2b AND step 3 (you publish blind)
#   --skip-github     Don't commit/tag/push/release on GitHub
#   --skip-local      Don't refresh ~/.browser-mcp/extension/
#   --cws-draft       Upload to CWS but leave as draft (no auto-submit for review)
#   --allow-dirty     Proceed even if the working tree has unrelated changes
#
# One-time setup for the publish channels: docs/CWS_PUBLISH_SETUP.md  +  `npm login`
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# Beviset for at koden er set koere i en browser maa KUN kunne komme fra trin 2b i denne koersel. Arvede vi
# flaget fra skallen, kunne en tidligere koersels bevis slukke spaerren for kode den aldrig har set.
unset BMCP_FLOW_OK

# ── colours ──────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; Z=$'\033[0m'
else
  B=''; R=''; G=''; Y=''; C=''; Z=''
fi
say()  { echo "${C}→${Z} $*"; }
ok()   { echo "${G}✓${Z} $*"; }
warn() { echo "${Y}!${Z} $*"; }
die()  { echo "${R}✗ $*${Z}" >&2; exit 1; }
step() { echo; echo "${B}━━ $* ━━${Z}"; }

# ── arg parse ────────────────────────────────────────────────────────────────
NEW_VERSION=""
SHIP=0
SKIP_NPM=0; SKIP_CWS=0; SKIP_GITHUB=0; SKIP_LOCAL=0; SKIP_REGISTRY=0; SKIP_FLOW=0
CWS_DRAFT=0; ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --ship)        SHIP=1 ;;
    --skip-npm)    SKIP_NPM=1 ;;
    --skip-registry) SKIP_REGISTRY=1 ;;
    --skip-cws)    SKIP_CWS=1 ;;
    --skip-flow)   SKIP_FLOW=1 ;;
    --skip-github) SKIP_GITHUB=1 ;;
    --skip-local)  SKIP_LOCAL=1 ;;
    --cws-draft)   CWS_DRAFT=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)            die "Unknown flag: $arg" ;;
    *)
      [[ -z "$NEW_VERSION" ]] || die "Version already set to '$NEW_VERSION' - unexpected arg '$arg'"
      NEW_VERSION="$arg" ;;
  esac
done

[[ -n "$NEW_VERSION" ]] || die "Usage: ./runbrowsermcpupdate.sh <X.Y.Z> [--ship]  (see --help)"
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Version '$NEW_VERSION' is not semver X.Y.Z"

# Load secrets ONCE, early + exported, so both the npm pre-flight and `npm publish`
# see NPM_TOKEN (.npmrc references ${NPM_TOKEN}) and the CWS step sees CWS_*. Both
# live in .env (gitignored). This is the single source of truth for publish auth.
if [[ -f .env ]]; then set -a; source .env; set +a; fi

MODE_LABEL="${Y}DRY-RUN${Z} (nothing will change - add --ship to execute)"
[[ "$SHIP" == 1 ]] && MODE_LABEL="${R}${B}SHIP${Z} (this WILL publish)"

# run-or-echo wrapper: in dry-run, print the command; with --ship, execute it
run() {
  if [[ "$SHIP" == 1 ]]; then "$@"; else echo "    ${C}would run:${Z} $*"; fi
}

echo
echo "${B}Browser MCP release - v${NEW_VERSION}${Z}    [$MODE_LABEL]"

# ── pre-flight ───────────────────────────────────────────────────────────────
step "Pre-flight checks"

for bin in node zip git; do command -v "$bin" >/dev/null || die "missing required tool: $bin"; done
ok "tools present: node, zip, git"

BRANCH="$(git branch --show-current)"
[[ "$BRANCH" == "main" ]] || die "on branch '$BRANCH' - releases ship from 'main'"
ok "on branch main"

# current versions (for monotonic check + reporting)
CUR_EXT="$(node -p "require('./extension/manifest.json').version")"
CUR_PKG="$(node -p "require('./mcp-server/package.json').version")"
NPM_LATEST="$(npm view @agent360/browser-mcp version 2>/dev/null || echo '0.0.0')"
say "current → extension:${CUR_EXT}  npm-package:${CUR_PKG}  npm-latest:${NPM_LATEST}"

# Monotonic check guards ONLY against npm-latest - the one irreversible channel.
# NOT the working-tree (a partial run may have bumped files) and NOT the git tag
# (a cross-channel resume legitimately re-runs a version whose tag/release already
# shipped but whose npm publish failed). The per-channel guards below (npm view,
# tag rev-parse, commit-diff, gh release view) make every other channel idempotent.
LATEST_TAG="$(git tag | sed 's/^v//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
# MAALT 11/9 (Astra, efterproevet): her stoppede scriptet naar NEW_VERSION == npm-latest.
# Men npm koerer som trin 5 og MCP-registret EFTER npm. Fejlede registret, kunne udgivelsen
# ikke genoptages, selvom npm-trinnet selv springer en allerede udgivet version over.
# Lighed betyder derfor "genoptag"; kun en aeldre version stopper.
versions_tjek() {
  local ny="$1" npm="$2"
  if [[ "$ny" == "$npm" ]]; then echo genoptag; return 0; fi
  [[ "$(printf '%s\n%s\n' "$npm" "$ny" | sort -V | tail -1)" == "$ny" ]] || return 1
  echo ny
}
# MAALT 11/9 af Fable (sign-off): samme version som npm + ny kode paa main (glemt versionsbump) blev kaldt
# "genoptag". Med --skip-cws blev main pushet, og GitHub-udgivelsens zip erstattet (--clobber) med kode der
# hverken var tagget eller paa npm. En halv udgivelse genoptages kun, hvis tagget peger paa netop HEAD.
genoptag_tjek() {
  local ny="$1" tag_commit
  tag_commit="$(git rev-parse -q --verify "v${ny}^{commit}" 2>/dev/null)" || return 1
  [[ "$tag_commit" == "$(git rev-parse HEAD)" ]]
}
# MAALT 11/9 af Fable (e2e-review): paa "ny"-vejen blev et eksisterende tag ikke tjekket. Stoppede en udgivelse efter
# push+tag, og kom der én commit mere, ville naeste koersel pushe, erstatte zippen (--clobber) og udgive npm fra HEAD,
# mens tagget blev staaende paa den gamle commit. Intet tag er fint; et tag skal pege paa den kode der udgives.
# MAALT 11/9 af Fable (e2e runde 2): GitHub-udgivelsen fik én generisk linje, mens kladden og ja-blokken lovede at
# CHANGELOG-afsnittet fulgte med ordret. Afsnittet for versionen hentes ud her og bruges som udgivelsesnoter.
udgivelsesnoter() {
  local ver="$1" fil="${2:-CHANGELOG.md}"
  [[ -f "$fil" ]] || return 0
  awk -v start="## ${ver}" '
    index($0, start) == 1 { i = 1; next }
    i && /^## / { exit }
    i { print }
  ' "$fil"
}

ny_tag_tjek() {
  local ny="$1" tag_commit
  tag_commit="$(git rev-parse -q --verify "v${ny}^{commit}" 2>/dev/null)" || return 0
  [[ "$tag_commit" == "$(git rev-parse HEAD)" ]]
}
VERSIONS_TILSTAND="$(versions_tjek "$NEW_VERSION" "$NPM_LATEST")" \
  || die "new version $NEW_VERSION must be greater than or equal to npm-latest ($NPM_LATEST)"
if [[ "$VERSIONS_TILSTAND" == genoptag ]]; then
  genoptag_tjek "$NEW_VERSION" || die "v$NEW_VERSION er allerede paa npm, men tagget v$NEW_VERSION findes ikke eller peger ikke paa HEAD: der er ny kode siden udgivelsen. Bump versionen i stedet for at genoptage"
  warn "v$NEW_VERSION er allerede paa npm: genoptager en halv udgivelse. npm springes over; brug --skip-cws hvis butikken allerede har versionen (den afviser samme version igen)"
else
  ny_tag_tjek "$NEW_VERSION" || die "tagget v$NEW_VERSION findes allerede, men peger ikke paa HEAD: en tidligere koersel naaede at tagge og pushe, og der er kommet ny kode siden. Bump versionen, eller flyt tagget bevidst foer du koerer igen"
  ok "version $NEW_VERSION > npm-latest $NPM_LATEST (tag:${LATEST_TAG:-none})"
fi

# Every path this release touches/stages. Anything dirty OUTSIDE this set is a
# stray (likely another chat's WIP) and must not be swept into the release commit.
MANAGED=(
  extension
  mcp-server/extension
  mcp-server/index.js
  mcp-server/tools.js
  mcp-server/bin
  server.json
  mcp-server/package.json
  mcp-server/package-lock.json
  mcp-server/server.json
  mcp-server/README.md
  README.md
  docs/index.html
  # MAALT 12/9 af Astra: trin 1d-3 skriver CHANGELOG-overskriften om fra "(not released yet)" til datoen - men filen stod
  # hverken her eller i `git add` nedenfor. Aendringen blev derfor aldrig committet: den PUSHEDE CHANGELOG.md sagde
  # fortsat "not released yet", altsaa praecis det trinnet skulle lukke. Og filen stod beskidt bagefter, saa NAESTE
  # koersels stray-tjek doede paa den.
  CHANGELOG.md
)
is_managed() { # path → 0 if under a managed prefix
  local p="$1" m
  for m in "${MANAGED[@]}"; do [[ "$p" == "$m" || "$p" == "$m"/* ]] && return 0; done
  return 1
}

# working tree: only release-managed paths may be dirty (unless --allow-dirty)
if [[ "$ALLOW_DIRTY" == 0 ]]; then
  STRAY=""
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    p="${line:3}"; p="${p%% -> *}"          # strip status prefix + rename arrow
    is_managed "$p" || STRAY="${STRAY}      ${p}"$'\n'
  done < <(git status --porcelain)
  if [[ -n "$STRAY" ]]; then
    warn "working tree has changes outside release-managed files:"
    printf '%s' "$STRAY"
    die "commit/stash these first, or re-run with --allow-dirty"
  fi
fi
ok "working tree clean (or only release-managed files dirty)"

# gate(): defineret HER, foer foerste kald. MAALT 22/8: test-gaten nedenfor kaldte
# gate paa linje 163, mens definitionen laa paa 168 - med `set -euo pipefail` gav et
# roedt testresultat derfor "gate: command not found" og exit 127 i stedet for den
# tilsigtede besked. Gaten HOLDT, men dry-run-adfaerden ("advar og fortsaet") fandtes ikke.
gate() { if [[ "$SHIP" == 1 ]]; then die "$1"; else warn "$1 ${Y}(dry-run: continuing)${Z}"; fi; }

# ── test-gate ────────────────────────────────────────────────────────────────
# Der var INGEN test-gate her. Udgivelsen kunne - og gjorde det - sende en kopi af
# udvidelsen af sted som var 88 linjer bagud for kilden, uden at noget sagde fra.
# Testene er rene node:test-filer uden Chrome-afhaengighed, saa de koster to sekunder.
if TEST_OUT="$(node --test "$REPO_ROOT"/test/*.test.mjs 2>&1)"; then
  # MAALT 8/9: her stod kun `grep '^# pass'`. node --test skriver nu `ℹ pass 257`, saa
  # tallet blev tomt og linjen sagde "tests groenne ( bestaaet)". Spaerren SELV var i
  # orden - den hviler paa exit-koden - men rapporten sagde ingenting. Et tal der tavst
  # forsvinder er praecis den slags man senere kommer til at stole paa.
  ok "tests groenne ($(printf '%s' "$TEST_OUT" | grep -m1 -E '^(# |ℹ )pass' | tr -dc '0-9') bestaaet)"
else
  printf '%s\n' "$TEST_OUT" | tail -40
  gate "tests fejler - ret dem foer udgivelse"
fi

# channel auth pre-flight. In SHIP mode a broken channel aborts the whole run;
# in dry-run it's only a warning so you can still preview the full plan.

if [[ "$SKIP_NPM" == 0 ]]; then
  # MAALT 7/9: her stod KUN `npm whoami`, som laeser den lokale ~/.npmrc-login.
  # Men trin 5 udgiver med `--//registry.npmjs.org/:_authToken=${NPM_TOKEN}` fra .env -
  # en HELT anden noegle. Spaerren tjekkede altsaa en legitimation udgivelsen ikke bruger:
  # den blokerede en udgivelse der ville lykkes, og ville have lukket én igennem der
  # ville fejle. Nu tjekkes den noegle der faktisk bliver brugt.
  if [[ -n "${NPM_TOKEN:-}" ]]; then
    NPM_WHO="$(curl -s -H "Authorization: Bearer $NPM_TOKEN" https://registry.npmjs.org/-/whoami \
      | python3 -c "import json,sys;print(json.load(sys.stdin).get('username',''))" 2>/dev/null || true)"
    if [[ -n "$NPM_WHO" ]]; then ok "npm authenticated as $NPM_WHO (NPM_TOKEN fra .env)"
    else gate "NPM_TOKEN i .env afvises af npm - forny den paa npmjs.com/settings/<bruger>/tokens, eller pass --skip-npm"; fi
  elif npm whoami >/dev/null 2>&1; then ok "npm authenticated as $(npm whoami) (lokal login)"
  else gate "npm not authenticated (E401) - run 'npm login', saet NPM_TOKEN i .env, eller pass --skip-npm"; fi
fi
if [[ "$SKIP_CWS" == 0 ]]; then
  if [[ ! -f .env ]]; then gate ".env missing (CWS secrets) - see docs/CWS_PUBLISH_SETUP.md, or --skip-cws"
  else
    # .env already sourced early (top of file); just verify the required vars.
    CWS_MISSING=""
    for v in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_EXTENSION_ID; do
      [[ -n "${!v:-}" ]] || CWS_MISSING="$CWS_MISSING $v"
    done
    if [[ -n "$CWS_MISSING" ]]; then gate "CWS secrets missing in .env:$CWS_MISSING - see docs/CWS_PUBLISH_SETUP.md"
    else ok "CWS secrets present in .env"; fi
  fi
fi
if [[ "$SKIP_GITHUB" == 0 ]]; then
  if ! command -v gh >/dev/null; then gate "gh CLI missing - install it, or pass --skip-github"
  elif ! gh auth status >/dev/null 2>&1; then gate "gh not authenticated - run 'gh auth login', or --skip-github"
  else ok "gh authenticated"; fi
fi
if [[ "$SKIP_REGISTRY" == 0 ]]; then
  # The registry rejects description > 100 chars with a 422. Catch it HERE - failing at the
  # registry step means npm is already published and the release is half-done, which is how
  # server.json sat un-publishable while the registry silently fell behind.
  SJ_DESC_LEN="$(python3 -c "import json;print(len(json.load(open('mcp-server/server.json')).get('description','')))" 2>/dev/null || echo 0)"
  if [[ "$SJ_DESC_LEN" == 0 ]]; then gate "mcp-server/server.json unreadable or has no description"
  elif (( SJ_DESC_LEN > 100 )); then gate "server.json description is ${SJ_DESC_LEN} chars - registry rejects >100; shorten it, or --skip-registry"
  else ok "server.json description ${SJ_DESC_LEN}/100 chars"; fi
fi

# tool-count: single source of truth = tools.js (don't hardcode - derive it)
TOOL_COUNT="$(grep -oE "name: ['\"]browser_[a-z_]+" mcp-server/tools.js | sort -u | wc -l | tr -d ' ')"

# ── 2b. Flow-spaerre mod en aegte Chrome ──────────────────────────────────────
# MAALT 12/9 (Astra + Fable): spaerren laa KUN inde i butikstrinnet, saa `--skip-cws` sprang ogsaa spaerren over -
# og npm og GitHub fik koden uden at nogen levende kontrol havde koert. Astra maalte desuden at en GAMMEL service
# worker kan koere videre selv om ny kode ligger paa disken; aftrykket hasher FILER og kan ikke se det. Kun en
# levende koersel kan.
#
# Fable, samme dag, paa min foerste udgave af dette trin - tre fejl jeg selv lavede:
#   1. Trinnet sagde GROENT saa laenge `browser_provide_feedback` ikke var i FEJL-listen, og ignorerede ALLE andre
#      fejl. Butikstrinnet stopper paa praecis samme rapport (KENDTE_FEJL er tom). To spaerrer med to forskellige
#      barer er én spaerre. Baren er nu den samme.
#   2. Trinnet brugte `die` ogsaa i toerloeb, saa planen ikke kunne ses hele vejen. Nu `gate`.
#   3. Trinnet laa EFTER versionsbumpet. Bumpet skriver den nye version i manifestet paa disken, mens den INDLAESTE
#      udvidelse stadig svarer den gamle - saa foerste --ship-pas doede altid paa en forskel scriptet selv havde
#      lavet. Spaerren ligger nu FOER trin 1. Den beviser stadig koden: bumpet roerer ingen af de filer aftrykket
#      hasher (background.js, offscreen.js).
step "2b. Flow-spaerre mod en aegte Chrome"
if [[ "$SKIP_FLOW" == 1 || "${SPRING_FLOW_OVER:-}" == "1" ]]; then
  warn "sprunget over - du udgiver i blinde: ingen har set koden koere i en browser"
  # MAALT 13/9 af Astra og Fable, uafhaengigt: uden den her linje var --skip-flow ikke en noedudgang, men en
  # doedsfaelde. Butikstrinnet (trin 3) koerer sin EGEN flow-test, og efter versionsbumpet fejler den altid paa
  # en forskel scriptet selv har lavet (manifestet bumpet, den indlaeste udvidelse ikke). Flaget lovede
  # "udgiv i blinde" og standsede i stedet koerslen - efter at seks filer var bumpet. Kun miljoevariablen
  # arves af barnet, saa den er den der skal saettes.
  export SPRING_FLOW_OVER=1
else
  # Kendte, accepterede fejl. Samme liste-mekanik som scripts/publish-cws.sh, og den skal helst blive tom:
  # hver linje her er en roed lampe nogen har vaennet sig til. Tilfoej kun med dato og grund.
  KENDTE_FEJL=()
  FLOW_UD="$(mktemp)"
  say "npm --prefix mcp-server run flow"
  npm --prefix mcp-server run flow > "$FLOW_UD" 2>&1 || true
  if ! grep -q "^DAEKNING:" "$FLOW_UD"; then
    tail -20 "$FLOW_UD" | sed 's/^/    /'
    gate "flow-testen kunne ikke koere faerdig. Er Chrome aaben med PRAECIS én udvidelse indlaest - repoets extension/? (--skip-flow udgiver i blinde)"
  else
    grep -E "^DAEKNING:" "$FLOW_UD" | sed 's/^/  /'
    FLOW_UVENTEDE=0
    while IFS= read -r linje; do
      navn="$(echo "$linje" | sed 's/^  //; s/:.*//')"
      [[ -z "$navn" ]] && continue
      kendt=0
      for k in ${KENDTE_FEJL[@]+"${KENDTE_FEJL[@]}"}; do [[ "$navn" == "$k" ]] && kendt=1; done
      if [[ $kendt -eq 1 ]]; then echo "  ◦ kendt fejl, accepteret: $navn"
      else echo "  ✗ $navn"; FLOW_UVENTEDE=$((FLOW_UVENTEDE+1)); fi
    done < <(sed -n '/^FEJL:/,/^====/p' "$FLOW_UD" | sed '1d; /^====/d')
    if [[ $FLOW_UVENTEDE -gt 0 ]]; then
      gate "$FLOW_UVENTEDE uventede fejl i flow-testen. Er det musehaendelser, ligger fanen i baggrunden - giv Chrome et synligt vindue og koer igen. Er det selv-diagnosen, koerer Chrome ikke kandidatens kode"
    else
      ok "flow-spaerren er groen: nul uventede fejl paa den kode der udgives"
      # Butikstrinnet koerer samme flow-test. Efter versionsbumpet ville den fejle paa en forskel scriptet
      # selv har lavet (manifest bumpet, indlaest udvidelse ikke). Beviset er fremskaffet her, foer bumpet.
      export BMCP_FLOW_OK=1
    fi
  fi
fi

# ── 1. sync + version bump + tool-count + readme (only written under --ship) ──
step "1. Version → ${NEW_VERSION} · tool-count → ${TOOL_COUNT} · sync extension + README"

# 1a. sync extension/ → mcp-server/extension/ FIRST so the npm-bundled copy + the
#     GitHub zip + CWS zip are byte-identical, then bump every manifest uniformly.
say "sync extension/ → mcp-server/extension/ (npm-bundled copy)"
run rsync -a --delete --exclude='.DS_Store' extension/ mcp-server/extension/

# 1b. sync root README → mcp-server/README.md (the npmjs.com landing page)
say "sync README.md → mcp-server/README.md (npm landing page)"
run cp README.md mcp-server/README.md

# 1c. ATOMIC version bump: one node process reads+validates ALL json, then writes
#     ALL - so a parse error can't leave the tree half-bumped at mixed versions.
#     NOTE: server.json's version bumpes her, og trin 5b UDGIVER den til MCP-registret.
#     (Kommentaren sagde indtil 7/9 at registret ikke blev udgivet - det var sandt da den
#     blev skrevet, og forkert fra 23/8. En foraeldet note om en kanal er hvordan kanalen
#     bliver glemt.)
JSON_FILES="server.json extension/manifest.json mcp-server/extension/manifest.json mcp-server/package.json mcp-server/package-lock.json mcp-server/server.json"
say "bump .version → $NEW_VERSION in: $JSON_FILES"
run node -e "
  const fs=require('fs');
  const V='$NEW_VERSION';
  const files='$JSON_FILES'.split(' ');
  const parsed = files.map(f => ({f, j: JSON.parse(fs.readFileSync(f,'utf8'))}));  // validate all first
  for (const {f,j} of parsed) {
    if ('version' in j) j.version = V;
    if (Array.isArray(j.packages)) j.packages.forEach(p => { if (p && p.version) p.version = V; });       // server.json
    if (j.packages && j.packages[''] && j.packages[''].version) j.packages[''].version = V;               // package-lock root
    fs.writeFileSync(f, JSON.stringify(j,null,2)+'\n');
  }
"

# 1d. tool-count sweep: fix '<n> tools' / '<n> browser tools' everywhere it drifts.
TOOLCOUNT_FILES="README.md mcp-server/README.md llms-install.md extension/manifest.json mcp-server/extension/manifest.json mcp-server/server.json mcp-server/bin/cli.js docs/index.html"
say "sweep tool-count → '${TOOL_COUNT} tools' across: $TOOLCOUNT_FILES"
for f in $TOOLCOUNT_FILES; do
  [[ -f "$f" ]] || continue
  # Bemaerk 'Tools' med stort T: overskriften "## 42 Tools" blev ikke ramt af det
  # smaa-bogstavs-moenster, saa mcp-server/README.md stod med "## 34 Tools" i otte udgaver.
  run perl -0pi -e "s/\b[0-9]+ browser tools\b/${TOOL_COUNT} browser tools/g; s/\b[0-9]+ tools\b/${TOOL_COUNT} tools/g; s/\\b[0-9]+ Tools\\b/${TOOL_COUNT} Tools/g" "$f"
done

# 1d-1b. README's "latest release vX.Y.Z (dato)" er en versionspaastand paa forsiden - og
#        den kopieres til npmjs.com i trin 1b. Intet trin vedligeholdt den: den stod paa
#        v1.25.0 (2026-07-24) mens npm var paa 1.28.1. Fejes som de oevrige versionsfelter.
say "README: 'latest release vX.Y.Z' -> v${NEW_VERSION} ($(date +%Y-%m-%d))"
for f in README.md mcp-server/README.md; do
  [[ -f "$f" ]] || continue
  run perl -0pi -e "s/latest release v[0-9]+\.[0-9]+\.[0-9]+ \([0-9]{4}-[0-9]{2}-[0-9]{2}\)/latest release v${NEW_VERSION} ($(date +%Y-%m-%d))/g" "$f"
done
if [[ "$SHIP" == 1 ]]; then
  grep -q "latest release v${NEW_VERSION}" README.md \
    || die "README 'latest release' did not update to v${NEW_VERSION} - the line moved; fix the regex"
fi

# 1d-2. Homepage JSON-LD softwareVersion. This is the machine-readable version claim that
#       search engines and AI crawlers read - it is NOT covered by the tool-count sweep above,
#       so it silently advertised 1.23.0 while 1.24.0 was live on every other channel.
say "docs/index.html: JSON-LD softwareVersion → ${NEW_VERSION}"
run perl -0pi -e "s/(\"softwareVersion\":\s*\")[0-9]+\.[0-9]+\.[0-9]+(\")/\${1}${NEW_VERSION}\${2}/g" docs/index.html
if [[ "$SHIP" == 1 ]]; then
  grep -q "\"softwareVersion\": \"${NEW_VERSION}\"" docs/index.html \
    || die "docs/index.html softwareVersion did not update to ${NEW_VERSION} - JSON-LD format changed; fix the regex"
fi

# 1d-3. CHANGELOG-overskriften. MAALT 12/9 af Fable (e2e runde 3): afsnittet staar som
#        "## X.Y.Z (not released yet)" mens der arbejdes - og INTET trin skrev den om. Den
#        gik derfor offentlig i den pushede CHANGELOG.md, i en fil der selv lover at
#        "Dates are when the version was published". Udgivelsesnoterne til GitHub rammes
#        ikke (awk springer overskriften over), men filen i repoet gjorde.
say "CHANGELOG: '## ${NEW_VERSION} (not released yet)' -> '## ${NEW_VERSION} ($(date +%Y-%m-%d))'"
run perl -0pi -e "s/^## \Q${NEW_VERSION}\E \(not released yet\)\$/## ${NEW_VERSION} ($(date +%Y-%m-%d))/m" CHANGELOG.md
if [[ "$SHIP" == 1 ]]; then
  grep -q "^## ${NEW_VERSION} (not released yet)" CHANGELOG.md \
    && die "CHANGELOG still says '(not released yet)' for ${NEW_VERSION} - the heading moved; fix the regex"
fi

# 1e. FJERNET 22/8: her stod en perl-erstatning + en grep-gate paa `browser-mcp-vX.Y.Z.zip`.
#     Den streng findes ikke laengere i nogen README - begge linker nu til
#     `releases/latest` med pladsholderen `agent360-browser-mcp-<version>.zip`. Perl'en
#     ramte derfor nul, og grep-gaten `die`de. Og fordi gaten laa inde i `if SHIP == 1`,
#     meldte toerkoerslen GROENT mens den rigtige koersel doede - efter at 5 JSON-filer
#     allerede var bumpet. Trinnet var overfloedigt: README peger ikke paa en versioneret fil.

# ── 2. Pakke-tjek: starter tarballen overhovedet? ─────────────────────────────
# MAALT 23/8: `vagt.js` blev importeret af index.js men glemt i package.json "files".
# `npm pack` gav 14 filer uden den, og HVER eneste `npx @agent360/browser-mcp` doede
# med ERR_MODULE_NOT_FOUND foer den naaede at sige noget. 178 tests var groenne, og
# release-testen der skulle fange det itererede over en haandskrevet fil-liste.
#
# Derfor pakkes tarballen nu og startes som en rigtig bruger ville goere det, FOER
# noget som helst udgives. Det er det eneste trin der beviser at pakken virker.
step "2. Pakke-tjek (pack → udpak → start)"
if [[ "$SHIP" != 1 ]]; then
  say "ville pakke tarballen ud og starte den (koeres kun med --ship)"
else
  SMOKE_DIR="$(mktemp -d)"
  ( cd "$REPO_ROOT/mcp-server" && npm pack --pack-destination "$SMOKE_DIR" >/dev/null ) || die "npm pack fejlede"
  ( cd "$SMOKE_DIR" && tar xzf agent360-browser-mcp-*.tgz ) || die "kunne ikke pakke tarballen ud"
  ( cd "$SMOKE_DIR/package" && npm install --silent --no-audit --no-fund >/dev/null 2>&1 ) || die "npm install i tarballen fejlede"
  # MAALT 11/9 (Astra): her grep'ede tjekket kun efter modul- og syntaksfejl, og en manglende
  # "server running"-linje gav kun en advarsel. En pakke der crashede af enhver anden grund
  # blev godkendt. Nu kraeves et gyldigt svar paa MCP-haandtrykket (scripts/pakke-roegtest.mjs).
  node "$REPO_ROOT/scripts/pakke-roegtest.mjs" "$SMOKE_DIR/package" \
    || die "tarballen svarer ikke paa MCP-haandtrykket - UDGIV IKKE. Se fejlen ovenfor (mangler der en fil i package.json files?)"
  ok "tarballen starter og svarer paa initialize"
  rm -rf "$SMOKE_DIR"
fi


# ── 3. Chrome Web Store ───────────────────────────────────────────────────────
step "3. Chrome Web Store publish"
if [[ "$SKIP_CWS" == 1 ]]; then warn "skipped (--skip-cws)"
else
  # MAALT 12/9 af Fable: fejler koerslen EFTER butiks-uploaden men FOER npm, afviser butikken den samme version
  # ved en genkoersel - og saa doer scriptet foer GitHub. Alt andet (tag, push, release, npm, register) taaler en
  # genkoersel. Hintet stod kun paa genoptag-stien, hvor man allerede var forbi npm.
  warn "fejler koerslen EFTER dette trin, saa koer igen med --skip-cws: butikken afviser den samme version to gange"
  CWS_ARGS=(); [[ "$CWS_DRAFT" == 1 ]] && CWS_ARGS+=(--draft)
  say "scripts/publish-cws.sh ${CWS_ARGS[*]:-} (reads extension/manifest.json = $NEW_VERSION)"
  run ./scripts/publish-cws.sh ${CWS_ARGS[@]+"${CWS_ARGS[@]}"}
fi

# ── 4. GitHub: commit, tag, push, release ─────────────────────────────────────
step "4. GitHub: commit · tag v${NEW_VERSION} · push · release"
if [[ "$SKIP_GITHUB" == 1 ]]; then warn "skipped (--skip-github)"
else
  say "reset index, then stage release-managed files only (no git add -A; drops any stray pre-staged files)"
  run git reset -q
  # MAALT 22/8: index.js, tools.js og bin/ manglede her - praecis den kode npm udgiver
  # ("files" i package.json). npm kunne faa en version der ikke fandtes i noget commit.
  run git add extension mcp-server/extension mcp-server/index.js mcp-server/tools.js mcp-server/bin \
              mcp-server/package.json mcp-server/package-lock.json \
              mcp-server/server.json server.json mcp-server/README.md README.md docs/index.html \
              CHANGELOG.md

  # commit only if something is staged - a resumed run (already committed) must
  # NOT abort here under set -e and strand the tag/push/release that follow.
  if [[ "$SHIP" == 1 ]]; then
    if git diff --cached --quiet; then
      warn "nothing staged (resumed run) - skipping commit"
    else
      git commit -m "release: v${NEW_VERSION} - npm + Chrome Web Store + GitHub"
    fi
  else
    echo "    ${C}would run:${Z} git commit -m \"release: v${NEW_VERSION} …\" (if anything staged)"
  fi

  if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    warn "tag v${NEW_VERSION} already exists - skipping tag"
  else
    run git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"   # annotated, so it pushes
  fi
  # push branch, then the tag EXPLICITLY. (--follow-tags silently skips lightweight
  # tags and even annotated ones can be missed on resume; explicit push is robust
  # and idempotent - an already-pushed tag just reports up-to-date.)
  run git push origin main
  run git push origin "v${NEW_VERSION}"

  ZIP="/tmp/agent360-browser-mcp-${NEW_VERSION}.zip"
  say "build release zip for GitHub asset: $ZIP"
  run bash -c "rm -f '$ZIP'; cd '$REPO_ROOT/extension' && zip -qr '$ZIP' . -x '*.DS_Store'"
  if gh release view "v${NEW_VERSION}" >/dev/null 2>&1; then
    warn "release v${NEW_VERSION} exists - uploading asset with --clobber"
    run gh release upload "v${NEW_VERSION}" "$ZIP" --clobber
  else
    NOTER_FIL="$(mktemp)"
    {
      printf 'Install: `npx @agent360/browser-mcp install` - or load the attached zip unpacked in chrome://extensions.\n\n'
      udgivelsesnoter "$NEW_VERSION" "$REPO_ROOT/CHANGELOG.md"
    } > "$NOTER_FIL"
    run gh release create "v${NEW_VERSION}" "$ZIP" \
      --title "Browser MCP ${NEW_VERSION}" \
      --notes-file "$NOTER_FIL"
  fi
fi
# ── npm SIDST: det eneste trin der ikke kan fortrydes ─────────────────────────
# MAALT 23/8: npm publish laa som step 2, altsaa FOER Chrome Web Store og git push.
# Fejlede noget bagefter, var kanalerne ude af sync - og scriptets egen monotone
# versions-gate blokerede at man kunne genoptage paa samme version. Et brugt
# versionsnummer er brugt for evigt (dist-tag kan flyttes, unpublish kun i 72 timer).
# Alt det reversible koerer nu foerst, og npm er det sidste haandtag der traekkes.

# ── 2. npm ────────────────────────────────────────────────────────────────────
step "5. npm publish  ← sidste uigenkaldelige skridt"
if [[ "$SKIP_NPM" == 1 ]]; then warn "skipped (--skip-npm)"
else
  if [[ "$(npm view @agent360/browser-mcp@"$NEW_VERSION" version 2>/dev/null || true)" == "$NEW_VERSION" ]]; then
    warn "v$NEW_VERSION already on npm - skipping (resumable re-run)"
  else
    say "publishing @agent360/browser-mcp@$NEW_VERSION"
    # Pass the token EXPLICITLY on the CLI. npm run from mcp-server/ reads only
    # mcp-server/.npmrc + ~/.npmrc - NOT the repo-root .npmrc that references
    # ${NPM_TOKEN} - so without this it silently uses the stale ~/.npmrc token
    # and 404s. Requires NPM_TOKEN from .env (sourced at top).
    [[ -n "${NPM_TOKEN:-}" ]] || die "NPM_TOKEN missing in .env - needed for npm publish (Bypass-2FA token, see npmjs.com Access Tokens)"
    # \${NPM_TOKEN} stays literal in the outer shell (so dry-run echoes the var name,
    # not the secret) and is expanded by the inner bash -c from the exported env.
    run bash -c "cd '$REPO_ROOT/mcp-server' && npm publish --access public '--//registry.npmjs.org/:_authToken=\${NPM_TOKEN}'"
  fi
fi

# ── 2b. MCP registry ──────────────────────────────────────────────────────────
# The MCP registry is what clients and directories read to discover the server. It was NOT
# wired into this script, so every release left it behind - it sat 3 months on v1.16.1 once,
# and v1.24.0 shipped to npm while the registry still advertised v1.23.0. Runs after npm
# because the registry entry points at the published npm package.
# ── 5c. Koldt tjek af den UDGIVNE pakke ───────────────────────────────────────
# MAALT 12/9 af Astra: roegtesten (scripts/pakke-roegtest.mjs) koerer paa TARBALLEN, foer npm. Intet tjekkede at det
# brugerne faktisk henter, kan installeres og svare paa et MCP-haandtryk. Det er den eneste kontrol der ser registret
# som en fremmed maskine ser det.
#
# Fable, samme dag, to fejl i min foerste udgave:
#   - Den advarede kun, og scriptet fortsatte - saa registret (5b) blev udgivet mod en pakke der lige var dumpet.
#   - Ét forsoeg. Registret indekserer forsinket (5b poller selv 20x3 s), saa en netop udgivet version kan mangle et
#     oejeblik - og saa ville den raade til unpublish paa en fuldstaendig god udgivelse.
step "5c. Koldt tjek: henter den udgivne pakke og taler med den"
if [[ "$SKIP_NPM" == 1 ]]; then warn "sprunget over (--skip-npm: der blev ikke udgivet noget)"
elif [[ "$SHIP" != 1 ]]; then say "ville hente @agent360/browser-mcp@${NEW_VERSION} med npx og sende initialize"
else
  KOLD_OK=0
  # MAALT 13/9 af Fable: kaldet havde ingen tidsgraense. `npx` henter fra registret, og et haengende
  # download eller en pakke der aldrig svarer, ville staa her i det uendelige - som SIDSTE spaerre foer
  # registret, efter at npm er udgivet. `head -1` lukker roeret, men lukker ikke processen.
  if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD=(timeout 90)
  elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD=(gtimeout 90)
  else TIMEOUT_CMD=(); warn "ingen timeout(1) paa maskinen - det kolde tjek kan haenge"; fi
  for forsoeg in 1 2 3; do
    KOLD_HJEM="$(mktemp -d)"
    say "npx @agent360/browser-mcp@${NEW_VERSION} (frisk HOME, forsoeg ${forsoeg}/3)"
    KOLD_SVAR="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"koldt-tjek","version":"1"}}}' \
      | HOME="$KOLD_HJEM" "${TIMEOUT_CMD[@]}" npx -y "@agent360/browser-mcp@${NEW_VERSION}" 2>"$KOLD_HJEM/fejl.log" | head -1 || true)"
    if [[ "$KOLD_SVAR" == *'"serverInfo"'* && "$KOLD_SVAR" == *'agent360-browser'* ]]; then
      KOLD_OK=1; rm -rf "$KOLD_HJEM" 2>/dev/null || true; break
    fi
    [[ -s "$KOLD_HJEM/fejl.log" ]] && tail -5 "$KOLD_HJEM/fejl.log" | sed 's/^/    /'
    rm -rf "$KOLD_HJEM" 2>/dev/null || true
    [[ $forsoeg -lt 3 ]] && { say "registret har maaske ikke indekseret endnu - venter 15 s"; sleep 15; }
  done
  if [[ $KOLD_OK -eq 1 ]]; then
    ok "den udgivne pakke svarer paa MCP-haandtrykket"
  else
    echo "    sidste svar: ${KOLD_SVAR:0:200}"
    warn "TILBAGERULNING - og den er smal:"
    warn "  npm unpublish @agent360/browser-mcp@${NEW_VERSION}   # kun inden for 72 timer, og kun uden dependents"
    warn "  Versionsnummeret er braendt for evigt. Vaelg ÉN vej:"
    warn "    a) unpublish (tagget latest falder selv tilbage), eller"
    warn "    b) udgiv en rettelse - og flyt kun latest tilbage hvis du IKKE udgiver en ny:"
    warn "       npm dist-tag add @agent360/browser-mcp@${NPM_LATEST} latest"
    die "den udgivne pakke svarede ikke paa initialize efter tre forsoeg - registret udgives IKKE mod den"
  fi
fi

step "5b. MCP registry publish"
if [[ "$SKIP_REGISTRY" == 1 ]]; then warn "skipped (--skip-registry)"
elif ! command -v mcp-publisher >/dev/null 2>&1; then
  # MAALT 7/9: her stod `warn` + fortsaet. Konsekvensen var at 1.28.0 og 1.28.1 begge
  # gik paa npm mens registret blev staaende paa 1.25.0 - og scriptet sluttede GROENT.
  # En udgivelse der kun naaede tre af fire kanaler skal fejle, ikke advare.
  [[ "$SHIP" == 1 ]] && die "mcp-publisher not installed (brew install mcp-publisher) - registry would be left behind; use --skip-registry to accept that deliberately"
  warn "mcp-publisher not installed (brew install mcp-publisher) - registry NOT updated"
elif ! command -v gh >/dev/null 2>&1; then
  [[ "$SHIP" == 1 ]] && die "gh not installed - cannot mint a registry token; use --skip-registry to accept that deliberately"
  warn "gh not installed - cannot mint a registry token; registry NOT updated"
else
  REG_LIVE="$(curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.Agent360dk/browser-mcp" 2>/dev/null \
    | python3 -c "import json,sys;print(next((e['server']['version'] for e in json.load(sys.stdin).get('servers',[]) if e.get('_meta',{}).get('io.modelcontextprotocol.registry/official',{}).get('isLatest')),''))" 2>/dev/null || true)"
  if [[ "$REG_LIVE" == "$NEW_VERSION" ]]; then
    warn "registry already at v$NEW_VERSION - skipping (resumable re-run)"
  elif [[ "$SHIP" != 1 ]]; then
    say "would: gh auth token → exchange for registry JWT → mcp-publisher publish mcp-server/server.json"
    say "       (registry currently advertises '${REG_LIVE:-unknown}')"
  else
    say "registry advertises '${REG_LIVE:-unknown}' → publishing $NEW_VERSION"
    # The registry JWT lives ~5 min, so mint it immediately before publishing.
    # `gh auth token` carries read:org, which the exchange requires - a mcp-publisher
    # device-flow login does NOT get an effective read:org and yields a token scoped to
    # io.github.<user>/* only, which cannot publish under the org namespace.
    GH_TOK="$(gh auth token 2>/dev/null || true)"
    [[ -n "$GH_TOK" ]] || die "gh auth token empty - run 'gh auth login' (scope must include read:org)"
    REG_TOK="$(curl -s -X POST https://registry.modelcontextprotocol.io/v0/auth/github-at \
      -H 'Content-Type: application/json' -d "{\"github_token\":\"$GH_TOK\"}" 2>/dev/null \
      | python3 -c "import json,sys;print(json.load(sys.stdin).get('registry_token',''))" 2>/dev/null || true)"
    [[ -n "$REG_TOK" ]] || die "registry token exchange failed - the gh token needs read:org AND you must be an active Owner of the org"
    mkdir -p "$HOME/.config/mcp-publisher"
    REG_TOK="$REG_TOK" python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.config/mcp-publisher/token.json")
d = json.load(open(p)) if os.path.exists(p) else {"method": "github", "registry": "https://registry.modelcontextprotocol.io"}
d["token"] = os.environ["REG_TOK"]
json.dump(d, open(p, "w"))
os.chmod(p, 0o600)
PY
    ( cd "$REPO_ROOT/mcp-server" && mcp-publisher publish server.json ) \
      || die "registry publish failed - see the error above (description must be <=100 chars)"
    # Laes tilbage. Linjen herunder PAASTOD tidligere at registret var opdateret uden at
    # spoerge det om noget - praecis den slags paastand der lod 1.25.0 staa i tre udgivelser.
    #
    # MAALT 7/9 ved foerste koersel: registret indekserer IKKE med det samme. Med et fast
    # `sleep 3` afbroed gaten en udgivelse der var lykkedes - 1.29.0 stod i registret 6
    # sekunder senere med isLatest=true. En gate der raaber ulv er naesten lige saa slem
    # som en der tier. Derfor pollet, ikke ét kig.
    REG_EFTER=""
    for _forsoeg in $(seq 1 20); do
      sleep 3
      REG_EFTER="$(curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.Agent360dk/browser-mcp" 2>/dev/null \
        | python3 -c "import json,sys;print(next((e['server']['version'] for e in json.load(sys.stdin).get('servers',[]) if e.get('_meta',{}).get('io.modelcontextprotocol.registry/official',{}).get('isLatest')),''))" 2>/dev/null || true)"
      [[ "$REG_EFTER" == "$NEW_VERSION" ]] && break
    done
    [[ "$REG_EFTER" == "$NEW_VERSION" ]] \
      || die "registry still advertises '${REG_EFTER:-unknown}' 60s after publish - do NOT claim the release is out"
    ok "registry now advertises v$NEW_VERSION (laest tilbage)"
  fi
fi

# ── 5. refresh local install ──────────────────────────────────────────────────
step "6. Refresh local install (~/.browser-mcp/extension/)"
if [[ "$SKIP_LOCAL" == 1 ]]; then warn "skipped (--skip-local)"
else
  say "copy extension/ → ~/.browser-mcp/extension/"
  run rsync -a --delete --exclude='.DS_Store' extension/ "$HOME/.browser-mcp/extension/"

  # Chrome may load the extension from a DIFFERENT unpacked folder than ~/.browser-mcp/extension
  # - e.g. a ~/Downloads copy someone once picked with "Load unpacked". Refreshing only the
  # canonical path then silently leaves the running browser on the OLD build. That is exactly how
  # v1.24.0 went live on npm while the local Chrome kept running v1.23.0 without the macOS fix.
  # So: ask the browser itself which unpacked copies it has registered, and refresh those too.
  if command -v python3 >/dev/null 2>&1; then
    LOADED_COPIES="$(python3 - <<'PY' 2>/dev/null
import json, glob, os
seen = set()
for root in ("~/Library/Application Support/Google/Chrome",
             "~/Library/Application Support/Google/Chrome Canary",
             "~/Library/Application Support/BraveSoftware/Brave-Browser",
             "~/Library/Application Support/Microsoft Edge",
             "~/Library/Application Support/Arc/User Data",
             "~/.config/google-chrome", "~/.config/chromium"):
    for prefs in glob.glob(os.path.expanduser(root) + "/*/Secure Preferences"):
        try:
            d = json.load(open(prefs))
        except Exception:
            continue
        for v in d.get("extensions", {}).get("settings", {}).values():
            p = v.get("path") or ""
            if v.get("location") in (4, 10) and p.startswith("/") and "browser-mcp" in p.lower():
                if p not in seen:
                    seen.add(p)
                    print(p)
PY
)"
    while IFS= read -r loaded; do
      [[ -z "$loaded" || ! -d "$loaded" ]] && continue
      [[ "$loaded" == "$HOME/.browser-mcp/extension" ]] && continue
      # Never overwrite a rollback copy. Chrome can still have an old backup folder
      # registered as unpacked; refreshing it would destroy the very version you
      # would roll back TO.
      case "$loaded" in
        *.bak*|*backup*|*-old|*.old) warn "skipping backup copy: $loaded"; continue ;;
      esac
      warn "Chrome also loads an unpacked copy here - refreshing it too:"
      say  "  $loaded"
      run rsync -a --delete --exclude='.DS_Store' extension/ "$loaded/"
    done <<< "$LOADED_COPIES"
  fi

  warn "reload it: open chrome://extensions → Agent360 Browser MCP → ↻ reload"
fi

# ── done ──────────────────────────────────────────────────────────────────────
echo
if [[ "$SHIP" == 1 ]]; then
  ok "${B}Released v${NEW_VERSION}${Z} across all enabled channels."
  echo "   • npm: live next \`npx ...@latest\` run"
  echo "   • CWS: in review queue (1-3 days; email on approval)"
  echo "   • GitHub: tag + release pushed"
  echo "   • local: reload chrome://extensions to pick it up"
else
  echo "${Y}${B}Dry-run complete - nothing changed.${Z}"
  echo "Review the plan above, then run:  ${C}./runbrowsermcpupdate.sh ${NEW_VERSION} --ship${Z}"
fi
