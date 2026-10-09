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
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
    assert.doesNotMatch(t, /<(?:your|url|site|page|app)(?:[\s_-][^>]*)?>/i, `${fil}: vinkelparenteser forsvinder i GitHubs og npms markdown (Opus R19)`);
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
  assert.equal(createHash('sha256').update(tekst).digest('hex'), '92883499c28184bc77c42844c7dbfbc8b16fd58b6e454763a50d90f09279b160');
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

// 1.30.2 skive 19 (Opus R38): manifestets beskrivelse sagde «carries on in the tab you were already signed into» - kan
// laeses som brugerens EGEN fane; agenten arbejder i sine egne faner i brugerens Chrome. Samme budskab som butiksteksten v5
// («Your agent works in the Chrome you're already signed into»), ikke ordret samme tekst.
test('manifestets korte beskrivelse siger «the Chrome you\'re signed into», ikke brugerens egen fane, og holder sig under 132 tegn', () => {
  for (const f of ['extension/manifest.json', 'mcp-server/extension/manifest.json']) {
    const d = JSON.parse(readFileSync(join(rod, f), 'utf8')).description;
    assert.ok(d.length <= 132, `${f}: ${d.length} tegn - Chrome Web Store tillader 132`);
    assert.match(d, /the Chrome you're signed into/, `${f}: siger ikke at det er brugerens Chrome`);
    assert.doesNotMatch(d, /the tab you were already signed into|carries on in the tab/, `${f}: kan laeses som brugerens egen fane`);
  }
  // R62 (Opus): npm-beskrivelsen og to sider havde stadig samme formulering.
  const npm = JSON.parse(readFileSync(join(rod, 'mcp-server/package.json'), 'utf8')).description;
  for (const [f, t] of [['mcp-server/package.json', npm], ...['content/browsermcp-compare-playwright-mcp.md', 'content/browsermcp-usecase-codex-2fa.md'].map((x) => [x, readFileSync(join(rod, x), 'utf8')])]) {
    assert.doesNotMatch(t, /the tab you were already signed into|carries on in the tab that was already signed in/, `${f}: kan laeses som brugerens egen fane`);
  }
});

// 1.30.2 skive 11 (F9): docs/ serveres som browsermcp.dev. Tre interne noter (butikstekst-revision, opsaetning af
// butiksudgivelse, en performance-maaling) laa der og blev serveret med status 200. De ligger nu i noter/.
test('docs/ indeholder ingen interne noter, kun den genererede llms-install.md', () => {
  // R56 (Astra): kun docs/ selv blev laest - en note i docs/internal/ slap igennem. Hele traeet gennemgaas.
  const md = [];
  const gaa = (d) => { for (const e of readdirSync(join(rod, d), { withFileTypes: true })) {
    if (e.isDirectory()) gaa(join(d, e.name)); else if (/\.(md|markdown)$/i.test(e.name)) md.push(join(d, e.name).split('\\').join('/')); } };
  gaa('docs');
  assert.deepEqual(md, ['docs/llms-install.md'], `markdown i docs/ bliver serveret offentligt: ${md.join(', ')}`);
  for (const f of ['CWS_LISTING_TEXT.md', 'CWS_PUBLISH_SETUP.md', 'PERFORMANCE-2026-09-08.md']) {
    assert.ok(existsSync(join(rod, 'noter', f)), `noter/${f} mangler - en henvisning peger paa en fil der ikke findes`);
  }
});

// 1.30.2 skive 13 (D3): hver side, der henter docs.css eller docs.js, bruger den noegle, filens indhold giver.
// R58-R60 (Astra, MAALT): en tekstsoegning blev snydt af entiteter, tabulatorer, CSS-escapes, procent-kodning og til
// sidst af kommentartegn inde i en attributvaerdi. Siderne laeses nu med en HTML-tokenizer (test/hjaelp/asset-henvisninger.py),
// og der er EN tilladt form: <link href> / <script src> med praecis /assets/docs.(css|js)?v=<noegle>. Hver anden omtale af
// de to filer i en attribut eller en tekst er en fejl.
const henvisninger = (mappe) => JSON.parse(execFileSync('python3', ['-I', join(rod, 'test/hjaelp/asset-henvisninger.py'), mappe],
  { encoding: 'utf8' }));
const noegle8 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 8);

