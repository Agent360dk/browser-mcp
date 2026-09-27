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
 *
 * ⛔ Og Astra 26/9: de foerste udgaver af proeverne her var groenne med en genbygOffscreen der INTET
 * gjorde, fordi hjerteslaget selv byggede broen. Proeverne maaler derfor nu at Reconnect ERSTATTER
 * dokumentet (et nyt id), ikke bare at der er en bro til sidst.
 */
function broModel({ levende = false } = {}) {
  const tilstand = { dokument: true, id: 1, levende, klar: true, oprettet: 0, lukket: 0, halvdoed: false };
  const chrome = { offscreen: {
    hasDocument: async () => tilstand.dokument,
    closeDocument: async () => {
      if (!tilstand.dokument) throw new Error('No current offscreen document');
      if (!tilstand.klar) tilstand.halvdoed = true;
      tilstand.dokument = false; tilstand.lukket += 1;
    },
    createDocument: async () => {
      tilstand.dokument = true; tilstand.klar = false; tilstand.id += 1; tilstand.oprettet += 1;
      await new Promise((r) => setTimeout(r, 40));
      tilstand.klar = true; tilstand.levende = true;
    },
  } };
  // Den del af ensureOffscreenIndre der betyder noget her: et dokument der findes og svarer, faar
  // lov at vaere; et der ikke svarer, lukkes; kan det ikke lukkes, proeves der igen naeste gang.
  const src = `
    let offscreenIGang = null;
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

test('«Reconnect» midt i hjerteslagets ping efterlader en bro - og den er Reconnects egen', async () => {
  const m = broModel();                          // et dokument der findes men er doedt
  const hjerteslag = m.ensureOffscreen();        // pinget venter
  await new Promise((r) => setTimeout(r, 10));
  const reconnect = m.genbygOffscreen();         // brugeren trykker
  await Promise.allSettled([hjerteslag, reconnect]);
  assert.equal(m.tilstand.dokument && m.tilstand.klar, true,
    `ingen faerdig bro efter Reconnect (lukket ${m.tilstand.lukket}, oprettet ${m.tilstand.oprettet})`);
  assert.equal(m.tilstand.oprettet, 2,
    `Reconnect byggede ikke selv en ny bro (oprettet ${m.tilstand.oprettet}) - hjerteslaget gjorde arbejdet`);
});

test('«Reconnect» erstatter ogsaa en bro der svarer - det er hele knappens formaal', async () => {
  const m = broModel({ levende: true });
  await m.genbygOffscreen();
  assert.equal(m.tilstand.lukket, 1, 'den gamle bro blev ikke lukket');
  assert.equal(m.tilstand.id, 2, 'der blev ikke bygget en ny bro');
  assert.equal(m.tilstand.dokument && m.tilstand.klar, true);
});

test('«Reconnect» midt i en opbygning venter paa den - og erstatter den bagefter', async () => {
  // Chrome melder dokumentet «til stede» fra det oejeblik det oprettes, men det er foerst klar naar
  // siden er indlaest. Lukkes det imellem, er broen halvdoed - «Offscreen document closed before
  // fully loading», den fejl 8cd485d handlede om.
  const m = broModel();
  m.tilstand.dokument = false;
  const opbygning = m.ensureOffscreen();         // bygger dokument 2
  await new Promise((r) => setTimeout(r, 5));
  await Promise.allSettled([opbygning, m.genbygOffscreen()]);
  assert.equal(m.tilstand.halvdoed, false, 'genopbygningen lukkede en bro der stadig var ved at indlaese');
  assert.equal(m.tilstand.id, 3, `Reconnect erstattede ikke broen efter opbygningen (id ${m.tilstand.id})`);
  assert.equal(m.tilstand.dokument && m.tilstand.klar, true, 'og bagefter er der ingen faerdig bro');
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
