/**
 * PARRINGEN ER TRUKKET TILBAGE I 1.30.1 - og disse proever beviser at den er det, begge steder.
 *
 * 1.30.0 udgav en parringsnoegle (issue #10). 26/9 maalte et panel og et review at den ikke holdt:
 *  - udvidelsen sendte noeglen i hilsenen til ENHVER server paa en port i spaendet og tog den
 *    tilbage som bevis, saa et fremmed program kunne parre sig ved at gentage den (0 -> 1 kommando);
 *  - en halvt parret opsaetning kaprede den anden profils server (3 af 8 forsoeg);
 *  - en 1.30.0-udvidelse kunne aldrig laese sin noegle og blev laast ude (4003) af en server med
 *    noeglen sat - som popup'en bad brugeren om.
 * En sikring der ikke sikrer, er vaerre end ingen. Den kommer igen redesignet.
 *
 * Det der IKKE handlede om parring, bevares og proeves stadig her: svar bindes til den forbindelse
 * kommandoen gik til, og offscreen.js roerer kun chrome.runtime.
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

// Spaendet kommer fra den faelles hjaelper - se test/hjaelp/ledigt-spaend.mjs for hvorfor
// faste spaend kostede baade her og i to andre proevefiler.
const SPAEND = await ledigtSpaend();

/** Starter den aegte server, faar den til at binde en port, og giver porten tilbage. */
async function serverMedNoegle(noegle) {
  const p = spawn(process.execPath, [join(rod, 'mcp-server', 'index.js')], {
    // ⛔ MAALT 21/9: uden eget spaend bandt proeven 9876/9877 - Gustavs EGET spaend. Hver
    // `npm test` tog altsaa pladser i den pulje hans 5-12 chats deler, og hans koerende
    // udvidelse forbandt til proevens server og blev afvist igen og igen. Er puljen fuld
    // (maalt 7/9: 37 servere), kaster serveren efter 10 s og seks proever bliver roede paa
    // uaendret kode.
    //
    // BROWSER_MCP_TOKEN nulstilles ogsaa foerst: arves den fra skallen, koerer
    // «uden noegle»-proeverne i virkeligheden MED noegle og maaler det modsatte af deres navn.
    env: { ...process.env, BROWSER_MCP_TOKEN: '',
      BROWSER_MCP_BASE_PORT: String(SPAEND), BROWSER_MCP_MAX_PORT: String(SPAEND + 4),
      ...(noegle ? { BROWSER_MCP_TOKEN: noegle } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let fejl = '';
  p.stderr.on('data', (d) => { fejl += d.toString(); });
  const skriv = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'proeve', version: '0' } } });
  await new Promise((ok) => p.stdout.once('data', ok));
  skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
  // Porten bindes foerst naar browseren faktisk skal bruges - derfor et vaerktoejskald.
  // Svaret ventes ikke: uden udvidelse proever det i flere sekunder, og det er porten vi vil have.
  skriv({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });

  // Porten LAESES af serverens egen log. En skanning af spaendet ville finde den foerste
  // levende browser-mcp paa maskinen - og paa denne maskine koerer der altid nogle - saa
  // testen ville maale en HELT anden proces uden noegle og alligevel se groen ud.
  for (let i = 0; i < 200; i++) {
    const m = fejl.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (m) return { proces: p, port: Number(m[1]), fejl: () => fejl };
    await new Promise((ok) => setTimeout(ok, 50));
  }
  p.kill();
  throw new Error('serveren bandt aldrig en port: ' + fejl);
}

/** Melder sig som udvidelse med et givet haandtryk og rapporterer hvad der skete. */
function udvidelseHilser(port, hilsen) {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    const svar = [];
    let lukket = null;
    ws.on('open', () => ws.send(JSON.stringify(hilsen)));
    ws.on('message', (d) => { try { svar.push(JSON.parse(d.toString())); } catch { /* ikke json */ } });
    ws.on('close', (kode) => { lukket = kode; });
    ws.on('error', () => {});
    setTimeout(() => { try { ws.close(); } catch { /* lukket */ } ok({ svar, lukket }); }, 900);
  });
}


