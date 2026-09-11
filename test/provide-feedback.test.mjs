// browser_provide_feedback — selv-diagnose foer feedback.
//
// Hvorfor vaerktoejet findes (21/8): den udgave der koerte lokalt var npm 1.25.0,
// mens rettelserne laa uudgivet i repoet, OG der var to udvidelser indlaest i
// Chrome samtidig. Begge dele viste sig som "browseren opfoerer sig maerkeligt" —
// ikke som "din installation er gammel" og ikke som "du har to udvidelser". Der
// fandtes ingen maade at spoerge paa, saa en hel nat gik med at lede i den forkerte
// ende. Vaerktoejet spoerger nu selv, foer det konkluderer noget.
//
// Kontrakten der testes: en gammel eller konfliktende installation maa ALDRIG
// rapporteres som en fejl i Browser MCP, og en frisk installation maa aldrig faa
// et "opdater foerst"-svar der sender brugeren paa vildspor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');

function udtraek(navn) {
  const start = kilde.search(new RegExp(`(?:async )?function ${navn}\\(`));
  if (start === -1) throw new Error(`${navn}() findes ikke i index.js`);
  let dybde = 0, i = kilde.indexOf('{', start);
  for (; i < kilde.length; i++) {
    if (kilde[i] === '{') dybde++;
    else if (kilde[i] === '}' && --dybde === 0) break;
  }
  return kilde.slice(start, i + 1);
}

const AABEN = 1;
let seq = 0;
const ext = (version, id) => ({ ws: { readyState: AABEN }, seq: ++seq, extensionId: id, version, name: 'Agent360 Browser MCP', since: ++seq });

// Bygger handleProvideFeedback med kontrolleret omverden: hvilke udvidelser der er
// forbundet, hvad npm siger, og hvilken version serveren selv har.
function byg({ serverVersion = '1.28.0', npmLatest = '1.28.0', udvidelser = [ext('1.28.0', 'a')], activePort = 9876 } = {}) {
  const connections = new Set(udvidelser);
  // fingeraftryk/afkortUrl/skrivTilLogbog hentes ud af den RIGTIGE kilde. Kun
  // filsystemet stubbes — ellers ville testen maale sin egen attrap i stedet for
  // dedup-logikken, som er hele pointen.
  const src = [
    udtraek('cmpVersion'), udtraek('liveConnections'),
    udtraek('activeConnection'), udtraek('distinctExtensions'),
    udtraek('fingeraftryk'), udtraek('afkortUrl'), udtraek('skrivTilLogbog'),
    udtraek('handleProvideFeedback'),
  ].join('\n\n');
  // laastForbindelse/harSendtKommando er modul-variable i index.js; de erklaeres her
  // i den omsluttende scope saa den udtrukne kode muterer de samme variable.
  // Logbogen skrives til disk i produktionen. I testen indsprojtes en attrap, saa
  // testkoersler ikke lader spor i brugerens rigtige logbog.
  const skrevet = [];
  const fabrik = new Function(
    'connections', 'PKG_VERSION', 'activePort', 'REPO_URL', 'ISSUE_TEMPLATES', 'npmLatestVersion', 'process',
    'appendFileSync', 'mkdirSync', 'dirname', 'join', 'homedir', 'Date',
    `let laastForbindelse = null, harSendtKommando = false;
     const setteFingeraftryk = new Set();
     const FEEDBACK_LOG = '/attrap/feedback.jsonl';
     ${src}
     return handleProvideFeedback;`,
  );
  const h = fabrik(
    connections, serverVersion, activePort,
    'https://github.com/Agent360dk/browser-mcp',
    { wish: 'wish.yml', use_case: 'use-case.yml', bug: 'bug.yml' },
    async () => npmLatest,
    { version: 'v22.0.0', platform: 'darwin', arch: 'arm64' },
    (_sti, linje) => { skrevet.push(JSON.parse(linje)); },   // appendFileSync
    () => {},                                                 // mkdirSync
    (x) => x, (...x) => x.join('/'), () => '/attrap',          // dirname, join, homedir
    class { toISOString() { return '2026-08-21T00:00:00.000Z'; } },
  );
  const kald = async (args) => JSON.parse((await h(args)).content[0].text);
  kald.skrevet = skrevet;
  return kald;
}

