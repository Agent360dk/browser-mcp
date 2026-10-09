#!/usr/bin/env python3
"""Finder hver omtale af docs.css og docs.js i HTML-siderne under en mappe, som en browser ville laese dem.

R58-R60 (Astra, MAALT): en tekstsoegning blev snydt tre gange i traek - af entiteter og tabulatorer i adressen, af
CSS-escapes og procent-kodning, og til sidst af kommentartegn inde i en attributvaerdi, der fik et rigtigt <link> til at
ligne en kommentar. En HTML-tokenizer adskiller attributter, tekst og rigtige kommentarer, saa den sidste klasse findes
ikke her. CSS-escapes afkodes efter CSS Syntax 3 FOER URL-parserens fjernelse af tabulatorer og linjeskift (`d\\9 cs`
bliver en tabulator, som URL-parseren fjerner; `d\\6f<TAB>cs` bruger tabulatoren som escapens afslutning).

R61 (Astra, MAALT): `<!-->` lukker en kommentar i en browser, men ikke i html.parser, saa et link efter den var skjult for
vagten; et `srcdoc` er et helt dokument i en attribut (dobbelt kodet); og et stylesheet kan selv hente et andet med
@import. Afbrudte kommentarer afvises, srcdoc og base64-data:-dokumenter laeses som HTML, og .css-filer laeses ogsaa.
Et script der saetter en adresse sammen mens siden koerer, kan ingen statisk vagt se - det dækkes ikke.

R62 (Astra, MAALT): en afbrudt kommentar INDE i et srcdoc og en CSS-kommentarstart inde i en URL-streng skjulte en henvisning
igen. Formerne lukkes derfor ikke enkeltvis laengere: hele filen afkodes til et fikspunkt (entiteter, CSS-escapes,
procent-kodning, tabulatorer og linjeskift), og navnene maa derefter kun forekomme lige saa mange gange, som filen har
kanoniske henvisninger. En omtale i en kommentar taeller ogsaa - det er prisen for en regel uden huller.

Udskriver JSON: {side: {"kanon": [[endelse, noegle], ...], "raa": antal, "omtaler": [tekst, ...]}}.
  kanon   - <link href> eller <script src> med praecis /assets/docs.(css|js)?v=<8 hex>
  raa     - antal kanoniske henvisninger i kildeteksten i den citerede form, som generatoren opdaterer
  omtaler - alt andet, der efter afkodning naevner en af de to filer
"""
import base64
import html
import json
import os
import re
import sys
from html.parser import HTMLParser
from urllib.parse import unquote

NAVN = re.compile(r'docs\.(css|js)', re.I)
KANON = re.compile(r'/assets/docs\.(css|js)\?v=([0-9a-f]{8})')
RAA = re.compile(r'(?<![\w-])(?:href|src)="/assets/docs\.(?:css|js)\?v=[0-9a-f]{8}"')
HVOR = {'css': ('link', 'href'), 'js': ('script', 'src')}
AFBRUDT = re.compile(r'<!---?>')   # HTML: «<!-->» og «<!--->» er tomme kommentarer, der lukker straks
DATA64 = re.compile(r'^\s*data:[^,]*;base64,(.*)$', re.I | re.S)


def css_afkod(s):
    """CSS Syntax 3, 4.3.7: op til seks hex-cifre, og et efterfoelgende mellemrum, tabulator eller linjeskift hoerer
    med til escapen. En backslash foer et linjeskift er en fortsaettelse."""
    ud, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c != '\\':
            ud.append(c)
            i += 1
            continue
        i += 1
        if i >= n:
            ud.append('�')
            break
        if s.startswith('\r\n', i):
            i += 2
            continue
        if s[i] in '\n\r\f':
            i += 1
            continue
        m = re.match(r'[0-9a-fA-F]{1,6}', s[i:])
        if m:
            v = int(m.group(0), 16)
            i += len(m.group(0))
            if s.startswith('\r\n', i):
                i += 2
            elif i < n and s[i] in ' \t\n\r\f':
                i += 1
            ud.append(chr(v) if 0 < v <= 0x10FFFF and not 0xD800 <= v <= 0xDFFF else '�')
        else:
            ud.append(s[i])
            i += 1
    return ''.join(ud)