const HILSEN = { type: 'hello', extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', version: '1.29.2', kode: 'abcdef012345' };

test('uden noegle er intet aendret - udvidelsen kommer ind som i dag', async () => {
  const s = await serverMedNoegle(null);
  try {
    const r = await udvidelseHilser(s.port, HILSEN);
    assert.equal(r.lukket, null, 'serveren lukkede en helt almindelig udvidelse ude');
    assert.equal(r.svar.find((m) => m.type === 'parring'), undefined, 'der blev sendt en parringskvittering');
  } finally { s.proces.kill(); }
});

test('BROWSER_MCP_TOKEN ignoreres: en udvidelse uden noegle kommer ind, og serveren siger hvorfor', async () => {
  // Det er netop butikkens 1.30.0-udvidelse: den kan aldrig sende sin noegle. Med parringen
  // aktiv blev den lukket ude med 4003; nu skal den ind, og brugeren skal kunne se hvorfor
  // noeglen ikke virker.
  const s = await serverMedNoegle('arbejde');
  try {
    const r = await udvidelseHilser(s.port, HILSEN);
    assert.equal(r.lukket, null, `en udvidelse uden noegle blev lukket ude (kode ${r.lukket}) - parringen er ikke trukket tilbage`);
    assert.match(s.fejl(), /BROWSER_MCP_TOKEN is ignored: pairing was withdrawn/,
      'serveren tier om at noeglen ignoreres - brugeren tror han er beskyttet');
  } finally { s.proces.kill(); }
});

test('med noegle sat gentager serveren den aldrig - heller ikke til en udvidelse der sender en', async () => {
  const s = await serverMedNoegle('arbejde');
  try {
    const r = await udvidelseHilser(s.port, { ...HILSEN, noegle: 'arbejde' });
    assert.equal(r.lukket, null);
    assert.equal(r.svar.find((m) => m.type === 'parring'), undefined,
      'serveren sendte en parringskvittering - noeglen er stadig i spil');
    assert.ok(!JSON.stringify(r.svar).includes('arbejde'), 'serveren gentog noeglen over broen');
  } finally { s.proces.kill(); }
});

test('en fremmed forbindelse kan ikke besvare en andens kommando', async () => {
  const s = await serverMedNoegle(null);
  try {
    // Den aegte udvidelse.
    const aegte = new WebSocket(`ws://127.0.0.1:${s.port}`, { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    const modtaget = [];
    aegte.on('message', (d) => { try { modtaget.push(JSON.parse(d.toString())); } catch { /* ikke json */ } });
    aegte.on('error', () => {});
    await new Promise((ok) => aegte.on('open', ok));
    aegte.send(JSON.stringify(HILSEN));

    // Angriberen: ingen hilsen - men lytter med paa broen.
    const fremmed = new WebSocket(`ws://127.0.0.1:${s.port}`, { origin: 'chrome-extension://cccccccccccccccccccccccccccccccc' });
    fremmed.on('error', () => {});
    await new Promise((ok) => fremmed.on('open', ok));
    await new Promise((ok) => setTimeout(ok, 300));

    // Serveren skal sende et kald til den AEGTE. Angriberen forsoeger at svare foerst.
    s.proces.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: { name: 'browser_list_tabs', arguments: {} } }) + '\n');
    for (let i = 0; i < 40 && modtaget.filter((m) => m.method).length === 0; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
    }
    const kald = modtaget.find((m) => m.method);
    assert.ok(kald, 'den aegte udvidelse fik aldrig kaldet - proeven kan ikke maale noget');

    let svaret = null;
    const slut = new Promise((ok) => {
      const t = setInterval(() => {
        const l = s.fejl();
        if (/Ignored a reply to command/.test(l)) { svaret = 'afvist'; clearInterval(t); ok(); }
      }, 100);
      setTimeout(() => { clearInterval(t); ok(); }, 4000);
    });
    fremmed.send(JSON.stringify({ id: kald.id, result: { tabs: [{ id: 1, url: 'https://forfalsket.example' }] } }));
    await slut;

    assert.equal(svaret, 'afvist',
      'et forfalsket svar fra en fremmed forbindelse blev accepteret - agenten ville handle '
      + 'paa data der aldrig kom fra browseren');
    try { aegte.close(); fremmed.close(); } catch { /* lukket */ }
  } finally { s.proces.kill(); }
});

