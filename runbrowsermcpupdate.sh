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
SKIP_NPM=0; SKIP_CWS=0; SKIP_GITHUB=0; SKIP_LOCAL=0
CWS_DRAFT=0; ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --ship)        SHIP=1 ;;
    --skip-npm)    SKIP_NPM=1 ;;
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

# new must be strictly greater than the highest known published/local version
PRIOR_MAX="$(printf '%s\n%s\n%s\n' "$CUR_EXT" "$CUR_PKG" "$NPM_LATEST" | sort -V | tail -1)"
HIGHEST="$(printf '%s\n%s\n' "$PRIOR_MAX" "$NEW_VERSION" | sort -V | tail -1)"
{ [[ "$HIGHEST" == "$NEW_VERSION" && "$NEW_VERSION" != "$PRIOR_MAX" ]]; } \
  || die "new version $NEW_VERSION must be greater than current max ($PRIOR_MAX)"
[[ "$NEW_VERSION" != "$NPM_LATEST" ]] || die "version $NEW_VERSION already published to npm"
ok "version $NEW_VERSION > prior max $PRIOR_MAX"

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

# 1e. README download-zip link → new version, then verify the replace actually hit.
say "README: download-zip link → browser-mcp-v${NEW_VERSION}.zip"
run perl -0pi -e "s/browser-mcp-v[0-9]+\.[0-9]+\.[0-9]+\.zip/browser-mcp-v${NEW_VERSION}.zip/g" README.md
if [[ "$SHIP" == 1 ]]; then
  grep -q "browser-mcp-v${NEW_VERSION}.zip" README.md \
    || die "README zip-link did not update to v${NEW_VERSION} — link format changed; fix the regex"
fi

# ── 2. npm ────────────────────────────────────────────────────────────────────
step "2. npm publish"
if [[ "$SKIP_NPM" == 1 ]]; then warn "skipped (--skip-npm)"
else
  if [[ "$(npm view @agent360/browser-mcp@"$NEW_VERSION" version 2>/dev/null || true)" == "$NEW_VERSION" ]]; then
    warn "v$NEW_VERSION already on npm — skipping (resumable re-run)"
  else
    say "publishing @agent360/browser-mcp@$NEW_VERSION"
    run bash -c "cd '$REPO_ROOT/mcp-server' && npm publish --access public"
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
    run git tag "v${NEW_VERSION}"
  fi
  # push branch + tag together; --follow-tags is idempotent (up-to-date → exit 0).
  run git push origin main --follow-tags

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
