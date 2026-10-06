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
import { createHash } from 'node:crypto';
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

const PIN = JSON.parse(readFileSync(join(rod, 'data/konkurrent-pin.json'), 'utf8'));
const PLAYWRIGHT = PIN['playwright-mcp'].vaerktoejer.length;

test('forsiden naevner kun det rigtige vaerktoejstal, og sammenligningsraekken matcher begge datakilder', () => {
  assert.ok(VAERKTOEJER >= 30, `tools.js gav ${VAERKTOEJER}`);
  const forkerte = [...html.matchAll(/\b(\d+)\s+(?:browser\s+)?tools\b/gi)].filter((m) => Number(m[1]) !== VAERKTOEJER);
  assert.deepEqual(forkerte.map((m) => m[0]), [], `forsiden siger andre tal end ${VAERKTOEJER}`);
  // Vores celle staar som "N tools", saa udgivelsens tool-sweep (runbrowsermcpupdate.sh 1d) opdaterer den.
  // Playwrights celle er et BART tal med dato, saa samme sweep ikke omskriver en konkurrents tal til vores.
  const raekke = html.match(/<th scope="row">Tool count<\/th><td class="us"><span class="check">(\d+) tools<\/span><\/td><td>(\d+) \(counted (\d{4}-\d{2}-\d{2})\)<\/td>/);
  assert.ok(raekke, 'sammenligningstabellens "Tool count"-raekke har ikke den forventede form');
  assert.equal(Number(raekke[1]), VAERKTOEJER, 'vores tal i tabellen');
  assert.equal(Number(raekke[2]), PLAYWRIGHT, `Playwright-tallet i tabellen skal vaere det pinnede (${PLAYWRIGHT}, data/konkurrent-pin.json)`);
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

test('softwareVersion staar som X.Y.Z og er pakkens version', () => {
  const m = html.match(/"softwareVersion":\s*"(\d+\.\d+\.\d+)"/);
  assert.ok(m, 'softwareVersion mangler (release-scriptet omskriver den)');
  assert.equal(m[1], JSON.parse(readFileSync(join(rod, 'mcp-server/package.json'), 'utf8')).version);
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
  // JPG'en er den metadata faktisk peger paa: maal dens SOF-segment.
  const jpg = readFileSync(join(rod, 'docs/og-image.jpg'));
  let i = 2, dim = null;
  while (i < jpg.length && !dim) {
    assert.equal(jpg[i], 0xff, 'ugyldigt JPEG-segment');
    const mk = jpg[i + 1], len = jpg.readUInt16BE(i + 2);
    if (mk >= 0xc0 && mk <= 0xc3) dim = [jpg.readUInt16BE(i + 7), jpg.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  assert.deepEqual(dim, [1200, 630], 'docs/og-image.jpg skal vaere 1200x630');
});

test('bevaegelse er til at slaa fra, ogsaa det usynlige fokusstop, og animerer ikke alt', () => {
  const reduce = html.match(/@media \(prefers-reduced-motion:reduce\)\{([^\n]*)\}/);
  assert.ok(reduce, 'reduced-motion-reglen mangler');
  assert.match(reduce[1], /\.pause-input\{display:none\}/, 'pause-afkrydsningsfeltet skjules ikke: usynligt fokusstop');
  assert.match(reduce[1], /animation:none!important/);
  assert.match(reduce[1], /transition:none!important/);
  assert.doesNotMatch(html, /transition\s*:\s*all\b/);
  // Kun transform/opacity animeres; clip-path er den ene bevidste undtagelse (skrivningen af koden i scenen).
  const tilladt = new Set(['transform', 'opacity', 'clip-path']);
  const ulovlige = [];
  for (const k of html.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\}\s*(?=@keyframes|\.|@media|\/\*|\n)/g)) {
    for (const p of k[2].matchAll(/([a-z-]+)\s*:/g)) if (!tilladt.has(p[1])) ulovlige.push(`${k[1]}:${p[1]}`);
  }
  assert.deepEqual(ulovlige, [], 'keyframes animerer andet end transform/opacity/clip-path');
  assert.match(html, /name="color-scheme" content="light dark"/);
  assert.match(html, /name="theme-color"[^>]*prefers-color-scheme: dark/);
});

test('forsiden lover ikke det koden ikke goer (Astra 2/10)', () => {
  const t = synlig(html);
  for (const [m, hvorfor] of [
    [/current Chrome tab/i, 'agenten arbejder ikke i faner brugeren selv har aabnet; en frisk session screenshotter about:blank og fejler'],
    [/Gmail tab/i, 'samme: agenten aabner selv Gmail'],
    [/leftover state/i, '~/.browser-mcp/ kan indeholde feedback-log og udpakket udvidelse'],
    [/\bEvery chat\b/i, 'gruppen følger MCP-sessionen, ikke chatten'],
    [/about a minute/i, 'tiden er ikke målt; installationen kræver Node 20 og en klient'],
  ]) assert.doesNotMatch(t, m, hvorfor);
});

test('popup og README lover heller ikke fanen brugeren selv har aaben (3c 5/10: rettet paa forsiden, stod stadig i popup og npm-README)', () => {
  for (const fil of ['extension/popup.html', 'mcp-server/extension/popup.html', 'README.md', 'mcp-server/README.md', 'content/browsermcp-docs-what-is-browser-mcp.md', 'docs/docs/what-is-browser-mcp/index.html']) {
    const t = readFileSync(join(rod, fil), 'utf8');
    assert.doesNotMatch(t, /current Chrome tab/i, `${fil}: agenten screenshotter kun egne faner; en frisk session ser about:blank`);
    assert.doesNotMatch(t, /\bmy Gmail tab\b|own Gmail tab/i, `${fil}: agenten aabner selv Gmail i sin egen fane`);
    assert.doesNotMatch(t, /another tab you have open/i, `${fil}: agenten ser kun sessionens egne faner (Opus R18)`);
    assert.doesNotMatch(t, /<your [a-z]+>/i, `${fil}: vinkelparenteser forsvinder i GitHubs og npms markdown (Opus R19)`);
  }
});

test('ingen lange tankestreger i forsidens synlige tekst', () => {
  const udenKode = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(udenKode, /[–—]|&[mn]dash;|&#821[12];/);
});

test('privacy-teksten er last (hash af den synlige tekst: beviser stabilitet, ikke sandhed) og 404 holdes ude af indekset', () => {
  const body = docs('privacy.html').match(/<body>([\s\S]*)<\/body>/)[1].replace(/<a class="skip"[\s\S]*?<\/header>/, '');
  const tekst = body.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  // Aendres politikken med vilje, opdateres hashen i samme commit og begrundelsen staar i commit-beskeden.
  assert.equal(createHash('sha256').update(tekst).digest('hex'), '7e761c356b6d9142ee76929c4d8b5decf18f79f21f673c00bd3010e384d0dbfb');
  assert.match(docs('404.html'), /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(readFileSync(join(rod, 'docs/sitemap.xml'), 'utf8'), /404\.html/);
});

test('udgivelsens tool-sweep omskriver vores tal men lader konkurrentens stå (Opus/Astra 2/10)', () => {
  // Samme tre regexes som runbrowsermcpupdate.sh trin 1d; scriptet tjekkes for at de stadig står der.
  const script = readFileSync(join(rod, 'runbrowsermcpupdate.sh'), 'utf8');
  for (const r of ['s/\\b[0-9]+ browser tools\\b/${TOOL_COUNT} browser tools/g', 's/\\b[0-9]+ tools\\b/${TOOL_COUNT} tools/g']) {
    assert.ok(script.includes(r), `sweepet er aendret: ${r} findes ikke laengere, saa testens kopi er forkert`);
  }
  const sweep = (t, n) => t.replace(/\b[0-9]+ browser tools\b/g, `${n} browser tools`).replace(/\b[0-9]+ tools\b/g, `${n} tools`).replace(/\b[0-9]+ Tools\b/g, `${n} Tools`);
  const readme = sweep(readFileSync(join(rod, 'README.md'), 'utf8'), 41);
  // Begge steder i README (tabellen og rettelsesafsnittet) skal overleve; en tilbagefoersel af kun det ene maa ikke slippe igennem.
  assert.ok((readme.match(new RegExp(`${PLAYWRIGHT} documented tools`, 'g')) || []).length >= 2, 'README: Playwright-tallet skal overleve sweepet paa begge steder');
  assert.match(readme, new RegExp(`lists ${PLAYWRIGHT} documented tools \\(counted`), 'README: rettelsesafsnittets Playwright-tal');
  const side = sweep(html, 41);
  assert.match(side, new RegExp(`<td>${PLAYWRIGHT} \\(counted \\d{4}-\\d{2}-\\d{2}\\)</td>`), 'forsiden: Playwright-cellen overlever ikke sweepet');
  assert.match(side, /<span class="check">41 tools<\/span>/, 'forsiden: vores celle opdateres ikke af sweepet');
});

// ---- Scenens start- og fallback-logik, kørt med sidens EGNE scripts mod en minimal falsk DOM og et falsk ur.
// Astra R3 (2/10) fandt at en ubetinget 30 s-timer satte .still midt i en afspilning og gjorde Replay virkningsløs.
function simulerSide({ reducedMotion = false, utenObserver = false, observerKaster = false, kunHoved = false } = {}) {
  const sider = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const hoved = sider.find((s) => s.includes("'hold'") && s.includes('IntersectionObserver'));
  const bund = sider[sider.length - 1];
  assert.ok(hoved && bund && hoved !== bund, 'kunne ikke finde sidens to inline-scripts');
  const klasseSaet = () => { const k = new Set(); return { k, classList: { add: (...c) => c.forEach((x) => k.add(x)), remove: (...c) => c.forEach((x) => k.delete(x)), contains: (c) => k.has(c) } }; };
  const rod = klasseSaet(), vindue = klasseSaet(), pause = { checked: true };
  let replayKlik = null; const replay = { addEventListener: (_, f) => { replayKlik = f; } };
  vindue.offsetWidth = 0; vindue.classList.add('run');
  const timere = new Map(); let nu = 0, nr = 0;
  const setTimeout_ = (f, ms) => { timere.set(++nr, { f, at: nu + ms }); return nr; };
  const clearTimeout_ = (i) => { timere.delete(i); };
  const gaaFrem = (ms) => { nu += ms; for (const [i, t] of [...timere]) if (t.at <= nu) { timere.delete(i); t.f(); } };
  let observer = null;
  class IO { constructor(cb, opt) { if (observerKaster) throw new Error('IO kan ikke oprettes'); this.cb = cb; this.opt = opt; this.frakoblet = false; observer = this; } observe() {} disconnect() { this.frakoblet = true; } }
  const win = { bmcpHold: undefined }; if (!utenObserver) win.IntersectionObserver = IO;
  const doc = { documentElement: rod, querySelectorAll: () => [], getElementById: (id) => ({ win: vindue, replay, pause }[id]) };
  const kor = (kode) => new Function('document', 'window', 'matchMedia', 'IntersectionObserver', 'setTimeout', 'clearTimeout', 'navigator', kode)(doc, win, () => ({ matches: reducedMotion }), IO, setTimeout_, clearTimeout_, {});
  kor(hoved);
  if (!kunHoved) kor(bund);
  return { rod, vindue, pause, timere, gaaFrem, get observer() { return observer; }, replay: () => replayKlik(), win };
}

test('scenen: observeren styrer starten, og fallbacken fryser aldrig en scene der spiller', () => {
  const s = simulerSide();
  assert.ok(s.rod.k.has('hold') && s.rod.k.has('js'));
  assert.equal(s.timere.size, 0, 'fallback-timeren skal annulleres naar observeren er sat op');
  assert.equal(s.observer.opt.threshold, 0.4);
  s.observer.cb([{ isIntersecting: true, intersectionRatio: 0.01 }]);
  assert.ok(s.rod.k.has('hold'), '1 % synlig maa ikke starte scenen');
  s.observer.cb([{ isIntersecting: true, intersectionRatio: 0.45 }]);
  assert.ok(!s.rod.k.has('hold') && s.observer.frakoblet, '45 % synlig starter scenen');
  s.gaaFrem(120000);
  assert.ok(!s.rod.k.has('still'), 'efter 2 minutter maa scenen ikke staa i .still');
  s.replay();
  assert.ok(s.vindue.k.has('run') && !s.rod.k.has('hold') && !s.rod.k.has('still'), 'Replay skal virke');
  assert.equal(s.pause.checked, false, 'Replay slaar pausen fra');
});

test('scenen: hvis bundscriptet aldrig koerer, viser fallbacken den faerdige scene efter 5 s', () => {
  const s = simulerSide({ kunHoved: true });
  assert.ok(s.rod.k.has('hold'));
  s.gaaFrem(4900); assert.ok(s.rod.k.has('hold') && !s.rod.k.has('still'));
  s.gaaFrem(200); assert.ok(!s.rod.k.has('hold') && s.rod.k.has('still'));
});

test('scenen: observer der kaster giver sluttilstanden straks, og reduceret bevaegelse / manglende observer holder ikke scenen tilbage', () => {
  const k = simulerSide({ observerKaster: true });
  assert.ok(!k.rod.k.has('hold') && k.rod.k.has('still') && k.timere.size === 0);
  k.replay();
  assert.ok(!k.rod.k.has('still') && k.vindue.k.has('run'), 'Replay skal rydde .still, ellers er knappen doed efter en fejl');
  assert.ok(!simulerSide({ reducedMotion: true }).rod.k.has('hold'));
  assert.ok(!simulerSide({ utenObserver: true }).rod.k.has('hold'));
});
