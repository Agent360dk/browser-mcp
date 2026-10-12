#!/usr/bin/env python3
"""Finder hver omtale af docs.css og docs.js i HTML-siderne under en mappe, som en browser ville laese dem.

R58-R60 (Astra, MAALT): en tekstsoegning blev snydt tre gange i traek - af entiteter og tabulatorer i adressen, af
CSS-escapes og procent-kodning, og til sidst af kommentartegn inde i en attributvaerdi, der fik et rigtigt <link> til at
ligne en kommentar. En HTML-tokenizer adskiller attributter, tekst og rigtige kommentarer, saa den sidste klasse findes
ikke her. CSS-escapes afkodes efter CSS Syntax 3 FOER URL-parserens fjernelse af tabulatorer og linjeskift (`d\\9 cs`
bliver en tabulator, som URL-parseren fjerner; `d\\6f<TAB>cs` bruger tabulatoren som escapens afslutning).

R61 (Astra, MAALT): `<!-->` lukker en kommentar i en browser, men ikke i html.parser, saa et link efter den var skjult for
vagten; et `srcdoc` er et helt dokument i en attribut (dobbelt kodet); og et stylesheet kan selv hente et andet med
@import. (R61 lukkede dem enkeltvis; R62 erstattede det med lukkereglen nedenfor, og R64 forbyder base64-data helt.)
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


# R63 (Astra, maalt): base64 laestes kun i attributter og kun ét lag, `; base64` med mellemrum blev ikke set, og 12 runder var
# ikke et fikspunkt (16 lag srcdoc). Nu afkodes der til intet aendrer sig mere.
# R64 (Astra, maalt): mellemrum, tabulatorer, linjeskift og procent-kodning INDE i base64-dataene slap igennem - hver ny
# afkoder aabner en ny form. Generatoren skriver ingen base64-data (maalt 9/10: 0 af 43 sider har `;base64,`), saa formen
# forbydes i stedet for at blive afkodet: en side eller et stylesheet med base64-data er en omtale, uanset hvad dataene
# indeholder. Moensteret proeves paa hvert trin af afkodningen, saa en kodet `;base64,` ogsaa ses. Browseren kraever
# ordet `base64` i et stykke lige efter semikolon og mellemrum (Fetch: data: URL processor); entiteter, CSS-escapes,
# procent-kodning og tabulatorer afkodes her foer, saa vagten ser mindst det, browseren ser.
BASE64 = re.compile(r';\s*base64\s*,', re.I)


def fikspunkt(tekst):
    """Afkod til intet aendrer sig mere: HTML-entiteter, CSS-escapes, procent-kodning, tabulatorer og linjeskift.
    Svarer (tekst, om base64-data blev set paa et af trinene). Et trin, der aendrer noget, goer teksten kortere (kun en enlig
    backslash til sidst bliver til ét erstatningstegn, og det sker én gang), saa det ender altid."""
    base64_set = False
    for _ in range(100000):
        base64_set = base64_set or bool(BASE64.search(tekst))
        ny = re.sub(r'[\t\n\r]', '', unquote(css_afkod(html.unescape(tekst)), errors='replace'))
        if ny == tekst:
            break
        tekst = ny
    return tekst, base64_set


def naevner(tekst):
    afkodet, base64_set = fikspunkt(tekst)
    if base64_set or NAVN.search(afkodet):
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
            omtaler = list(p.omtaler)
            # Lukkereglen: efter afkodning til fikspunkt maa navnene kun staa i de kanoniske henvisninger.
            afkodet, base64_set = fikspunkt(kilde)
            if base64_set:
                omtaler.append('filen har base64-data (;base64,), som vagten ikke ser ind i - generatoren skriver ingen')
            i_alt = len(NAVN.findall(afkodet))
            if i_alt != len(p.kanon):
                omtaler.append(f'filen naevner docs.css/docs.js {i_alt} gange efter afkodning, men har {len(p.kanon)} kanoniske henvisninger')
            ud[os.path.relpath(sti, mappe)] = {'kanon': p.kanon, 'raa': len(RAA.findall(kilde)), 'omtaler': omtaler}
    print(json.dumps(ud, sort_keys=True))


if __name__ == '__main__':
    main(sys.argv[1])
