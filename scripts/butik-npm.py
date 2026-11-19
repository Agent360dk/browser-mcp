#!/usr/bin/env python3
"""butik-npm.py - udleverer Chrome Web Store den samme version af udvidelsen, som npm har af serveren?

Findes fordi (maalt 18/11-2026): serveren 1.31.0 kom paa npm 29/10, butikken afviste udvidelsen samme dag
(soegeord i beskrivelsen), ingen sendte den ind igen, og i 20 dage udleverede butikken 1.30.3. Profilvalget (som
kraever udvidelsens popup) naaede aldrig butiksbrugerne, og ingen opdagede det. Regel 10 (Gustav 18/11):
dele, der skal passe sammen, gaar live sammen - butikken foerst.

  python3 scripts/butik-npm.py            maal og doem (exit 1 = roed)
  python3 scripts/butik-npm.py --selvtest kun selvtesten

Dom:
  * samme version                                  -> groen
  * npm er foran butikken i hoejst GRAENSE dage     -> groen med note (butikken behandler den)
  * npm er foran butikken i mere end GRAENSE dage   -> ROED (det, der skete med 1.31)
  * butikken er foran npm i hoejst GRAENSE dage    -> groen med note (npm-trinnet efter godkendelsen mangler)
  * butikken er foran npm i mere end GRAENSE dage  -> ROED (npm-trinnet blev aldrig koert; regel 10 gaelder begge veje)
    (butikkens dato = Last-Modified paa den .crx, butikken udleverer; maalt 19/11: 1.30.3 -> 15/10 06:14 UTC)
  * en kilde kunne ikke laeses                     -> ROED (UMAALT): et ukendt svar er aldrig et groent svar
"""
import datetime, email.utils, json, re, sys, urllib.error, urllib.request

ID = 'jdehgalffmffhfhmmhaokfbfnafnmgcl'
PAKKE = '@agent360/browser-mcp'
GRAENSE = 3  # dage
BUTIK = ('https://clients2.google.com/service/update2/crx?response=redirect&prodversion=141.0'
         f'&acceptformat=crx2,crx3&x=id%3D{ID}%26uc')
NPM = 'https://registry.npmjs.org/' + PAKKE.replace('/', '%2f')


def version_fra_crx(adresse):
    """«…/JDEHGALFFMFFHFHMMHAOKFBFNAFNMGCL_1_30_3_0.crx» -> «1.30.3». Ukendt form -> None."""
    m = re.search(r'_(\d+)_(\d+)_(\d+)(?:_(\d+))?\.crx$', adresse or '')
    if not m:
        return None
    return '.'.join(m.group(i) for i in (1, 2, 3)) + ('' if m.group(4) in (None, '0') else '.' + m.group(4))


def tal(v):
    """De tre foerste tal: «1.33.0.5» (butikkens 4. del) og «1.34.0-beta.1» (npm-prerelease) sammenlignes paa 1.33.0 / 1.34.0."""
    m = re.match(r'(\d+)\.(\d+)\.(\d+)', v or '')
    return tuple(int(x) for x in m.groups()) if m else None


def dom(butik, npm, npm_tid, nu, butik_tid=None):
    """(roed, linje). npm_tid, butik_tid og nu er datetime med tidszone."""
    if not butik or tal(butik) is None:
        return True, '✗ UMAALT: butikkens version kunne ikke laeses'
    if not npm or npm_tid is None or tal(npm) is None:
        return True, '✗ UMAALT: npm latest kunne ikke laeses'
    if tal(butik) == tal(npm):
        return False, f'✓ samme version: Chrome Web Store {butik}, npm {npm}'
    dage = (nu - npm_tid).total_seconds() / 86400
    if tal(npm) > tal(butik):
        if dage > GRAENSE:
            return True, (f'✗ npm {npm} siden {npm_tid.date()} ({dage:.0f} dage), men Chrome Web Store udleverer {butik} '
                          f'- butiksbrugerne har en anden udvidelse end serveren. Er udvidelsen afvist? Send den ind igen')
        return False, f'· npm {npm} i {dage:.1f} dage, Chrome Web Store {butik}: venter paa butikkens gennemgang (graense {GRAENSE} dage)'
    if butik_tid is None:
        return True, f'✗ UMAALT: Chrome Web Store {butik} er foran npm {npm}, men butikkens dato kunne ikke laeses'
    bdage = (nu - butik_tid).total_seconds() / 86400
    if bdage > GRAENSE:
        return True, (f'✗ Chrome Web Store {butik} siden {butik_tid.date()} ({bdage:.0f} dage), men npm har {npm} '
                      f'- serveren til den nye udvidelse blev aldrig udgivet. Koer npm-trinnet')
    return False, f'· Chrome Web Store {butik} er foran npm {npm} i {bdage:.1f} dage: npm-trinnet efter godkendelsen mangler (graense {GRAENSE} dage)'


