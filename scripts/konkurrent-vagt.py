#!/usr/bin/env python3
"""
Konkurrent-vagt - holder oeje med de paastande VI goer om ANDRE.

Hvorfor den findes: 19/9-2026 stod der ni sider paa browsermcp.dev og paastod at
Playwright MCP var headless, kraevede login hver gang, blev blokeret paa 2FA-sider og
kun kunne koere én session. Alle fire var falske - Microsoft sender en Chrome-udvidelse
der bruger din egen indloggede browser og giver hver klient sin egen farvede fanegruppe.
README'en var rettet 7/9; de otte andre sider var ikke. Intet gen-laeste deres
dokumentation, saa fejlen kunne ligge i ti dage uden at nogen opdagede den.

Designet, og hvorfor det ikke er et ord-tjek:
  En vagt der leder efter strengen `ask_user` kan narres af en omdoebning. Derfor pinner
  denne vagt MAENGDEN - hele saettet af vaerktoejsnavne og de ordrette citater vores
  paastande hviler paa. Aendrer saettet sig, bliver vagten roed og et menneske laeser.
  Det er samme laere som husets: soeg paa mekanikken, ikke paa navnet.

  Det daekker ogsaa doedsvarslet: vores ENESTE tilbagevaerende position er at ingen af
  Playwrights vaerktoejer kan standse og spoerge mennesket. Den dag de tilfoejer ét,
  aendrer saettet sig, og vagten siger det - i stedet for at vi opdager det ved et tilfaelde.

Brug:
  python3 scripts/konkurrent-vagt.py           # tjek mod det pinnede
  python3 scripts/konkurrent-vagt.py --pin     # gem nuvaerende tilstand som sandhed
"""
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIN = os.path.join(ROOT, 'data', 'konkurrent-pin.json')

# True betyder at kilden SKAL indeholde en vaerktoejsliste. Svarer den 0, er det
# instrumentet der er i stykker - ikke konkurrenten der har fjernet alt. MAALT 19/9:
# foerste udgave pegede paa Googles README, hvor vaerktoejerne IKKE staar (de ligger i
# docs/tool-reference.md), og vagten pinnede glad 0 vaerktoejer og sagde "alt uaendret".
# En vagt der svarer nul skal proeves mod et kendt-sandt tilfaelde foer tallet bruges.
KILDER = {
    'playwright-mcp': ('https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md', True),
    'playwright-udvidelse': ('https://raw.githubusercontent.com/microsoft/playwright/main/packages/extension/README.md', False),
    'chrome-devtools-mcp': ('https://raw.githubusercontent.com/ChromeDevTools/chrome-devtools-mcp/main/docs/tool-reference.md', True),
}

# Hver linje er en paastand VI goer offentligt. Falder citatet vaek, er vores side forkert.
CITATER = [
    ('playwright-mcp', 'leverage your logged-in sessions',
     'Vi skriver at deres udvidelse bruger din egen indloggede browser'),
    ('playwright-udvidelse', 'its own tab group',
     'Vi skriver at de ogsaa giver hver klient sin egen fanegruppe - raekken vi FOER paastod var vores alene'),
]

def kontekst(tekst, citat, bredde=180):
    """Normaliseret afsnit omkring citatet.

    MAALT 19/9 af reviewet: et bart `citat in tekst` passerer hvis saetningen negeres -
    "does NO LONGER leverage your logged-in sessions" indeholder stadig citatet, og vagten
    sagde groent. Derfor pinnes KONTEKSTEN: aendrer saetningen omkring citatet sig
    overhovedet, bliver vagten roed og et menneske laeser. Samme filosofi som
    vaerktoejsmaengden - vi er ikke kloge paa sprog, vi opdager at noget flyttede sig."""
    i = tekst.lower().find(citat.lower())
    if i < 0:
        return None
    return ' '.join(tekst[max(0, i - bredde): i + len(citat) + bredde].split())


def hent(url):
    r = urllib.request.Request(url, headers={'User-Agent': 'browser-mcp-konkurrent-vagt'})
    return urllib.request.urlopen(r, timeout=30).read().decode('utf-8', 'replace')

def vaerktoejer(tekst):
    # Microsoft praefikser med browser_; Google goer ikke, og lister dem som overskrifter
    navne = set(re.findall(r'\bbrowser_[a-z_]+', tekst))
    navne |= set(re.findall(r'^#+\s+`?([a-z][a-z0-9_]{3,40})`?\s*$', tekst, re.M))
    navne |= set(re.findall(r'^[-*]\s+`([a-z][a-z0-9_]{3,40})`', tekst, re.M))
    return sorted(navne)