test('css og js hentes kun i den kanoniske form med en noegle, der passer til filens indhold', () => {
  const v = { css: noegle8(join(rod, 'docs/assets/docs.css')), js: noegle8(join(rod, 'docs/assets/docs.js')) };
  const sider = henvisninger(join(rod, 'docs'));
  let set = 0;
  for (const [s, h] of Object.entries(sider)) {
    assert.deepEqual(h.omtaler, [], `${s}: docs.css/docs.js naevnes uden for den kanoniske form href="/assets/docs.css?v=<noegle>"`);
    assert.equal(h.raa, h.kanon.length, `${s}: ${h.kanon.length} kanoniske henvisninger, men ${h.raa} i den citerede form generatoren opdaterer`);
    for (const [endelse, n] of h.kanon) {
      set++;
      assert.equal(n, v[endelse], `${s}: docs.${endelse} hentes med en foraeldet noegle (${n}) - koer scripts/generate-docs.py`);
    }
  }
  assert.equal(set, 82, `${set} kanoniske henvisninger - 42 sider henter css og 40 js; et andet tal betyder at noget er faldet ud`);
});

// Vagten maa ikke kunne snydes af de former, der slap igennem R58-R60. Hver skal give en omtale.
test('vagten finder de former, der slap igennem tidligere runder', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const k = '<link rel="stylesheet" href="/assets/docs.css?v=05f4bb13">';
  const former = {
    'tab-entitet.html': `<link rel='stylesheet' href='/assets/do&#9;cs.css?v=old'>`,
    'kommentar-i-attribut.html': `<meta name="a" content="<!--">\n<link rel="stylesheet" href='/assets/docs.css?v=old'>\n<meta name="b" content="-->">`,
    'css-tab-escape.html': `<style>@import url("/assets/do\\9 cs.css?v=old");</style>`,
    'css-hex-med-tab.html': `<style>@import url("/assets/d\\6f\tcs.css?v=old");</style>`,
    'procent.html': `<img srcset="/assets/do%63s.css?v=old 1x" alt="">`,
    'relativ.html': `<link rel="stylesheet" href="assets/docs.css?v=old">`,
    'data-href.html': `<a data-href="/assets/docs.css?v=05f4bb13">x</a>`,
    'forkert-element.html': `<script src="/assets/docs.css?v=05f4bb13"></script>`,
    'ucciteret.html': `<link rel="stylesheet" href=/assets/docs.css?v=05f4bb13>`,
    // R61 (Astra): en afbrudt kommentar lukker i browseren, men ikke i parseren; srcdoc og data: er dokumenter i en attribut.
    'afbrudt-kommentar.html': `<!--><link rel='stylesheet' href='/assets/docs.css?v=old'><!-- -->`,
    'afbrudt-kommentar2.html': `<!---><link rel='stylesheet' href='/assets/docs.css?v=old'><!-- -->`,
    'srcdoc.html': `<iframe srcdoc="<link rel=stylesheet href=/assets/do&amp;#99;s.css?v=old>"></iframe>`,
    'srcdoc-kanonisk.html': `<iframe srcdoc='<link rel="stylesheet" href="/assets/docs.css?v=05f4bb13">'></iframe>`,
    'data-base64.html': `<iframe src="data:text/html;base64,PGxpbmsgcmVsPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg=="></iframe>`,
    'import.css': `@import url("/assets/docs.css?v=old");`,
    // R62 (Astra): en afbrudt kommentar INDE i et srcdoc eller et base64-dokument, og en kommentarstart inde i en URL-streng.
    'srcdoc-afbrudt.html': `<iframe srcdoc="&lt;!--&gt;&lt;link rel=stylesheet href=/assets/do&amp;#99;s.css?v=old&gt;&lt;!-- --&gt;"></iframe>`,
    'data-afbrudt.html': `<iframe src="data:text/html;base64,PCEtLT48bGluayByZWw9c3R5bGVzaGVldCBocmVmPS9hc3NldHMvZG8mIzk5O3MuY3NzP3Y9b2xkPjwhLS0gLS0+"></iframe>`,
    'url-streng.css': '@import url("data:text/css,/*");\n@import url("/assets/docs.css?v=old");\n/* end */',
    // R63 (Astra): base64 i srcdoc, base64 i base64, base64 i CSS, base64 efter en afbrudt kommentar, 16 lag srcdoc og
    // «; base64» med mellemrum.
    "srcdoc-base64.html": "<iframe srcdoc=\"<iframe src=&quot;data:text/html;base64,PGxpbmsgcmVsPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==&quot;></iframe>\"></iframe>",
    "base64-i-base64.html": "<iframe src=\"data:text/html;base64,PGlmcmFtZSBzcmM9ImRhdGE6dGV4dC9odG1sO2Jhc2U2NCxQR3hwYm1zZ2NtVnNQWE4wZVd4bGMyaGxaWFFnYUhKbFpqMHZZWE56WlhSekwyUnZZM011WTNOelAzWTliMnhrUGc9PSI+PC9pZnJhbWU+\"></iframe>",
    "base64-css.html": "<style>@import url(\"data:text/css;base64,QGltcG9ydCB1cmwoL2Fzc2V0cy9kb2NzLmNzcz92PW9sZCk7\");</style>",
    "base64-efter-afbrudt.html": "<!--><iframe src=\"data:text/html;base64,PGxpbmsgcmVsPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==\"></iframe><!-- -->",
    "srcdoc-16-lag.html": "<iframe srcdoc=\"&lt;iframe srcdoc=&quot;&amp;lt;iframe srcdoc=&amp;quot;&amp;amp;lt;iframe srcdoc=&amp;amp;quot;&amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;quot;&amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;iframe srcdoc=&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;link rel=stylesheet href=/assets/do&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;#99;s.css?v=old&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;quot;&amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;amp;gt;&amp;amp;amp;amp;quot;&amp;amp;amp;amp;gt;&amp;amp;amp;amp;lt;/iframe&amp;amp;amp;amp;gt;&amp;amp;amp;quot;&amp;amp;amp;gt;&amp;amp;amp;lt;/iframe&amp;amp;amp;gt;&amp;amp;quot;&amp;amp;gt;&amp;amp;lt;/iframe&amp;amp;gt;&amp;quot;&amp;gt;&amp;lt;/iframe&amp;gt;&quot;&gt;&lt;/iframe&gt;\"></iframe>",
    "base64-mellemrum.html": "<iframe src=\"data:text/html; base64,PGxpbmsgcmVsPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==\"></iframe>",
    // R64 (Astra): mellemrum, tabulator, linjeskift og procent-kodning INDE i dataene. Base64-data er nu forbudt i sig selv,
    // saa ogsaa et ufarligt billede, en kodet `;base64,` og et komma kodet som %2C i medietypen afvises.
    "base64-mellemrum-i-data.html": "<iframe src=\"data:text/html;base64,PGxpbmsgcmVs PXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==\"></iframe>",
    "base64-tab-i-data.html": "<iframe src=\"data:text/html;base64,PGxpbmsgcmVs\tPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==\"></iframe>",
    "base64-linjeskift-i-data.html": "<iframe src=\"data:text/html;base64,PGxpbmsgcmVs\nPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==\"></iframe>",
    "base64-procent-i-data.html": "<iframe src=\"data:text/html;base64,PGxpbmsgcmVs%50XN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==\"></iframe>",
    "base64-uciteret-boolesk.html": "<iframe srcdoc=\"<iframe src=data:text/html;base64,PGxpbmsgcmVsPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg hidden></iframe>\"></iframe>",
    "base64-komma-i-medietype.html": "<iframe src=\"data:text/html%2C;base64,PGxpbmsgcmVsPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==\"></iframe>",
    "base64-kodet-ord.html": "<iframe src=\"data:text/html;&#98;ase64,PGxpbmsgcmVsPXN0eWxlc2hlZXQgaHJlZj0vYXNzZXRzL2RvY3MuY3NzP3Y9b2xkPg==\"></iframe>",
    "base64-ufarligt-billede.html": "<img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\" alt=\"\">",
    "base64.css": "@import url(\"data:text/css;base64,QGltcG9ydCB1cmwoL2Fzc2V0cy9kb2NzLmNzcz92PW9sZCk7\");",
  };
  const tmp = mkdtempSync(join(tmpdir(), 'vagt-'));
  try {
    for (const [f, html] of Object.entries(former)) writeFileSync(join(tmp, f), html);
    writeFileSync(join(tmp, 'kommentar.html'), `<!-- ${k} -->`);
    writeFileSync(join(tmp, 'rigtig.html'), k);
    writeFileSync(join(tmp, 'base64-ord.html'), `${k}<p>returns base64 PNG; base64 of the config</p>`);
    writeFileSync(join(tmp, 'gammel-i-kommentar.html'), `<!-- foer: /assets/docs.css?v=old -->\n${k}`);
    writeFileSync(join(tmp, 'kommentar.css'), '/* tidligere: docs.css?v=old */ body { color: red }');
    const h = henvisninger(tmp);
    for (const f of Object.keys(former)) {
      const fanget = h[f].omtaler.length > 0 || h[f].raa !== h[f].kanon.length;
      assert.ok(fanget, `${f}: vagten saa ingen fejl i ${former[f]}`);
    }
    // R62: lukkereglen taeller ogsaa en omtale i en kommentar - det er prisen for en regel uden huller.
    assert.deepEqual([h['kommentar.html'].kanon.length, h['kommentar.html'].raa], [0, 1], 'en henvisning i en kommentar er ikke en indlaesning');
    assert.ok(h['kommentar.html'].omtaler.length > 0, 'en kanonisk henvisning i en kommentar skal afvises');
    assert.ok(h['gammel-i-kommentar.html'].omtaler.length > 0, 'en gammel adresse i en kommentar skal afvises');
    assert.ok(h['kommentar.css'].omtaler.length > 0, 'et stylesheet maa slet ikke naevne de to filer, heller ikke i en kommentar');
    assert.deepEqual(h['rigtig.html'], { kanon: [['css', '05f4bb13']], raa: 1, omtaler: [] });
    // R64: ordet base64 i almindelig tekst er ikke data - de udgivne sider skriver «returns base64 PNG».
    assert.deepEqual(h['base64-ord.html'], { kanon: [['css', '05f4bb13']], raa: 1, omtaler: [] });
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('generatorens noeglefunktion retter den kanoniske form og intet andet', () => {
  const kilde = readFileSync(join(rod, 'scripts/generate-docs.py'), 'utf8');
  const blok = kilde.slice(kilde.indexOf('_KANON = re.compile'), kilde.indexOf("CSS_V if m.group(2) == 'css' else JS_V), t)") + "CSS_V if m.group(2) == 'css' else JS_V), t)".length);
  const py = `import re\nCSS_V = 'aaaa1111'\nJS_V = 'bbbb2222'\n${blok}\nimport json, sys\nprint(json.dumps([_saet_noegle(x) for x in json.loads(sys.argv[1])]))`;
  const ind = ['<link href="/assets/docs.css?v=old">', '<script src="/assets/docs.js"></script>', '<a data-href="/assets/docs.css?v=old">', '<link href="https://x.example/assets/docs.css?v=old">'];
  const ud = JSON.parse(execFileSync('python3', ['-c', py, JSON.stringify(ind)], { encoding: 'utf8' }));
  assert.deepEqual(ud, ['<link href="/assets/docs.css?v=aaaa1111">', '<script src="/assets/docs.js?v=bbbb2222"></script>',
    '<a data-href="/assets/docs.css?v=old">', '<link href="https://x.example/assets/docs.css?v=old">']);
});

// R59-R60 (Astra): funktionsproeven fangede ikke, at generatoren holdt op med at bruge funktionen paa de haandskrevne
// sider, og R60 viste at en side uden js-noegle, med css-noeglen som js-noegle eller helt uden script-tag ogsaa slap
// igennem. Her koeres hele generatoren paa en kopi med egen git-historik (dateret 2020-01-01), efter at begge assets er
// aendret. Hver side skal bagefter have praecis de samme henvisninger som foer, i samme raekkefoelge, med de nye noegler -
// laest med samme tokenizer som vagten ovenfor. Privacy-sidens sitemap-dato skal vaere i dag efter foerste koersel (R56:
// omskrivningen skal ske foer sitemappet), og en anden koersel maa ikke aendre noget.
test('hele generatoren: nyt asset giver ny noegle paa hver henvisning, og sitemappet ser det i samme koersel', async () => {
  const { mkdtempSync, cpSync, appendFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmp = mkdtempSync(join(tmpdir(), 'gen-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgsign=false', ...a], { cwd: tmp, stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T12:00:00', GIT_COMMITTER_DATE: '2020-01-01T12:00:00' } });
  const alle = (d) => readdirSync(d, { recursive: true }).filter((f) => /\.(html|xml)$/.test(f)).sort()
    .map((f) => [f, readFileSync(join(d, f), 'utf8')]);
  try {
    for (const d of ['docs', 'content', 'scripts']) cpSync(join(rod, d), join(tmp, d), { recursive: true });
    cpSync(join(rod, 'llms-install.md'), join(tmp, 'llms-install.md'));
    cpSync(join(rod, 'mcp-server/tools.js'), join(tmp, 'mcp-server/tools.js'));
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
    const foer = henvisninger(join(tmp, 'docs'));
    appendFileSync(join(tmp, 'docs/assets/docs.css'), '\n/* proeve */\n');
    appendFileSync(join(tmp, 'docs/assets/docs.js'), '\n// proeve\n');
    const ny = { css: noegle8(join(tmp, 'docs/assets/docs.css')), js: noegle8(join(tmp, 'docs/assets/docs.js')) };
    const gen = () => execFileSync('python3', [join(tmp, 'scripts/generate-docs.py')], { cwd: tmp, stdio: 'ignore' });
    gen();
    const efter = henvisninger(join(tmp, 'docs'));
    assert.deepEqual(Object.keys(efter).sort(), Object.keys(foer).sort(), 'generatoren aendrede hvilke sider der findes');
    let set = 0;
    for (const [s, h] of Object.entries(efter)) {
      assert.deepEqual(h.omtaler, [], `${s}: docs.css/docs.js naevnes uden for den kanoniske form efter generering`);
      assert.equal(h.raa, h.kanon.length, `${s}: en kanonisk henvisning staar ikke i den citerede form`);
      assert.deepEqual(h.kanon, foer[s].kanon.map(([endelse]) => [endelse, ny[endelse]]),
        `${s}: henvisningerne efter generering er ikke de samme som foer med de nye noegler`);
      set += h.kanon.length;
    }
    assert.equal(set, 82);
    const idag = execFileSync('python3', ['-c', 'import datetime; print(datetime.date.today().isoformat())'], { encoding: 'utf8' }).trim();
    assert.match(readFileSync(join(tmp, 'docs/sitemap.xml'), 'utf8'),
      new RegExp(`privacy\\.html</loc><lastmod>${idag}</lastmod>`), 'sitemappet saa ikke privacy-sidens nye dato i samme koersel');
    const efter1 = alle(join(tmp, 'docs'));
    gen();
    assert.deepEqual(alle(join(tmp, 'docs')), efter1, 'en anden koersel aendrede noget');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
