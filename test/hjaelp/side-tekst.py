#!/usr/bin/env python3
"""Teksten i en HTML-side, som en parser laeser den: tekst, attributvaerdier og kommentarer, med tegnreferencer afkodet.

R63-R65 (Astra, MAALT): bagudlistens regex blev snydt tre gange i traek - af attributter med enkelte anfoerselstegn og
mellemrum om lighedstegnet, af `&#x27`/`&#39` uden semikolon, og af et `>` inde i en citeret attributvaerdi. Samme lære som
cache-vagten (R58-R60): en tokenizer adskiller attributter og tekst, saa de klasser findes ikke her. html.parser afkoder
tegnreferencer efter HTML5-reglerne, ogsaa uden semikolon.

  side-tekst.py <mappe>   -> JSON {sti: tekst} for hver .html under mappen
  side-tekst.py -         -> laeser en JSON-liste af HTML-strenge paa stdin og skriver en liste af tekster
"""
import json
import os
import sys
from html.parser import HTMLParser


class Tekst(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.dele = []

    def handle_starttag(self, tag, attrs):
        self.dele.extend(v for _, v in attrs if v)

    handle_startendtag = handle_starttag

    def handle_data(self, data):
        self.dele.append(data)

    def handle_comment(self, data):
        self.dele.append(data)


def tekst(html):
    p = Tekst()
    p.feed(html)
    p.close()
    return ' '.join(' '.join(p.dele).split())


if __name__ == '__main__':
    if sys.argv[1] == '-':
        print(json.dumps([tekst(s) for s in json.load(sys.stdin)]))
    else:
        mappe = sys.argv[1]
        ud = {}
        for rod, _, filer in os.walk(mappe):
            for f in filer:
                if f.endswith('.html'):
                    sti = os.path.join(rod, f)
                    ud[os.path.relpath(sti, mappe)] = tekst(open(sti, encoding='utf-8').read())
        print(json.dumps(ud, sort_keys=True))
