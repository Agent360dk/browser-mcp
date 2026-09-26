/**
 * ⛔ MAALT 24/9 - fundet af Astra: broen kunne bygges af tre kaldere paa samme tid.
 *
 * Linjen oeverst i «Start», installations-haendelsen og hjerteslaget kaldte alle
 * ensureOffscreen, og ingen ventede paa de andre. Ved en ny installation fyrede de to foerste
 * naesten samtidig, og den ene lukkede broen mens den anden byggede den. Resultat: en halvdoed
 * bro, og «Not connected» for evigt for en ny bruger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'extension', 'background.js'), 'utf8');

function udklip(navn) {
  const m = kilde.match(new RegExp(`\\n((?:async )?function ${navn}\\([^)]*\\) \\{[\\s\\S]*?\\n\\})`));
  assert.ok(m, `${navn} blev ikke fundet i background.js`);
  return m[1];
}

test('to samtidige kald bygger broen ÉN gang - ikke to', async () => {
  let oprettet = 0;
  const chrome = {
    offscreen: {
      // Ingen bro endnu, og opbygningen tager tid - netop vinduet hvor kapløbet opstod.
      hasDocument: async () => false,
      createDocument: async () => { oprettet += 1; await new Promise((r) => setTimeout(r, 50)); },
    },
  };
  // ensureOffscreenIndre er tunge; her er den erstattet af det ene den skal: bygge broen.
  const src = `
    let offscreenIGang = null;
    const OFFSCREEN_FRIST_MS = 20000;
    ${udklip('iOffscreenKoe')}
    async function ensureOffscreenIndre() {
      if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument();
    }
    ${udklip('ensureOffscreen')}
    return ensureOffscreen;`;
  const ensureOffscreen = new Function('chrome', src)(chrome);

  await Promise.all([ensureOffscreen(), ensureOffscreen(), ensureOffscreen()]);
  assert.equal(oprettet, 1,
    `broen blev bygget ${oprettet} gange af tre samtidige kald. Saa kan én kalder lukke den `
    + 'mens en anden bygger den - og det var det der efterlod broen halvdoed for en ny bruger');
});

test('naar opbygningen er faerdig, maa et nyt kald godt starte en ny', async () => {
  let oprettet = 0;
  const chrome = { offscreen: {
    hasDocument: async () => false,
    createDocument: async () => { oprettet += 1; },
  } };
  const src = `
    let offscreenIGang = null;
    const OFFSCREEN_FRIST_MS = 20000;
    ${udklip('iOffscreenKoe')}
    async function ensureOffscreenIndre() {
      if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument();
    }
    ${udklip('ensureOffscreen')}
    return ensureOffscreen;`;
  const ensureOffscreen = new Function('chrome', src)(chrome);
  await ensureOffscreen();
  await ensureOffscreen();
  assert.equal(oprettet, 2, 'laasen blev aldrig sluppet - saa kan broen aldrig genopbygges efter et nedbrud');
});

/**
 * ⛔ 26/9 (fuld review, maalt): «Reconnect» lukkede broen UDEN for koeen og sluttede sig derefter
 * til hjerteslagets igangvaerende opbygning. Hjerteslagets ping fejlede (dokumentet var vaek),
 * lukningen kastede, og hjerteslaget vendte tilbage uden at bygge. Resultat: ingen bro i op til
 * 60 s - netop naar brugeren trykker, fordi serverens fejltekst beder om det.
 */
function broModel({ fristMs = 20000, opretHaenger = false } = {}) {
  const tilstand = { dokument: true, levende: false, oprettet: 0, lukket: 0 };
  const chrome = { offscreen: {
    hasDocument: async () => tilstand.dokument,
    closeDocument: async () => {
      if (!tilstand.dokument) throw new Error('No current offscreen document');
      tilstand.dokument = false; tilstand.lukket += 1;
    },
    createDocument: async () => {
      if (opretHaenger && tilstand.oprettet === 0) { tilstand.oprettet += 1; return new Promise(() => {}); }
      await new Promise((r) => setTimeout(r, 20));
      tilstand.dokument = true; tilstand.levende = true; tilstand.oprettet += 1;
    },
  } };
  // Den del af ensureOffscreenIndre der betyder noget her: et dokument der findes men ikke
  // svarer, lukkes; kan det ikke lukkes, proeves der igen ved naeste hjerteslag.
  const src = `
    let offscreenIGang = null;
    const OFFSCREEN_FRIST_MS = ${fristMs};
    const ping = async () => { await new Promise((r) => setTimeout(r, 50)); return tilstand.dokument && tilstand.levende; };
    async function ensureOffscreenIndre() {
      if (await chrome.offscreen.hasDocument()) {
        if (await ping()) return;
        try { await chrome.offscreen.closeDocument(); } catch { return; }
      }
      await chrome.offscreen.createDocument();
    }
    ${udklip('iOffscreenKoe')}
    ${udklip('ensureOffscreen')}
    ${udklip('genbygOffscreen')}
    return { ensureOffscreen, genbygOffscreen };`;
  const f = new Function('chrome', 'tilstand', 'console', src)(chrome, tilstand, { warn() {}, log() {}, error() {} });
  return { ...f, tilstand };
}

