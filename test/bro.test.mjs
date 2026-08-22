/**
 * Adfaerdstests for broen (extension/offscreen.js).
 *
 * MAALT 22/8: broen havde INGEN adfaerdstest. Jeg erstattede hele dens videresendelse
 * til background med `{ __muteret: true }` — altsaa en udvidelse der ikke gjorde
 * noget som helst — og suiten var 116/116 groen. Det er den fejl denne fil lukker.
 *
 * Funktionerne klippes ud af den aegte kilde og koeres mod stubbede globaler.
 * Hver test er mutations-verificeret: koden er braekket, testen set blive roed,
 * koden sat tilbage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/offscreen.js', import.meta.url), 'utf8');

function udklip(navn) {
  const start = kilde.search(new RegExp(`(async )?function ${navn}\\s*\\(`));
  assert.ok(start > -1, `${navn} findes ikke i offscreen.js`);
  let dybde = 0;
  for (let j = kilde.indexOf('{', start); j < kilde.length; j++) {
    if (kilde[j] === '{') dybde++;
    else if (kilde[j] === '}' && --dybde === 0) return kilde.slice(start, j + 1);
  }
  throw new Error(`kunne ikke afgraense ${navn}`);
}

/** Rejser scanPorts + harServer mod stubbede fetch/WebSocket og rapporterer adfaerden. */
async function koerSkan({ levende = [], fremmede = [], allerede = new Map() } = {}) {
  const log = { probet: [], forbundet: [] };

  // `fremmede` er porte hvor der sidder en HELT anden HTTP-server. De svarer altsaa
  // paent — bare ikke 426. Uden dem i stubben kunne testen ikke se forskel paa
  // "tjekker status" og "tjekker at der kom et svar overhovedet".
  const fetchStub = async (url) => {
    const port = Number(url.match(/:(\d+)/)[1]);
    log.probet.push(port);
    if (levende.includes(port)) return { status: 426 };
    if (fremmede.includes(port)) return { status: 200 };
    throw new Error('ECONNREFUSED');
  };
  const WebSocketStub = function (url) {
    log.forbundet.push(Number(url.match(/:(\d+)/)[1]));
    this.readyState = 0;
    this.close = () => {};
  };
  WebSocketStub.OPEN = 1; WebSocketStub.CONNECTING = 0;

  const src = [
    'const BASE_PORT = 9876, MAX_PORT = 9895;',
    'const PROBE_TIMEOUT_MS = 400;',
    'let skanner = false;',
    'function tryConnect(p) { new WebSocket(`ws://127.0.0.1:${p}`); }',
    udklip('harServer'),
    udklip('scanPorts'),
    'return scanPorts();',
  ].join('\n');

  const fn = new Function('fetch', 'WebSocket', 'connections', 'AbortSignal', 'console',
    `return (async () => { ${src} })()`);
  await fn(fetchStub, WebSocketStub, allerede, { timeout: () => undefined }, { log() {}, warn() {} });
  return log;
}

// ── Mutations-verificeret: `svar.status === 426` -> `true` gav roed.
test('der aabnes KUN WebSockets mod porte hvor der faktisk sidder en server', async () => {
  const r = await koerSkan({ levende: [9878, 9881] });
  assert.equal(r.probet.length, 20, 'alle 20 porte skal probes — det er gratis i Chromes regnskab');
  assert.deepEqual(r.forbundet.sort(), [9878, 9881],
    'en WebSocket mod en doed port taeller som et mislykket haandtryk og goer Chromes bremse haardere');
});

// ── Mutations-verificeret: fjernet `continue` for aabne forbindelser gav roed.
test('en port der allerede er forbundet proeves ikke igen', async () => {
  const aaben = new Map([[9878, { readyState: 1 }]]);
  const r = await koerSkan({ levende: [9878, 9881], allerede: aaben });
  assert.ok(!r.probet.includes(9878), 'en aaben forbindelse skal ikke engang probes');
  assert.deepEqual(r.forbundet, [9881]);
});

