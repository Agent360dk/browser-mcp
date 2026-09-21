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
import os, re, sys, glob, subprocess

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DOCS = os.path.join(ROOT, 'docs')
fails = []

def fail(msg): fails.append(msg)

# Generated pages = the PAGES registry in generate-docs.py (parse it, single source of truth)
gen_src = open(os.path.join(ROOT, 'scripts', 'generate-docs.py')).read()
# MAALT 19/9: her stod en liste over kendte praefikser - docs, compare, use-cases, learn.
# En ny side paa /migrate/ slap derfor HELT uden om gaten: ingen head-tjek, intet
# sitemap-krav, ingen noindex-regel. En vagt der kun ser de mapper den blev foedt med,
# bliver tyndere hver gang sitet vokser, og den siger ikke selv til. Nu laeses URL'en som
# det den er - sidste felt i en PAGES-post - saa et nyt praefiks daekkes fra dag ét.
GEN_URLS = re.findall(r",\s*'(/[a-z0-9/-]+)'\s*\)", gen_src)
if len(GEN_URLS) < 5:
    fail('could not parse PAGES registry from generate-docs.py (found %d urls)' % len(GEN_URLS))

# ---- 0. hver side viser en kommando OG hvad man faar tilbage ----------------
# MAALT 19/9: 18 af 34 sider manglede det - heriblandt 2FA-fra-Gmail og migrationssiden,
# hvor udvekslingen ER pointen. Det var ikke en beslutning; det skete side for side, fordi
# intet maalte det. Foerste maaling talte kun citat-blokke og meldte 22 - Codex-siden viser
# sin udveksling som transskript, og det er bedre end et citat. Instrumentet blev kalibreret
# mod tre kendt-sande sider foer tallet blev brugt.
import re as _re1
_uden = []
for _f in sorted(os.listdir(os.path.join(ROOT, 'content'))):
    if not _f.endswith('.md'):
        continue
    _t = open(os.path.join(ROOT, 'content', _f), encoding='utf-8').read()
    _citat = bool(_re1.search(r'^>\s+\S', _t, _re1.M)) and bool(
        _re1.search(r'You get|you get back|comes back|instead of', _t, _re1.I))
    _transskript = any(
        _re1.search(r'^You:', _b, _re1.M) and _re1.search(r'^\w[\w .-]*:\s', _b, _re1.M)
        for _b in _re1.findall(r'```[a-z]*\n(.*?)```', _t, _re1.S))
    if not (_citat or _transskript):
        _uden.append(_f)
if _uden:
    fail('%d sider viser hverken kommando eller svar: %s' % (len(_uden), ', '.join(_uden)))

# ---- 0b. ingen side maa have to udgaver af sin egen indledning --------------
# MAALT 19/9: baade VS Code-siden og ZCode-siden aabnede med SAMME saetning to gange, i to
# lidt forskellige udgaver - «install takes about 90 seconds» og «about 90 seconds, four
# steps». Paa de to sider der ligger i den tungeste ende af trafikken. Det er ikke en
# stavefejl, det er en side der ser ubearbejdet ud i det foerste oejeblik en ny bruger ser den.
_dubletter = []
for _f in sorted(os.listdir(os.path.join(ROOT, 'content'))):
    if not _f.endswith('.md'):
        continue
    _t = open(os.path.join(ROOT, 'content', _f), encoding='utf-8').read()
    _afsnit = [_a.strip() for _a in _t.split('\n\n')
               if len(_a.strip()) > 60 and not _a.strip().startswith('//') and '```' not in _a]
    _set = {}
    for _a in _afsnit:
        _k = ' '.join(_a.split())[:60]
        if _k in _set:
            _dubletter.append('%s: "%s…"' % (_f, _k[:52]))
        _set[_k] = _a
