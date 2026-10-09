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
  // 9/10 (PR63 R1): med filmen er knappen synlig («Play»), saa feltet maa IKKE skjules - ellers kan tastaturet ikke starte filmen
  assert.doesNotMatch(reduce[1], /\.pause-input\{display:none\}/, 'Play skal kunne naas med tastaturet under reduceret bevaegelse');
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
    [/works in the tabs you(?:’|')re already signed into/i, 'PR63 R1: agenten aabner sine EGNE faner (switch_tab/close_tab afviser fremmede)'],
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
  assert.equal(createHash('sha256').update(tekst).digest('hex'), 'b9d7879ff496fff8c1a799a835d5fd33060e60c898f0d280bd2f01aa9ed783c8');
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

// ---- Heroens film (8/10-2026): afløste den tegnede CSS-scene og dens start/fallback-logik. Proeverne koerer
// sidens EGET bundscript mod en falsk video, saa en aendring der faar filmen til at spille under «reduceret
// bevaegelse», eller en Pause-knap der ikke stopper den, bliver roed.
function simulerFilm({ reduceret = false, afvis = false, smal = false } = {}) {
  const bund = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();
  let spiller = false, kald = 0;
  const video = { src: '/film-v2.mp4', poster: '/film-v2.jpg', play: () => { kald++; if (afvis) return Promise.reject(new Error('nej')); spiller = true; return Promise.resolve(); }, pause: () => { spiller = false; } };
  let skift = null; const pause = { checked: false, addEventListener: (_, f) => { skift = f; } }, lbl = { textContent: 'Pause' };
  const doc = { documentElement: { classList: { add() {} } }, querySelectorAll: () => [], getElementById: (id) => ({ filmv: video, pause, pauselbl: lbl }[id]) };
  new Function('document', 'window', 'matchMedia', 'navigator', bund)(doc, {}, (q) => ({ matches: /reduce/.test(q) ? reduceret : smal }), {});
  return { get spiller() { return spiller; }, get kald() { return kald; }, pause, lbl, video, tryk: (v) => { pause.checked = v; skift(); } };
}

test('filmen: spiller uden reduceret bevaegelse, og Pause/Play styrer den', () => {
  const f = simulerFilm();
  assert.ok(f.spiller && f.kald === 1, 'filmen skal starte');
  f.tryk(true); assert.ok(!f.spiller, 'Pause skal stoppe filmen'); assert.equal(f.lbl.textContent, 'Play');
  f.tryk(false); assert.ok(f.spiller, 'Play skal starte den igen'); assert.equal(f.lbl.textContent, 'Pause');
});

test('filmen: spiller ikke under reduceret bevaegelse, og en afvist afspilning viser Play', async () => {
  const r = simulerFilm({ reduceret: true });
  assert.ok(!r.spiller && r.kald === 0 && r.pause.checked, 'reduceret bevaegelse maa ikke starte filmen');
  assert.equal(r.lbl.textContent, 'Play');
  const a = simulerFilm({ afvis: true }); await new Promise((ok) => setTimeout(ok, 0));
  assert.ok(a.pause.checked && a.lbl.textContent === 'Play', 'en afvist play() skal vise Play, ikke en Pause der intet goer');
});

test('filmen: en smal skaerm faar 4:5-klippet, en bred beholder 16:10, og brudpunktet er det samme som i CSS', () => {
  const s = simulerFilm({ smal: true }), b = simulerFilm();
  assert.equal(s.video.src, '/film-v2-mobil.mp4'); assert.equal(s.video.poster, '/film-v2-mobil.jpg');
  assert.equal(b.video.src, '/film-v2.mp4'); assert.equal(b.video.poster, '/film-v2.jpg');
  assert.ok(s.spiller, 'klippet skal ogsaa spille');
  assert.match(html, /@media \(max-width:37\.5rem\)\{\.hero \.film video\{aspect-ratio:4\/5\}\}/, 'CSS-rammen skal skifte til 4:5 ved samme brudpunkt');
  assert.ok(html.includes("matchMedia('(max-width:37.5rem)')"), 'scriptet skal bruge samme brudpunkt');
  const mp4 = statSync(join(rod, 'docs/film-v2-mobil.mp4')).size, jpg = statSync(join(rod, 'docs/film-v2-mobil.jpg')).size;
  assert.ok(mp4 > 10_000 && mp4 < 3_000_000, `film-v2-mobil.mp4 er ${mp4} byte`);
  assert.ok(jpg > 5_000 && jpg < 300_000, `film-v2-mobil.jpg er ${jpg} byte`);
});

test('filmen: tavs, i loop, inline, uden autoplay-attribut, og filerne findes i fornuftig stoerrelse', () => {
  const v = html.match(/<video[^>]*>/)[0];
  for (const a of ['muted', 'loop', 'playsinline', 'poster="/film-v2.jpg"', 'src="/film-v2.mp4"', 'aria-label="']) assert.ok(v.includes(a), `video mangler ${a}`);
  assert.doesNotMatch(v, /\bautoplay\b/, 'autoplay-attributten ville spille trods reduceret bevaegelse');
  const mp4 = statSync(join(rod, 'docs/film-v2.mp4')).size, jpg = statSync(join(rod, 'docs/film-v2.jpg')).size;
  assert.ok(mp4 > 10_000 && mp4 < 3_000_000, `film-v2.mp4 er ${mp4} byte`);
  assert.ok(jpg > 5_000 && jpg < 300_000, `film-v2.jpg er ${jpg} byte`);
});

// ---- Toppen 9/10-2026 (Gustav: «forstå direkte hvad det er», flest installationer). Begge trin staar i heroen;
// en telefon kan ikke installere en Chrome-udvidelse, saa den faar «send linket til din computer» og GitHub-stjernen.
function simulerSend({ share = true } = {}) {
  const bund = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).pop();
  let klik = null; const knap = { hidden: true, textContent: 'Send the link to my computer', addEventListener: (_, f) => { klik = f; } };
  const delt = [], kopieret = [];
  const nav = share ? { share: (d) => { delt.push(d); return Promise.resolve(); } } : { clipboard: { writeText: (t) => { kopieret.push(t); return Promise.resolve(); } } };
  const doc = { documentElement: { classList: { add() {} } }, querySelectorAll: (sel) => (sel === '.sendlink' ? [knap] : []), querySelector: () => null, getElementById: () => null };
  new Function('document', 'window', 'matchMedia', 'navigator', bund)(doc, {}, () => ({ matches: false }), nav);
  return { knap, klik: () => klik && klik(), delt, kopieret };
}

test('toppen: «send linket» deler browsermcp.dev, og uden deling kopieres adressen', async () => {
  const a = simulerSend();
  assert.equal(a.knap.hidden, false, 'knappen skal vises, naar scriptet koerer');
  a.klik(); assert.deepEqual(a.delt.map((d) => d.url), ['https://browsermcp.dev/']);
  const b = simulerSend({ share: false });
  b.klik(); await new Promise((ok) => setTimeout(ok, 0));
  assert.deepEqual(b.kopieret, ['https://browsermcp.dev/']);
  assert.match(b.knap.textContent, /Link copied/);
});

test('toppen: begge trin i heroen paa en computer; paa en beroeringsskaerm i stedet telefonkortet uden butiksknap', () => {
  const hero = html.slice(html.indexOf('<section class="hero">'), html.indexOf('<figure class="film"'));
  assert.match(hero, /<div class="inst kun-pc" id="install-hero">[\s\S]*chromewebstore\.google\.com[\s\S]*id="c1"/, 'trin 1 og trin 2 skal staa foer filmen');
  assert.ok(html.includes('@media (hover:none) and (pointer:coarse){.kun-pc{display:none!important}.kun-tlf{display:block}.top .nav a.navcta{display:none}}'), 'beroeringsskaerm: skjul alt kun-pc og topbjaelkens butiksknap, vis telefonkortene');
  // hvert afsnit med en butiksknap har den inde i kun-pc og har et telefonkort med send-knap og GitHub
  const afsnit = html.split(/<section /).slice(1).filter((a) => /class="btn pri" href="https:\/\/chromewebstore/.test(a));
  assert.equal(afsnit.length, 3, 'hero, Install og bundbaandet');
  for (const a of afsnit) {
    const knap = a.search(/class="btn pri" href="https:\/\/chromewebstore/), pc = a.lastIndexOf('kun-pc', knap);
    assert.ok(pc > -1, 'butiksknappen skal ligge inde i et kun-pc-element: ' + a.slice(0, 40));
    assert.match(a, /class="paa-tlf kun-tlf"[\s\S]*class="btn pri sendlink"[\s\S]*github\.com\/Agent360dk\/browser-mcp/, 'telefonkort mangler: ' + a.slice(0, 40));
  }
  assert.match(html, /<h1>Let your AI agent use your real Chrome\.<\/h1>/);
});
