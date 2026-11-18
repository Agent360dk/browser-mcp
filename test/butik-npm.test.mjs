/**
 * scripts/butik-npm.py - regel 10 (Gustav 18/11-2026): udvidelsen i Chrome Web Store og serveren paa npm skal passe sammen.
 * Maalt 18/11: npm 1.31.0 siden 29/10, butikken 1.30.3 - 20 dage uden at nogen opdagede det. Proeverne koerer scriptets
 * egne funktioner (dom, version_fra_crx) og dets selvtest; netvaerket roeres ikke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rod = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKRIPT = join(rod, 'scripts/butik-npm.py');
const py = (kode) => {
  const r = spawnSync('python3', ['-c', `import importlib.util, datetime as d\ns = importlib.util.spec_from_file_location('b', ${JSON.stringify(SKRIPT)}); b = importlib.util.module_from_spec(s); s.loader.exec_module(b)\n${kode}`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const tid = (iso) => `d.datetime.fromisoformat(${JSON.stringify(iso)})`;
const NU = tid('2026-11-18T12:00:00+00:00');

test('butik-npm: det, der skete med 1.31, er roedt', () => {
  assert.equal(py(`print(b.dom('1.30.3', '1.31.0', ${tid('2026-10-29T14:06:36+00:00')}, ${NU})[0])`), 'True');
});

test('butik-npm: samme version er groen; npm foran i hoejst 3 dage er groen', () => {
  assert.equal(py(`print(b.dom('1.31.0', '1.31.0', ${tid('2026-11-01T00:00:00+00:00')}, ${NU})[0])`), 'False');
  assert.equal(py(`print(b.dom('1.31.0', '1.33.0', ${tid('2026-11-16T12:00:00+00:00')}, ${NU})[0])`), 'False');
  assert.equal(py(`print(b.dom('1.31.0', '1.33.0', ${tid('2026-11-14T11:00:00+00:00')}, ${NU})[0])`), 'True', 'over 3 dage skal vaere roedt');
});

test('butik-npm: butikken foran npm er groen (butikken foerst)', () => {
  assert.equal(py(`print(b.dom('1.33.0', '1.31.0', ${tid('2026-10-29T00:00:00+00:00')}, ${NU})[0])`), 'False');
});

test('butik-npm: et svar, der ikke kan laeses, er aldrig groent', () => {
  assert.equal(py(`print(b.dom(None, '1.31.0', ${tid('2026-11-17T00:00:00+00:00')}, ${NU})[0])`), 'True');
  assert.equal(py(`print(b.dom('1.31.0', None, None, ${NU})[0])`), 'True');
});

test('butik-npm: versioner sammenlignes som tal, ikke tekst', () => {
  assert.equal(py(`print(b.dom('1.9.0', '1.10.0', ${tid('2026-11-01T00:00:00+00:00')}, ${NU})[0])`), 'True');
});

test('butik-npm: versionen laeses af butikkens filnavn', () => {
  assert.equal(py(`print(b.version_fra_crx('https://h/JDEH_1_30_3_0.crx'), b.version_fra_crx('https://h/x.zip'))`), '1.30.3 None');
});

test('butik-npm: selvtesten er groen, og workflowet sender roedt til vagt-besked', () => {
  const r = spawnSync('python3', [SKRIPT, '--selvtest'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const wf = readFileSync(join(rod, '.github/workflows/butik-npm.yml'), 'utf8');
  assert.match(wf, /set -o pipefail/);
  assert.match(wf, /bash scripts\/vagt-besked\.sh butik-npm /);
});
