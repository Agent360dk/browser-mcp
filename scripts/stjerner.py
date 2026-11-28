#!/usr/bin/env python3
# stjerner.py - bager de samme tal ind i docs/index.html, som gustavlouv.com viser for Browser MCP.
#
# Samme adresser og felter som GLouv/gustavlouv-site (forsiden og .github/scripts/maal-tal.py):
#   Chrome  gustavlouv.com/tal.json  feltet cws (ugentlige brugere, users-7d). Butikkens afrundede tal bruges ikke.
#   npm     api.npmjs.org/downloads/range fra 2026-04-02, summeret (browser.npm_i_alt). Et lavere tal beholdes.
#   stjerner api.github.com/repos/Agent360dk/browser-mcp  stargazers_count (browser.stjerner).
# Fejler en kilde, bruges tal.json for npm og stjerner, og ellers det tal siden allerede har. Jobbet fejler ikke af det.
#   python3 scripts/stjerner.py            skriv tallene ind
#   python3 scripts/stjerner.py --tjek     exit 1 hvis siden afviger fra en kilde, der svarede
import datetime, json, os, re, sys, time, urllib.request

ROD = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SIDE = os.path.join(ROD, 'docs', 'index.html')
TAL = 'https://gustavlouv.com/tal.json'
GH = 'https://api.github.com/repos/Agent360dk/browser-mcp'
NPM_FRA = datetime.date(2026, 4, 2)
MDR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

def positiv(n):
    return isinstance(n, int) and not isinstance(n, bool) and n > 0

def behold(forrige, nyt):
    """Et positivt heltal erstatter. Alt andet beholder det forrige."""
    return nyt if positiv(nyt) else forrige

def behold_voks(forrige, nyt):
    """Hentninger i alt kan kun vokse. Et lavere eller manglende tal beholder det forrige."""
    if positiv(nyt) and (not positiv(forrige) or nyt >= forrige):
        return nyt
    return forrige

def vis_dato(d):
    return f'{d.day} {MDR[d.month - 1]} {d.year}'

