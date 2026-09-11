#!/usr/bin/env python3
"""Monthly dominans-audit for Browser MCP by Agent360 — model-free, read-only.

Runs in GitHub Actions on a schedule (see .github/workflows/dominans-audit.yml).
No AI, no external dependencies (urllib only) — deterministic API checks, so it is
universal: it does not depend on any AI model or vendor, and it fires on GitHub's
own infrastructure regardless of any machine being on.

Exits non-zero on any 🔴 finding (drift / regression / twin-resurrection) so the
workflow fails and GitHub emails the repo owner. Full report goes to the job summary.

Baseline captured 2026-07-21:
  registry v1.23.0 · npm 1.23.0 · 40 tools · mcpservers.org live · punkpeye PR #10565 open
  browsermcp.io (the dead twin) last commit 2025-04-24 — if it moves, our compare pages lie.
"""
import json, os, re, sys, time, urllib.request, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from katalog_tal import katalog_fejl

# MAALT 7/9-2026: med en egen User-Agent svarer Cloudflare 403 paa mcpservers.org og
# mcp.so. Tjekket rapporterede derfor "⚠ transient" ved HVER koersel siden det blev
# skrevet — det kunne hverken bekraefte eller afkraefte noget. En vagt der aldrig kan
# sige nej er ikke en vagt. En almindelig browser-UA slipper igennem.
BASE_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/140.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
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
# Sessionstallet laeses paa samme maade fra kilden: portintervallet i index.js (9876-9895 = 20 sessioner).
idx, _ = fetch("https://raw.githubusercontent.com/Agent360dk/browser-mcp/main/mcp-server/index.js")
_porte = re.search(r"BASE_PORT\)\s*\|\|\s*(\d+).*?MAX_PORT\)\s*\|\|\s*(\d+)", idx or "", re.S)
sessioner = int(_porte.group(2)) - int(_porte.group(1)) + 1 if _porte else None

if npm_latest != "?" and reg_ver not in ("?", npm_latest):
    red.append("DRIFT: MCP-registry viser %s, npm er %s (registry hang 3 mdr sidst — republish)" % (reg_ver, npm_latest))
    rows.append(("Registry vs. npm", "🔴", "registry %s ≠ npm %s" % (reg_ver, npm_latest)))
else:
    rows.append(("Registry vs. npm", "🟢" if reg_ver == npm_latest else "⚪", "registry %s / npm %s" % (reg_ver, npm_latest)))

if tools != "?" and str(tools) not in (reg_desc or ""):
    red.append("Registry-beskrivelsen nævner ikke %s tools" % tools)
    rows.append(("Tool-count i registry", "🔴", "%s tools, ikke nævnt i desc" % tools))
else:
    # Tallet laeses allerede af tools.js paa linje 63 — sammenlign ikke med en
    # haardkodet konstant. MAALT 22/8: den stod paa 34, saa dashboardet viste ⚪
    # for evigt uanset hvad der faktisk stod i registryet.
    rows.append(("Tool-count", "🟢" if tools != "?" else "⚪", "%s tools" % tools))

# ---- DEL 2 — KATALOG-TILSTEDEVÆRELSE (content-based, ikke bare HTTP-status) ----
def listed(url, needles=("agent360", "browser-mcp")):
    body, code = fetch(url)
    if not body:
        return None, "HTTP %s" % code, None  # couldn't fetch after retries — UNKNOWN, not a delisting
    low = body.lower()
    ok = any(n in low for n in needles) and "404:" not in body and "not found or removed" not in low
    return ok, "HTTP %s" % code, body

sider = {}
for name, url, was_live in [
    # PulseMCP tilfoejet 7/9: den eneste kanal hvor vi kan se et faktisk trafiktal.
    ("PulseMCP",       "https://www.pulsemcp.com/servers/agent360dk-browser",    True),
    ("mcpservers.org", "https://mcpservers.org/servers/agent360dk/browser-mcp", True),
    ("Glama",          "https://glama.ai/mcp/servers/Agent360dk/browser-mcp",    False),
    ("Smithery",       "https://smithery.ai/server/@Agent360dk/browser-mcp",     False),
]:
    is_listed, detail, sider[name] = listed(url)
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

