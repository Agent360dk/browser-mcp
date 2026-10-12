/**
 * To fund fra Astras uafhaengige review af 1.30.1-kandidaten (1/10-2026, runde 1).
 *
 * 1. DOBBELT SOKKEL. `scanPorts` kalder `tryConnect(port)` efter `await Promise.all(...)` uden at tjekke
 *    kortet igen. Haenger én probe laenge nok til at sikkerhedsventilen slipper laasen, naar en ny
 *    skanning at forbinde til en levende port, og naar den gamle skannings probe endelig svarer, kalder
 *    den `tryConnect` paa den SAMME port: `connections.set(port, ws)` overskriver den foerste sokkel uden at lukke
 *    den. Resultat: en aaben sokkel UDEN FOR kortet, som status og terminering ikke kender.
 *    Maalt af Astra med hele kandidatens offscreen.js og syntetiske netvaerkssvar.
 *
 * 2. KALD DER HAENGER. Siden svarbindingen maa KUN den forbindelse et kald blev sendt til besvare det.
 *    `afvisVentende` sprang dog over saa laenge NOGEN anden forbindelse levede, saa et kald hvis ejer
 *    doede ventede til sin frist (30 s, 180 s for extract_list) - med en forkert forklaring.
 *    Kald sendt til ANDRE forbindelser skal stadig ikke roeres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const krav = createRequire(join(rod, 'mcp-server', 'index.js'));
const WebSocket = krav('ws');

// ── 1 · udvidelsens side ───────────────────────────────────────────────────

/** Kører den ægte offscreen.js med en WebSocket-stub der tæller hvor mange der oprettes. */
function broen() {
  const instanser = [];
  function WS(url) {
    const o = { readyState: 0, url, send() {}, close() { o.readyState = 3; } };
    instanser.push(o);
    return o;
  }
  WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    URLSearchParams, JSON, Promise, Uint8Array, Array, Error, String, Boolean, WeakSet, Map, Set, Object, Number, Date, Math,
    location: { search: '?v=1.30.1' },
    WebSocket: WS,
    fetch: async () => { throw new Error('ingen server'); },
    crypto: { subtle: { digest: async () => new Uint8Array([1, 2, 3]).buffer } },
    chrome: { runtime: { id: 'proeve-id', getURL: (f) => 'chrome-extension://proeve-id/' + f,
      sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } } },
  };
  ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(readFileSync(join(rod, 'extension/offscreen.js'), 'utf8'), ctx, { filename: 'offscreen.js' });
  const kort = () => runInContext('connections', ctx);
  return { ctx, instanser, kort };
}

test('en port der allerede har en forbindelse under oprettelse faar ikke endnu en sokkel', () => {
  const b = broen();
  b.ctx.tryConnect(9876);
  assert.equal(b.instanser.length, 1, 'foerste tryConnect oprettede ingen sokkel - proeven kan ikke maale noget');
  b.ctx.tryConnect(9876);   // en gammel skanning, der fik svar fra sin probe for sent
  assert.equal(b.instanser.length, 1, 'der blev oprettet en ANDEN sokkel til samme port - den foerste er nu forældreløs uden for kortet');
  assert.equal(b.kort().get(9876), b.instanser[0], 'kortet peger ikke laengere paa den foerste sokkel');
});

test('en port med en AABEN forbindelse faar heller ikke endnu en sokkel', () => {
  const b = broen();
  b.ctx.tryConnect(9876);
  b.instanser[0].readyState = 1;
  b.ctx.tryConnect(9876);
  assert.equal(b.instanser.length, 1, 'der blev oprettet en sokkel til en port der allerede var forbundet');
});

test('modsat: en LUKKET forbindelse maa gerne erstattes (ellers kan broen aldrig genforbinde)', () => {
  const b = broen();
  b.ctx.tryConnect(9876);
  b.instanser[0].readyState = 3;
  b.ctx.tryConnect(9876);
  assert.equal(b.instanser.length, 2, 'en doed forbindelse blev ikke erstattet - vagten er for streng, broen genforbinder aldrig');
  assert.equal(b.kort().get(9876), b.instanser[1]);
});

test('to forskellige porte forbindes begge (vagten er pr. port)', () => {
  const b = broen();
  b.ctx.tryConnect(9876);
  b.ctx.tryConnect(9877);
  assert.equal(b.instanser.length, 2);
});

// ── 2 · serverens side ─────────────────────────────────────────────────────

const SPAEND = await ledigtSpaend();

