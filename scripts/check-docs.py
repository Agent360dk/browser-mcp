#!/usr/bin/env python3
"""Docs-site gate for browsermcp.dev - run locally or in CI (stdlib only).

Checks the COMMITTED site files (docs/) against the sources of truth:
  1. tool count   - every "N browser tools" claim equals the count in mcp-server/tools.js
  2. leak markers - editorial/drafting notes must never appear in rendered HTML
  3. links        - every internal href/src resolves to a file in docs/
  4. head meta    - canonical/og/twitter/description present + correct on generated pages
  5. sitemap      - every generated page is listed; every sitemap URL resolves locally

The companion check (regen-diff: generator output == committed HTML) runs as its
own CI step: `python3 scripts/generate-docs.py && git diff --exit-code -- docs/`.
Exit code 0 = all green; 1 = failures (printed).
"""
import os, re, sys, glob

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DOCS = os.path.join(ROOT, 'docs')
fails = []

def fail(msg): fails.append(msg)

# Generated pages = the PAGES registry in generate-docs.py (parse it, single source of truth)
gen_src = open(os.path.join(ROOT, 'scripts', 'generate-docs.py')).read()
GEN_URLS = re.findall(r"'(/(?:docs|compare|use-cases|learn)/[a-z0-9-]+)'\)", gen_src)
if len(GEN_URLS) < 5:
    fail('could not parse PAGES registry from generate-docs.py (found %d urls)' % len(GEN_URLS))

# ---- 1. tool count ----------------------------------------------------------
TOOLCOUNT = len(re.findall(r"""name: ['\"]browser_""", open(os.path.join(ROOT, 'mcp-server', 'tools.js')).read()))
claim_files = glob.glob(DOCS + '/**/*.html', recursive=True) + \
              glob.glob(os.path.join(ROOT, 'content', '*.md')) + [os.path.join(ROOT, 'README.md')]