// ── Mutations-verificeret: fjernet CONNECTING-tjekket gav roed.
test('en port midt i et haandtryk faar lov at goere det faerdigt', async () => {
  const undervejs = new Map([[9880, { readyState: 0 }]]);
  const r = await koerSkan({ levende: [9880], allerede: undervejs });
  assert.deepEqual(r.forbundet, [], 'at aabne endnu en socket mod samme port var dobbeltforbindelses-fejlen fra 21/8');
});

test('ingen levende porte betyder ingen WebSockets overhovedet', async () => {
  const r = await koerSkan({ levende: [] });
  assert.equal(r.forbundet.length, 0);
});

// ── Mutations-verificeret: `svar.status === 426` -> `true` gav roed FOERST efter
//    at stubben kunne svare 200. Med en stub der bare kastede, slap mutationen
//    igennem — testen maalte "kom der et svar", ikke "var det en ws-server".
test('en fremmed HTTP-server paa porten forveksles ikke med en MCP-server', async () => {
  const r = await koerSkan({ levende: [9878], fremmede: [9880, 9884] });
  assert.deepEqual(r.forbundet, [9878],
    'kun 426 betyder ws-server. Et vilkaarligt 200-svar er en anden tjeneste, ' +
    'og at aabne en WebSocket mod den er baade nytteloest og usikkert.');
});

// ── Den vigtigste taerskel. Chromes bremse kan lovligt holde et haandtryk i op til
//    5000 ms (services/network/websocket_throttler.cc). Lukker vi foer, taeller det
//    som en FEJL der goer bremsen haardere — en spiral vi selv driver.
//    MAALT 22/8: med 2000 ms var den 10. chat 15,5 sek om at komme op.
test('afbryderen ligger OVER Chromes 5-sekunders bremse', () => {
  const m = kilde.match(/const connectTimeout = setTimeout\([\s\S]{0,120}?\},\s*(\d+)\);/);
  assert.ok(m, 'connectTimeout skal findes');
  assert.ok(Number(m[1]) > 5000,
    `afbryderen er ${m[1]} ms — under Chromes maksimale bremse paa 5000 ms. ` +
    'Hver for tidlig lukning taeller som et mislykket haandtryk og forlaenger den naeste.');
});

// ── Mutations-verificeret: erstattet sendMessage-kaldet med en konstant gav roed.
//    Det er praecis den mutation der slap igennem den gamle suite.
test('broen videresender faktisk kommandoer til background', () => {
  const i = kilde.indexOf('ws.onmessage');
  assert.ok(i > 0, 'onmessage-handleren skal findes');
  const blok = kilde.slice(i, kilde.indexOf('ws.onclose', i));
  assert.match(blok, /chrome\.runtime\.sendMessage\(/,
    'uden det her kald er udvidelsen fuldstaendig stum — den modtager kommandoer og goer intet');
  assert.match(blok, /port/, 'porten skal med, ellers ved background ikke hvilken session der ejer fanen');
});

// ── Mutations-verificeret: fjernet hello-blokken gav roed.
test('identitets-haandtrykket sendes naar forbindelsen aabner', () => {
  // Grænsen er den naeste handler, ikke et fast antal tegn — ellers braekker testen
  // naar en kommentar vokser, og det er ikke det den skal maale.
  const i = kilde.indexOf('ws.onopen');
  const blok = kilde.slice(i, kilde.indexOf('ws.onmessage', i));
  assert.ok(blok.length > 0, 'onopen-blokken skal kunne afgraenses');
  assert.match(blok, /type: 'hello'/, 'uden hello kan serveren ikke se at to udvidelser slaas om den');
  assert.match(blok, /extensionId/);
  assert.match(blok, /version/);
});

// ── Mutations-verificeret: flyttet connections.set ned i onopen gav roed.
test('forbindelsen registreres FOER onopen — ellers laver naeste skan en dublet', () => {
  const iSet = kilde.indexOf('connections.set(port, ws)');
  const iOpen = kilde.indexOf('ws.onopen');
  assert.ok(iSet > -1 && iOpen > -1);
  assert.ok(iSet < iOpen,
    'i vinduet mellem `new WebSocket` og onopen stod der intet i kortet, saa naeste ' +
    'skan lavede endnu en forbindelse. Den foerste blev foraeldreloes: aldrig lukket, fuldt aaben.');
});
