#!/usr/bin/env python3
"""Bygger film-16x9.html og film-9x16.html fra forsidens EGEN scene (docs/index.html): samme CSS, samme markup, saa filmen
og siden aldrig kan vise to forskellige ting. Genopret filmen efter ENHVER aendring af scenen paa forsiden.

  python3 demo-video-src/film/bygg-film.py                      # skriver HTML-sider til demo-video-src/film/ud/
  CHROME=/sti/til/chrome node demo-video-src/film/optag.mjs demo-video-src/film/ud/film-16x9.html /tmp/rammer --sek 15
  ffmpeg -framerate 30 -i /tmp/rammer/f%04d.jpg -vf \"scale=in_range=pc:out_range=tv,format=yuv420p\" -c:v libx264 -crf 20 -preset slow -movflags +faststart -an docs/film.mp4
  (lodret: film-9x16.html med --w 1080 --h 1920)"""
import re, sys, os
HER = os.path.dirname(os.path.abspath(__file__))
ROD = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(HER))
UD = os.path.join(HER, 'ud'); os.makedirs(UD, exist_ok=True)
h = open(os.path.join(ROD, 'docs/index.html'), encoding='utf8').read()
css = re.search(r'<style>([\s\S]*?)</style>', h).group(1)
a = h.index('<div class="win run"'); b = h.index('<figcaption>', a)
win = h[a:b].rstrip()
win = re.sub(r'<div class="win run" id="win" role="img" aria-label="[^"]*"', '<div class="win run" id="win"', win)

def side(vertikal):
    W, H = (1080, 1920) if vertikal else (1920, 1080)
    scene_w = 960 if vertikal else 900
    extra = f'''
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:var(--paper)}}
.film{{position:relative;width:{W}px;height:{H}px;font-family:var(--sans);color:var(--ink)}}
.caps{{position:absolute;{'left:0;right:0;top:215px;text-align:center' if vertikal else 'left:110px;width:720px;top:330px;text-align:left'}}}
.cap{{position:absolute;left:0;right:0;top:0;opacity:0;font-weight:700;letter-spacing:-.03em;font-size:{66 if vertikal else 72}px;line-height:1.08;padding:0 {70 if vertikal else 0}px;text-wrap:balance;animation:cap var(--len) var(--ease-out) var(--at) none}}
@keyframes cap{{0%{{opacity:0;transform:translateY(14px)}}7%,90%{{opacity:1;transform:none}}100%{{opacity:0;transform:none}}}}
.stage{{position:absolute;left:{(W-scene_w)//2 if vertikal else 900}px;top:{(480 if vertikal else 115)}px;width:{scene_w}px;animation:sceneout .5s ease 11.2s forwards}}
@keyframes sceneout{{to{{opacity:0;transform:scale(.98)}}}}
.illu{{position:absolute;{'left:0;right:0;bottom:70px;text-align:center;padding:0 60px' if vertikal else 'left:110px;width:700px;bottom:90px;text-align:left;line-height:1.4'};font-size:{27 if vertikal else 22}px;color:var(--muted);animation:sceneout .5s ease 11.2s forwards}}
.end{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:{40 if vertikal else 34}px;padding:0 {80 if vertikal else 240}px;opacity:0;animation:endin .6s var(--ease-out) 11.6s forwards}}
@keyframes endin{{from{{opacity:0;transform:translateY(16px)}}to{{opacity:1;transform:none}}}}
.end .lg{{display:flex;align-items:center;gap:18px;font-weight:700;font-size:{44 if vertikal else 38}px}}
.end .lg i{{width:{72 if vertikal else 60}px;height:{72 if vertikal else 60}px;border-radius:16px;background:linear-gradient(135deg,#4F8EF7,#1A73E8);display:grid;place-items:center}}
.end .lg svg{{width:60%;height:60%}}
.end h2{{font-size:{92 if vertikal else 84}px;line-height:1.04;letter-spacing:-.04em;font-weight:700;text-wrap:balance}}
.end .cm{{font:500 {30 if vertikal else 28}px/1.35 var(--mono);background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:26px 34px;max-width:100%;word-break:break-all;text-align:left}}
.end .sub{{font-size:{34 if vertikal else 30}px;color:var(--muted)}}
.end .url{{font-weight:700;font-size:{40 if vertikal else 34}px}}
'''
    caps = [('0.2s', '3.1s', 'Four agents. Four tab groups.'), ('3.3s', '5.2s', 'One hits a 2FA code and asks you.'), ('8.5s', '2.6s', 'You type it. It carries on, signed in.')]
    cap_html = ''.join(f'<div class="cap" style="--at:{at};--len:{ln}">{t}</div>' for at, ln, t in caps)
    spark = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z"/><path d="M19 14l.9 2.6L22.5 17.5l-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z"/></svg>'
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Browser MCP film</title><style>{css}{extra}</style></head><body>
<div class="film"><div class="caps">{cap_html}</div>
<div class="stage"><figure class="scene" id="scene" style="margin:0;width:{scene_w}px">{win}</figure></div>
<div class="illu">Simplified illustration. The tab groups, the box and the log follow the real extension (the real log lists the newest line first); the page is made up.</div>
<div class="end"><div class="lg"><i>{spark}</i><span translate="no">Browser MCP</span></div><h2>Your agent works in the Chrome you’re already signed into.</h2><div class="cm">claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest</div><div class="sub">Free, open-source, MIT. Nothing is sent to Agent360.</div><div class="url">browsermcp.dev</div></div></div></body></html>'''

for navn, v in (('film-16x9.html', False), ('film-9x16.html', True)):
    open(os.path.join(UD, navn), 'w', encoding='utf8').write(side(v)); print('skrevet', navn)
