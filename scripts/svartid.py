#!/usr/bin/env python3
"""Maaler hvor laenge en bidragyder venter paa det FOERSTE svar fra os.

Findes fordi det tal aldrig blev maalt, og fordi det viste sig at vaere det dyreste
tal projektet har. Maalt 20/9, da de tre aeldste endelig blev besvaret:

    PR #20   9 dage, 462 linjer i 6 filer, nul ord
    #11     16 dage
    #19      2 dage til foerste svar, men den aabne halvdel laa 12 dage

En bidragyder der ikke hoerer noget, kan ikke se forskel paa "vi overvejer det" og
"vi har ikke laest det". Nummer to er den der koster - og den er gratis at undgaa.

Maaler to ting pr. aaben traad:
  * timer til foerste svar fra et medlem (naar der ER et)
  * timer siden sidste besked fra en UDENFORSTAAENDE uden svar (naar der ikke er)

Frist: 72 timer. Over den bliver kommandoen roed.
Koeres uden argumenter mod Agent360dk/browser-mcp, eller med --repo <ejer/navn>.
Kraever `gh` med laeseadgang. Skriver intet, sender intet.
"""
import json, subprocess, sys, argparse
from datetime import datetime, timezone

FRIST_TIMER = 72
MEDLEM = {'MEMBER', 'OWNER', 'COLLABORATOR'}


def gh(args):
    r = subprocess.run(['gh', *args], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print(f'gh fejlede: {r.stderr.strip()[:200]}', file=sys.stderr)
        sys.exit(2)
    return json.loads(r.stdout or '[]')


def tid(s):
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def maal(traad, vedligeholdere):
    """(timer, tilstand) for én traad. Tilstand: 'svaret' | 'venter' | 'vores egen'."""
    aabnet = tid(traad['createdAt'])
    forfatter = (traad.get('author') or {}).get('login')
    if forfatter and forfatter in vedligeholdere:
        # Vores eget notat. En traad vi selv har aabnet skylder ingen et svar.
        return (0.0, 'vores egen')
    for k in sorted(traad.get('comments', []), key=lambda c: c['createdAt']):
        if k.get('authorAssociation') in MEDLEM or (k.get('author') or {}).get('login') in vedligeholdere:
            return ((tid(k['createdAt']) - aabnet).total_seconds() / 3600, 'svaret')
    nu = datetime.now(timezone.utc)
    return ((nu - aabnet).total_seconds() / 3600, 'venter')


def selvtest():
    """Proever logikken mod to KENDT-SANDE tilfaelde foer et tal fra den maa bruges.

    ⛔ MAALT 21/9: uden den her kunne vagten ikke blive roed. Begge aabne traade fra
    udenforstaaende VAR besvaret, saa flag-grenen blev aldrig naaet - og "0 over fristen"
    saa groent ud ved enhver frist, ogsaa én time. Et instrument der ikke kan svare nej,
    svarer ikke ja heller.
    """
    from datetime import timedelta
    nu = datetime.now(timezone.utc)
    gammel = (nu - timedelta(days=9)).isoformat().replace('+00:00', 'Z')
    ubesvaret = {'number': 0, 'title': 'syntetisk', 'createdAt': gammel,
                 'author': {'login': 'fremmed'}, 'comments': []}
    besvaret = {'number': 0, 'title': 'syntetisk', 'createdAt': gammel,
                'author': {'login': 'fremmed'}, 'comments': [
                    {'createdAt': (nu - timedelta(days=8)).isoformat().replace('+00:00', 'Z'),
                     'authorAssociation': 'MEMBER', 'author': {'login': 'vedligeholder'}}]}
    vh = {'vedligeholder'}
    fejl = []
    timer, tilstand = maal(ubesvaret, vh)
    if tilstand != 'venter' or timer < 72:
        fejl.append(f'en 9 dage gammel ubesvaret traad blev laest som {tilstand!r}/{timer:.0f}t')
    timer, tilstand = maal(besvaret, vh)
    if tilstand != 'svaret' or not (23 < timer < 25):
        fejl.append(f'et svar efter ét doegn blev laest som {tilstand!r}/{timer:.0f}t')
    return fejl


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--repo', default='Agent360dk/browser-mcp')
    # Fristen er et argument, saa vagten kan proeves mod et kendt-sandt tilfaelde.
    # En vagt der svarer "ingen over fristen" uden at kunne blive roed, maaler ingenting.
    p.add_argument('--frist', type=float, default=FRIST_TIMER, help='timer (standard 72)')
    a = p.parse_args()

    fejl = selvtest()
    if fejl:
        print('SELVTEST FEJLEDE - tallene herunder maa ikke bruges:', file=sys.stderr)
        for f in fejl:
            print('  ✗ ' + f, file=sys.stderr)
        return 2

    felter = 'number,title,createdAt,author,comments'
    traade = (gh(['issue', 'list', '--repo', a.repo, '--state', 'open', '--limit', '100', '--json', felter])
              + gh(['pr', 'list', '--repo', a.repo, '--state', 'open', '--limit', '100', '--json', felter]))

    # ⛔ Vedligeholder-saettet udledes af DATA, ikke af en navneliste i koden: enhver der
    # nogensinde har skrevet som MEMBER/OWNER/COLLABORATOR. En haardkodet liste ville blive
    # forkert den dag nogen kommer til eller gaar, og ingen ville opdage det.
    vedligeholdere = {
        (k.get('author') or {}).get('login')
        for t in traade for k in t.get('comments', [])
        if k.get('authorAssociation') in MEDLEM
    } - {None}
    if not vedligeholdere:
        print('UMAALT: kunne ikke udlede hvem der er vedligeholder - ingen kommentar bar MEMBER/OWNER/COLLABORATOR',
              file=sys.stderr)
        return 2

    over, svartider, egne = [], [], 0
    for t in traade:
        timer, tilstand = maal(t, vedligeholdere)
        if tilstand == 'vores egen':
            egne += 1
            continue
        if tilstand == 'svaret':
            svartider.append(timer)
        elif timer > a.frist:
            over.append((t['number'], t['title'][:58], timer))

    print(f'SVARTID · {a.repo}   (selvtest groen)')
    print(f'  vedligeholdere udledt af data: {", ".join(sorted(vedligeholdere))}')
    print(f'  aabne traade fra udenforstaaende: {len(traade) - egne}   (vores egne notater: {egne})')
    if svartider:
        svartider.sort()
        median = svartider[len(svartider) // 2]
        print(f'  median tid til foerste svar: {median / 24:.1f} dage   (vaerste: {max(svartider) / 24:.1f})')
    else:
        print('  median tid til foerste svar: UMAALT - ingen besvarede traade er aabne')

    if over:
        print(f'\n  ⛔ {len(over)} venter over fristen paa {a.frist:g} timer:')
        for nr, titel, timer in sorted(over, key=lambda x: -x[2]):
            print(f'     #{nr}  {timer / 24:5.1f} dage  {titel}')
        return 1
    print(f'\n  ✓ ingen venter over {a.frist:g} timer')
    return 0


if __name__ == '__main__':
    sys.exit(main())
