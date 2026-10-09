#!/usr/bin/env python3
"""Teksten i en HTML-side, som en parser laeser den: den synlige tekst som EN sammenhaengende stroem, og derefter hver
attributvaerdi og hver kommentar for sig, med tegnreferencer afkodet.

R63-R65 (Astra, MAALT): bagudlistens regex blev snydt tre gange i traek - af attributter med enkelte anfoerselstegn og
mellemrum om lighedstegnet, af `&#x27`/`&#39` uden semikolon, og af et `>` inde i en citeret attributvaerdi. Samme laere som
cache-vagten (R58-R60): en tokenizer adskiller attributter og tekst, saa de klasser findes ikke her. html.parser afkoder
tegnreferencer efter HTML5-reglerne, ogsaa uden semikolon.
R66 (Astra, MAALT): attributter og kommentarer blev flettet ind i den synlige tekst, saa `A headless <em class="x">browser`
blev til «A headless x browser», og et ord delt af et tag eller en kommentar blev til to. Den synlige tekst samles nu uden
indsatte mellemrum (kun ved blokelementer), og attributter og kommentarer kommer bagefter, hver for sig.

  side-tekst.py <mappe>   -> JSON {sti: tekst} for hver .html under mappen
  side-tekst.py -         -> laeser en JSON-liste af HTML-strenge paa stdin og skriver en liste af tekster
"""
import json
import os
import sys
from html.parser import HTMLParser

BLOK = {'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset',
        'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav',
        'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'ul',
        'script', 'style', 'head', 'body', 'html', 'meta', 'link', 'noscript', 'option', 'select', 'textarea', 'button'}


class Tekst(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stroem, self.ekstra = [], []

    def handle_starttag(self, tag, attrs):
        if tag in BLOK:
            self.stroem.append(' ')
        self.ekstra.extend(v for _, v in attrs if v)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in BLOK:
            self.stroem.append(' ')

    def handle_data(self, data):
        self.stroem.append(data)

    def handle_comment(self, data):
        self.ekstra.append(data)


def tekst(html):
    p = Tekst()
    p.feed(html)
    p.close()
    dele = [''.join(p.stroem)] + p.ekstra
    # Delene adskilles med \u241e (et tegn, ingen side bruger), saa et moenster aldrig kan strække sig fra én del til den næste.
    return '\u241e'.join(' '.join(d.split()) for d in dele if d.strip())


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
