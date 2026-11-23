#!/usr/bin/env python3
"""flader-ens.py - viser alle Browser MCP's offentlige flader den samme version som npm?

Findes fordi (maalt 18-20/11-2026): da butikken var 22 dage bagud, var der intet, der sammenlignede npm med de
andre flader. Butikken mod npm vogtes af butik-npm.py (#112). Denne vagt holder resten op mod npm latest:
MCP-registret, GitHubs seneste udgivelse og browsermcp.dev (softwareVersion i sidens ld+json). Gustav 19/11:
«chrome extension er samme version som npm og alt andet er ens e2e».

  python3 scripts/flader-ens.py            maal og doem (exit 1 = roed)
  python3 scripts/flader-ens.py --selvtest kun selvtesten

Dom:
  * alle flader = npm latest                                 -> groen
  * en flade afviger, og npm latest er hoejst 1 dag gammel   -> groen med note (udgivelsen er i gang: registret
    og siden foelger npm inden for timer)
  * NB: runbrowsermcpupdate.sh laver GitHub-udgivelsen (trin 4) FOER npm publish (trin 5). Rammer den daglige koersel
    netop de minutter, er GitHub foran en gammel npm, og dommen er roed; naeste groenne koersel lukker beskeden igen
  * en flade afviger, og npm latest er mere end 1 dag gammel -> ROED (en flade blev glemt, eller en udgivelse
    stoppede halvvejs - fx siden live foer npm)
  * en kilde kunne ikke laeses                               -> ROED (UMAALT): et ukendt svar er aldrig et groent svar
    (ogsaa: npm-svaret er ikke en version, mangler tidszone eller ligger i fremtiden; siden har ingen gyldig ld+json
    for Browser MCP)
  * er dommen roed, laeses npm igen: skiftede npm, mens fladerne blev laest (en udgivelse midt i maalingen), maales
    fladerne igen mod den nye version, i stedet for at give falsk alarm
"""
import datetime, json, os, re, sys, time, urllib.error, urllib.request

PAKKE = '@agent360/browser-mcp'
REGISTER_NAVN = 'io.github.Agent360dk/browser-mcp'
REPO = 'Agent360dk/browser-mcp'
SIDE = 'https://browsermcp.dev/'
GRAENSE_DAGE = 1
UA = {'User-Agent': 'browsermcp-flader-ens'}
SIDE_NAVN = 'browser mcp'   # navnet paa SoftwareApplication-objektet i sidens ld+json (sammenlignet uden store bogstaver)
LDJSON = re.compile(r'<script\b[^>]*\btype\s*=\s*["\']application/ld\+json["\'][^>]*>(.*?)</script\s*>', re.S | re.I)
FREMTID = datetime.timedelta(hours=1)
GRUND = {}                  # navn -> hvorfor kilden ikke kunne laeses (fx «HTTP 403»), saa en roed besked siger aarsagen


def ren(v):
    """«v1.33.0» -> «1.33.0». Andet end en version -> None."""
    v = (v or '').strip()
    v = v[1:] if v[:1] in ('v', 'V') else v
    return v if re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?', v) else None


def side_version(html):
    """Versionen i sidens ld+json: et SoftwareApplication-objekt med navnet Browser MCP. Kun gyldig JSON i en
    <script type="application/ld+json">-blok taeller (ikke en kommentar eller brødtekst). En ugyldig blok, intet
    objekt eller to forskellige versioner -> None (UMAALT)."""
    fundet = set()
    for blok in LDJSON.findall(html or ''):
        try:
            data = json.loads(blok)
        except ValueError:
            return None
        stak = [data]
        while stak:
            o = stak.pop()
            if isinstance(o, list):
                stak.extend(o)
            elif isinstance(o, dict):
                typer = o.get('@type') if isinstance(o.get('@type'), list) else [o.get('@type')]
                if 'SoftwareApplication' in typer and str(o.get('name', '')).strip().lower() == SIDE_NAVN \
                        and 'softwareVersion' in o:
                    v = o['softwareVersion']
                    fundet.add(ren(v) if isinstance(v, str) else None)
                stak.extend(o.values())
    return fundet.pop() if len(fundet) == 1 else None


