/**
 * Forsiden (docs/index.html) og de to haandskrevne sider ved siden af maa holde de loefter de giver.
 *
 * 2/10-2026: forsiden blev skrevet om fra bunden (ny scene, kortere tekst, ingen tredjepartskald). Docs-spaerren
 * (scripts/check-docs.py) ser de genererede sider; den ser kun om forsidens canonical findes. Her staar resten af det
 * der er lovet og som en senere redigering let kan bryde uden at nogen ser det: et billede der peger i tomme luft,
 * to h1, en FAQ der er gledet fra sine strukturerede data, et kald til en tredjepart paa en side der lover ingen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const docs = (f) => readFileSync(join(rod, 'docs', f), 'utf8');
const html = docs('index.html');
const VAERKTOEJER = (readFileSync(join(rod, 'mcp-server/tools.js'), 'utf8').match(/name: ['"]browser_/g) || []).length;
const synlig = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

test('forsiden har praecis een h1 og et skip-link der rammer et element der findes', () => {
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  const m = html.match(/<a class="skip" href="#([^"]+)"/);
  assert.ok(m, 'skip-link mangler');
  assert.ok(html.includes(`id="${m[1]}"`), `skip-linket peger paa #${m[1]}, som ikke findes`);
});

test('forsiden naevner kun det rigtige vaerktoejstal', () => {
  assert.ok(VAERKTOEJER >= 30, `tools.js gav ${VAERKTOEJER}`);
  // 73 er Playwright MCP's tal i sammenligningstabellen (konkurrent-vagten ejer det).
  const forkerte = [...html.matchAll(/\b(\d+)\s+(?:browser\s+)?tools\b/gi)].filter((m) => Number(m[1]) !== VAERKTOEJER && Number(m[1]) !== 73);
  assert.deepEqual(forkerte.map((m) => m[0]), [], `forsiden siger andre tal end ${VAERKTOEJER}`);
  const raekke = html.match(/<th scope="row">Tool count<\/th><td class="us"><span class="check">(\d+)<\/span>/);
  assert.ok(raekke, 'sammenligningstabellens vaerktoejstal-raekke mangler');
  assert.equal(Number(raekke[1]), VAERKTOEJER);
});

test('"20 samtidige" staar ikke som maalt: kapacitet hedder "op til 20"', () => {
  assert.doesNotMatch(synlig(html), /\b20\s+concurrent\b/i);
});

const norm = (t) => t.replace(/<\/(p|li|div)>|<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')
  .replace(/&ldquo;/g, '\u201C').replace(/&rdquo;/g, '\u201D').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();

test('FAQPage-data er ordret det der staar paa siden (Googles krav)', () => {
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const faq = ld.find((o) => o['@type'] === 'FAQPage');
  assert.ok(faq, 'FAQPage mangler');
  const side = [...html.matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => m[0]);
  assert.equal(faq.mainEntity.length, side.length, 'forskelligt antal spoergsmaal i data og side');
  faq.mainEntity.forEach((q, i) => {
    assert.equal(q.name, norm(side[i].match(/<summary[^>]*>([\s\S]*?)<\/summary>/)[1]), `spoergsmaal ${i + 1} afviger`);
    assert.equal(q.acceptedAnswer.text, norm(side[i].match(/<div class="answer">([\s\S]*?)<\/div>\s*<\/details>/)[1]), `svar ${i + 1} afviger`);
  });
});

test('softwareVersion staar som X.Y.Z (release-scriptet omskriver den)', () => {
  assert.match(html, /"softwareVersion":\s*"\d+\.\d+\.\d+"/);
});

test('forsiden kalder ingen tredjepart ved indlaesning', () => {
  assert.doesNotMatch(html, /<script[^>]+\ssrc=/i, 'ekstern/ekstra script-fil');
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|api\.github\.com|googletagmanager|google-analytics|fonts\.(googleapis|gstatic)/i);
  const udefra = [...html.matchAll(/\s(?:src|srcset)="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]);
  assert.deepEqual(udefra, [], 'billede/medie hentet udefra');
  const link = [...html.matchAll(/<link\b[^>]*\bhref="https?:\/\/[^"]+"[^>]*>/g)].map((m) => m[0]).filter((l) => !/rel="canonical"/.test(l));
  assert.deepEqual(link, [], 'link til tredjepart ud over canonical');
});

test('de billeder siderne peger paa findes og har det maal der staar', () => {
  for (const [side, tekst] of [['index.html', html], ['privacy.html', docs('privacy.html')]]) {
    for (const m of tekst.matchAll(/<meta (?:property="og:image"|name="twitter:image") content="https:\/\/browsermcp\.dev\/([^"]+)"/g)) {
      const f = join(rod, 'docs', m[1]);
      assert.ok(existsSync(f) && statSync(f).size > 10_000, `${side} peger paa ${m[1]}, som ikke findes`);
    }
  }
  const png = readFileSync(join(rod, 'docs/github-social-1280x640.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1280, 640]);
  const og = readFileSync(join(rod, 'docs/og-image.png'));
  assert.deepEqual([og.readUInt32BE(16), og.readUInt32BE(20)], [1200, 630]);
});

test('bevaegelse er til at slaa fra og animerer ikke alt', () => {
  assert.match(html, /prefers-reduced-motion\s*:\s*reduce/);
  assert.doesNotMatch(html, /transition\s*:\s*all\b/);
  assert.match(html, /name="color-scheme" content="light dark"/);
  assert.match(html, /name="theme-color"[^>]*prefers-color-scheme: dark/);
});

test('ingen lange tankestreger i forsidens synlige tekst', () => {
  const udenKode = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(udenKode, /[–—]|&[mn]dash;|&#821[12];/);
});

test('privacy er uaendret i substans og 404 holdes ude af indekset', () => {
  const p = synlig(docs('privacy.html'));
  for (const s of ['Nothing is sent to Agent360', 'is not password-protected', 'hello@agent360.dk']) assert.ok(p.includes(s), `privacy mangler "${s}"`);
  assert.match(docs('404.html'), /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(readFileSync(join(rod, 'docs/sitemap.xml'), 'utf8'), /404\.html/);
});