// ── verdict ─────────────────────────────────────────────────────────────────

test('frisk installation → current, ingen fix-skridt', async () => {
  const r = await byg()({ what_happened: 'browser_click ramte ikke knappen' });
  assert.equal(r.verdict, 'current');
  assert.deepEqual(r.fix_steps, []);
  assert.deepEqual(r.findings, []);
  assert.match(r.instruction, /aegte mangel eller fejl/, 'ved frisk installation skal fejlen tages alvorligt som fejl');
});

test('gammel server → outdated, og der peges paa genstart i stedet for en bug-rapport', async () => {
  const r = await byg({ serverVersion: '1.25.0', npmLatest: '1.28.0', udvidelser: [ext('1.25.0', 'a')] })(
    { what_happened: 'sessioner blander sig sammen' });
  assert.equal(r.verdict, 'outdated');
  assert.ok(r.findings.some(f => f.includes('1.25.0') && f.includes('1.28.0')), 'skal naevne begge versioner');
  assert.ok(r.fix_steps.some(s => /@latest|genstart/i.test(s)));
  assert.match(r.instruction, /KUN submit_url hvis problemet stadig staar/,
    'en gammel installation maa ikke rapporteres som en fejl med det samme');
});

test('gammel udvidelse mod ny server → outdated med reload-anvisning', async () => {
  const r = await byg({ serverVersion: '1.28.0', npmLatest: '1.28.0', udvidelser: [ext('1.26.0', 'a')] })(
    { what_happened: 'browser_set_date findes ikke' });
  assert.equal(r.verdict, 'outdated');
  assert.equal(r.environment.extension_up_to_date, false);
  assert.ok(r.fix_steps.some(s => s.includes('chrome://extensions')));
});

// MAALT 11/9 af Fable (e2e-review): butiksbrugere faar "↻ reload" som eneste raad, naar deres udvidelse oplyser sin version.
// Efter en udgivelse ligger butikkens version i review i 1-3 dage, saa reload henter ingenting - raadet foerer i ring.
// Serveren kan ikke se hvilken slags installation det er, saa begge tilfaelde skal staa der, ogsaa med kendt version.
test('gammel udvidelse med kendt version: raadet naevner ogsaa butikkens ventetid', async () => {
  const r = await byg({ serverVersion: '1.29.1', npmLatest: '1.29.1', udvidelser: [ext('1.29.0', 'a')] })(
    { what_happened: 'klik virker ikke' });
  assert.equal(r.verdict, 'outdated');
  const tekst = r.fix_steps.join(' ');
  assert.match(tekst, /chrome:\/\/extensions/, 'reload-vejen skal stadig staa der');
  assert.match(tekst, /Chrome Web Store|butik/i, 'butiksbrugeren faar et raad der foerer i ring');
  assert.match(tekst, /1-3 dage|review/i, 'ventetiden skal siges, saa den ikke ligner en fejl');
});

test('udvidelse uden haandtryk regnes som for gammel', async () => {
  const r = await byg({ udvidelser: [ext(null, null)] })({ what_happened: 'noget gik galt' });
  assert.equal(r.verdict, 'outdated');
  assert.ok(r.findings.some(f => f.includes('ikke oplyser sin version')));
});

test('to udvidelser → conflict, og det slaar alt andet', async () => {
  const r = await byg({ serverVersion: '1.25.0', npmLatest: '1.28.0', udvidelser: [ext('1.27.0', 'kmbhc'), ext('1.27.1', 'hajof')] })(
    { what_happened: 'faner forsvinder' });
  assert.equal(r.verdict, 'conflict', 'konflikten er den foerste ting brugeren skal rette');
  assert.equal(r.environment.extensions_connected.length, 2);
  assert.equal(r.environment.extensions_connected.filter(e => e.active).length, 1, 'praecis én skal vaere aktiv');
  assert.equal(r.environment.extensions_connected.find(e => e.active).version, '1.27.1', 'den nyeste er den aktive');
  assert.ok(r.fix_steps.some(s => s.includes('chrome://extensions')));
  // Den gamle server naevnes stadig — konflikten skjuler ikke det andet fund.
  assert.ok(r.findings.some(f => f.includes('1.25.0')));
});

