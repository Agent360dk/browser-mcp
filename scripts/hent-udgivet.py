#!/usr/bin/env python3
"""Hent det en fremmed faar i dag - butikkens udvidelse og/eller npm-serveren - til flow-spaerren.

26/9: spaerren maalte kun repoets egen kode. Kriterie 1 («virker for en fremmed der installerer i
dag») kraever at maale det der faktisk er udgivet: udvidelsen fra Chrome Web Store og serveren fra
npm. Scriptet henter dem, beviser hvad det har hentet, og skriver miljoevariablerne spaerren bruger.

Beviserne (et af dem fejler -> exit 1, intet skrives):
  - butikkens manifest har den forventede version
  - butikkens pakke og taggets extension/ har PRAECIS de samme filer (begge veje - en manglende
    fil er lige saa forkert som en ekstra), og hver fil er byte for byte lig tagget. Undtaget er
    kun butikkens egen _metadata/, .DS_Store og manifestets «key»/«update_url»; manifestet
    sammenlignes derfor som JSON (formatering og noegleorden tilgives)
  - npm-pakken har den forventede version, og dens erklaerede brugerindgang (package.json «bin»)
    findes, og npm-KOMMANDOEN - det link npm laver i node_modules/.bin, som `npx` koerer direkte,
    altsaa gennem filens shebang - svarer med versionen

Hver hentning pakkes ud i sin EGEN nye mappe under --ud: en genbrugt mappe kunne blande gamle filer
ind i det der maales (Astra 27/9).

Brug:
  hent-udgivet.py --udvidelse 1.30.1 --server 1.30.1 --ud <mappe>
Udskriver linjer til $GITHUB_OUTPUT:  UDGIVET_UDVIDELSE=<mappe>  UDGIVET_SERVER=<brugerindgangen, bin/cli.js>
"""
import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

UDVIDELSES_ID = 'jdehgalffmffhfhmmhaokfbfnafnmgcl'
CRX_URL = ('https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0'
           '&acceptformat=crx2,crx3&x=id%3D{id}%26uc')
BUTIKKENS_TILFOEJELSER = {'_metadata'}


def pak_crx_ud(crx: bytes, mappe: str) -> None:
    """En CRX er en signeret header efterfulgt af en helt almindelig zip."""
    i = crx.find(b'PK\x03\x04')
    if i < 0:
        raise ValueError('ingen zip i CRX-filen - er det en fejlside?')
    zipfile.ZipFile(io.BytesIO(crx[i:])).extractall(mappe)


def filer(mappe: str):
    for rod, _, navne in os.walk(mappe):
        for n in navne:
            rel = os.path.relpath(os.path.join(rod, n), mappe)
            if rel.split(os.sep)[0] in BUTIKKENS_TILFOEJELSER or n == '.DS_Store':
                continue
            yield rel


