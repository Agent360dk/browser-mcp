/**
 * Udgivelsens flowtest skal kunne se at det er KANDIDATENS kode der koerer - ikke bare et versionsnummer der stemmer.
 *
 * MAALT 11/9 af Astra (R2 og e2e-reviewet): flow-gaten kraever én forbundet udvidelse med serverens version. To kopier med
 * samme versionsnummer og forskellig kode er derfor ikke til at skelne, og en udgivelse kan blive godkendt mod gammel kode.
 * Udvidelsen sender nu et fingeraftryk af sin egen `background.js` i haandtrykket (kun et hash - intet forlader maskinen,
 * serveren er 127.0.0.1), serveren viser det i selv-diagnosen, og flowtesten sammenligner med repoets egen fil.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const laes = (p) => readFileSync(join(rod, p), 'utf8');

// Samme regnestykke som udvidelsen og flowtesten skal bruge: SHA-256 af background.js, de foerste 6 bytes som hex.
function aftryk(fil) {
  return createHash('sha256').update(readFileSync(join(rod, fil))).digest('hex').slice(0, 12);
}

test('udvidelsen sender et fingeraftryk af sin egen background.js i haandtrykket', () => {
  const off = laes('extension/offscreen.js');
  assert.match(off, /background\.js/, 'offscreen henter ikke background.js');
  assert.match(off, /SHA-256/, 'der beregnes ikke et SHA-256-aftryk');
  assert.match(off, /kode/, 'haandtrykket sender ikke feltet `kode`');
});

// MAALT 11/9 af Astra (e2e runde 2): haenger hentningen af background.js, blev haandtrykket ALDRIG sendt, og serveren saa
// en forbindelse uden version. Aftrykket er en bekvemmelighed for udgivelsens gate - hilsenen er ikke til forhandling.
/**
 * Koerer den AEGTE offscreen.js mod stubbede API'er og rapporterer hvad den sendte.
 * Kildetekst-matchning kan ikke se en kaploeb - kun en koersel kan.
 */
function broen({ aftrykEfterMs = 0, aftrykFejler = false } = {}) {
  const sendt = [];
  const ws = {
    readyState: 0, OPEN: 1,
    send: (d) => sendt.push(JSON.parse(d)),
    close: () => {},
  };
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, URLSearchParams, JSON, Promise, Uint8Array, Array, Error, String,
    location: { search: '?v=1.29.1' },
    WebSocket: Object.assign(function () { return ws; }, { OPEN: 1, CONNECTING: 0 }),
    fetch: async (u) => {
      if (String(u).includes('background.js')) {
        if (aftrykFejler) throw new Error('hentningen fejlede');
        await new Promise((ok) => setTimeout(ok, aftrykEfterMs));
        return { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
      }
      throw new Error('ingen server');   // harServer -> ingen porte at skanne
    },
    crypto: { subtle: { digest: async () => new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67]).buffer } },
    chrome: {
      runtime: {
        id: 'proeve-id',
        getURL: (f) => 'chrome-extension://proeve-id/' + f,
        sendMessage: async () => {},
        onMessage: { addListener() {} },
      },
    },
  };
  ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(laes('extension/offscreen.js'), ctx, { filename: 'offscreen.js' });
  return { ctx, ws, sendt, aabn: async () => { ws.readyState = 1; await ws.onopen(); } };
}

// MAALT 11/9 af Astra (e2e runde 2): haenger hentningen af background.js, blev haandtrykket ALDRIG sendt, og serveren saa
// en forbindelse uden version. Aftrykket er en bekvemmelighed for udgivelsens gate - hilsenen er ikke til forhandling.
test('haandtrykket sendes selv naar aftrykket aldrig bliver beregnet', async () => {
  const b = broen({ aftrykFejler: true });
  b.ctx.tryConnect(9876);
  await b.aabn();
  assert.equal(b.sendt[0]?.type, 'hello', `haandtrykket blev ikke sendt: ${JSON.stringify(b.sendt)}`);
  assert.equal(b.sendt[0]?.version, '1.29.1');
});

// MAALT 12/9 af Astra (efterproevning af 19d036a): aftrykket blev kapproendt mod en frist paa 1 s. Tog hentningen 1,3 s,
// sendte udvidelsen `kode: null` - og udgivelsens flow-gate afviste sin EGEN kandidat, selv om koden var den rigtige.
// Et langsomt svar er ikke et forkert svar. Aftrykket eftersendes nu, saa hverken hilsen eller gate afhaenger af et ur.
test('et aftryk der tager laengere end et sekund, eftersendes - hilsenen venter ikke paa det', async () => {
  const b = broen({ aftrykEfterMs: 1300 });
  b.ctx.tryConnect(9876);
  const aabner = b.aabn();   // IKKE afventet: hilsenen skal vaere sendt uden at vente paa noget som helst
  assert.equal(b.sendt.length, 1, 'hilsenen ventede paa aftrykket i stedet for at blive sendt med det samme');
  assert.equal(b.sendt[0]?.type, 'hello');
  await aabner;
  await new Promise((ok) => setTimeout(ok, 1600));
  const medKode = b.sendt.find((m) => typeof m.kode === 'string');
  assert.ok(medKode, `aftrykket naaede aldrig frem: ${JSON.stringify(b.sendt)}`);
  assert.equal(medKode.kode, 'abcdef012345', JSON.stringify(medKode));
});

test('serveren tager ogsaa imod et eftersendt aftryk', () => {
  const srv = laes('mcp-server/index.js');
  assert.match(srv, /msg\.type === 'kode'/, 'serveren tager ikke imod et eftersendt aftryk');
});

test('serveren gemmer aftrykket fra haandtrykket og viser det i selv-diagnosen', () => {
  const srv = laes('mcp-server/index.js');
  assert.match(srv, /conn\.kode = typeof msg\.kode === 'string'/, 'serveren gemmer ikke aftrykket');
  assert.match(srv, /code: c\.kode/, 'selv-diagnosen viser ikke aftrykket pr. udvidelse');
});

test('flowtesten sammenligner udvidelsens aftryk med repoets egen background.js', () => {
  const flow = laes('test/flow/run.mjs');
  assert.match(flow, /createHash\('sha256'\)/, 'flowtesten beregner ikke aftrykket');
  assert.match(flow, /extension\/background\.js|extension', 'background\.js'/, 'flowtesten laeser ikke repoets background.js');
  assert.match(flow, /\.slice\(0, 12\)/, 'flowtesten bruger ikke samme laengde som udvidelsen');
  assert.match(flow, /aktiv\[0\]\?\.code|\.code\b/, 'flowtesten sammenligner ikke med det udvidelsen oplyste');
});

test('de to kopier af udvidelsen har samme aftryk - ellers maaler gaten den forkerte fil', () => {
  assert.equal(aftryk('extension/background.js'), aftryk('mcp-server/extension/background.js'));
  assert.match(aftryk('extension/background.js'), /^[0-9a-f]{12}$/);
});