def fikspunkt(tekst):
    """Afkod til intet aendrer sig mere: HTML-entiteter, CSS-escapes, procent-kodning, tabulatorer og linjeskift."""
    for _ in range(12):
        ny = re.sub(r'[\t\n\r]', '', unquote(css_afkod(html.unescape(tekst)), errors='replace'))
        if ny == tekst:
            break
        tekst = ny
    return tekst


def naevner(tekst):
    if NAVN.search(fikspunkt(tekst)):
        return True
    for v in (tekst, css_afkod(tekst)):
        v = re.sub(r'[\t\n\r]', '', v)
        if NAVN.search(v) or NAVN.search(unquote(v, errors='replace')):
            return True
    return False


class Side(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.kanon, self.omtaler = [], []

    def _stykke(self, tekst):
        if tekst and naevner(tekst):
            self.omtaler.append(tekst[:200])

    def handle_starttag(self, tag, attrs):
        self._stykke(tag)
        for navn, vaerdi in attrs:
            m = KANON.fullmatch(vaerdi or '')
            if m and HVOR[m.group(1).lower()] == (tag, navn) and m.group(1) in ('css', 'js'):
                self.kanon.append([m.group(1), m.group(2)])
                continue
            self._stykke(navn)
            self._stykke(vaerdi)
            self._indlejret(navn, vaerdi or '')

    def _indlejret(self, navn, vaerdi):
        """Et dokument inde i en attribut: srcdoc, eller en data:-adresse i base64. Alt i det, der naevner de to filer,
        er en omtale - ogsaa en kanonisk henvisning, for generatoren opdaterer den ikke."""
        indre = None
        if navn == 'srcdoc':
            indre = vaerdi
        else:
            m = DATA64.match(vaerdi)
            if m:
                try:
                    indre = base64.b64decode(re.sub(r'\s', '', m.group(1)) + '===').decode('utf-8', 'replace')
                except Exception:
                    indre = None
                if indre is not None and naevner(indre):
                    self.omtaler.append(('data:base64 ' + indre)[:200])
                    return
        if indre is None:
            return
        under = Side()
        under.feed(indre)
        under.close()
        self.omtaler += [f'{navn}: {o}' for o in under.omtaler]
        self.omtaler += [f'{navn}: afbrudt kommentar {m.group(0)}' for m in AFBRUDT.finditer(indre)]
        if len(NAVN.findall(fikspunkt(indre))) > 0:
            self.omtaler.append(f'{navn}: dokumentet naevner docs.css/docs.js')
        self.omtaler += [f'{navn}: docs.{e}?v={n}' for e, n in under.kanon]

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        self._stykke(tag)

    def handle_data(self, data):
        self._stykke(data)

    def handle_comment(self, data):
        pass  # en rigtig kommentar indlaeses ikke (de afbrudte afvises i main, foer parseren ser dem)

    def unknown_decl(self, data):
        self._stykke(data)

    def handle_pi(self, data):
        self._stykke(data)


def main(mappe):
    ud = {}
    for rod, _, filer in os.walk(mappe):
        for f in filer:
            sti = os.path.join(rod, f)
            if f.endswith('.css'):
                # Et stylesheet henter andre med @import og url(). Kommentarer fjernes ikke: en kommentarstart inde i en
                # URL-streng er ikke en kommentar (R62), saa et stylesheet maa slet ikke naevne de to filer.
                kilde = open(sti, encoding='utf-8').read()
                ud[os.path.relpath(sti, mappe)] = {'kanon': [], 'raa': 0, 'omtaler': [kilde[:200]] if naevner(kilde) else []}
                continue
            if not f.endswith('.html'):
                continue
            kilde = open(sti, encoding='utf-8').read()
            p = Side()
            p.feed(kilde)
            p.close()
            omtaler = p.omtaler + [f'afbrudt kommentar {m.group(0)} - en browser lukker kommentaren dér' for m in AFBRUDT.finditer(kilde)]
            # Lukkereglen: efter afkodning til fikspunkt maa navnene kun staa i de kanoniske henvisninger.
            i_alt = len(NAVN.findall(fikspunkt(kilde)))
            if i_alt != len(p.kanon):
                omtaler.append(f'filen naevner docs.css/docs.js {i_alt} gange efter afkodning, men har {len(p.kanon)} kanoniske henvisninger')
            ud[os.path.relpath(sti, mappe)] = {'kanon': p.kanon, 'raa': len(RAA.findall(kilde)), 'omtaler': omtaler}
    print(json.dumps(ud, sort_keys=True))


if __name__ == '__main__':
    main(sys.argv[1])