test('ingen udvidelse → disconnected', async () => {
  const r = await byg({ udvidelser: [] })({ what_happened: 'ingenting virker' });
  assert.equal(r.verdict, 'disconnected');
  assert.ok(r.fix_steps.some(s => /Reconnect/i.test(s)));
});

test('npm uden svar (offline) → unknown, ikke en falsk "alt er fint"', async () => {
  const r = await byg({ npmLatest: null })({ what_happened: 'noget' });
  assert.equal(r.verdict, 'unknown');
  assert.equal(r.environment.server_up_to_date, null, 'ukendt maa ikke rapporteres som true');
  assert.equal(r.environment.npm_latest_version, null);
});

// ── indholdet af rapporten ──────────────────────────────────────────────────

test('submit_url er forudfyldt og peger paa den rigtige skabelon', async () => {
  const r = await byg()({ what_happened: 'browser_click virker ikke paa Shadow DOM', kind: 'broken', tool: 'browser_click', url: 'https://eksempel.dk/side' });
  const u = new URL(r.submit_url);
  assert.equal(u.pathname, '/Agent360dk/browser-mcp/issues/new');
  assert.equal(u.searchParams.get('template'), 'bug.yml');
  assert.equal(u.searchParams.get('title'), 'browser_click virker ikke paa Shadow DOM');
  const body = u.searchParams.get('body');
  assert.ok(body.includes('browser_click'), 'vaerktoejet skal med i rapporten');
  assert.ok(body.includes('https://eksempel.dk/side'), 'URL\'en skal med');
  assert.ok(body.includes('mcp_server_version'), 'miljoeet skal med — ellers starter enhver issue med tre afklarende spoergsmaal');
});

test('kind styrer skabelonen', async () => {
  const h = byg();
  for (const [kind, skabelon] of [['wish', 'wish.yml'], ['use_case', 'use-case.yml'], ['broken', 'bug.yml'], ['blocked', 'bug.yml'], ['missing', 'bug.yml']]) {
    const r = await h({ what_happened: 'x', kind });
    assert.equal(new URL(r.submit_url).searchParams.get('template'), skabelon, `kind=${kind}`);
  }
});

test('lang foerste linje bliver en brugbar titel, ikke en roman', async () => {
  const r = await byg()({ what_happened: 'a'.repeat(400) });
  assert.ok(new URL(r.submit_url).searchParams.get('title').length <= 90);
});

test('flerlinjet beskrivelse giver enkeltlinjet titel', async () => {
  const r = await byg()({ what_happened: 'Klik landede forkert\n\nDetaljer: ...' });
  assert.equal(new URL(r.submit_url).searchParams.get('title'), 'Klik landede forkert');
});

test('rapporten spejler det der blev meldt ind', async () => {
  const r = await byg()({ what_happened: 'x', kind: 'missing', tool: 'browser_hover', url: 'https://a.dk', attempted: 'proevede text=-selector' });
  assert.deepEqual(r.reported, { kind: 'missing', what_happened: 'x', tool: 'browser_hover', url: 'https://a.dk', attempted: 'proevede text=-selector' });
});

// ── kontrakter mod resten af systemet ───────────────────────────────────────

test('vaerktoejet er registreret og routet', async () => {
  const { TOOLS } = await import(join(rod, 'mcp-server/tools.js'));
  const t = TOOLS.find(x => x.name === 'browser_provide_feedback');
  assert.ok(t, 'browser_provide_feedback mangler i tools.js');
  assert.deepEqual(t.inputSchema.required, ['what_happened']);
  assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['attempted', 'kind', 'tool', 'url', 'what_happened']);
  assert.match(kilde, /name === 'browser_provide_feedback'/, 'ikke routet i index.js');
});

test('beskrivelsen beder modellen kalde det af sig selv', async () => {
  const { TOOLS } = await import(join(rod, 'mcp-server/tools.js'));
  const d = TOOLS.find(x => x.name === 'browser_provide_feedback').description;
  assert.match(d, /AUTOMATICALLY/, 'uden dette kaldes vaerktoejet kun naar brugeren beder om det');
  assert.match(d, /without asking/i);
});