def iso_dato(s):
    if not isinstance(s, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
        return None
    try:
        d = datetime.date.fromisoformat(s)
    except ValueError:
        return None
    return d if d.isoformat() == s else None

def kort(e):
    kode = getattr(e, 'code', None)
    return type(e).__name__ + (f' {kode}' if kode else '')

def hent(url, forsoeg=3):
    # Tre forsoeg: et enkelt timeout maa ikke kassere en daglig maaling. Tokenet sendes kun til GitHub, som hos gustavlouv.
    headers = {'User-Agent': 'browsermcp.dev-stjerner', 'Accept': 'application/json'}
    if url.startswith('https://api.github.com/') and os.environ.get('GH_TOKEN'):
        headers['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    sidste = None
    for i in range(forsoeg):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            sidste = e
            if i == forsoeg - 1:
                raise
            time.sleep(5 * (i + 1))
    raise sidste

def npm_ialt(idag):
    """Summen af downloads/range fra foerste udgivelse, i vinduer paa 364 dage. Samme loop som gustavlouv.com."""
    total, a = 0, NPM_FRA
    while a <= idag:
        b = min(a + datetime.timedelta(days=364), idag)
        j = hent(f'https://api.npmjs.org/downloads/range/{a.isoformat()}:{b.isoformat()}/@agent360/browser-mcp')
        dage = j.get('downloads') if isinstance(j, dict) else None
        if not isinstance(dage, list) or not dage:
            raise ValueError('svaret havde ingen dage')
        total += sum(int(x['downloads']) for x in dage)
        a = b + datetime.timedelta(days=1)
    return total

def tal_i(s, moenster):
    m = re.search(moenster, s)
    if not m:
        return None
    n = int(m.group(1).replace(',', ''))
    return n if n > 0 else None

def forrige(s):
    stj = re.search(r'title="GitHub stars on ([^"]*)"', s)
    cws = re.search(r'title="Weekly users in Chrome on ([^"]*)"', s)
    maalt = re.search(r'data-maalt="([^"]*)"', s)
    cws_dato = re.search(r'data-cws-dato="([^"]*)"', s)
    return {
        'stjerner': tal_i(s, r'<span class="n" title="GitHub stars on [^"]*">([\d,]+)</span>'),
        'stjerne_dato': stj.group(1) if stj else None,
        'npm': tal_i(s, r'<b data-tal="npm"[^>]*>([\d,]+)</b>'),
        'cws': tal_i(s, r'<b data-tal="cws"[^>]*>([\d,]+)</b>'),
        'cws_titel': cws.group(1) if cws else None,
        'maalt': maalt.group(1) if maalt else None,
        'cws_dato': cws_dato.group(1) if cws_dato else None,
    }

def maal(forrige_tal, idag=None):
    """(tal, kilder). kilder er 'github'/'npm'/'tal.json' naar den foretrukne kilde svarede, ellers None."""
    idag = idag or datetime.date.today()
    gl, noter = None, []
    try:
        fund = hent(TAL)
        gl = fund if isinstance(fund, dict) else None
        if gl is None:
            noter.append('tal.json: ikke et objekt; det forrige tal beholdes')
    except Exception as e:
        noter.append(f'tal.json: {kort(e)}; det forrige tal beholdes')
    browser = gl.get('browser') if isinstance(gl, dict) and isinstance(gl.get('browser'), dict) else {}

    stjerner, stjerne_kilde = None, None
    try:
        repo = hent(GH)
        n = repo.get('stargazers_count') if isinstance(repo, dict) else None
        if positiv(n):
            stjerner, stjerne_kilde = n, 'github'
        else:
            noter.append('GitHub: intet stargazers_count; proever tal.json')
    except Exception as e:
        noter.append(f'GitHub: {kort(e)}; proever tal.json')
    if stjerner is None and positiv(browser.get('stjerner')):
        stjerner, stjerne_kilde = browser['stjerner'], 'tal.json'

    npm, npm_kilde = None, None
    try:
        total = npm_ialt(idag)
        if positiv(total):
            npm, npm_kilde = total, 'npm'
        else:
            noter.append('npm: summen var ikke et positivt heltal; proever tal.json')
    except Exception as e:
        noter.append(f'npm: {kort(e)}; proever tal.json')
    if npm is None and positiv(browser.get('npm_i_alt')):
        npm, npm_kilde = browser['npm_i_alt'], 'tal.json'
    if npm_kilde and positiv(forrige_tal['npm']) and positiv(npm) and npm < forrige_tal['npm']:
        noter.append(f'npm: {npm} er lavere end {forrige_tal["npm"]}; det forrige beholdes')

    cws, cws_iso, cws_kilde = None, None, None
    if isinstance(gl, dict) and positiv(gl.get('cws')) and iso_dato(gl.get('cws_dato')):
        cws, cws_iso, cws_kilde = gl['cws'], gl['cws_dato'], 'tal.json'
    elif gl is not None:
        noter.append('tal.json: intet cws med en dato; det forrige Chrome-tal beholdes')

    if stjerne_kilde == 'github':
        stjerne_dato = vis_dato(idag)
    elif stjerne_kilde == 'tal.json' and iso_dato((gl or {}).get('maalt')):
        stjerne_dato = vis_dato(iso_dato(gl['maalt']))
    else:
        stjerne_dato = forrige_tal['stjerne_dato']

    if stjerne_kilde == 'github' or npm_kilde == 'npm':
        maalt = idag.isoformat()
    elif iso_dato((gl or {}).get('maalt')) and (stjerne_kilde == 'tal.json' or npm_kilde == 'tal.json'):
        maalt = gl['maalt']
    else:
        maalt = forrige_tal['maalt']

    ud = {
        'stjerner': behold(forrige_tal['stjerner'], stjerner),
        'stjerne_dato': stjerne_dato,
        'npm': behold_voks(forrige_tal['npm'], npm),
        'cws': behold(forrige_tal['cws'], cws),
        'cws_titel': vis_dato(iso_dato(cws_iso)) if cws_kilde else forrige_tal['cws_titel'],
        'cws_dato': cws_iso if cws_kilde else forrige_tal['cws_dato'],
        'maalt': maalt,
    }
    kilder = {'stjerner': stjerne_kilde, 'npm': npm_kilde, 'cws': cws_kilde}
    return ud, kilder, noter

def erstat(s, moenster, ny):
    ud, n = re.subn(moenster, ny, s, count=1)
    if n != 1:
        raise RuntimeError(f'moenster ramte {n} gange: {moenster}')
    return ud

def skriv(s, ud):
    fmt = lambda n: f'{n:,}'
    if positiv(ud['stjerner']):
        if ud['stjerne_dato']:
            s = erstat(s, r'(<span class="n" title="GitHub stars on )[^"]*(">)[\d,]+(</span>)',
                       lambda m: m.group(1) + ud['stjerne_dato'] + m.group(2) + fmt(ud['stjerner']) + m.group(3))
        else:
            s = erstat(s, r'(<span class="n" title="GitHub stars on [^"]*">)[\d,]+(</span>)',
                       lambda m: m.group(1) + fmt(ud['stjerner']) + m.group(2))
        s = erstat(s, r'(aria-label="Browser MCP on GitHub, )[\d,]+( stars")',
                   lambda m: m.group(1) + fmt(ud['stjerner']) + m.group(2))
    if positiv(ud['npm']):
        s = erstat(s, r'(<b data-tal="npm"[^>]*>)[\d,]+(</b>)', lambda m: m.group(1) + fmt(ud['npm']) + m.group(2))
    if positiv(ud['cws']):
        if ud['cws_titel']:
            s = erstat(s, r'(<b data-tal="cws" title="Weekly users in Chrome on )[^"]*(">)[\d,]+(</b>)',
                       lambda m: m.group(1) + ud['cws_titel'] + m.group(2) + fmt(ud['cws']) + m.group(3))
        else:
            s = erstat(s, r'(<b data-tal="cws"[^>]*>)[\d,]+(</b>)', lambda m: m.group(1) + fmt(ud['cws']) + m.group(2))
    if ud['maalt']:
        s = erstat(s, r'(data-maalt=")[^"]*(")', lambda m: m.group(1) + ud['maalt'] + m.group(2))
    if ud['cws_dato']:
        s = erstat(s, r'(data-cws-dato=")[^"]*(")', lambda m: m.group(1) + ud['cws_dato'] + m.group(2))
    return s

def afviger(side, ud, kilder):
    """Kun en kilde, der faktisk svarede, kan goere --tjek roed. En kilde, der fejlede, beholder sidens tal."""
    fejl = []
    if kilder['stjerner'] == 'github' and side['stjerner'] != ud['stjerner']:
        fejl.append(f'stjerner {side["stjerner"]} != {ud["stjerner"]}')
    if kilder['npm'] == 'npm' and side['npm'] != ud['npm']:
        fejl.append(f'npm {side["npm"]} != {ud["npm"]}')
    if kilder['cws'] == 'tal.json' and side['cws'] != ud['cws']:
        fejl.append(f'chrome {side["cws"]} != {ud["cws"]}')
    return fejl

def linje(ud, kilder, uaendret):
    return (f'stjerner {ud["stjerner"]} ({kilder["stjerner"] or "forrige"}) · '
            f'npm {ud["npm"]} ({kilder["npm"] or "forrige"}) · '
            f'chrome {ud["cws"]} ({kilder["cws"] or "forrige"}, {ud["cws_dato"]})'
            + (' (uaendret)' if uaendret else ''))

if __name__ == '__main__':
    try:
        s = open(SIDE, encoding='utf-8').read()
    except OSError as e:
        print(f'kan ikke laese siden: {kort(e)}')
        sys.exit(1)
    ud, kilder, noter = maal(forrige(s))
    for n in noter:
        print(n)
    if '--tjek' in sys.argv:
        fejl = afviger(forrige(s), ud, kilder)
        print(linje(ud, kilder, not fejl) + (' · OK' if not fejl else ' · AFVIGER: ' + '; '.join(fejl)))
        sys.exit(0 if not fejl else 1)
    try:
        ny = skriv(s, ud)
    except RuntimeError as e:
        print(f'siden har ikke det markup, tallene skrives ind i: {e}')
        sys.exit(1)
    if ny != s:
        open(SIDE, 'w', encoding='utf-8').write(ny)
    print(linje(ud, kilder, ny == s))
