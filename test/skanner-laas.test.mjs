/**
 * ⛔ MAALT 23/9: broen kunne doe permanent af ÉN haengende probe.
 *
 * `skanner`-flaget frigives i `finally`. Det daekker exceptions - men ikke et loefte der
 * aldrig afgoeres. Haenger én probe, afgoeres `Promise.all` aldrig, `finally` naas aldrig, og
 * hver senere skanning returnerer med det samme. Udvidelsen holder op med at finde servere
 * indtil den genstartes.
 *
 * Det er ikke kun et proeve-problem: et offscreen-dokument er aldrig synligt, saa Chrome kan
 * fryse det - og et frosset dokument fyrer heller ikke sin egen afbryder-timer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'extension', 'offscreen.js'), 'utf8');

/** Klipper scanPorts ud og koerer den med en probe der ALDRIG svarer. */
function byg({ ventil }) {
  const m = kilde.match(/const SCAN_MAX_MS = \d+;[\s\S]*?\nasync function scanPorts\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'scanPorts blev ikke fundet - proeven kan ikke maale noget');
  const src = m[0].replace(/const SCAN_MAX_MS = \d+;/, `const SCAN_MAX_MS = ${ventil};`);
  const fabrik = new Function('harServer', 'tryConnect', 'connections', 'BASE_PORT', 'MAX_PORT', 'WebSocket', `
    let skanner = false;
    ${src}
    return { scanPorts, laast: () => skanner };`);
  let kaldt = 0;
  return fabrik(
    () => { kaldt += 1; return new Promise(() => {}); },   // svarer ALDRIG
    () => {}, new Map(), 19900, 19904, { OPEN: 1, CONNECTING: 0 },
  );
}

const vent = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('en skanning der aldrig bliver faerdig, laaser ikke broen for altid', async () => {
  const b = byg({ ventil: 300 });
  b.scanPorts();
  await vent(50);
  assert.equal(b.laast(), true, 'foerste skanning saetter ikke laasen - saa maaler proeven intet');

  await vent(400);   // ventilen skal have fyret
  assert.equal(b.laast(), false,
    'laasen staar stadig efter ventilens tid. Én haengende probe ville saa doede broen '
    + 'permanent: hver senere skanning returnerer med det samme, og udvidelsen finder aldrig '
    + 'en server igen uden genstart');
});

test('ventilen frigiver ikke for tidligt - to skanninger maa ikke overlappe', async () => {
  const b = byg({ ventil: 5000 });
  b.scanPorts();
  await vent(100);
  assert.equal(b.laast(), true, 'laasen blev sluppet med det samme - saa kan to skanninger koere oveni hinanden');
});