test('friskheds-tjekket maa ikke kunne braekke vaerktoejet', () => {
  const blok = kilde.slice(kilde.indexOf('function npmLatestVersion('), kilde.indexOf('async function handleProvideFeedback('));
  assert.match(blok, /timeout: \d+/, 'npm-opslaget skal have en timeout — ellers haenger vaerktoejet offline');
  assert.match(blok, /if \(err\) return resolve\(null\)/, 'en fejl skal give null, ikke kaste');
  assert.match(blok, /NPM_LATEST_TTL_MS/, 'svaret skal caches — ellers et netvaerkskald pr. kald');
});


// ── logbogen: loekken der goer en graense til en rettelse ───────────────────

test('hver graense skrives til den lokale logbog', async () => {
  const h = byg();
  const r = await h({ what_happened: 'browser_click ramte ikke knappen', tool: 'browser_click', url: 'https://ads.example.com/kampagner?token=HEMMELIG&id=42' });
  assert.equal(r.logged_locally.logged, true, 'haendelsen blev ikke logget');
  assert.equal(h.skrevet.length, 1);
  const post = h.skrevet[0];
  assert.equal(post.tool, 'browser_click');
  assert.equal(post.verdict, r.verdict);
  assert.ok(post.at, 'tidsstempel mangler — uden det kan man ikke se om en graense stadig gaelder');
});

test('query-strengen ryger — den baerer tokens og soegetermer', async () => {
  const h = byg();
  await h({ what_happened: 'x', url: 'https://mail.example.com/u/0/inbox?token=HEMMELIG#tr=abc' });
  const u = h.skrevet[0].url;
  assert.equal(u, 'https://mail.example.com/u/0/inbox');
  assert.ok(!u.includes('HEMMELIG'), 'et token naaede ind i logbogen');
  assert.ok(!u.includes('#'), 'fragmentet naaede ind i logbogen');
});

test('en uduelig url braekker ikke logningen', async () => {
  const h = byg();
  await h({ what_happened: 'x', url: 'ikke en url' });
  assert.equal(h.skrevet[0].url, '(ulaeselig url)');
});

test('den samme graense i loekke fylder ikke logbogen', async () => {
  const h = byg();
  const en = { what_happened: 'Debugger attach failed after 3 attempts (tab 338952551)', tool: 'browser_click' };
  const to = { what_happened: 'Debugger attach failed after 3 attempts (tab 999111222)', tool: 'browser_click' };
  const r1 = await h(en);
  const r2 = await h(to);
  assert.equal(r1.logged_locally.logged, true);
  assert.equal(r2.logged_locally.logged, false,
    'fane-id\'et gjorde to ens haendelser forskellige — en loekke ville skrive tusind linjer');
  assert.equal(h.skrevet.length, 1);
});

test('to forskellige graenser logges hver for sig', async () => {
  const h = byg();
  await h({ what_happened: 'klik landede ikke', tool: 'browser_click' });
  await h({ what_happened: 'upload fejlede', tool: 'browser_upload_file' });
  assert.equal(h.skrevet.length, 2);
});

