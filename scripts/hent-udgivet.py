#!/usr/bin/env python3
"""Hent det en fremmed faar i dag - butikkens udvidelse og/eller npm-serveren - til flow-spaerren.

26/9: spaerren maalte kun repoets egen kode. Kriterie 1 («virker for en fremmed der installerer i
dag») kraever at maale det der faktisk er udgivet: udvidelsen fra Chrome Web Store og serveren fra
npm. Scriptet henter dem, beviser hvad det har hentet, og skriver miljoevariablerne spaerren bruger.

Beviserne (et af dem fejler -> exit 1, intet skrives):
  - butikkens manifest har den forventede version
  - hver fil i butikkens pakke er byte for byte lig filen i tagget v<version> (butikkens egen
    _metadata/ og manifestets «key»/«update_url» er det eneste butikken tilfoejer)
  - npm-pakken har den forventede version

Brug:
  hent-udgivet.py --udvidelse 1.30.1 --server 1.30.1 --ud <mappe>
Udskriver linjer til $GITHUB_ENV:  UDGIVET_UDVIDELSE=<mappe>  UDGIVET_SERVER=<index.js>
"""
import argparse
import io
import json
import os
import subprocess
import sys
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


def forskelle_mod_tag(mappe: str, version: str, repo: str) -> list:
    """Filer der IKKE er byte-identiske med tagget. Manifestet sammenlignes uden butikkens felter."""
    forskelle = []
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


def hent_udvidelse(version: str, ud: str, repo: str) -> str:
    mappe = os.path.join(ud, 'udvidelse')
    os.makedirs(mappe, exist_ok=True)
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
    mappe = os.path.join(ud, 'server')
    os.makedirs(mappe, exist_ok=True)
    subprocess.run(['npm', 'install', '--prefix', mappe, '--no-audit', '--no-fund', '--silent',
                    f'@agent360/browser-mcp@{version}'], check=True)
    pakke = os.path.join(mappe, 'node_modules', '@agent360', 'browser-mcp')
    fik = json.load(open(os.path.join(pakke, 'package.json'))).get('version')
    if fik != version:
        raise SystemExit(f'npm udleverede {fik}, ikke {version}')
    print(f'npm-serveren {version} hentet', file=sys.stderr)
    return os.path.join(pakke, 'index.js')


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
