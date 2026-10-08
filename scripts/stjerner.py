#!/usr/bin/env python3
# stjerner.py - bager GitHub-stjerner og npm-downloads (sidste maaned) ind i docs/index.html.
#
# Forsiden maa ikke kalde nogen tredjepart ved indlaesning (test/forside.test.mjs), saa tallene kan ikke
# hentes i browseren. De hentes her og skrives ind i siden. Stod der 49 i hånden, viste siden 49 laenge
# efter at repoet havde 52 (maalt 8/10-2026). Idempotent: samme tal giver samme fil.
#   python3 scripts/stjerner.py            skriv tallene ind
#   python3 scripts/stjerner.py --tjek     exit 1 hvis siden viser andre tal end kilderne
import json, os, re, sys, time, urllib.request, datetime

ROD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SIDE = os.path.join(ROD, 'docs', 'index.html')

def hent(url, forsoeg=3):
    # Tre forsoeg: et enkelt timeout maa ikke stoppe en daglig koersel. Fejler alle, skrives intet.
    for i in range(forsoeg):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'browsermcp.dev-stjerner', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            if i == forsoeg - 1:
                raise
            time.sleep(5 * (i + 1))

def tal():
    stjerner = int(hent('https://api.github.com/repos/Agent360dk/browser-mcp')['stargazers_count'])
    npm = int(hent('https://api.npmjs.org/downloads/point/last-month/@agent360/browser-mcp')['downloads'])
    return stjerner, npm

def skriv(s, stjerner, npm, dato):
    fmt = lambda n: f'{n:,}'
    s = re.sub(r'(<b data-tal="stjerner">)[\d,]+(</b>)', lambda m: m.group(1) + fmt(stjerner) + m.group(2), s)
    s = re.sub(r'(<b data-tal="npm-maaned">)[\d,]+(</b>)', lambda m: m.group(1) + fmt(npm) + m.group(2), s)
    s = re.sub(r'(aria-label="Browser MCP on GitHub, )[\d,]+( stars")', lambda m: m.group(1) + fmt(stjerner) + m.group(2), s)
    s = re.sub(r'(<span class="n" title="GitHub stars on )[^"]*(">)[\d,]+(</span>)', lambda m: m.group(1) + dato + m.group(2) + fmt(stjerner) + m.group(3), s)
    return s

def vist(s):
    a = re.search(r'<b data-tal="stjerner">([\d,]+)</b>', s); b = re.search(r'<b data-tal="npm-maaned">([\d,]+)</b>', s)
    c = re.search(r'<span class="n" title="GitHub stars on [^"]*">([\d,]+)</span>', s)
    return [int(x.group(1).replace(',', '')) if x else None for x in (a, b, c)]

if __name__ == '__main__':
    s = open(SIDE, encoding='utf-8').read()
    stjerner, npm = tal()
    if '--tjek' in sys.argv:
        v = vist(s)
        ok = v[0] == stjerner and v[2] == stjerner and v[1] == npm
        print(f'side: stjerner {v[0]}/{v[2]}, npm {v[1]} · kilder: stjerner {stjerner}, npm {npm} · {"OK" if ok else "AFVIGER"}')
        sys.exit(0 if ok else 1)
    dato = datetime.date.today().strftime('%-d %b %Y')
    ny = skriv(s, stjerner, npm, dato)
    if ny != s:
        open(SIDE, 'w', encoding='utf-8').write(ny)
    print(f'stjerner {stjerner} · npm sidste maaned {npm}' + ('' if ny != s else ' (uaendret)'))
