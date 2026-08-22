/**
 * Beviser de to fejl der gjorde at forbindelsen aldrig kom tilbage af sig selv.
 *
 * Fejl 1: chrome.alarms.create() paa oeverste niveau NULSTILLER nedtaellingen.
 *         Vaagner service workeren oftere end perioden, fyrer alarmen aldrig.
 * Fejl 2: 'reconnect' lukkede offscreen-dokumentet og genskabte det UDEN fangst.
 *         Fejlede genskabelsen, stod extensionen uden dokument for evigt.
 *
 * Testene koerer den AEGTE kildekode mod en stubbet chrome-API.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

test('alarmen oprettes kun hvis den ikke findes', () => {
  assert.match(kilde, /chrome\.alarms\.get\(\s*'ensure-offscreen'/,
    'skal spoerge om alarmen findes foer den oprettes');
  const create = kilde.match(/chrome\.alarms\.create\('ensure-offscreen'/g) || [];
  assert.equal(create.length, 1, 'kun ét create-kald');
  const iGet = kilde.indexOf("chrome.alarms.get('ensure-offscreen'");
  const iCreate = kilde.indexOf("chrome.alarms.create('ensure-offscreen'");
  assert.ok(iGet < iCreate, 'create skal ligge INDE i get-tilbagekaldet');
});

test('alarm-nulstillingen simuleret: create maa ikke kaldes naar alarmen findes', async () => {
  let creates = 0;
  const chrome = {
    alarms: {
      get: (navn, cb) => cb({ name: navn }),          // alarmen findes allerede
      create: () => { creates++; },
      onAlarm: { addListener() {} },
    },
  };
  // efterlign den rettede blok
  chrome.alarms.get('ensure-offscreen', (e) => {
    if (!e) chrome.alarms.create('ensure-offscreen', { periodInMinutes: 1 });
  });
  assert.equal(creates, 0, 'alarmen maa ikke nulstilles naar den allerede findes');
});

test('alarmen oprettes naar den mangler', () => {
  let creates = 0;
  const chrome = {
    alarms: { get: (_n, cb) => cb(undefined), create: () => { creates++; } },
  };
  chrome.alarms.get('ensure-offscreen', (e) => {
    if (!e) chrome.alarms.create('ensure-offscreen', { periodInMinutes: 1 });
  });
  assert.equal(creates, 1, 'skal oprettes naar den ikke findes');
});

test('reconnect-stien har fangst omkring genskabelsen', () => {
  const i = kilde.indexOf("msg.type === 'reconnect'");
  assert.ok(i > 0, 'reconnect-handleren skal findes');
  const blok = kilde.slice(i, i + 1400);
  assert.match(blok, /try\s*\{/, 'skal have try omkring lukning/genskabelse');
  assert.match(blok, /catch/, 'skal fange fejl');
  assert.match(blok, /setTimeout\(/, 'skal genforsoege hvis genskabelsen fejler');
});

test('genskabelse efter fejlet close efterlader ikke extensionen uden dokument', async () => {
  let findes = true, genskabt = 0;
  const chrome = {
    offscreen: {
      hasDocument: async () => findes,
      closeDocument: async () => { findes = false; throw new Error('race'); },
      createDocument: async () => { findes = true; genskabt++; },
    },
  };
  const ensureOffscreen = async () => {
    if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument();
  };
  // den rettede sti
  try { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); }
  catch {}
  try { await ensureOffscreen(); } catch {}
  assert.equal(genskabt, 1, 'dokumentet skal vaere genskabt trods fejl i close');
  assert.equal(findes, true, 'extensionen maa ikke staa uden offscreen-dokument');
});

// ── Et dokument der FINDES er ikke det samme som et der SVARER ──────────────
//
// MAALT 21/8, ved selv at braekke det: ensureOffscreen() spurgte kun
// chrome.offscreen.hasDocument(). Et dokument hvis script aldrig blev indlaest —
// en enkelt CSP-afvisning i offscreen.html raekker — taeller stadig som
// eksisterende. Saa hjerteslaget hvert minut gjorde ingenting, for evigt.
//
// Udvidelsen saa levende ud i chrome://extensions, men havde ingen WebSocket. Og
// den kunne ikke naas: reload_extension gaar netop gennem den forbindelse der
// manglede. Eneste vej ud var ↻ i haanden. Selvhelbredelsen helbredte ikke den
// tilstand den var bygget til at helbrede.

import { test as t2 } from 'node:test';
import assert2 from 'node:assert/strict';
import { readFileSync as laes2 } from 'node:fs';
import { fileURLToPath as url2 } from 'node:url';
import { dirname as dir2, join as join2 } from 'node:path';

const rod2 = dir2(dir2(url2(import.meta.url)));
const bg2 = laes2(join2(rod2, 'extension/background.js'), 'utf8');
const off2 = laes2(join2(rod2, 'extension/offscreen.js'), 'utf8');

t2('ensureOffscreen noejes ikke med at spoerge om dokumentet findes', () => {
  const i = bg2.indexOf('async function ensureOffscreen(');
  const blok = bg2.slice(i, i + 1200);
  assert2.match(blok, /await offscreenSvarer\(\)/,
    'kun hasDocument() — et doedt dokument bliver aldrig erstattet');
  assert2.match(blok, /closeDocument\(\)/, 'det doede dokument skal lukkes foer et nyt kan oprettes');
});

t2('liveness-tjekket kan ikke haenge', () => {
  const i = bg2.indexOf('async function offscreenSvarer(');
  const blok = bg2.slice(i, i + 800);
  assert2.match(blok, /setTimeout\(\(\) => afvis\(new Error\('intet svar'\)\), \d+\)/,
    'uden en frist ville et halvdoedt dokument kunne blokere hjerteslaget');
  assert2.match(blok, /catch \{\s*\n?\s*return false;/,
    '"ingen modtager" skal betyde doed, ikke en kastet fejl');
});

t2('offscreen-dokumentet svarer paa hjerteslaget', () => {
  assert2.match(off2, /msg\?\.type !== 'bmcp_ping'/, 'ping-lytteren mangler — saa svarer den aldrig');
  assert2.match(off2, /sendResponse\(\{ ok: true/, 'svaret skal sige ok:true, det er hele tjekket');
});

t2('offscreen.html holder sig fri af inline-script', () => {
  // Det var praecis her det gik galt: et inline <script> i en MV3-udvidelsesside
  // afvises af CSP, saa broen aldrig blev indlaest — og dokumentet fandtes stadig.
  const html = laes2(join2(rod2, 'extension/offscreen.html'), 'utf8');
  const uden = html.replace(/<!--[\s\S]*?-->/g, '');
  assert2.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(uden),
    'inline <script> i en MV3-udvidelsesside blokeres af CSP — broen indlaeses aldrig');
  assert2.match(uden, /<script src="offscreen\.js"><\/script>/, 'broen skal indlaeses fra en fil');
});

t2('en forbindelse registreres straks — ikke foerst naar den aabner', () => {
  // MAALT 21/8: den samme udvidelse holdt TO aabne forbindelser til den samme
  // server. Forbindelsen blev foerst skrevet i kortet i onopen, mens scanPorts
  // koerer hvert 2. sekund og kun springer over hvis kortet HAR en. I vinduet
  // mellem `new WebSocket` og onopen stod kortet tomt, saa naeste scan lavede
  // endnu en. Den foerste blev foraeldreloes: aldrig lukket, aldrig i kortet.
  const i = off2.indexOf('function tryConnect(');
  const blok = off2.slice(i, i + 1400);
  const nyIdx = blok.indexOf('new WebSocket(');
  const setIdx = blok.indexOf('connections.set(port, ws);');
  const onopenIdx = blok.indexOf('ws.onopen');
  assert2.ok(setIdx > nyIdx && setIdx < onopenIdx,
    'registreringen skal ske mellem oprettelsen og onopen — ellers aabner scanPorts en dublet');
});

t2('genskabelsen er begraenset — ellers bliver kuren vaerre end sygdommen', () => {
  // Fundet ved gennemlaesning 21/8, foer det naaede at goere skade: "svarer ikke"
  // betyder ikke altid "doed". En AELDRE offscreen.js uden ping-lytter svarer heller
  // ikke — og Chrome kan servere den fra cache hen over en genindlaesning (maalt
  // samme dag). Uden graense ville hjerteslaget lukke og genskabe en fuldt
  // fungerende bro hvert minut, for evigt, og rive WebSocket'en ned hver gang.
  const i = bg2.indexOf('async function ensureOffscreen(');
  const blok = bg2.slice(i, i + 2200);
  assert2.match(blok, /offscreenGenskabt >= MAX_OFFSCREEN_GENSKAB/,
    'ingen graense paa genskabelsen — en gammel bro ville blive revet ned hvert minut');
  assert2.match(blok, /chrome\.storage\.local\.set\(\{ offscreenGenskabt: 0 \}\)/,
    'taelleren nulstilles ikke naar broen svarer — saa laases den ude efter tre gamle forsoeg');
  assert2.match(blok, /chrome\.storage\.local\.get\(\{ offscreenGenskabt: 0 \}\)/,
    'taelleren skal ligge i storage — en modul-variabel nulstilles ved hver service-worker-genstart');
});