# ---- Chrome Web Store: brugertal OG ratings ----
# Tilfoejet 7/9-2026. Ratings er butikkens EGEN rangeringsfaktor, og vi stod paa
# 0 anmeldelser mod tvillingens 717 — det er den storste enkeltforskel i synlighed,
# og den blev ikke maalt af noget. Brugertallet alene siger intet om placeringen.
import re as _re
CWS_ID = "jdehgalffmffhfhmmhaokfbfnafnmgcl"
cws, _ = fetch("https://chromewebstore.google.com/detail/agent360-browser-mcp/" + CWS_ID)
if cws:
    _brugere = _re.search(r"([\d.,]+)\s*(?:users|brugere)", cws)
    _rating  = _re.search(r"([0-9][.,][0-9])\s*(?:out of 5|af 5|\u2605)", cws)
    _antal   = _re.search(r"([\d.,]+)\s*(?:ratings|reviews|anmeldelser)", cws)
    _dele = []
    if _brugere: _dele.append(_brugere.group(1) + " brugere")
    # Stjerne-tallet vises KUN naar der faktisk er anmeldelser bag det. Uden den regel
    # hentede regexen 7/9 et 4,8 fra en anden udvidelse paa siden og satte det paa en
    # listing med nul anmeldelser — praecis den slags tal en vagt aldrig maa opfinde.
    if _antal:
        _dele.append((_rating.group(1) + "\u2605") if _rating else "ingen rating")
        _dele.append(_antal.group(1) + " anmeldelser")
    else:
        _dele.append("0 anmeldelser")
    _txt = " \u00b7 ".join(_dele)
    if not _antal:
        # Ikke en fejl — men det er det billigste synligheds-hul der findes, og det
        # skal staa i rapporten hver maaned indtil det er lukket.
        rows.append(("Chrome Web Store", "\u26a0", _txt + " \u2014 ratings er butikkens rangeringsfaktor"))
    else:
        rows.append(("Chrome Web Store", "\u2713", _txt))
else:
    rows.append(("Chrome Web Store", "\u26a0", "kunne ikke laeses"))

pk, _ = fetch("https://raw.githubusercontent.com/punkpeye/awesome-mcp-servers/main/README.md")
if pk and "Agent360dk" in pk:
    green.append("punkpeye/awesome-mcp-servers (91k★): merget")
    rows.append(("punkpeye awesome (91k★)", "🟢", "merget"))
else:
    rows.append(("punkpeye awesome (91k★)", "·", "PR #10565 ikke merget endnu"))

# ---- DEL 2c — HVAD KATALOGERNE SIGER OM OS ----
# MAALT 11/9-2026: mcp.so viste "34 tools" og "MIT, local-only", og punkpeye viste "34 tools, up to 10 concurrent
# sessions" - i to maaneder, fordi tjekket ovenfor kun ser om navnet staar der. Kun tekst der med sikkerhed er vores
# laeses: meta-beskrivelsen (resten af en katalogside kan omtale andre servere) og vores egen linje hos punkpeye.
# Fund er ⚠, ikke 🔴: teksten ligger hos andre og kan ikke rettes med et push.
def _meta(html):
    fundne = re.findall(r'<meta[^>]+(?:name|property)="(?:description|og:description)"[^>]+content="([^"]*)"', html or "")
    return " ".join(dict.fromkeys(fundne))

_facit_tools = tools if tools != "?" else None
_mcpso, _ = fetch("https://mcp.so/servers/browser-mcp-agent360dk")
_pk_linje = "\n".join(l for l in (pk or "").splitlines() if "Agent360dk" in l)
for navn, tekst, fund in [
    ("mcp.so-beskrivelsen", _meta(_mcpso), katalog_fejl(_meta(_mcpso), _facit_tools, sessioner)),
    ("punkpeye-linjen", _pk_linje, katalog_fejl(_pk_linje, _facit_tools, sessioner)),
    ("PulseMCP-beskrivelsen", _meta(sider.get("PulseMCP")), katalog_fejl(_meta(sider.get("PulseMCP")), _facit_tools, sessioner)),
]:
    if not tekst:
        rows.append((navn, "⚠", "ingen tekst at tjekke (siden kunne ikke laeses)"))
    elif fund:
        rows.append((navn, "⚠", "forkert om os: " + "; ".join(fund)))
    else:
        rows.append((navn, "✓", "ingen forkerte tal eller løfter"))

