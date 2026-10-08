#!/usr/bin/env python3
# stjerner.py - bager GitHub-stjerner og npm-downloads (sidste maaned) ind i docs/index.html.
#
# Forsiden maa ikke kalde nogen tredjepart ved indlaesning (test/forside.test.mjs), saa tallene kan ikke
# hentes i browseren. De hentes her og skrives ind i siden. Stod der 49 i hånden, viste siden 49 laenge
# efter at repoet havde 52 (maalt 8/10-2026). Idempotent: samme tal giver samme fil.
#   python3 scripts/stjerner.py            skriv tallene ind
#   python3 scripts/stjerner.py --tjek     exit 1 hvis siden viser andre tal end kilderne
import html, json, os, re, sys, time, urllib.request, datetime

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

CWS = 'https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl?hl=en'

def butik():
    # Chrome Web Store har intet offentligt API for brugere. Tallene laeses af butikssiden lige efter
    # udvidelsens eget navn, saa «Related»-udvidelsernes tal paa samme side aldrig kan forveksles med vores.
    # Butikken afrunder selv brugertallet («1,000 users»); siden viser det, som butikken viser det.
    for i in range(3):
        try:
            req = urllib.request.Request(CWS, headers={'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/141.0 Safari/537.36', 'Accept-Language': 'en-US,en'})
            with urllib.request.urlopen(req, timeout=40) as r:
                s = r.read().decode('utf-8', 'replace')
            t = html.unescape(re.sub(r'<[^>]+>', '\n', re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', ' ', s)))
            i0 = t.find('\nAgent360 Browser MCP\n')   # overskriften paa vores egen side, ikke sidetitlen
            if i0 < 0: raise ValueError('udvidelsens navn ikke fundet')
            blok = t[i0:i0 + 600]
            brugere = re.search(r'([\d,]+)\+? users', blok); rating = re.search(r'\n\s*([0-5]\.\d)\s*\n', blok); antal = re.search(r'([\d,]+) ratings?', blok)
            if brugere and rating and antal:
                return int(brugere.group(1).replace(',', '')), rating.group(1), int(antal.group(1).replace(',', ''))
            raise ValueError('butikssiden havde ikke tallene')
        except Exception:
            if i == 2:
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

def skriv_butik(s, brugere, rating, antal):
    s = re.sub(r'(<b data-tal="cws-brugere">)[\d,]+(</b>)', lambda m: m.group(1) + f'{brugere:,}' + m.group(2), s)
    s = re.sub(r'(<b data-tal="cws-rating">)[\d.]+(</b>)', lambda m: m.group(1) + rating + m.group(2), s)
    s = re.sub(r'(<span data-tal="cws-antal">)[\d,]+( ratings?)(</span>)', lambda m: m.group(1) + f'{antal:,}' + (' rating' if antal == 1 else ' ratings') + m.group(3), s)
    return s

def vist(s):
    a = re.search(r'<b data-tal="stjerner">([\d,]+)</b>', s); b = re.search(r'<b data-tal="npm-maaned">([\d,]+)</b>', s)
    c = re.search(r'<span class="n" title="GitHub stars on [^"]*">([\d,]+)</span>', s)
    return [int(x.group(1).replace(',', '')) if x else None for x in (a, b, c)]

if __name__ == '__main__':
    s = open(SIDE, encoding='utf-8').read()
    stjerner, npm = tal()
    brugere, rating, antal = butik()
    if '--tjek' in sys.argv:
        v = vist(s)
        b = re.search(r'<b data-tal="cws-brugere">([\d,]+)</b>', s); r = re.search(r'<b data-tal="cws-rating">([\d.]+)</b>', s)
        # 8/10: bedoemmelsen (5,0 af 3) er taget ud af siden efter ekspertpanelet; staar den der, skal den passe.
        ok = v[2] == stjerner and v[1] == npm and b and int(b.group(1).replace(',', '')) == brugere and (r is None or r.group(1) == rating) and (v[0] is None or v[0] == stjerner)
        print(f'side: stjerner {v[0]}/{v[2]}, npm {v[1]}, butik {b.group(1) if b else None}/{r.group(1) if r else None} · kilder: stjerner {stjerner}, npm {npm}, butik {brugere}/{rating} ({antal}) · {"OK" if ok else "AFVIGER"}')
        sys.exit(0 if ok else 1)
    dato = datetime.date.today().strftime('%-d %b %Y')
    ny = skriv_butik(skriv(s, stjerner, npm, dato), brugere, rating, antal)
    if ny != s:
        open(SIDE, 'w', encoding='utf-8').write(ny)
    print(f'stjerner {stjerner} · npm sidste maaned {npm} · butik {brugere} brugere, {rating} ({antal})' + ('' if ny != s else ' (uaendret)'))
