#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# runbrowsermcpupdate.sh — one-command release for Agent360 Browser MCP
#
# Ships a single version across EVERY channel, in sync:
#   1. Version-bump  → extension/manifest.json, mcp-server/extension/manifest.json,
#                      mcp-server/package.json, mcp-server/server.json (×2 fields)
#   2. Sync          → extension/  →  mcp-server/extension/  (the npm-bundled copy)
#   3. README        → bump the download-zip link to the new version
#   4. npm           → npm publish (server + bundled extension)
#   4b. MCP registry → mcp-publisher publish (what MCP clients/directories discover)
#   5. Chrome Web Store → scripts/publish-cws.sh (review queue, 1-3 days)
#   6. GitHub        → commit, tag vX.Y.Z, push, gh release create + zip asset
#   7. Local install → refresh ~/.browser-mcp/extension/ (then reload chrome://extensions)
#
# SAFE BY DEFAULT: runs as a DRY-RUN unless you pass --ship.
#
# Usage:
#   ./runbrowsermcpupdate.sh 1.23.0            # dry-run: show the full plan, change nothing
#   ./runbrowsermcpupdate.sh 1.23.0 --ship     # execute the release
#
# Flags:
#   --ship            Actually do it (default is dry-run)
#   --skip-npm        Don't publish to npm (e.g. token expired — fix with `npm login`)
#   --skip-registry   Don't publish to the MCP registry (needs mcp-publisher + gh read:org)
#   --skip-cws        Don't publish to Chrome Web Store
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
SKIP_NPM=0; SKIP_CWS=0; SKIP_GITHUB=0; SKIP_LOCAL=0; SKIP_REGISTRY=0
CWS_DRAFT=0; ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --ship)        SHIP=1 ;;
    --skip-npm)    SKIP_NPM=1 ;;
    --skip-registry) SKIP_REGISTRY=1 ;;
    --skip-cws)    SKIP_CWS=1 ;;
    --skip-github) SKIP_GITHUB=1 ;;
    --skip-local)  SKIP_LOCAL=1 ;;
    --cws-draft)   CWS_DRAFT=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)            die "Unknown flag: $arg" ;;
    *)
      [[ -z "$NEW_VERSION" ]] || die "Version already set to '$NEW_VERSION' — unexpected arg '$arg'"
      NEW_VERSION="$arg" ;;
  esac
done

