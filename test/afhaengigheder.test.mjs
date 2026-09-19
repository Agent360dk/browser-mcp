/**
 * Vi skal proeve den kode brugerne faktisk koerer.
 *
 * MAALT 19/9: `package.json` sagde `^1.28.0`, laasefilen laaste 1.28.0, og vores 689 proever
 * plus flow-spaerren koerte mod 1.28.0. En ny bruger der installerer i dag, faar **1.30.0** -
 * caret-omraadet loeses paa hans maskine, ikke paa vores. Hele suiten havde altsaa aldrig
 * koert mod det der bliver installeret.
 *
 * Det er samme fejlklasse som huset har skrevet ned: en sammenligning kraever ens udstyrede
 * traeer. Et instrument der maaler noget andet end det der sendes ud, svarer paa et andet
 * spoergsmaal end det man stillede.
 *
 * Vagten: gulvet i `package.json` skal VAERE den version vi har laast og proevet. Saa kan
 * omraadet stadig give brugeren noget nyere - det kan npm ikke forhindres i - men gulvet
 * flytter sig aldrig uden at nogen har koert proeverne mod den nye version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const pakke = JSON.parse(readFileSync(join(rod, 'mcp-server/package.json'), 'utf8'));
const laas = JSON.parse(readFileSync(join(rod, 'mcp-server/package-lock.json'), 'utf8'));

function laastVersion(navn) {
  const p = laas.packages || {};
  const n = p[`node_modules/${navn}`];
  return n && n.version;
}

test('hver runtime-afhaengigheds gulv er den version vi har laast og proevet', () => {
  const skaev = [];
  for (const [navn, omraade] of Object.entries(pakke.dependencies || {})) {
    const laast = laastVersion(navn);
    if (!laast) { skaev.push(`${navn}: ikke i laasefilen`); continue; }
    const gulv = String(omraade).replace(/^[\^~>=\s]+/, '');
    if (gulv !== laast) {
      skaev.push(`${navn}: package.json siger "${omraade}" (gulv ${gulv}), laasefilen har ${laast}`);
    }
  }
  assert.deepEqual(skaev, [], 'proeverne koerer mod en anden version end den vi erklaerer:\n  ' + skaev.join('\n  '));
});

test('den INSTALLEREDE afhaengighed er ogsaa den laaste - ellers maaler suiten noget tredje', () => {
  const skaev = [];
  for (const navn of Object.keys(pakke.dependencies || {})) {
    let installeret = null;
    try {
      installeret = JSON.parse(readFileSync(join(rod, 'mcp-server/node_modules', navn, 'package.json'), 'utf8')).version;
    } catch { continue; }   // ikke installeret her (fx en ren checkout) - ikke en fejl
    const laast = laastVersion(navn);
    if (installeret !== laast) skaev.push(`${navn}: installeret ${installeret}, laast ${laast} - koer npm ci`);
  }
  assert.deepEqual(skaev, [], skaev.join('\n  '));
});