test('«Reconnect» midt i hjerteslagets ping efterlader en bro - ikke ingen', async () => {
  const m = broModel();
  const hjerteslag = m.ensureOffscreen();        // dokumentet findes men er doedt; pinget venter
  await new Promise((r) => setTimeout(r, 10));
  const reconnect = m.genbygOffscreen();         // brugeren trykker
  await Promise.allSettled([hjerteslag, reconnect]);
  assert.equal(m.tilstand.dokument, true,
    `ingen bro efter Reconnect (lukket ${m.tilstand.lukket}, oprettet ${m.tilstand.oprettet}) - `
    + 'lukningen ramte hjerteslagets opbygning, og ingen byggede igen');
});

test('en opbygning der haenger, holder ikke koeen - den naeste bygger efter fristen', async () => {
  const m = broModel({ fristMs: 100, opretHaenger: true });
  m.tilstand.dokument = false;
  await m.ensureOffscreen().catch(() => {});      // haenger, afvises af fristen
  const naeste = await Promise.race([
    m.ensureOffscreen().then(() => 'bygget', () => 'fejlede'),
    new Promise((r) => setTimeout(() => r('haenger stadig'), 1000)),
  ]);
  assert.equal(naeste, 'bygget', `det naeste kald ${naeste} - en haengende opbygning laaser broen til servicearbejderen genstartes`);
  assert.equal(m.tilstand.dokument, true);
});

test('broen lukkes KUN inde i koeen - aldrig direkte fra en haendelse', () => {
  // Vagten hviler paa mekanikken: hvilken funktion omslutter hvert kald til closeDocument.
  const kode = kilde.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const fund = [];
  for (const m of kode.matchAll(/chrome\.offscreen\.closeDocument\(/g)) {
    const foer = kode.slice(0, m.index);
    const fn = [...foer.matchAll(/\n(?:async )?function (\w+)\(/g)].pop()?.[1];
    fund.push(fn);
  }
  // Kalibrering: detektoren skal kunne se et kald.
  assert.ok(fund.length >= 2, `detektoren fandt kun ${fund.length} kald - den maaler ikke noget`);
  const tilladt = new Set(['ensureOffscreenIndre', 'genbygOffscreen']);
  assert.deepEqual(fund.filter((f) => !tilladt.has(f)), [],
    `broen lukkes uden for koeen i: ${fund.filter((f) => !tilladt.has(f)).join(', ')}`);
});

test('«Reconnect» midt i en opbygning lukker ikke den halvfaerdige bro', async () => {
  // Chrome melder dokumentet «til stede» fra det oejeblik det oprettes, men det er foerst klar
  // naar siden er indlaest. Lukkes det imellem, er broen halvdoed - «Offscreen document closed
  // before fully loading», den fejl 8cd485d handlede om. Genopbygningen skal derfor VENTE paa den
  // opbygning der er i gang, ikke bare selv bygge bagefter.
  const tilstand = { dokument: false, klar: false, halvdoed: false };
  const chrome = { offscreen: {
    hasDocument: async () => tilstand.dokument,
    closeDocument: async () => {
      if (!tilstand.dokument) throw new Error('No current offscreen document');
      if (!tilstand.klar) tilstand.halvdoed = true;
      tilstand.dokument = false; tilstand.klar = false;
    },
    createDocument: async () => {
      tilstand.dokument = true; tilstand.klar = false;
      await new Promise((r) => setTimeout(r, 40));
      tilstand.klar = true;
    },
  } };
  const src = `
    let offscreenIGang = null;
    const OFFSCREEN_FRIST_MS = 20000;
    async function ensureOffscreenIndre() {
      if (await chrome.offscreen.hasDocument()) return;
      await chrome.offscreen.createDocument();
    }
    ${udklip('iOffscreenKoe')}
    ${udklip('ensureOffscreen')}
    ${udklip('genbygOffscreen')}
    return { ensureOffscreen, genbygOffscreen };`;
  const m = new Function('chrome', 'console', src)(chrome, { warn() {}, log() {}, error() {} });
  const opbygning = m.ensureOffscreen();
  await new Promise((r) => setTimeout(r, 5));    // opbygningen er i gang
  await Promise.allSettled([opbygning, m.genbygOffscreen()]);
  assert.equal(tilstand.halvdoed, false, 'genopbygningen lukkede en bro der stadig var ved at indlaese');
  assert.equal(tilstand.dokument && tilstand.klar, true, 'og bagefter er der ingen faerdig bro');
});