[[ -n "$NEW_VERSION" ]] || die "Usage: ./runbrowsermcpupdate.sh <X.Y.Z> [--ship]  (see --help)"
[[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Version '$NEW_VERSION' is not semver X.Y.Z"

# Load secrets ONCE, early + exported, so both the npm pre-flight and `npm publish`
# see NPM_TOKEN (.npmrc references ${NPM_TOKEN}) and the CWS step sees CWS_*. Both
# live in .env (gitignored). This is the single source of truth for publish auth.
if [[ -f .env ]]; then set -a; source .env; set +a; fi

MODE_LABEL="${Y}DRY-RUN${Z} (nothing will change — add --ship to execute)"
[[ "$SHIP" == 1 ]] && MODE_LABEL="${R}${B}SHIP${Z} (this WILL publish)"

# run-or-echo wrapper: in dry-run, print the command; with --ship, execute it
run() {
  if [[ "$SHIP" == 1 ]]; then "$@"; else echo "    ${C}would run:${Z} $*"; fi
}

echo
echo "${B}Browser MCP release — v${NEW_VERSION}${Z}    [$MODE_LABEL]"

# ── pre-flight ───────────────────────────────────────────────────────────────
step "Pre-flight checks"

for bin in node zip git; do command -v "$bin" >/dev/null || die "missing required tool: $bin"; done
ok "tools present: node, zip, git"

BRANCH="$(git branch --show-current)"
[[ "$BRANCH" == "main" ]] || die "on branch '$BRANCH' — releases ship from 'main'"
ok "on branch main"

# current versions (for monotonic check + reporting)
CUR_EXT="$(node -p "require('./extension/manifest.json').version")"
CUR_PKG="$(node -p "require('./mcp-server/package.json').version")"
NPM_LATEST="$(npm view @agent360/browser-mcp version 2>/dev/null || echo '0.0.0')"
say "current → extension:${CUR_EXT}  npm-package:${CUR_PKG}  npm-latest:${NPM_LATEST}"

# Monotonic check guards ONLY against npm-latest — the one irreversible channel.
# NOT the working-tree (a partial run may have bumped files) and NOT the git tag
# (a cross-channel resume legitimately re-runs a version whose tag/release already
# shipped but whose npm publish failed). The per-channel guards below (npm view,
# tag rev-parse, commit-diff, gh release view) make every other channel idempotent.
LATEST_TAG="$(git tag | sed 's/^v//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
HIGHEST="$(printf '%s\n%s\n' "$NPM_LATEST" "$NEW_VERSION" | sort -V | tail -1)"
{ [[ "$HIGHEST" == "$NEW_VERSION" && "$NEW_VERSION" != "$NPM_LATEST" ]]; } \
  || die "new version $NEW_VERSION must be greater than npm-latest ($NPM_LATEST)"
ok "version $NEW_VERSION > npm-latest $NPM_LATEST (tag:${LATEST_TAG:-none})"

# Every path this release touches/stages. Anything dirty OUTSIDE this set is a
# stray (likely another chat's WIP) and must not be swept into the release commit.
MANAGED=(
  extension
  mcp-server/extension
  mcp-server/package.json
  mcp-server/package-lock.json
  mcp-server/server.json
  mcp-server/README.md
  README.md
  docs/index.html
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

# channel auth pre-flight. In SHIP mode a broken channel aborts the whole run;
# in dry-run it's only a warning so you can still preview the full plan.
gate() { if [[ "$SHIP" == 1 ]]; then die "$1"; else warn "$1 ${Y}(dry-run: continuing)${Z}"; fi; }

if [[ "$SKIP_NPM" == 0 ]]; then
  if npm whoami >/dev/null 2>&1; then ok "npm authenticated as $(npm whoami)"
  else gate "npm not authenticated (E401) — run 'npm login', or pass --skip-npm"; fi
fi
if [[ "$SKIP_CWS" == 0 ]]; then
  if [[ ! -f .env ]]; then gate ".env missing (CWS secrets) — see docs/CWS_PUBLISH_SETUP.md, or --skip-cws"
  else
    # .env already sourced early (top of file); just verify the required vars.
    CWS_MISSING=""
    for v in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_EXTENSION_ID; do
      [[ -n "${!v:-}" ]] || CWS_MISSING="$CWS_MISSING $v"
    done
    if [[ -n "$CWS_MISSING" ]]; then gate "CWS secrets missing in .env:$CWS_MISSING — see docs/CWS_PUBLISH_SETUP.md"
    else ok "CWS secrets present in .env"; fi
  fi
fi
if [[ "$SKIP_GITHUB" == 0 ]]; then
  if ! command -v gh >/dev/null; then gate "gh CLI missing — install it, or pass --skip-github"
  elif ! gh auth status >/dev/null 2>&1; then gate "gh not authenticated — run 'gh auth login', or --skip-github"
  else ok "gh authenticated"; fi
fi
if [[ "$SKIP_REGISTRY" == 0 ]]; then
  # The registry rejects description > 100 chars with a 422. Catch it HERE — failing at the
  # registry step means npm is already published and the release is half-done, which is how
  # server.json sat un-publishable while the registry silently fell behind.
  SJ_DESC_LEN="$(python3 -c "import json;print(len(json.load(open('mcp-server/server.json')).get('description','')))" 2>/dev/null || echo 0)"
  if [[ "$SJ_DESC_LEN" == 0 ]]; then gate "mcp-server/server.json unreadable or has no description"
  elif (( SJ_DESC_LEN > 100 )); then gate "server.json description is ${SJ_DESC_LEN} chars — registry rejects >100; shorten it, or --skip-registry"
  else ok "server.json description ${SJ_DESC_LEN}/100 chars"; fi
fi

# tool-count: single source of truth = tools.js (don't hardcode — derive it)
TOOL_COUNT="$(grep -oE "name: ['\"]browser_[a-z_]+" mcp-server/tools.js | sort -u | wc -l | tr -d ' ')"

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
#     ALL — so a parse error can't leave the tree half-bumped at mixed versions.
#     NOTE: server.json's version IS bumped here for internal consistency, but the
#     MCP registry (registry.modelcontextprotocol.io) is NOT auto-published — that
#     channel is deferred. TODO: wire `mcp-publisher` (OIDC) as a 4th channel when
#     registry traffic justifies it; until then the bumped server.json just keeps
#     the repo coherent so the eventual first registry-publish is at the right ver.
JSON_FILES="extension/manifest.json mcp-server/extension/manifest.json mcp-server/package.json mcp-server/package-lock.json mcp-server/server.json"
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
TOOLCOUNT_FILES="README.md mcp-server/README.md extension/manifest.json mcp-server/extension/manifest.json mcp-server/server.json mcp-server/bin/cli.js docs/index.html"
say "sweep tool-count → '${TOOL_COUNT} tools' across: $TOOLCOUNT_FILES"
for f in $TOOLCOUNT_FILES; do
  [[ -f "$f" ]] || continue
  run perl -0pi -e "s/\b[0-9]+ browser tools\b/${TOOL_COUNT} browser tools/g; s/\b[0-9]+ tools\b/${TOOL_COUNT} tools/g" "$f"
done

# 1d-2. Homepage JSON-LD softwareVersion. This is the machine-readable version claim that
#       search engines and AI crawlers read — it is NOT covered by the tool-count sweep above,
#       so it silently advertised 1.23.0 while 1.24.0 was live on every other channel.
say "docs/index.html: JSON-LD softwareVersion → ${NEW_VERSION}"
run perl -0pi -e "s/(\"softwareVersion\":\s*\")[0-9]+\.[0-9]+\.[0-9]+(\")/\${1}${NEW_VERSION}\${2}/g" docs/index.html
if [[ "$SHIP" == 1 ]]; then
  grep -q "\"softwareVersion\": \"${NEW_VERSION}\"" docs/index.html \
    || die "docs/index.html softwareVersion did not update to ${NEW_VERSION} — JSON-LD format changed; fix the regex"
fi

# 1e. README download-zip link → new version, then verify the replace actually hit.
#     Must hit BOTH READMEs — mcp-server/README.md is the npm landing page, and it was
#     cp'd from README.md above BEFORE this bump, so it needs the bump too or it ships stale.
say "README: download-zip link → browser-mcp-v${NEW_VERSION}.zip (both copies)"
run perl -0pi -e "s/browser-mcp-v[0-9]+\.[0-9]+\.[0-9]+\.zip/browser-mcp-v${NEW_VERSION}.zip/g" README.md mcp-server/README.md
if [[ "$SHIP" == 1 ]]; then
  for f in README.md mcp-server/README.md; do
    grep -q "browser-mcp-v${NEW_VERSION}.zip" "$f" \
      || die "$f zip-link did not update to v${NEW_VERSION} — link format changed; fix the regex"
  done
fi

# ── 2. npm ────────────────────────────────────────────────────────────────────
step "2. npm publish"
if [[ "$SKIP_NPM" == 1 ]]; then warn "skipped (--skip-npm)"
else
  if [[ "$(npm view @agent360/browser-mcp@"$NEW_VERSION" version 2>/dev/null || true)" == "$NEW_VERSION" ]]; then
    warn "v$NEW_VERSION already on npm — skipping (resumable re-run)"
  else
    say "publishing @agent360/browser-mcp@$NEW_VERSION"
    # Pass the token EXPLICITLY on the CLI. npm run from mcp-server/ reads only
    # mcp-server/.npmrc + ~/.npmrc — NOT the repo-root .npmrc that references
    # ${NPM_TOKEN} — so without this it silently uses the stale ~/.npmrc token
    # and 404s. Requires NPM_TOKEN from .env (sourced at top).
    [[ -n "${NPM_TOKEN:-}" ]] || die "NPM_TOKEN missing in .env — needed for npm publish (Bypass-2FA token, see npmjs.com Access Tokens)"
    # \${NPM_TOKEN} stays literal in the outer shell (so dry-run echoes the var name,
    # not the secret) and is expanded by the inner bash -c from the exported env.
    run bash -c "cd '$REPO_ROOT/mcp-server' && npm publish --access public '--//registry.npmjs.org/:_authToken=\${NPM_TOKEN}'"
  fi
fi

# ── 2b. MCP registry ──────────────────────────────────────────────────────────
# The MCP registry is what clients and directories read to discover the server. It was NOT
# wired into this script, so every release left it behind — it sat 3 months on v1.16.1 once,
# and v1.24.0 shipped to npm while the registry still advertised v1.23.0. Runs after npm
# because the registry entry points at the published npm package.
step "2b. MCP registry publish"
if [[ "$SKIP_REGISTRY" == 1 ]]; then warn "skipped (--skip-registry)"
elif ! command -v mcp-publisher >/dev/null 2>&1; then
  warn "mcp-publisher not installed (brew install mcp-publisher) — registry NOT updated"
elif ! command -v gh >/dev/null 2>&1; then
  warn "gh not installed — cannot mint a registry token; registry NOT updated"
else
  REG_LIVE="$(curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.Agent360dk/browser-mcp" 2>/dev/null \
    | python3 -c "import json,sys;print(next((e['server']['version'] for e in json.load(sys.stdin).get('servers',[]) if e.get('_meta',{}).get('io.modelcontextprotocol.registry/official',{}).get('isLatest')),''))" 2>/dev/null || true)"
  if [[ "$REG_LIVE" == "$NEW_VERSION" ]]; then
    warn "registry already at v$NEW_VERSION — skipping (resumable re-run)"
  elif [[ "$SHIP" != 1 ]]; then
    say "would: gh auth token → exchange for registry JWT → mcp-publisher publish mcp-server/server.json"
    say "       (registry currently advertises '${REG_LIVE:-unknown}')"
  else
    say "registry advertises '${REG_LIVE:-unknown}' → publishing $NEW_VERSION"
    # The registry JWT lives ~5 min, so mint it immediately before publishing.
    # `gh auth token` carries read:org, which the exchange requires — a mcp-publisher
    # device-flow login does NOT get an effective read:org and yields a token scoped to
    # io.github.<user>/* only, which cannot publish under the org namespace.
    GH_TOK="$(gh auth token 2>/dev/null || true)"
    [[ -n "$GH_TOK" ]] || die "gh auth token empty — run 'gh auth login' (scope must include read:org)"
    REG_TOK="$(curl -s -X POST https://registry.modelcontextprotocol.io/v0/auth/github-at \
      -H 'Content-Type: application/json' -d "{\"github_token\":\"$GH_TOK\"}" 2>/dev/null \
      | python3 -c "import json,sys;print(json.load(sys.stdin).get('registry_token',''))" 2>/dev/null || true)"
    [[ -n "$REG_TOK" ]] || die "registry token exchange failed — the gh token needs read:org AND you must be an active Owner of the org"
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
      || die "registry publish failed — see the error above (description must be <=100 chars)"
    ok "registry now advertises v$NEW_VERSION"
  fi
fi

# ── 3. Chrome Web Store ───────────────────────────────────────────────────────
step "3. Chrome Web Store publish"
if [[ "$SKIP_CWS" == 1 ]]; then warn "skipped (--skip-cws)"
else
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
  run git add extension mcp-server/extension mcp-server/package.json mcp-server/package-lock.json \
              mcp-server/server.json mcp-server/README.md README.md docs/index.html

  # commit only if something is staged — a resumed run (already committed) must
  # NOT abort here under set -e and strand the tag/push/release that follow.
  if [[ "$SHIP" == 1 ]]; then
    if git diff --cached --quiet; then
      warn "nothing staged (resumed run) — skipping commit"
    else
      git commit -m "release: v${NEW_VERSION} — npm + Chrome Web Store + GitHub"
    fi
  else
    echo "    ${C}would run:${Z} git commit -m \"release: v${NEW_VERSION} …\" (if anything staged)"
  fi

  if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    warn "tag v${NEW_VERSION} already exists — skipping tag"
  else
    run git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"   # annotated, so it pushes
  fi
  # push branch, then the tag EXPLICITLY. (--follow-tags silently skips lightweight
  # tags and even annotated ones can be missed on resume; explicit push is robust
  # and idempotent — an already-pushed tag just reports up-to-date.)
  run git push origin main
  run git push origin "v${NEW_VERSION}"

  ZIP="/tmp/agent360-browser-mcp-${NEW_VERSION}.zip"
  say "build release zip for GitHub asset: $ZIP"
  run bash -c "rm -f '$ZIP'; cd '$REPO_ROOT/extension' && zip -qr '$ZIP' . -x '*.DS_Store'"
  if gh release view "v${NEW_VERSION}" >/dev/null 2>&1; then
    warn "release v${NEW_VERSION} exists — uploading asset with --clobber"
    run gh release upload "v${NEW_VERSION}" "$ZIP" --clobber
  else
    run gh release create "v${NEW_VERSION}" "$ZIP" \
      --title "v${NEW_VERSION} — Chrome extension + MCP server" \
      --notes "Browser MCP v${NEW_VERSION}. Install: \`npx @agent360/browser-mcp install\` or load the attached zip unpacked."
  fi
fi

# ── 5. refresh local install ──────────────────────────────────────────────────
step "5. Refresh local install (~/.browser-mcp/extension/)"
if [[ "$SKIP_LOCAL" == 1 ]]; then warn "skipped (--skip-local)"
else
  say "copy extension/ → ~/.browser-mcp/extension/"
  run rsync -a --delete --exclude='.DS_Store' extension/ "$HOME/.browser-mcp/extension/"

  # Chrome may load the extension from a DIFFERENT unpacked folder than ~/.browser-mcp/extension
  # — e.g. a ~/Downloads copy someone once picked with "Load unpacked". Refreshing only the
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
      warn "Chrome also loads an unpacked copy here — refreshing it too:"
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
  echo "${Y}${B}Dry-run complete — nothing changed.${Z}"
  echo "Review the plan above, then run:  ${C}./runbrowsermcpupdate.sh ${NEW_VERSION} --ship${Z}"
fi
