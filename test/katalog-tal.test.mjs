/**
 * Katalogerne maa ikke vise forkerte tal eller falske loefter uden at den maanedlige audit siger det.
 *
 * MAALT 11/9: mcp.so viste "34 tools", "MIT, local-only" og "~80% reCAPTCHA-checkbox solve", og
 * punkpeye/awesome-mcp-servers viste "34 tools, up to 10 concurrent sessions" - mens produktet har 40
 * vaerktoejer og 20 sessioner. dominans-audit.py kiggede kun efter om navnet stod paa siden, saa intet af
 * det blev fanget i to maaneder.
 *
 * Testen kalder den rigtige Python-funktion (scripts/katalog_tal.py) som auditten bruger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));

function fejl(tekst, vaerktoejer = 40, sessioner = 20) {
  const r = spawnSync('python3', ['-c',
    'import sys, json; sys.path.insert(0, "scripts"); from katalog_tal import katalog_fejl; ' +
    'print(json.dumps(katalog_fejl(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))))',
    tekst, String(vaerktoejer), String(sessioner)], { cwd: rod, encoding: 'utf8' });
  assert.equal(r.status, 0, `python fejlede: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

test('mcp.so-teksten: gammelt vaerktoejstal og "local-only" findes', () => {
  const f = fejl('Reads emailed login codes from your Gmail, solves CAPTCHAs, 34 tools. MIT, local-only.');
  assert.ok(f.some((x) => /34/.test(x)), `34 tools blev ikke fanget: ${JSON.stringify(f)}`);
  assert.ok(f.some((x) => /local-only/.test(x)), `local-only blev ikke fanget: ${JSON.stringify(f)}`);
});

test('en CAPTCHA-procent findes', () => {
  const f = fejl('34 tools. ~80% reCAPTCHA-checkbox solve with a human fallback');
  assert.ok(f.some((x) => /80%/.test(x)), JSON.stringify(f));
});

test('punkpeye-linjen: gammelt sessionstal findes', () => {
  const f = fejl('34 tools, up to 10 concurrent color-coded sessions');
  assert.ok(f.some((x) => /10/.test(x) && /session/i.test(x)), `10 sessioner blev ikke fanget: ${JSON.stringify(f)}`);
});

test('en korrekt beskrivelse giver ingen fund (positiv kontrol)', () => {
  assert.deepEqual(fejl('Drive your real, logged-in Chrome. 40 tools, up to 20 concurrent sessions. MIT, runs on your machine.'), []);
});

test('auditten bruger funktionen paa de kataloger den henter', () => {
  const audit = readFileSync(join(rod, 'scripts/dominans-audit.py'), 'utf8');
  assert.match(audit, /from katalog_tal import katalog_fejl/);
  for (const katalog of ['mcp.so', 'punkpeye', 'PulseMCP']) {
    assert.match(audit, new RegExp(`katalog_fejl\\([^\\n]*\\)[^\\n]*|${katalog}`), `auditten tjekker ikke ${katalog}`);
  }
  assert.ok((audit.match(/katalog_fejl\(/g) || []).length >= 3, 'katalog_fejl skal kaldes for mindst tre kataloger');
});