async function startServer() {
  const p = spawn(process.execPath, [join(rod, 'mcp-server', 'index.js')], {
    env: { ...process.env, BROWSER_MCP_TOKEN: '',
      BROWSER_MCP_BASE_PORT: String(SPAEND), BROWSER_MCP_MAX_PORT: String(SPAEND + 4) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let fejl = ''; const ud = [];
  let rest = '';
  p.stderr.on('data', (d) => { fejl += d.toString(); });
  p.stdout.on('data', (d) => {
    rest += d.toString();
    let i;
    while ((i = rest.indexOf('\n')) > -1) {
      const l = rest.slice(0, i); rest = rest.slice(i + 1);
      try { ud.push(JSON.parse(l)); } catch { /* ikke json */ }
    }
  });
  const skriv = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'proeve', version: '0' } } });
  for (let i = 0; i < 100 && !ud.find((m) => m.id === 1); i++) await new Promise((ok) => setTimeout(ok, 50));
  skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
  // Porten bindes foerst naar browseren bruges: et vaerktoejskald (svaret ventes ikke).
  skriv({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });
  for (let i = 0; i < 200; i++) {
    const m = fejl.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (m) return { proces: p, port: Number(m[1]), fejl: () => fejl, ud, skriv };
    await new Promise((ok) => setTimeout(ok, 50));
  }
  p.kill();
  throw new Error('serveren bandt aldrig en port: ' + fejl);
}

async function udvidelse(port, bogstav) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${bogstav.repeat(32)}` });
  const modtaget = [];
  ws.on('message', (d) => { try { modtaget.push(JSON.parse(d.toString())); } catch { /* ikke json */ } });
  ws.on('error', () => {});
  await new Promise((ok) => ws.on('open', ok));
  ws.send(JSON.stringify({ type: 'hello', extensionId: bogstav.repeat(32), version: '1.30.1', kode: 'abcdef012345' }));
  return { ws, modtaget };
}

const vent = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('doer den forbindelse et kald blev sendt til, afvises kaldet med det samme - selv om en anden udvidelse lever', async () => {
  const s = await startServer();
  try {
    const x = await udvidelse(s.port, 'a');
    const y = await udvidelse(s.port, 'b');
    await vent(300);
    s.skriv({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });
    let ejer = null;
    for (let i = 0; i < 40 && !ejer; i++) {
      ejer = [x, y].find((e) => e.modtaget.some((m) => typeof m?.method === 'string')) || null;
      if (!ejer) await vent(100);
    }
    assert.ok(ejer, 'ingen af de to udvidelser fik kaldet - proeven kan ikke maale noget');
    const andre = ejer === x ? y : x;
    const t0 = Date.now();
    ejer.ws.close();                       // ejeren doer UDEN at have svaret
    let svar = null;
    for (let i = 0; i < 40 && !svar; i++) {   // op til 4 s; fristen er 30 s
      svar = s.ud.find((m) => m.id === 9) || null;
      if (!svar) await vent(100);
    }
    assert.ok(svar, 'kaldet blev ikke afvist inden for 4 s: det venter til sin frist (30 s) fordi en ANDEN forbindelse lever');
    assert.ok(Date.now() - t0 < 4000);
    assert.match(JSON.stringify(svar), /disappeared/, 'afvisningen har en forkert forklaring (ikke «forbindelsen forsvandt»)');
    assert.equal(andre.ws.readyState, 1, 'den anden udvidelse blev lukket - proeven maaler en anden ting');
  } finally { s.proces.kill(); }
});

test('modsat: doer en ANDEN forbindelse end kaldets ejer, roeres kaldet ikke', async () => {
  const s = await startServer();
  try {
    const x = await udvidelse(s.port, 'a');
    const y = await udvidelse(s.port, 'b');
    await vent(300);
    s.skriv({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });
    let ejer = null;
    for (let i = 0; i < 40 && !ejer; i++) {
      ejer = [x, y].find((e) => e.modtaget.some((m) => typeof m?.method === 'string')) || null;
      if (!ejer) await vent(100);
    }
    assert.ok(ejer, 'ingen af de to udvidelser fik kaldet - proeven kan ikke maale noget');
    const andre = ejer === x ? y : x;
    andre.ws.close();                      // en forbindelse kaldet IKKE blev sendt til, doer
    await vent(1200);
    assert.equal(s.ud.find((m) => m.id === 9), undefined,
      'et kald blev afvist fordi en ANDEN forbindelse doede - et normalt skift mellem to udvidelser afbryder fuldt gyldige kald');
    // og ejeren kan stadig besvare det
    const kald = ejer.modtaget.find((m) => typeof m?.method === 'string');
    ejer.ws.send(JSON.stringify({ id: kald.id, result: { tabs: [] } }));
    let svar = null;
    for (let i = 0; i < 40 && !svar; i++) {
      svar = s.ud.find((m) => m.id === 9) || null;
      if (!svar) await vent(100);
    }
    assert.ok(svar, 'ejeren kunne ikke laengere besvare sit kald');
    assert.doesNotMatch(JSON.stringify(svar), /disappeared/);
  } finally { s.proces.kill(); }
});