if _dubletter:
    fail('%d sider aabner med samme saetning to gange: %s' % (len(_dubletter), '; '.join(_dubletter)))

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
ANDRE = re.compile(r'playwright|chrome devtools mcp|mcp-chrome|browsermcp\.io|puppeteer|selenium|copilot|vs ?code|zed|kiro|continue\.dev|cline|gemini cli', re.I)
# MAALT 9/9: at springe HELE linjen over var det andet hul. En sammenligningsraekke
# indeholder BEGGE tal - "| Tools | 69 documented | 34 |" - saa undtagelsen beskyttede
# praecis det sted hvor vores eget forkerte tal stod. Nu springes kun de tal over der er
# verificeret som andres. Kommer der et nyt, fejler gaten én gang og tallet skrives her.
KONKURRENT_TAL = {
    128,  # VS Code agent mode's vaerktoejs-loft pr. chat-anmodning (deres issue-tracker, 19/9)
    72,   # microsoft/playwright-mcp, genoptalt 2026-09-19 EFTER at vagten fyrede: de fjernede
          # browser_webmcp_call + browser_webmcp_list og tilfoejede browser_emulate_media samme dag
    73,   # samme, foer den aendring - beholdt saa gamle henvisninger ikke bliver falsk roede
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
# En side vi bevidst holder ude af indekset skal OGSAA vaere ude af sitemappet, ellers
# fortaeller vi Google to modsatte ting om samme URL. Reglen haandhaeves begge veje:
# en noindex-side i sitemappet er lige saa forkert som en almindelig side der mangler.
# MAALT 19/9: sitemappet er haandholdt, saa uden det her var det kun et tidsspoergsmaal
# foer de to lister gled fra hinanden - praecis som dokumentation og virkelighed gjorde.
NOINDEX = set()
_gen = open(os.path.join(ROOT, 'scripts', 'generate-docs.py'), encoding='utf-8').read()
_m = re.search(r'^NOINDEX = \{([^}]*)\}', _gen, re.M)
if _m:
    NOINDEX = {x.strip().strip("'\"") for x in _m.group(1).split(',') if x.strip()}
for url in GEN_URLS:
    i_sitemap = 'https://browsermcp.dev%s/' % url in locs
    if url in NOINDEX:
        if i_sitemap:
            fail('%s/ er noindex, men staar i sitemap.xml - to modsatte signaler om samme URL' % url)
        side = os.path.join(DOCS, url.strip('/'), 'index.html')
        if os.path.exists(side) and 'noindex' not in open(side, encoding='utf-8').read():
            fail('%s/ staar i NOINDEX, men siden baerer ikke robots-taggen' % url)
    elif not i_sitemap:
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
# 7. Enhver fil i content/ SKAL have en rute i generate-docs.py.
#
# MAALT 18/9: en ny side blev skrevet, generatoren koert og porten sagde "all green" - og
# siden fandtes ikke. Ruterne staar i en eksplicit liste i generate-docs.py, og en fil der
# ikke staar der bliver tavst sprunget over. Porten sammenlignede kun det der BLEV bygget
# med sig selv, saa den kunne ikke se det der aldrig blev bygget.
gen_src = open(os.path.join(ROOT, 'scripts', 'generate-docs.py'), encoding='utf-8').read()
for md in sorted(glob.glob(os.path.join(ROOT, 'content', '*.md'))):
    navn = os.path.basename(md)
    if "'%s'" % navn not in gen_src:
        fail('content/%s har ingen rute i generate-docs.py - filen bliver tavst ignoreret' % navn)

# ---- 6. intet dokument maa vente paa en version der er udgivet --------------
# MAALT 19/9 OG 20/9 - to gange paa to dage, i den samme fil. WISHLIST.md sagde
# «ingen udgivelse har fundet sted endnu» efter 1.29.1 og 1.29.2 var ude, og dagen efter
# sagde den «Venter paa 1.30» mens 1.30 laa paa npm, i registret, paa GitHub og i butikken.
# Begge gange stod det offentligt i repoet, og begge gange blev det fundet i haanden.
#
# Reglen hviler IKKE paa ordet: den finder et versionsnummer paa en linje der venter, og
# sammenligner det med den version manifestet faktisk baerer. Et omdoebt afsnit aendrer
# ingenting - tallet er det baerende. (Huset 7/9: et ord kan ikke baere en regel.)
VENTE_ORD = re.compile(r'(venter p[aå]|waiting (?:for|on)|kommer i|ships? in|lands? in)\s+v?(\d+\.\d+(?:\.\d+)?)', re.I)
IKKE_UDGIVET_MAERKE = re.compile(r'ikke udgivet|endnu ikke udgivet|not released|unreleased', re.I)
# Maerket, saa hoejst nogle faa skilletegn, saa versionen. Vinduet er smalt med vilje:
# det er naerheden der goer de to ord til ÉT udsagn om den version.
MAERKE_SAA_VERSION = re.compile(
    r'(?:ikke udgivet|endnu ikke udgivet|not released|unreleased)'
    r'[\s\-–:,.]{0,6}v?(\d+\.\d+(?:\.\d+)?)', re.I)

# MAALT 21/9: foerste udgave af reglen herunder sammenlignede versionsnummeret med den
# manifestet baerer, og kaldte «IKKE UDGIVET - v1.26.0» en loegn. Den linje er SAND:
# 1.26.0 blev aldrig udgivet - hverken tag eller npm (16 udgivne versioner, 1.26.0 ikke
# iblandt). Det baerende er ikke raekkefoelgen, men om versionen FINDES.
UDGIVNE_TAGS = {t[1:] for t in subprocess.run(
    ['git', '-C', ROOT, 'tag', '--list', 'v*'],
    capture_output=True, text=True).stdout.split() if t.startswith('v')}
# Et instrument der kan svare nul, proeves foer tallet bruges: uden tags ser reglen intet
# og ville tie stille i et fladt CI-udtjek.
if not UDGIVNE_TAGS:
    fail('check-docs: ingen git-tags fundet - ikke-udgivet-reglen kan ikke maale noget '
         '(fladt udtjek? koer git fetch --tags)')
_manifest = open(os.path.join(ROOT, 'extension', 'manifest.json'), encoding='utf-8').read()
UDGIVET = tuple(int(x) for x in re.search(r'"version"\s*:\s*"([\d.]+)"', _manifest).group(1).split('.'))

def _ver(t):
    d = [int(x) for x in t.split('.')]
    while len(d) < 3: d.append(0)
    return tuple(d)

for doc in ['WISHLIST.md', 'README.md', 'CHANGELOG.md', 'llms-install.md',
            os.path.join('docs', 'CWS_LISTING_TEXT.md')]:
    sti = os.path.join(ROOT, doc)
    if not os.path.exists(sti):
        continue
    for nr, linje in enumerate(open(sti, encoding='utf-8'), 1):
        if 'Rettet' in linje or 'foraeldet' in linje or 'forældet' in linje:
            continue  # en linje der selv siger den er foraeldet, er ikke en paastand
        m = VENTE_ORD.search(linje)
        if m and _ver(m.group(2)) <= UDGIVET:
            fail('%s:%d venter paa %s, men %s er udgivet: "%s"'
                 % (doc, nr, m.group(2), '.'.join(str(x) for x in UDGIVET), linje.strip()[:90]))

        # MAALT 21/9 - tredje gang i den samme fil, og denne gang gik den FORBI reglen
        # ovenfor. Linjen var «IKKE UDGIVET - v1.29.1. … venter en udgivelse»: tallet stod
        # FOER vente-ordet, og «venter en» er ikke «venter paa». Reglen ovenfor kraever
        # raekkefoelgen ord-saa-tal, saa den kunne aldrig se den.
        #
        # Derfor denne: et eksplicit ikke-udgivet-maerke paa en linje der navngiver en
        # version, uanset raekkefoelgen. Tallet er stadig det baerende - maerket vaelger
        # kun linjerne ud. (Huset 7/9: et ord kan ikke baere en regel.)
        # ⛔ Maerket skal staa LIGE FOER versionen. Foerste udgave saa paa hele linjen, og
        # fyrede dermed paa «kan ikke drives i 1.30.0 - rettet paa main, ikke udgivet», hvor
        # «ikke udgivet» handler om RETTELSEN og 1.30.0 er korrekt navngivet som udgivet.
        # Den form vi jager er «IKKE UDGIVET - v1.29.1»: maerket og tallet er det samme udsagn.
        for m in MAERKE_SAA_VERSION.finditer(linje):
            if m.group(1) in UDGIVNE_TAGS:
                fail('%s:%d kalder %s ikke-udgivet, men v%s er tagget: "%s"'
                     % (doc, nr, m.group(1), m.group(1), linje.strip()[:90]))
                break

# -----------------------------------------------------------------------------
if fails:
    print('DOCS GATE: %d failure(s)' % len(fails))
    for m in fails: print('  ✗', m)
    sys.exit(1)
print('DOCS GATE: all green (tool count %d · %d generated pages · %d sitemap URLs)' % (TOOLCOUNT, len(GEN_URLS), len(locs)))
