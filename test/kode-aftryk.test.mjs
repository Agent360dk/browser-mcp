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
  assert.match(off, /type: 'hello'[^}]*kode/, 'haandtrykket sender ikke feltet `kode`');
});

// MAALT 11/9 af Astra (e2e runde 2): haenger hentningen af background.js, blev haandtrykket ALDRIG sendt, og serveren saa
// en forbindelse uden version. Aftrykket er en bekvemmelighed for udgivelsens gate - hilsenen er ikke til forhandling.
test('haandtrykket venter ikke i det uendelige paa aftrykket', () => {
  const off = laes('extension/offscreen.js');
  assert.match(off, /Promise\.race\(\[kodeAftryk\(\)/, 'aftrykket har ingen tidsgraense foer haandtrykket sendes');
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
