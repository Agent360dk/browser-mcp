/**
 * De to lister over «det maa der ikke staa om os» maa ikke glide fra hinanden.
 *
 * `test/loefter-vagt.test.mjs` vogter VORES EGNE filer. `scripts/dominans-audit.py` vogter
 * tredjeparts-listningerne - og den kan kun koere med netvaerk, altsaa maanedligt, ikke i CI.
 * To lister med samme formaal og to redaktoerer ender forskellige: det er praecis saadan
 * README'en blev rettet 7/9 mens fire install-sider stod med de gamle paastande til 18/9.
 *
 * MAALT 19/9: mcp.so serverede vores juli-tekst - «solves CAPTCHAs, 34 tools. MIT, local-only».
 * Loefte-vagten forbyder baade «local-only» og «34 tools», men kunne ikke se dem: de laa paa en
 * fremmed server. Auditten kan se dem - saa laenge den kender de samme moenstre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const vagt = readFileSync(join(rod, 'test/loefter-vagt.test.mjs'), 'utf8');
const audit = readFileSync(join(rod, 'scripts/dominans-audit.py'), 'utf8');

/** Moenstrene i auditens TREDJEPART_FORBUDT, som de staar. */
function auditMoenstre() {
  const blok = audit.match(/TREDJEPART_FORBUDT = \[([\s\S]*?)\n\]/);
  assert.ok(blok, 'TREDJEPART_FORBUDT findes ikke i dominans-audit.py');
  return [...blok[1].matchAll(/\(r?"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
}

test('auditten kender mindst de seks kerne-usandheder', () => {
  assert.ok(auditMoenstre().length >= 6, `for faa moenstre: ${auditMoenstre().length}`);
});

// Python-regex og JS-regex skrives ikke ens (\\b vs \b), saa der sammenlignes paa den
// karakteristiske ORDSTAMME - det der ville skulle aendres hvis nogen aendrede reglen.
const STAMMER = {
  'local-only': 'local-only',
  'tools?': '(29|34) (browser )?tools?',
  'solves CAPTCHAs': null,          // kun tredjepart: vores egne sider siger *Partly* i tabelform
  'leaves (your|the) machine': 'leaves (your|the) machine',
  '100% local': '100% local',
  'up to 10 concurrent': 'up to 10 concurrent',
};

test('hvert moenster i auditten findes ogsaa i loefte-vagten (eller er markeret som kun-tredjepart)', () => {
  const mangler = [];
  for (const [stamme, iVagten] of Object.entries(STAMMER)) {
    if (iVagten === null) continue;
    if (!vagt.includes(iVagten)) mangler.push(`${stamme} -> "${iVagten}" findes ikke i loefter-vagt.test.mjs`);
  }
  assert.deepEqual(mangler, [], `listerne er gledet fra hinanden:\n  ${mangler.join('\n  ')}`);
});

test('auditten scanner KUN i vinduet omkring vores egen beskrivelse', () => {
  // Foerste udgave scannede hele siden og blev roed paa Glamas EGEN etiket `hosting:local-only`
  // i en JSON-klump med hundredvis af fremmede servere. En vagt der er roed paa noget andres
  // tekst, bliver slaaet fra - og saa vogter den ingenting.
  assert.match(audit, /SIGNATUR = .*logged-in Chrome/, 'auditten bruger ikke et signatur-vindue');
  assert.match(audit, /_vinduer/, 'der scannes ikke i vinduer');
  assert.ok(!/for _moenster, _hvorfor in TREDJEPART_FORBUDT:\n\s+if _re0\.search\(_moenster, _txt/.test(audit),
    'der scannes stadig i hele sidens tekst');
});