def maal(pinner=False):
    stand = {}
    for navn, (url, skal_have) in KILDER.items():
        t = hent(url)
        v = vaerktoejer(t)
        if skal_have and not v:
            raise SystemExit('KALIBRERING FEJLER: %s gav 0 vaerktoejer, men kilden skal have en '
                             'liste. Instrumentet peger forkert - ret URL foer du pinner.' % navn)
        cit = {c: kontekst(t, c) for k, c, _ in CITATER if k == navn}
        # MAALT 19/9: foerste udgave haengte "leverage your logged-in sessions" paa
        # udvidelsens README. Citatet staar i playwright-mcp's README, saa det blev pinnet
        # som FALSE - og et citat der er pinnet fravaerende, bliver aldrig vogtet. Samme
        # klasse som nul-vaerktoejerne: instrumentet svarede, og svaret var tomt.
        # Kalibreringen gaelder KUN naar vi pinner. MAALT 19/9 af reviewet: i drift betyder
        # et forsvundet citat at KONKURRENTEN aendrede sig - det er hele fundet, ikke en
        # fejl i instrumentet. Kastede vi ogsaa her, blev fundet meldt som en kalibreringsfejl
        # med raadet "ret URL", og den rigtige handling (ret siden) blev aldrig naevnt.
        if pinner:
            for c, fandtes in cit.items():
                if fandtes is None:
                    raise SystemExit('KALIBRERING FEJLER: citatet "%s" findes ikke i %s. '
                                     'Enten er kilden forkert, eller ogsaa er paastanden allerede '
                                     'usand. Begge dele skal ses paa - ikke pinnes.' % (c, navn))
        stand[navn] = {'vaerktoejer': v, 'citater': cit}
    return stand

# Vores egne paastande om andres vaerktoejstal. MAALT 19/9 af reviewet: vagten pinnede 58
# vaerktoejer hos Google samme dag som `when-not-to-use.md` sagde 52 - og vagten var groen,
# fordi den kun laeste konkurrenten og aldrig os selv. Det ER det gab der laa i ti dage:
# virkeligheden flyttede sig, siden ikke, og ingen sammenlignede de to.
EGNE_TAL = [
    ('playwright-mcp', re.compile(r'(\d+)\s+(?:documented\s+)?tools?\b', re.I),
     ['README.md', 'content/browsermcp-compare-playwright-mcp.md',
      'content/browsermcp-compare-mcp-servers.md', 'docs/index.html']),
]

def egne_paastande(stand):
    """Roed hvis en af VORES sider oplyser et andet vaerktoejstal end det maalte."""
    fejl = []
    for kilde, moenster, filer in EGNE_TAL:
        maalt = len(stand.get(kilde, {}).get('vaerktoejer', []))
        if not maalt:
            continue
        for f in filer:
            sti = os.path.join(ROOT, f)
            if not os.path.exists(sti):
                continue
            tekst = open(sti, encoding='utf-8', errors='replace').read()
            for m in moenster.finditer(tekst):
                tal = int(m.group(1))
                # 40 er VORES eget antal; det staar i de samme tabeller og er ikke en
                # paastand om dem. Alt andet der ligner et konkurrent-tal, skal passe.
                if tal == 40 or tal == maalt:
                    continue
                if abs(tal - maalt) > 40:
                    continue   # aabenlyst et andet tal (stjerner, downloads)
                fejl.append('%s siger "%s" om %s, men der er %d. Ret siden'
                            % (f, m.group(0).strip(), kilde, maalt))
    return fejl


def main():
    pinner = '--pin' in sys.argv
    stand = maal(pinner=pinner)
    if pinner:
        os.makedirs(os.path.dirname(PIN), exist_ok=True)
        json.dump(stand, open(PIN, 'w'), indent=2, sort_keys=True)
        for n, d in stand.items():
            print('PINNET %-22s %d vaerktoejer' % (n, len(d['vaerktoejer'])))
        return 0
    if not os.path.exists(PIN):
        print('INGEN PIN - koer med --pin foerst'); return 2
    gammel = json.load(open(PIN))
    fejl = []
    for navn, d in stand.items():
        g = gammel.get(navn)
        if g is None:
            fejl.append('%s: ny kilde, ikke pinnet' % navn); continue
        nye = set(d['vaerktoejer']) - set(g['vaerktoejer'])
        vaek = set(g['vaerktoejer']) - set(d['vaerktoejer'])
        if nye:
            fejl.append('%s: NYE vaerktoejer %s - laes hvad de goer. Kan ét af dem standse og '
                        'spoerge mennesket, er vores eneste position vaek og siderne skal rettes SAMME DAG'
                        % (navn, sorted(nye)))
        if vaek:
            fejl.append('%s: vaerktoejer FJERNET %s - en paastand om dem kan vaere blevet forkert'
                        % (navn, sorted(vaek)))
        for c, foer in g['citater'].items():
            nu = d['citater'].get(c)
            hvorfor = next(h for k, cc, h in CITATER if cc == c)
            if nu is None:
                fejl.append('%s: citatet "%s" findes ikke laengere. %s' % (navn, c, hvorfor))
            elif foer and nu != foer:
                fejl.append('%s: saetningen OMKRING "%s" er aendret - den kan vaere blevet '
                            'negeret eller taget forbehold for. %s\n      FOER: %s\n      NU:   %s'
                            % (navn, c, hvorfor, str(foer)[:150], str(nu)[:150]))
    fejl.extend(egne_paastande(stand))
    for n, d in stand.items():
        print('  %-22s %3d vaerktoejer' % (n, len(d['vaerktoejer'])))
    if fejl:
        print('\nKONKURRENT-VAGT: %d aendring(er) - en paastand paa vores sider kan vaere blevet usand' % len(fejl))
        for f in fejl: print('  X ' + f)
        return 1
    print('\nKONKURRENT-VAGT: alt uaendret - det vi siger om dem passer stadig')
    return 0

if __name__ == '__main__':
    sys.exit(main())