# ---- DEL 1b — TOOL-TALLET DRIFTER TRE STEDER, IKKE ÉT ----
# MAALT 9/9-2026: butikken sagde 29, MCP-registret sagde 34, og GitHub-repoets egen
# beskrivelse sagde ogsaa 34 — mens tools.js sagde 40. Tallet staar fire steder og
# vedligeholdes ét sted. Vagten tjekkede kun registret, saa de to andre kunne drifte
# i det uendelige. Nu tjekkes de sammen.
gh_desc = ""
gh_meta = fetch("https://api.github.com/repos/Agent360dk/browser-mcp", as_json=True)[0]
if isinstance(gh_meta, dict):
    gh_desc = gh_meta.get("description") or ""
if tools != "?" and gh_desc and str(tools) not in gh_desc:
    gammelt = re.search(r"(\d+)\s+tools", gh_desc)
    red.append("GitHub-beskrivelsen siger %s, ikke %s tools" %
               (gammelt.group(1) if gammelt else "et andet tal", tools))
    rows.append(("Tool-count paa GitHub", "🔴", "%s tools, ikke naevnt i repo-desc" % tools))
elif gh_desc:
    rows.append(("Tool-count paa GitHub", "🟢", "%s tools" % tools))

# ---- DEL 2b — SØGEPLACERING I BUTIKKEN ----
# MAALT 9/9-2026: butikkens sogeside svarer paa en almindelig browser-UA, og resultatlisten
# staar i den raa HTML som /detail/<slug>/<id> i raekkefolge. Vi har altsaa aldrig behovet
# en headless browser til det her — vi havde bare aldrig maalt.
#
# Baseline 9/9: "browser mcp" = #3 af 9 · "mcp" = ikke til stede.
# Google rangerer paa bedommelser + installationer minus afinstallationer over tid, saa
# placeringen er den eneste udadvendte maalestok vi har paa om noget af arbejdet virker.
VORES_ID = "jdehgalffmffhfhmmhaokfbfnafnmgcl"
SOEGEORD = [
    "browser mcp", "mcp", "chrome mcp", "claude chrome",
    "mcp server", "browser automation", "ai browser control", "logged in chrome",
]
BASELINE_PLADS = {"browser mcp": 3}   # kun ord vi FAKTISK stod paa; resten var ikke i top 9

placeringer = []
for ord_ in SOEGEORD:
    body, code = fetch("https://chromewebstore.google.com/search/" + ord_.replace(" ", "%20"))
    if not body:
        placeringer.append((ord_, "?", "HTTP %s — kunne ikke hentes" % code))
        continue
    fundne, set_ = re.findall(r"/detail/[a-z0-9-]+/([a-p]{32})", body), []
    for i in fundne:
        if i not in set_:
            set_.append(i)
    if not set_:
        # Ingen resultater overhovedet = siden svarede, men uden liste. Det er UKENDT,
        # ikke "vi er faldet ud" — samme skel som katalog-tjekket ovenfor.
        placeringer.append((ord_, "?", "siden svarede uden resultatliste"))
        continue
    plads = set_.index(VORES_ID) + 1 if VORES_ID in set_ else None
    grund = BASELINE_PLADS.get(ord_)
    if plads is None:
        placeringer.append((ord_, "—", "ikke i de %d viste" % len(set_)))
        if grund:
            red.append("Faldet ud af soegningen paa '%s' (var #%d)" % (ord_, grund))
    else:
        pil = ""
        if grund and plads > grund:
            pil = " ↓ fra #%d" % grund
            red.append("Placering faldet paa '%s': #%d → #%d" % (ord_, grund, plads))
        elif grund and plads < grund:
            pil = " ↑ fra #%d" % grund
            green.append("Placering steget paa '%s': #%d → #%d" % (ord_, grund, plads))
        placeringer.append((ord_, "#%d" % plads, "af %d viste%s" % (len(set_), pil)))

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
    o.append("\n## Søgeplacering i Chrome Web Store\n")
    o.append("| Søgeord | Plads | Detalje |")
    o.append("|---|---|---|")
    o += ["| %s | %s | %s |" % r for r in placeringer]
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