claim_files = [f for f in claim_files if os.path.isfile(f)]
# MAALT 21/8: moenstret var kun "N browser tools". Formen "N tools" - som er den
# der bruges paa naesten hver side - slap forbi, saa 45 paastande om "40 tools"
# stod paa sitet mens gaten meldte alt groent. Baade "N tools" og "N tool
# definitions" taelles nu med.
TOOL_CLAIM = re.compile(r'(\d+)\s+(?:browser\s+)?tools?\b')
# MAALT 9/9: moenstret ovenfor kraever ordet "tools" LIGE efter tallet. Fire udgivne sider
# slap forbi med "We document 34.", "34 of them" og "41 tools" i en tabelcelle - mens gaten
# meldte groent. Formerne herunder er dem der faktisk blev brugt. En vagt der kun kender én
# formulering, vogter én formulering.
TOOL_CLAIM_EKSTRA = [
    re.compile(r'[Ww]e document (\d+)\b'),
    re.compile(r'(\d+) of them\b'),
    # Kun en raekke der HANDLER om vaerktoejer. Foerste udgave matchede enhver sidste
    # tabelcelle og roedmarkerede stjerner, downloads og issue-tal. En vagt der raaber ulv
    # paa noget lovligt, bliver slaaet fra - saa den er snaevret ind til raekkens emne.
    re.compile(r'^\|\s*Tools?\s*\|.*\|\s*(\d+)\s*\|\s*$', re.I),
]
# MAALT 9/9: forsidens tal stod i en tabel hvor etiketten "Tool count" er paa ÉN linje og
# tallet paa den naeste. Ingen linje-baseret vagt kan se det, saa raekken tjekkes for sig.
TOOLCOUNT_RAEKKE = re.compile(r'Tool count', re.I)
# Overskrifter undtages. Vaerktoejssiden grupperer efter kategori - "Interaction - 14
# tools" er et AFSNITS-tal og skal ikke vaere lig totalen. Alt andet er en paastand om
# hvor mange vaerktoejer produktet har, og den skal passe.
HEADING = re.compile(r'^\s{0,3}#{1,6}\s|<h[1-6][^>]*>', re.I)
# Sammenlignings-sider naevner ANDRE produkters tal - Playwright MCP har 69
# vaerktoejer, Chrome DevTools MCP har 52. De tal er rigtige og skal ikke rettes til
# vores. En paastand springes over hvis linjen ELLER den naermeste overskrift over den
# naevner et andet produkt. Kommer der en ny konkurrent til, fejler gaten én gang og
# navnet tilfoejes her - stoejende frem for tavst forkert.
ANDRE = re.compile(r'playwright|chrome devtools mcp|mcp-chrome|browsermcp\.io|puppeteer|selenium', re.I)
# MAALT 9/9: at springe HELE linjen over var det andet hul. En sammenligningsraekke
# indeholder BEGGE tal - "| Tools | 69 documented | 34 |" - saa undtagelsen beskyttede
# praecis det sted hvor vores eget forkerte tal stod. Nu springes kun de tal over der er
# verificeret som andres. Kommer der et nyt, fejler gaten én gang og tallet skrives her.
KONKURRENT_TAL = {
    69,   # microsoft/playwright-mcp, verificeret 2026-08-19
    52,   # ChromeDevTools/chrome-devtools-mcp
    19,   # yolo-chrome-mcp (SeedX), verificeret 2026-09-08
    29,   # chrome-devtools-mcp's egen "29 tools"-formulering i deres README
}
for f in claim_files:
    naermeste_overskrift = ''
    linjer = open(f, encoding='utf-8').read().split('\n')
    for nr, linje in enumerate(linjer):
        if HEADING.search(linje):
            naermeste_overskrift = linje
            continue
        andres = ANDRE.search(linje) or ANDRE.search(naermeste_overskrift)
        for moenster in [TOOL_CLAIM] + TOOL_CLAIM_EKSTRA:
            for m in moenster.finditer(linje):
                tal = int(m.group(1))
                if tal == TOOLCOUNT:
                    continue
                # Paa en konkurrent-linje springes KUN de tal over der er verificeret som andres.
                if andres and tal in KONKURRENT_TAL:
                    continue
                fail('%s claims "%s" but tools.js defines %d' % (os.path.relpath(f, ROOT), m.group(0).strip(), TOOLCOUNT))
        # Tabelraekken "Tool count" har etiketten paa én linje og tallet paa de naeste.
        if TOOLCOUNT_RAEKKE.search(linje):
            naeste = ' '.join(linjer[nr + 1:nr + 5])
            vores = re.findall(r'>(\d+)<', naeste)
            if vores and int(vores[0]) != TOOLCOUNT:
                fail('%s: "Tool count"-raekken siger %s, tools.js definerer %d'
                     % (os.path.relpath(f, ROOT), vores[0], TOOLCOUNT))

# ---- 1b. tools reference page lists exactly the tools.js tool set ----------
tools_page = os.path.join(DOCS, 'docs', 'tools', 'index.html')
if os.path.isfile(tools_page):
    defined = set(re.findall(r"""name: ['\"](browser_[a-z_]+)['\"]""", open(os.path.join(ROOT, 'mcp-server', 'tools.js')).read()))
    documented = set(re.findall(r'\b(browser_[a-z_]+)\b', open(tools_page, encoding='utf-8').read()))
    for miss in sorted(defined - documented):
        fail('tools page does not document %s (defined in tools.js)' % miss)
    for ghost in sorted(documented - defined):
        fail('tools page documents %s which tools.js does not define' % ghost)
else:
    fail('tools reference page missing: docs/docs/tools/index.html')

# ---- 2. leak markers in rendered HTML --------------------------------------
LEAKS = ['VERIFICÉR', 'KILDE:', 'Suggested URL', 'Suggested title', 'Suggested meta',
         'Last verified:', 'TODO', 'FIXME', 'lorem ipsum']