// ── Udvidelsens side ────────────────────────────────────────────────────────

/** Koerer den aegte offscreen.js med en gemt noegle og rapporterer hvad broen gjorde. */
function broen(gemtNoegle, noegleSvarFejler = false) {
  const tilBaggrund = [];
  const sendt = [];
  let lukket = false;
  const ws = {
    readyState: 0, OPEN: 1,
    send: (d) => sendt.push(JSON.parse(d)),
    close: () => { lukket = true; },
  };
  const lyttere = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, URLSearchParams, JSON, Promise, Uint8Array, Array, Error, String, Boolean, WeakSet, Map, Set, Object,
    location: { search: '?v=1.29.2' },
    WebSocket: Object.assign(function () { return ws; }, { OPEN: 1, CONNECTING: 0 }),
    fetch: async () => { throw new Error('ingen server'); },
    crypto: { subtle: { digest: async () => new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45]).buffer } },
    chrome: {
      // ⛔ KUN runtime. Chromes dokumentation siger ordret at runtime er den ENESTE
      // udvidelses-API et offscreen-dokument har. Selen gav tidligere ogsaa `storage`, og
      // derfor kunne de fire proever herunder ikke se at offscreen.js laeste et lager der
      // ikke findes. Fejlen naaede den udgivne 1.30.0 og gjorde parringen ubrugelig.
      // En sele der er rundhaandet med API'er, maaler et produkt der ikke findes.
      runtime: {
        id: 'proeve-id',
        getURL: (f) => 'chrome-extension://proeve-id/' + f,
        // Baggrunden svarer paa noegle-hentningen. Alt andet kvitterer bare.
        // ⛔ Baggrunden svarer nu `{ ok, noegle }`: `ok:false` betyder «kunne ikke laese
        // lageret», og offscreen skal da holde broen LUKKET i stedet for at laese det som
        // «ingen noegle». Selen skal derfor svare i samme form, ellers proever den en
        // kontrakt der ikke findes.
        sendMessage: async (m) => {
          // ⛔ Kommandoer til baggrunden optages HER. `sendt` er ws-beskeder til serveren, og
          // en `mcp_command` optraeder aldrig der - en paastand om `sendt` kan derfor ikke
          // fejle, uanset hvad udvidelsen goer. (Den fejl blev skrevet og fanget 21/9.)
          tilBaggrund.push(m);
          if (m && m.type === 'bmcp_hent_parringsnoegle') {
            return noegleSvarFejler ? { ok: false, fejl: 'proeve' } : { ok: true, noegle: gemtNoegle || null };
          }
          return { ok: true };
        },
        onMessage: { addListener: (f) => lyttere.push(f) },
      },
    },
  };
  ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(readFileSync(join(rod, 'extension/offscreen.js'), 'utf8'), ctx, { filename: 'offscreen.js' });
  return {
    ctx, ws, sendt, lyttere, tilBaggrund,
    erLukket: () => lukket,
    aabn: async () => { ws.readyState = 1; await ws.onopen(); },
    modtag: async (o) => { await ws.onmessage({ data: JSON.stringify(o) }); },
  };
}

// Noeglen laeses asynkront, men haandtrykket bygges synkront - derfor caches den ved opstart,
// samme moenster som kodeaftrykket. Uden ventetiden her ville testen maale cachen foer den var fyldt.
const pust = () => new Promise((ok) => setTimeout(ok, 20));

test('udvidelsen sender ingen noegle - heller ikke en som 1.30.0 naaede at gemme', async () => {
  const b = broen('gammel-noegle-fra-1.30.0');
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  const hello = b.sendt.find((m) => m.type === 'hello');
  assert.ok(hello, 'udvidelsen hilste ikke - proeven kan ikke maale noget');
  assert.equal('noegle' in hello, false, 'hilsenen baerer stadig et noegle-felt');
  assert.equal(b.tilBaggrund.some((m) => m?.type === 'bmcp_hent_parringsnoegle'), false,
    'udvidelsen spoerger stadig baggrunden om noeglen');
});