def dom(npm, npm_tid, flader, nu, grunde=None):
    """(roed, linjer). flader = {navn: version eller None}. npm_tid og nu er datetime med tidszone."""
    grunde = grunde or {}
    # Aarsagen staar paa sin egen linje uden ✗: den ses i koerslens log, men er ikke en del af fundet. Ellers ville et udfald, hvor
    # fejltypen skifter (HTTP 503 -> URLError -> timeout), give en ny besked hver morgen trods dubletfilteret (Opus 20/11, #114 R2).
    hvorfor = lambda navn: [f'    aarsag: {grunde[navn]}'] if grunde.get(navn) else []
    linjer, roed = [], False
    if npm_tid is None or not isinstance(npm, str) or ren(npm) is None or npm_tid.tzinfo is None:
        return True, ['✗ UMAALT: npm latest kunne ikke laeses'] + hvorfor('npm')
    npm = ren(npm)
    if npm_tid > nu + FREMTID:
        return True, [f'✗ UMAALT: npm latest {npm} har udgivelsestidspunktet {npm_tid.isoformat()}, der ligger i fremtiden']
    alder = (nu - npm_tid).total_seconds() / 86400
    for navn, v in flader.items():
        if v is None:
            roed = True
            linjer.append(f'✗ UMAALT: {navn} kunne ikke laeses')
            linjer += hvorfor(navn)
        elif v == npm:
            linjer.append(f'✓ {navn} {v}')
        elif alder > GRAENSE_DAGE:
            roed = True
            linjer.append(f'✗ {navn} viser {v}, men npm latest er {npm} (udgivet {npm_tid.date()}) ({alder:.0f} dage)'
                          f' - en flade blev glemt, eller udgivelsen stoppede halvvejs')
        else:
            linjer.append(f'· {navn} viser {v}, npm latest {npm} er {alder * 24:.0f} timer gammel: foelger med udgivelsen'
                          f' (graense {GRAENSE_DAGE} dag)')
    return roed, linjer


def selvtest():
    nu = datetime.datetime(2026, 11, 20, 12, tzinfo=datetime.timezone.utc)
    t = lambda d, h=12: datetime.datetime(2026, 11, d, h, tzinfo=datetime.timezone.utc)
    alle = lambda v: {'MCP-registret': v, 'GitHub release': v, 'browsermcp.dev': v}
    forventet = [
        (('1.31.0', t(1), alle('1.31.0')), False),                                     # alt ens
        (('1.33.0', t(20, 9), alle('1.31.0')), False),                                 # 3 timer: udgivelsen er i gang
        (('1.33.0', t(18), {**alle('1.33.0'), 'browsermcp.dev': '1.31.0'}), True),     # 2 dage: siden glemt
        (('1.31.0', t(1), {**alle('1.31.0'), 'GitHub release': '1.33.0'}), True),      # GitHub foran npm
        (('1.31.0', t(1), {**alle('1.31.0'), 'MCP-registret': None}), True),           # ukendt = roed
        ((None, None, alle('1.31.0')), True),
        (('1.33.0', t(20, 9), {**alle('1.33.0'), 'browsermcp.dev': None}), True),      # ukendt er roed, ogsaa i udgivelsen
        (('latest', t(20, 9), alle('1.31.0')), True),                                  # npm-svaret er ikke en version
        (('1.31.0', t(21), alle('1.31.0')), True),                                     # udgivet i fremtiden
        (('1.31.0', datetime.datetime(2026, 11, 1), alle('1.31.0')), True),            # uden tidszone
    ]
    fejl = [f'{a[0]} {a[2]} -> roed={dom(*a, nu)[0]}, forventet {r}' for a, r in forventet if dom(*a, nu)[0] != r]
    for ind, ud in [('v1.33.0', '1.33.0'), ('1.33.0', '1.33.0'), ('1.34.0-beta.1', '1.34.0-beta.1'), ('', None), ('latest', None)]:
        if ren(ind) != ud:
            fejl.append(f'ren({ind!r}) = {ren(ind)!r}, forventet {ud!r}')
    return fejl


