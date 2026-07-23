#!/usr/bin/env python3
"""Monthly dominans-audit for Browser MCP by Agent360 — model-free, read-only.

Runs in GitHub Actions on a schedule (see .github/workflows/dominans-audit.yml).
No AI, no external dependencies (urllib only) — deterministic API checks, so it is
universal: it does not depend on any AI model or vendor, and it fires on GitHub's
own infrastructure regardless of any machine being on.

Exits non-zero on any 🔴 finding (drift / regression / twin-resurrection) so the
workflow fails and GitHub emails the repo owner. Full report goes to the job summary.

Baseline captured 2026-07-21:
  registry v1.23.0 · npm 1.23.0 · 34 tools · mcpservers.org live · punkpeye PR #10565 open
  browsermcp.io (the dead twin) last commit 2025-04-24 — if it moves, our compare pages lie.
"""
import json, os, re, sys, time, urllib.request, urllib.error

BASE_HEADERS = {"User-Agent": "browsermcp-dominans-audit"}
GH_TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")

def fetch(url, as_json=False, timeout=25, retries=2):
    # Retries on transient failures (timeout, connection reset, 429/5xx) so one flaky
    # response from a third-party listing site does not become a false 🔴 regression.
    headers = dict(BASE_HEADERS)
    if GH_TOKEN and "api.github.com" in url:
        headers["Authorization"] = "Bearer " + GH_TOKEN
    last = (None, None)
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout) as r:
                body = r.read().decode("utf-8", "replace")
                return (json.loads(body) if as_json else body), r.status
        except urllib.error.HTTPError as e:
            last = (None, e.code)
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 * (attempt + 1)); continue
            return None, e.code
        except Exception as e:
            last = (None, "ERR:%s" % e)
            if attempt < retries:
                time.sleep(2 * (attempt + 1)); continue
    return last

red, green, rows = [], [], []

# ---- DEL 1 — DRIFT (the reason this job exists) ----
npm, _ = fetch("https://registry.npmjs.org/@agent360%2Fbrowser-mcp", True)
npm_latest = npm["dist-tags"]["latest"] if npm and "dist-tags" in npm else "?"

reg, _ = fetch("https://registry.modelcontextprotocol.io/v0/servers?search=agent360", True)
reg_ver, reg_desc = "?", ""
if reg and reg.get("servers"):
    # the search returns every published version (old ones first); pick the one the
    # registry marks isLatest — NOT servers[0], which is the stale historical entry.
    latest = next((s for s in reg["servers"]
                   if s.get("_meta", {}).get("io.modelcontextprotocol.registry/official", {}).get("isLatest")),
                  reg["servers"][0])
    srv = latest.get("server", {})
    reg_ver = srv.get("version", "?")
    reg_desc = srv.get("description", "")

tjs, _ = fetch("https://raw.githubusercontent.com/Agent360dk/browser-mcp/main/mcp-server/tools.js")
tools = len(re.findall(r"""name: ['\"]browser_""", tjs)) if tjs else "?"

if npm_latest != "?" and reg_ver not in ("?", npm_latest):
    red.append("DRIFT: MCP-registry viser %s, npm er %s (registry hang 3 mdr sidst — republish)" % (reg_ver, npm_latest))
    rows.append(("Registry vs. npm", "🔴", "registry %s ≠ npm %s" % (reg_ver, npm_latest)))
else:
    rows.append(("Registry vs. npm", "🟢" if reg_ver == npm_latest else "⚪", "registry %s / npm %s" % (reg_ver, npm_latest)))

if tools != "?" and str(tools) not in (reg_desc or ""):
    red.append("Registry-beskrivelsen nævner ikke %s tools" % tools)
    rows.append(("Tool-count i registry", "🔴", "%s tools, ikke nævnt i desc" % tools))
else:
    rows.append(("Tool-count", "🟢" if tools == 34 else "⚪", "%s tools" % tools))

# ---- DEL 2 — KATALOG-TILSTEDEVÆRELSE (content-based, ikke bare HTTP-status) ----
def listed(url, needles=("agent360", "browser-mcp")):
    body, code = fetch(url)
    if not body:
        return None, "HTTP %s" % code  # couldn't fetch after retries — UNKNOWN, not a delisting
    low = body.lower()
    ok = any(n in low for n in needles) and "404:" not in body and "not found or removed" not in low
    return ok, "HTTP %s" % code