for f in glob.glob(DOCS + '/**/*.html', recursive=True):
    txt = open(f, encoding='utf-8').read()
    for marker in LEAKS:
        if marker in txt:
            fail('leak marker %r in %s' % (marker, os.path.relpath(f, ROOT)))

# ---- 3. internal links ------------------------------------------------------
def resolves(path):
    p = path.split('#')[0].split('?')[0]
    if not p: return True
    fs = os.path.join(DOCS, p.lstrip('/'))
    return os.path.isfile(fs) or os.path.isfile(os.path.join(fs, 'index.html'))
for f in glob.glob(DOCS + '/**/*.html', recursive=True):
    txt = open(f, encoding='utf-8').read()
    for attr, url in re.findall(r'(href|src)="(/[^"]*)"', txt):
        if not resolves(url):
            fail('dead internal %s="%s" in %s' % (attr, url, os.path.relpath(f, ROOT)))

# ---- 4. head meta on generated pages ---------------------------------------
REQUIRED = ['<link rel="canonical"', 'og:title', 'og:description', 'og:image',
            'twitter:card', '<meta name="description"', '<title>']
for url in GEN_URLS:
    f = os.path.join(DOCS, url.lstrip('/'), 'index.html')
    if not os.path.isfile(f):
        fail('generated page missing on disk: %s' % url); continue
    txt = open(f, encoding='utf-8').read()
    for req in REQUIRED:
        if req not in txt:
            fail('%s missing %s' % (url, req))
    want = 'https://browsermcp.dev%s/' % url
    m = re.search(r'<link rel="canonical" href="([^"]+)"', txt)
    if m and m.group(1) != want:
        fail('%s canonical is %s, expected %s' % (url, m.group(1), want))
# lighter check on hand-maintained top-level pages
for name in ('index.html', 'privacy.html'):
    txt = open(os.path.join(DOCS, name), encoding='utf-8').read()
    if '<link rel="canonical"' not in txt:
        fail('%s missing canonical' % name)

# ---- 5. sitemap -------------------------------------------------------------
smap = open(os.path.join(DOCS, 'sitemap.xml'), encoding='utf-8').read()
locs = re.findall(r'<loc>([^<]+)</loc>', smap)
for url in GEN_URLS:
    if 'https://browsermcp.dev%s/' % url not in locs:
        fail('sitemap.xml missing generated page %s/' % url)
for loc in locs:
    path = loc.replace('https://browsermcp.dev', '') or '/'
    if not resolves(path):
        fail('sitemap URL does not resolve locally: %s' % loc)

# ---- 6. tabelform -----------------------------------------------------------
# MAALT 13/9 af Astra: generatoren delte tabelraekker paa | uden at forstaa escapet \|, saa raekken med
# maalingen "11\|53\|...\|0" blev til ni celler i en tabel med tre kolonner. Den laa i stykker paa den
# offentlige capability-matrix fra 10/9, med synlige backslashes. Spaerren saa det ikke: regen-diff
# sammenligner output med sig selv, og en ensartet forkert tabel er stadig ensartet.
for path in glob.glob(DOCS + '/**/*.html', recursive=True):
    txt = open(path, encoding='utf-8').read()
    for tbl in re.findall(r'<table>.*?</table>', txt, re.S):
        kolonner = len(re.findall(r'<th>', tbl))
        if not kolonner:
            continue
        for nr, row in enumerate(re.findall(r'<tr>(.*?)</tr>', tbl, re.S)[1:], start=1):
            celler = len(re.findall(r'<td>', row))
            if celler and celler != kolonner:
                fail('%s: table row %d has %d cells, header has %d columns (escaped pipe?)'
                     % (os.path.relpath(path, ROOT), nr, celler, kolonner))

# -----------------------------------------------------------------------------
if fails:
    print('DOCS GATE: %d failure(s)' % len(fails))
    for m in fails: print('  ✗', m)
    sys.exit(1)
print('DOCS GATE: all green (tool count %d · %d generated pages · %d sitemap URLs)' % (TOOLCOUNT, len(GEN_URLS), len(locs)))