def selvtest():
    nu = datetime.datetime(2026, 11, 18, 12, tzinfo=datetime.timezone.utc)
    dag = lambda d: datetime.datetime(2026, 11, d, 12, tzinfo=datetime.timezone.utc)
    forventet = [
        (('1.30.3', '1.31.0', datetime.datetime(2026, 10, 29, 14, tzinfo=datetime.timezone.utc)), True),  # det, der skete
        (('1.31.0', '1.31.0', dag(1)), False),
        (('1.31.0', '1.33.0', dag(17)), False),     # 1 dag: butikken behandler den
        (('1.31.0', '1.33.0', dag(14)), True),      # 4 dage
        (('1.33.0', '1.31.0', dag(1), dag(17)), False),  # butikken foran i 1 dag (butikken foerst)
        (('1.33.0', '1.31.0', dag(1), dag(14)), True),   # butikken foran i 4 dage: npm-trinnet glemt
        (('1.33.0', '1.31.0', dag(1), None), True),      # butikken foran, dato ukendt
        (('1.33.0.5', '1.33.0', dag(1)), False),         # butikkens 4. del er samme udgivelse
        (('1.33.0', '1.34.0-beta.1', dag(17)), False),   # prerelease gaar ikke ned
        ((None, '1.31.0', dag(1)), True),
        (('1.31.0', None, None), True),
        (('1.9.0', '1.10.0', dag(1)), True),        # tal, ikke tekst: 1.10 > 1.9
    ]
    k = lambda a: dom(a[0], a[1], a[2], nu, *a[3:])[0]
    fejl = [f'{a} -> roed={k(a)}, forventet {r}' for a, r in forventet if k(a) != r]
    for navn, v in [('X_1_30_3_0.crx', '1.30.3'), ('X_1_33_0_0.crx', '1.33.0'), ('X_1_33_0_2.crx', '1.33.0.2'), ('noget.zip', None)]:
        if version_fra_crx('https://h/' + navn) != v:
            fejl.append(f'version_fra_crx({navn}) = {version_fra_crx("https://h/" + navn)}, forventet {v}')
    return fejl


class IngenOmdirigering(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def hent_butik():
    aabn = urllib.request.build_opener(IngenOmdirigering)
    for _ in range(3):
        try:
            aabn.open(urllib.request.Request(BUTIK, headers={'User-Agent': 'browsermcp-butik-npm'}), timeout=30)
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307):
                sted = e.headers.get('Location', '')
                return version_fra_crx(sted), hent_dato(sted)
        except Exception:
            pass
    return None, None


def hent_dato(sted):
    """Last-Modified paa den .crx, butikken udleverer = hvornaar butikken begyndte at udlevere den. Ukendt -> None."""
    if not sted.startswith('https://'):
        return None
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(sted, method='HEAD', headers={'User-Agent': 'browsermcp-butik-npm'}), timeout=30) as r:
                lm = r.headers.get('Last-Modified')
            return email.utils.parsedate_to_datetime(lm) if lm else None
        except Exception:
            pass
    return None


def hent_npm():
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(NPM, headers={'User-Agent': 'browsermcp-butik-npm'}), timeout=30) as r:
                d = json.load(r)
            v = d['dist-tags']['latest']
            return v, datetime.datetime.fromisoformat(d['time'][v].replace('Z', '+00:00'))
        except Exception:
            pass
    return None, None


if __name__ == '__main__':
    f = selvtest()
    if f:
        print('BUTIK-NPM · selvtesten fejlede - ingen dom:', *f, sep='\n  ✗ ')
        sys.exit(1)
    if '--selvtest' in sys.argv:
        print('BUTIK-NPM · selvtest groen')
        sys.exit(0)
    butik, butik_tid = hent_butik()
    npm, npm_tid = hent_npm()
    roed, linje = dom(butik, npm, npm_tid, datetime.datetime.now(datetime.timezone.utc), butik_tid)
    print(f'BUTIK-NPM · Agent360dk/browser-mcp   (selvtest groen)\n  {linje}')
    sys.exit(1 if roed else 0)
