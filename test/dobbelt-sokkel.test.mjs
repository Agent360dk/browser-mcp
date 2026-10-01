/**
 * Astras fund (uafhaengigt review af 1.30.1-kandidaten d05e612, 1/10-2026): DOBBELT SOKKEL i portscanneren.
 *
 * `scanPorts` kalder `tryConnect(port)` EFTER en `await`. Hang en probe saa laenge at sikkerhedsventilen slap
 * laasen, naaede en ny skanning at forbinde til en levende port. Naar den gamle skannings probe saa svarede,
 * forbandt den OGSAA til den port, og `connections.set(port, ws)` overskrev den foerste sokkel uden at lukke den.
 * En aaben sokkel uden for kortet. Astra maalte at den senere kan udloese `session_disconnect` for en LEVENDE session,
 * hvorefter releaseSession lukker sessionens faner. 1.30.0 har ikke fejlen (der laa en hængende probe fast for evigt).
 *
 * Disse proever koerer den AEGTE offscreen.js i en vm med en WebSocket-stub der taeller sokler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const tick = () => new Promise((ok) => setImmediate(ok));

/** Kører den ægte offscreen.js. setTimeout optages, så proeven selv kan lade sikkerhedsventilen fyre. */
function broen() {
  const instanser = [];
  const timere = [];
  function WS(url) {
    const o = { readyState: 0, url, send() {}, close() { o.readyState = 3; } };
    instanser.push(o);
    return o;
  }
  WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => { timere.push({ fn, ms, fyret: false }); return timere.length; },
    clearTimeout: (id) => { if (timere[id - 1]) timere[id - 1].fyret = true; },
    setInterval: () => 0, clearInterval() {},
    URLSearchParams, JSON, Promise, Uint8Array, Array, Error, String, Boolean, WeakSet, Map, Set, Object, Number, Date, Math, AbortSignal,
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
  const ventilMs = runInContext('SCAN_MAX_MS', ctx);
  /** Lader sikkerhedsventilen fyre for den skanning der haenger (den seneste ventil-timer der ikke er ryddet). */
  const fyrVentilen = () => {
    const t = [...timere].reverse().find((x) => x.ms === ventilMs && !x.fyret);
    assert.ok(t, 'ingen aktiv sikkerhedsventil at lade fyre - proeven maaler en anden ting');
    t.fyret = true; t.fn();
  };
  const sokler = (port) => instanser.filter((w) => w.url.endsWith(':' + port));
  return { ctx, instanser, kort, fyrVentilen, sokler };
}

// ── enhedsprøver for vagten ────────────────────────────────────────────────

test('en port der allerede har en forbindelse under oprettelse faar ikke endnu en sokkel', () => {
  const b = broen();
  b.ctx.tryConnect(9876);
  assert.equal(b.instanser.length, 1, 'foerste tryConnect oprettede ingen sokkel - proeven kan ikke maale noget');
  b.ctx.tryConnect(9876);
  assert.equal(b.instanser.length, 1, 'der blev oprettet en ANDEN sokkel til samme port - den foerste er nu forældreløs uden for kortet');
  assert.equal(b.kort().get(9876), b.instanser[0]);
});

test('en port med en AABEN forbindelse faar heller ikke endnu en sokkel', () => {
  const b = broen();
  b.ctx.tryConnect(9876);
  b.instanser[0].readyState = 1;
  b.ctx.tryConnect(9876);
  assert.equal(b.instanser.length, 1);
});

test('modsat: en LUKKET forbindelse maa gerne erstattes (ellers kan broen aldrig genforbinde)', () => {
  const b = broen();
  b.ctx.tryConnect(9876);
  b.instanser[0].readyState = 3;
  b.ctx.tryConnect(9876);
  assert.equal(b.instanser.length, 2, 'en doed forbindelse blev ikke erstattet - vagten er for streng');
  assert.equal(b.kort().get(9876), b.instanser[1]);
});

test('to forskellige porte forbindes begge (vagten er pr. port)', () => {
  const b = broen();
  b.ctx.tryConnect(9876);
  b.ctx.tryConnect(9877);
  assert.equal(b.instanser.length, 2);
});

// ── Astras eget forløb, ende til ende ──────────────────────────────────────

test('Astras forloeb: en gammel skannings sene probe laver ikke endnu en sokkel til en port en nyere skanning har forbundet', async () => {
  const b = broen();
  await tick(); await tick();                    // opstartsskanningen er faerdig (ingen levende porte)
  let frigivB;
  const bProbe = new Promise((ok) => { frigivB = ok; });
  b.ctx.fetch = (url) => {
    const port = Number(url.match(/:(\d+)/)[1]);
    if (port === 9876) return Promise.resolve({ status: 426 });   // A: levende
    if (port === 9877) return bProbe;                                // B: proben haenger
    return Promise.reject(new Error('refused'));
  };
  const skanning1 = b.ctx.scanPorts();           // skanning 1: A svarer straks, B haenger -> Promise.all holder A tilbage
  await tick();
  assert.equal(b.sokler(9876).length, 0, 'skanning 1 forbandt allerede til A - proeven rammer ikke kapløbet');
  b.fyrVentilen();                                // sikkerhedsventilen slipper laasen
  await b.ctx.scanPorts();                        // skanning 2: springer B over (probe i luften), forbinder til A
  await tick();
  assert.equal(b.sokler(9876).length, 1, 'skanning 2 forbandt ikke til A - proeven maaler ikke det vi tror');
  frigivB({ status: 426 });                       // den gamle probe svarer endelig
  await skanning1; await tick();
  assert.equal(b.sokler(9876).length, 1,
    'den gamle skanning forbandt til A IGEN: to sokler til samme port, og den foerste er forældreløs uden for kortet');
  assert.equal(b.kort().get(9876), b.sokler(9876)[0], 'kortet peger ikke paa den eneste sokkel til A');
  assert.equal(b.sokler(9877).length, 1, 'B (hvis probe svarede) blev ikke forbundet - vagten er for streng');
});
