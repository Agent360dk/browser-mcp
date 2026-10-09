#!/usr/bin/env python3
"""Finder hver omtale af docs.css og docs.js i HTML-siderne under en mappe, som en browser ville laese dem.

R58-R60 (Astra, MAALT): en tekstsoegning blev snydt tre gange i traek - af entiteter og tabulatorer i adressen, af
CSS-escapes og procent-kodning, og til sidst af kommentartegn inde i en attributvaerdi, der fik et rigtigt <link> til at
ligne en kommentar. En HTML-tokenizer adskiller attributter, tekst og rigtige kommentarer, saa den sidste klasse findes
ikke her. CSS-escapes afkodes efter CSS Syntax 3 FOER URL-parserens fjernelse af tabulatorer og linjeskift (`d\\9 cs`
bliver en tabulator, som URL-parseren fjerner; `d\\6f<TAB>cs` bruger tabulatoren som escapens afslutning).

Udskriver JSON: {side: {"kanon": [[endelse, noegle], ...], "raa": antal, "omtaler": [tekst, ...]}}.
  kanon   - <link href> eller <script src> med praecis /assets/docs.(css|js)?v=<8 hex>
  raa     - antal kanoniske henvisninger i kildeteksten i den citerede form, som generatoren opdaterer
  omtaler - alt andet, der efter afkodning naevner en af de to filer
"""
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


def naevner(tekst):
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

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        self._stykke(tag)

    def handle_data(self, data):
        self._stykke(data)

    def handle_comment(self, data):
        pass  # en rigtig kommentar indlaeses ikke

    def unknown_decl(self, data):
        self._stykke(data)

    def handle_pi(self, data):
        self._stykke(data)


def main(mappe):
    ud = {}
    for rod, _, filer in os.walk(mappe):
        for f in filer:
            if not f.endswith('.html'):
                continue
            sti = os.path.join(rod, f)
            kilde = open(sti, encoding='utf-8').read()
            p = Side()
            p.feed(kilde)
            p.close()
            ud[os.path.relpath(sti, mappe)] = {'kanon': p.kanon, 'raa': len(RAA.findall(kilde)), 'omtaler': p.omtaler}
    print(json.dumps(ud, sort_keys=True))


if __name__ == '__main__':
    main(sys.argv[1])
