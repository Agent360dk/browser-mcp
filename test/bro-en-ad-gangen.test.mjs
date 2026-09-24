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