def hent(url, navn, json_svar=True):
    """Tre forsoeg. GitHubs API faar arbejdsgangens noegle (GH_TOKEN), saa delte loebere ikke rammer graensen for
    anonyme kald; andre adresser faar den aldrig. Fejlede alle tre, gemmes aarsagen i GRUND[navn]."""
    hoved = dict(UA)
    if url.startswith('https://api.github.com/') and os.environ.get('GH_TOKEN'):
        hoved['Authorization'] = 'Bearer ' + os.environ['GH_TOKEN']
    for forsoeg in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=hoved), timeout=30) as r:
                tekst = r.read().decode('utf-8', 'replace')
            GRUND.pop(navn, None)
            return json.loads(tekst) if json_svar else tekst
        except urllib.error.HTTPError as e:
            GRUND[navn] = f'HTTP {e.code}'
            vent = e.headers.get('Retry-After') if e.code in (403, 429) and e.headers else None
            if forsoeg < 2:
                time.sleep(min(int(vent), 60) if vent and vent.isdigit() else 2)
        except Exception as e:
            GRUND[navn] = type(e).__name__
            if forsoeg < 2:
                time.sleep(2)
    return None


def hent_npm():
    d = hent('https://registry.npmjs.org/' + PAKKE.replace('/', '%2f'), 'npm')
    try:
        v = d['dist-tags']['latest']
        return v, datetime.datetime.fromisoformat(d['time'][v].replace('Z', '+00:00'))
    except Exception:
        return None, None


def hent_register():
    d = hent(f'https://registry.modelcontextprotocol.io/v0/servers?search={REGISTER_NAVN}&version=latest', 'MCP-registret')
    try:
        v = [s.get('server', s).get('version') for s in d.get('servers', []) if s.get('server', s).get('name') == REGISTER_NAVN]
        return ren(v[0]) if len(v) == 1 else None
    except Exception:
        return None


def hent_github():
    d = hent(f'https://api.github.com/repos/{REPO}/releases/latest', 'GitHub release')
    try:
        return ren(d['tag_name'])
    except Exception:
        return None


def hent_side():
    t = hent(SIDE, 'browsermcp.dev', json_svar=False)
    if t is None:
        return None
    v = side_version(t)
    if v is None:
        GRUND['browsermcp.dev'] = 'ingen gyldig ld+json med Browser MCP\'s version'
    return v


def hent_flader():
    return {'MCP-registret': hent_register(), 'GitHub release': hent_github(), 'browsermcp.dev': hent_side()}


def maal(hent_npm_f, hent_flader_f, nu_f):
    """Maal og doem. Er dommen roed, og har npm flyttet sig siden foerste aflaesning (en udgivelse midt i maalingen),
    laeses fladerne igen og doemmes mod den nye npm-version. Returnerer (npm, roed, linjer)."""
    npm, npm_tid = hent_npm_f()
    flader = hent_flader_f()
    roed, linjer = dom(npm, npm_tid, flader, nu_f(), GRUND)
    if roed:
        npm2, tid2 = hent_npm_f()
        if npm2 and (npm2, tid2) != (npm, npm_tid):
            npm, npm_tid = npm2, tid2
            flader = hent_flader_f()
            roed, linjer = dom(npm, npm_tid, flader, nu_f(), GRUND)
    return npm, roed, linjer


if __name__ == '__main__':
    f = selvtest()
    if f:
        print('FLADER-ENS · selvtesten fejlede - ingen dom:', *f, sep='\n  ✗ ')
        sys.exit(1)
    if '--selvtest' in sys.argv:
        print('FLADER-ENS · selvtest groen')
        sys.exit(0)
    npm, roed, linjer = maal(hent_npm, hent_flader, lambda: datetime.datetime.now(datetime.timezone.utc))
    print(f'FLADER-ENS · {REPO} · npm latest {npm or "?"}   (selvtest groen)', *linjer, sep='\n  ')
    sys.exit(1 if roed else 0)