def tag_filer(version: str, repo: str) -> set:
    r = subprocess.run(['git', '-C', repo, 'ls-tree', '-r', '--name-only', f'v{version}', '--', 'extension/'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f'tagget v{version} findes ikke i {repo}: {r.stderr.strip()}')
    return {n[len('extension/'):] for n in r.stdout.splitlines()
            if n.startswith('extension/') and os.path.basename(n) != '.DS_Store'}


def forskelle_mod_tag(mappe: str, version: str, repo: str) -> list:
    """Filer der IKKE er byte-identiske med tagget, begge veje. Manifestet sammenlignes uden butikkens felter."""
    forskelle = []
    # 27/9 (Astra): kun butikkens filer blev gennemloebet - en pakke UDEN popup.js var «lig tagget».
    for rel in sorted(tag_filer(version, repo) - set(filer(mappe))):
        forskelle.append(f'{rel}: findes i tagget v{version}, men mangler i pakken')
    for rel in sorted(filer(mappe)):
        r = subprocess.run(['git', '-C', repo, 'show', f'v{version}:extension/{rel}'], capture_output=True)
        if r.returncode != 0:
            forskelle.append(f'{rel}: findes ikke i tagget v{version}')
            continue
        butik = open(os.path.join(mappe, rel), 'rb').read()
        if rel == 'manifest.json':
            b, t = json.loads(butik), json.loads(r.stdout)
            for felt in ('key', 'update_url'):
                b.pop(felt, None)
                t.pop(felt, None)
            if b != t:
                forskelle.append('manifest.json: afviger fra tagget')
        elif butik != r.stdout:
            forskelle.append(f'{rel}: ikke byte-identisk med tagget')
    return forskelle


def ny_mappe(ud: str, navn: str) -> str:
    """En NY, tom mappe pr. hentning. En genbrugt mappe beholdt filer fra en tidligere hentning,
    og de blev maalt som om butikken havde udleveret dem (Astra 27/9)."""
    os.makedirs(ud, exist_ok=True)
    return tempfile.mkdtemp(prefix=f'{navn}-', dir=ud)


def hent_udvidelse(version: str, ud: str, repo: str) -> str:
    mappe = ny_mappe(ud, 'udvidelse')
    crx = urllib.request.urlopen(CRX_URL.format(id=UDVIDELSES_ID), timeout=60).read()
    pak_crx_ud(crx, mappe)
    fik = json.load(open(os.path.join(mappe, 'manifest.json'))).get('version')
    if fik != version:
        raise SystemExit(f'butikken udleverer {fik}, ikke {version}')
    forskelle = forskelle_mod_tag(mappe, version, repo)
    if forskelle:
        raise SystemExit('butikkens pakke er ikke tagget v%s:\n  %s' % (version, '\n  '.join(forskelle)))
    print(f'butikkens udvidelse {version}: {sum(1 for _ in filer(mappe))} filer, alle lig tagget', file=sys.stderr)
    return mappe


def hent_server(version: str, ud: str) -> str:
    mappe = ny_mappe(ud, 'server')
    subprocess.run(['npm', 'install', '--prefix', mappe, '--no-audit', '--no-fund', '--silent',
                    f'@agent360/browser-mcp@{version}'], check=True)
    pakke = os.path.join(mappe, 'node_modules', '@agent360', 'browser-mcp')
    fik = json.load(open(os.path.join(pakke, 'package.json'))).get('version')
    if fik != version:
        raise SystemExit(f'npm udleverede {fik}, ikke {version}')
    # 27/9 (Astra): en fremmed starter serveren gennem pakkens «bin» (npx), ikke index.js. Er bin
    # defekt, virker index.js stadig - og spaerren saa intet. Brugerindgangen proeves og bruges.
    bin_felt = json.load(open(os.path.join(pakke, 'package.json'))).get('bin')
    rel = bin_felt.get('browser-mcp') if isinstance(bin_felt, dict) else bin_felt
    if not rel:
        raise SystemExit('npm-pakken erklaerer ingen brugerindgang «browser-mcp» i package.json «bin»')
    indgang = os.path.normpath(os.path.join(pakke, rel))
    if not os.path.isfile(indgang):
        raise SystemExit(f'npm-pakkens brugerindgang {rel} findes ikke i pakken')
    # 27/9 (Astra R2): `node cli.js` omgaar shebang'en. npx koerer npm's link DIREKTE - uden
    # `#!/usr/bin/env node` starter kommandoen slet ikke. Linket proeves derfor som npx bruger det.
    kommando = os.path.join(mappe, 'node_modules', '.bin', 'browser-mcp')
    if not os.path.exists(kommando):
        raise SystemExit('npm lavede ingen kommando «browser-mcp» i node_modules/.bin - bin-feltet virker ikke')
    try:
        svar = subprocess.run([kommando, '--version'], capture_output=True, text=True, timeout=60)
    except OSError as e:
        raise SystemExit(f'npm-kommandoen browser-mcp kan ikke startes (shebang/koerselsret?): {e}')
    if svar.returncode != 0 or svar.stdout.strip() != version:
        raise SystemExit(f'npm-kommandoen browser-mcp svarede ikke {version} paa --version '
                         f'(exit {svar.returncode}): {(svar.stdout + svar.stderr).strip()[:200]}')
    print(f'npm-serveren {version} hentet - kommandoen browser-mcp ({rel}) svarer {version}', file=sys.stderr)
    return indgang


def main() -> int:
    a = argparse.ArgumentParser()
    a.add_argument('--udvidelse', default='')
    a.add_argument('--server', default='')
    a.add_argument('--ud', required=True)
    a.add_argument('--repo', default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    arg = a.parse_args()
    linjer = []
    if arg.udvidelse:
        linjer.append(f'UDGIVET_UDVIDELSE={hent_udvidelse(arg.udvidelse, arg.ud, arg.repo)}')
    if arg.server:
        linjer.append(f'UDGIVET_SERVER={hent_server(arg.server, arg.ud)}')
    print('\n'.join(linjer))
    return 0


if __name__ == '__main__':
    sys.exit(main())