for name, url, was_live in [
    ("mcpservers.org", "https://mcpservers.org/servers/agent360dk/browser-mcp", True),
    ("Glama",          "https://glama.ai/mcp/servers/Agent360dk/browser-mcp",    False),
    ("Smithery",       "https://smithery.ai/server/@Agent360dk/browser-mcp",     False),
]:
    is_listed, detail = listed(url)
    if is_listed is None:
        # transient fetch failure — report but do NOT escalate to a 🔴 regression
        rows.append((name, "⚠", detail + " — kunne ikke tjekke (transient)"))
    elif was_live and not is_listed:
        red.append("%s-listing VÆK (var live 21/7) — regression" % name)
        rows.append((name, "🔴", detail + " — regression"))
    elif not was_live and is_listed:
        green.append("%s lister os nu" % name)
        rows.append((name, "🟢", detail + " — NY optagelse"))
    else:
        rows.append((name, "✓" if is_listed else "·", detail))

pk, _ = fetch("https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md")
if pk and "Agent360dk" in pk:
    green.append("punkpeye/awesome-mcp-servers (91k★): merget")
    rows.append(("punkpeye awesome (91k★)", "🟢", "merget"))
else:
    rows.append(("punkpeye awesome (91k★)", "·", "PR #10565 ikke merget endnu"))

# ---- DEL 3 — KONKURRENT-FAKTA (dateret; twin-resurrection er kritisk) ----
competitors = [
    ("microsoft/playwright-mcp",            "@playwright%2Fmcp"),
    ("ChromeDevTools/chrome-devtools-mcp",  "chrome-devtools-mcp"),
    ("browser-use/browser-use",             None),
    ("BrowserMCP/mcp",                       "@browsermcp%2Fmcp"),
    ("hangwin/mcp-chrome",                   None),
    ("Agent360dk/browser-mcp",               "@agent360%2Fbrowser-mcp"),
]
comp_rows = []
for repo, pkg in competitors:
    gh, _ = fetch("https://api.github.com/repos/%s" % repo, True)
    stars = gh.get("stargazers_count", "?") if gh else "?"
    commits, _ = fetch("https://api.github.com/repos/%s/commits?per_page=1" % repo, True)
    last = commits[0]["commit"]["committer"]["date"][:10] if commits else "?"
    dl = "?"
    if pkg:
        d, _ = fetch("https://api.npmjs.org/downloads/point/last-week/%s" % pkg, True)
        dl = d.get("downloads", "?") if d else "?"
    comp_rows.append((repo, stars, last, dl))
    if repo == "BrowserMCP/mcp" and last != "?" and last > "2025-04-24":
        red.append("⚠️ browsermcp.io GENOPSTOD: commit %s (nyere end 2025-04-24) → "
                    "vores compare-siders «actively maintained»-vinkel er nu FALSK — opdatér STRAKS" % last)

# ---- REPORT ----
def build():
    o = ["# 🛰 browsermcp — månedlig dominans-audit\n"]
    if red:
        o.append("## 🔴 Handling påkrævet")
        o += ["- " + r for r in red]
    else:
        o.append("## ✅ Ingen drift eller regression — alt stabilt")
    if green:
        o.append("\n## 🟢 Nye optagelser siden sidst")
        o += ["- " + g for g in green]
    o.append("\n## Kanal-status\n")
    o.append("| Kanal | Status | Detalje |")
    o.append("|---|---|---|")
    o += ["| %s | %s | %s |" % r for r in rows]
    o.append("\n## Konkurrent-fakta (hentet denne kørsel)\n")
    o.append("| Projekt | Stars | Sidste commit | npm/uge |")
    o.append("|---|---|---|---|")
    o += ["| %s | %s | %s | %s |" % r for r in comp_rows]
    o.append("\n---\n⚠️ **Husk det manuelle 16-prompt AI-citations-panel** (Perplexity / ChatGPT / "
             "Claude / Copilot) — kræver login, kan ikke køre headless. Baseline 21/7: 0/2 nævnt, "
             "mcp-chrome vandt USP-prompten, Perplexity kaldte fejlagtigt browsermcp.io vedligeholdt. "
             "Tjek om compare-siderne har flyttet det.")
    return "\n".join(o)

report = build()
print(report)
step_summary = os.environ.get("GITHUB_STEP_SUMMARY")
if step_summary:
    with open(step_summary, "a") as f:
        f.write(report + "\n")

sys.exit(1 if red else 0)
