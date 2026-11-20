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
  * en flade afviger, og npm latest er hoejst 1 dag gammel   -> groen med note (udgivelsen er i gang:
    npm kommer foerst, registret, GitHub og siden foelger inden for timer)
  * en flade afviger, og npm latest er mere end 1 dag gammel -> ROED (en flade blev glemt, eller en udgivelse
    stoppede halvvejs - fx siden live foer npm)
  * en kilde kunne ikke laeses                               -> ROED (UMAALT): et ukendt svar er aldrig et groent svar
"""
import datetime, json, re, sys, urllib.request

PAKKE = '@agent360/browser-mcp'
REGISTER_NAVN = 'io.github.Agent360dk/browser-mcp'
REPO = 'Agent360dk/browser-mcp'
SIDE = 'https://browsermcp.dev/'
GRAENSE_DAGE = 1
UA = {'User-Agent': 'browsermcp-flader-ens'}


def ren(v):
    """«v1.33.0» -> «1.33.0». Andet end en version -> None."""
    v = (v or '').strip()
    v = v[1:] if v[:1] in ('v', 'V') else v
    return v if re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?', v) else None


def dom(npm, npm_tid, flader, nu):
    """(roed, linjer). flader = {navn: version eller None}. npm_tid og nu er datetime med tidszone."""
    linjer, roed = [], False
    if not npm or npm_tid is None:
        return True, ['✗ UMAALT: npm latest kunne ikke laeses']
    alder = (nu - npm_tid).total_seconds() / 86400
    for navn, v in flader.items():
        if v is None:
            roed = True
            linjer.append(f'✗ UMAALT: {navn} kunne ikke laeses')
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
    ]
    fejl = [f'{a[0]} {a[2]} -> roed={dom(*a, nu)[0]}, forventet {r}' for a, r in forventet if dom(*a, nu)[0] != r]
    for ind, ud in [('v1.33.0', '1.33.0'), ('1.33.0', '1.33.0'), ('1.34.0-beta.1', '1.34.0-beta.1'), ('', None), ('latest', None)]:
        if ren(ind) != ud:
            fejl.append(f'ren({ind!r}) = {ren(ind)!r}, forventet {ud!r}')
    return fejl


def hent(url, json_svar=True):
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                tekst = r.read().decode('utf-8', 'replace')
            return json.loads(tekst) if json_svar else tekst
        except Exception:
            pass
    return None


def hent_npm():
    d = hent('https://registry.npmjs.org/' + PAKKE.replace('/', '%2f'))
    try:
        v = d['dist-tags']['latest']
        return v, datetime.datetime.fromisoformat(d['time'][v].replace('Z', '+00:00'))
    except Exception:
        return None, None


def hent_register():
    d = hent(f'https://registry.modelcontextprotocol.io/v0/servers?search={REGISTER_NAVN}&version=latest')
    try:
        v = [s.get('server', s).get('version') for s in d.get('servers', []) if s.get('server', s).get('name') == REGISTER_NAVN]
        return ren(v[0]) if len(v) == 1 else None
    except Exception:
        return None


def hent_github():
    d = hent(f'https://api.github.com/repos/{REPO}/releases/latest')
    try:
        return ren(d['tag_name'])
    except Exception:
        return None


def hent_side():
    t = hent(SIDE, json_svar=False) or ''
    v = set(re.findall(r'"softwareVersion"\s*:\s*"([^"]+)"', t))
    return ren(v.pop()) if len(v) == 1 else None


if __name__ == '__main__':
    f = selvtest()
    if f:
        print('FLADER-ENS · selvtesten fejlede - ingen dom:', *f, sep='\n  ✗ ')
        sys.exit(1)
    if '--selvtest' in sys.argv:
        print('FLADER-ENS · selvtest groen')
        sys.exit(0)
    npm, npm_tid = hent_npm()
    flader = {'MCP-registret': hent_register(), 'GitHub release': hent_github(), 'browsermcp.dev': hent_side()}
    roed, linjer = dom(npm, npm_tid, flader, datetime.datetime.now(datetime.timezone.utc))
    print(f'FLADER-ENS · {REPO} · npm latest {npm or "?"}   (selvtest groen)', *linjer, sep='\n  ')
    sys.exit(1 if roed else 0)