test('kommandoer udfoeres med det samme - ingen kvittering kraeves', async () => {
  const b = broen('gammel-noegle-fra-1.30.0');
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  await b.modtag({ id: 1, method: 'get_page_content', params: {} });
  assert.equal(b.tilBaggrund.filter((m) => m?.type === 'mcp_command').length, 1,
    'kommandoen blev ikke udfoert - udvidelsen venter stadig paa en parring der aldrig kommer');
});

test('en parringsbesked fra en gammel server ignoreres, og soklen lever', async () => {
  const b = broen(null);
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  await b.modtag({ type: 'parring', ok: true, noegle: 'hvad-som-helst' });
  assert.equal(b.erLukket(), false, 'udvidelsen lukkede soklen paa en parringsbesked');
  assert.equal(b.tilBaggrund.filter((m) => m?.type === 'mcp_command').length, 0,
    'en besked uden method blev sendt videre som kommando');
});

test('null og beskeder uden method faar ikke udvidelsen til at kaste eller udfoere noget', async () => {
  const b = broen(null);
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  await b.modtag(null);
  await b.modtag({ id: 7 });
  assert.equal(b.tilBaggrund.filter((m) => m?.type === 'mcp_command').length, 0);
});

test('offscreen.js roerer kun chrome.runtime - alt andet findes ikke der', () => {
  const kilde = readFileSync(join(rod, 'extension/offscreen.js'), 'utf8');
  // Kommentarer ud foerst: filen FORKLARER fejlen, og forklaringen maa ikke udloese vagten.
  const kode = kilde.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const brugt = [...new Set([...kode.matchAll(/\bchrome\.([a-zA-Z]+)/g)].map((m) => m[1]))];

  // ⛔ Detektoren proeves mod et kendt-sandt tilfaelde, foer «ingen fund» betyder noget.
  const proeve = [...new Set([...'chrome.storage.local.get(1)'.matchAll(/\bchrome\.([a-zA-Z]+)/g)].map((m) => m[1]))];
  assert.deepEqual(proeve, ['storage'], 'detektoren finder ikke et chrome-navnerum den faar forelagt');

  assert.deepEqual(brugt, ['runtime'],
    `offscreen.js roerer ${brugt.join(', ')}. Kun runtime findes i et offscreen-dokument - `
    + 'alt andet kaster, og et slugt kast er praecis hvad der gjorde parringen ubrugelig i 1.30.0.');
});

test('popup\'en har ingen parring - brugeren kan ikke taende en sikring der ikke sikrer', () => {
  const html = readFileSync(join(rod, 'extension/popup.html'), 'utf8');
  const js = readFileSync(join(rod, 'extension/popup.js'), 'utf8');
  assert.equal(/id="pairKey"|id="savePair"|Pairing \(optional\)/.test(html), false, 'popup.html viser stadig parringen');
  assert.equal(/parringsnoegle|BROWSER_MCP_TOKEN/.test(js), false, 'popup.js saetter eller viser stadig noeglen');
});

test('baggrunden udleverer ingen noegle og skubber ingen noegle-aendring', async () => {
  const { indlaesUdvidelse } = await import('./hjaelp/udvidelses-sele.mjs');
  const u = indlaesUdvidelse({ svar: { 'storage.local.get': { parringsnoegle: 'arbejde' } } });
  const svar = await new Promise((ok) => {
    for (const fn of u.lyttere.get('runtime.onMessage') || []) fn({ type: 'bmcp_hent_parringsnoegle' }, {}, ok);
    setTimeout(() => ok('intet svar'), 200);
  });
  assert.ok(svar === 'intet svar' || svar?.noegle === undefined, `baggrunden udleverede noeglen: ${JSON.stringify(svar)}`);
  await u.fyr('storage.onChanged', { parringsnoegle: { newValue: 'ny' } }, 'local');
  assert.equal(u.optager.kald.filter((k) => k.args?.[0]?.type === 'bmcp_parringsnoegle_aendret').length, 0,
    'baggrunden skubber stadig noegle-aendringer til offscreen');
});