test('logbogen sender intet — den skriver kun lokalt', () => {
  const i = kilde.indexOf('function skrivTilLogbog(');
  const blok = kilde.slice(i, i + 900);
  assert.match(blok, /appendFileSync/, 'logbogen skrives ikke');
  assert.ok(!/fetch\(|https:\/\/api\.github|axios/.test(blok),
    'logbogen sender data ud — rapporten baerer URL\'er fra sider agenten stod paa');
  assert.match(blok, /catch \(e\)/, 'en ubeskrivelig logbog maa aldrig braekke vaerktoejet');
});

test('submit_url laekker ikke det logbogen redigerer vaek', async () => {
  // MAALT 22/8 ved sikkerhedsreview: issueBody brugte den RAA url, mens logbogen
  // brugte afkortUrl(). Query-strengen — hvor tokens bor — blev strippet fra filen
  // paa disken, men sendt uredigeret ind i et link til et OFFENTLIGT issue. Der
  // fandtes en test for logbogen og INGEN for linket. Den forkerte vej rundt.
  const h = byg();
  const r = await h({
    what_happened: 'kunne ikke klikke',
    url: 'https://mail.example.com/u/0/inbox?access_token=HEMMELIG123#tr=abc',
  });
  assert.ok(!r.submit_url.includes('HEMMELIG123'), 'et token naaede ind i det offentlige issue-link');
  assert.ok(!decodeURIComponent(r.submit_url).includes('access_token'), 'query-strengen naaede med');
  assert.ok(decodeURIComponent(r.submit_url).includes('https://mail.example.com/u/0/inbox'),
    'selve siden skal stadig med — ellers er rapporten ubrugelig');
});

test('butiks-brugere faar et raad der kan foelges i review-vinduet', async () => {
  // MAALT 22/8: fix-skridtet sagde "↻ reload" til ALLE. For en Chrome Web Store-bruger
  // henter reload ingenting foer Google har godkendt — raadet foerte i ring i 1-3 dage.
  const r = await byg({ udvidelser: [ext(null, 'a')] })({ what_happened: 'et vaerktoej fejlede' });
  const raad = r.fix_steps.join(' ');
  assert.match(raad, /Chrome Web Store/, 'butiks-tilfaeldet naevnes ikke');
  assert.match(raad, /review/, 'ventetiden forklares ikke');
  assert.match(raad, /forventet/, 'brugeren faar ikke at vide at det gaar over af sig selv');
  assert.match(raad, /unpacked/, 'den anden installationstype er faldet ud');
});

// 22/8 stod her det modsatte: "en kendt version faar det korte raad, ikke butiks-forklaringen". Antagelsen var at en
// udvidelse der oplyser sin version, ikke kan komme fra butikken. MAALT 11/9 (Fable, e2e-review): butikkens udgave oplyser
// sin version, og 781 af brugerne har netop den - de fik derfor "↻ reload", som ikke henter noget foer Google har godkendt.
// Serveren kan ikke se installationstypen, saa begge veje skal staa der uanset om versionen er kendt.
test('en kendt version faar baade unpacked-vejen og butikkens ventetid', async () => {
  const r = await byg({ serverVersion: '1.28.0', udvidelser: [ext('1.26.0', 'a')] })({ what_happened: 'x' });
  const raad = r.fix_steps.join(' ');
  assert.match(raad, /unpacked/, 'unpacked-vejen mangler');
  assert.match(raad, /review/, 'butikkens ventetid mangler, og raadet foerer i ring for en butiksbruger');
});

// ── "endnu ikke brugt" er ikke "i stykker" ─────────────────────────────────
//
// FUNDET AF REVIEW 7/9. Da porten blev doven (den bindes nu ved foerste browser-kald
// i stedet for ved opstart), kunne en HELT SUND chat staa uden forbindelse — og
// verdict'et var `disconnected` med fix_steps der bad brugeren geninstallere.
// INSTRUCTIONS beder agenten viderebringe netop de skridt, saa vi ville fortaelle
// folk at deres installation var i stykker fordi vi selv ikke havde aabnet doeren.
test('ingen port taget endnu → idle, ikke disconnected, og ingen fix-skridt', async () => {
  const kald = byg({ udvidelser: [], activePort: null });
  const r = await kald({ what_happened: 'noget gik galt' });
  assert.equal(r.verdict, 'idle', 'en sund chat der ikke har roert browseren blev meldt i stykker');
  assert.deepEqual(r.fix_steps, [], 'der blev givet fix-skridt paa en installation der fejler intet');
  assert.equal(r.environment.ws_port, null);
  assert.ok(!/Reconnect|chrome:\/\/extensions/.test(JSON.stringify(r.findings)),
    'findings sender stadig brugeren i gang med at reparere noget der virker');
});

test('port taget, men udvidelsen svarer ikke → stadig disconnected', async () => {
  const kald = byg({ udvidelser: [], activePort: 9876 });
  const r = await kald({ what_happened: 'noget gik galt' });
  assert.equal(r.verdict, 'disconnected', 'den aegte fejltilstand blev tavs af rettelsen');
  assert.ok(r.fix_steps.length > 0, 'en aegte afbrudt forbindelse skal stadig give skridt');
});
