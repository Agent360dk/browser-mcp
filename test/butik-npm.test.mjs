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

test('butik-npm: butikken foran npm er groen i hoejst 3 dage, derefter roed; ukendt dato er roed', () => {
  const npm = tid('2026-10-29T00:00:00+00:00');
  assert.equal(py(`print(b.dom('1.33.0', '1.31.0', ${npm}, ${NU}, ${tid('2026-11-17T00:00:00+00:00')})[0])`), 'False', 'butikken foerst: npm foelger efter');
  assert.equal(py(`print(b.dom('1.33.0', '1.31.0', ${npm}, ${NU}, ${tid('2026-11-14T11:00:00+00:00')})[0])`), 'True', 'npm-trinnet glemt i over 3 dage');
  assert.equal(py(`print(b.dom('1.33.0', '1.31.0', ${npm}, ${NU})[0])`), 'True', 'butikkens dato ukendt');
});

test('butik-npm: butikkens 4. versionsdel og npm-build-metadata vaelter ikke dommen', () => {
  assert.equal(py(`print(b.dom('1.33.0.5', '1.33.0', ${tid('2026-11-01T00:00:00+00:00')}, ${NU})[0])`), 'False');
  assert.equal(py(`print(b.dom('1.33.0', '1.33.0+build-7', ${tid('2026-11-01T00:00:00+00:00')}, ${NU})[0])`), 'False', 'efter «+» er build-metadata, ikke prerelease');
});

test('butik-npm: butikken foran npm er groen paa praecis 3 dage og roed et sekund efter', () => {
  const npm = tid('2026-10-29T00:00:00+00:00');
  assert.equal(py(`print(b.dom('1.33.0', '1.31.0', ${npm}, ${NU}, ${tid('2026-11-15T12:00:00+00:00')})[0])`), 'False', 'praecis 3 dage');
  assert.equal(py(`print(b.dom('1.33.0', '1.31.0', ${npm}, ${NU}, ${tid('2026-11-15T11:59:59+00:00')})[0])`), 'True', '3 dage + 1 sekund');
});

test('butik-npm: hent_butik sender butikkens adresse videre til hent_dato og beholder datoen', () => {
  const ud = py(`import urllib.error
class Aabn:
    def open(self, *a, **k):
        raise urllib.error.HTTPError('u', 302, 'Found', {'Location': 'https://h/JDEH_1_33_0_0.crx'}, None)
b.urllib.request.build_opener = lambda *a: Aabn()
b.hent_dato = lambda sted: 'DATO:' + sted
print(b.hent_butik())`);
  assert.equal(ud, "('1.33.0', 'DATO:https://h/JDEH_1_33_0_0.crx')");
});

test('butik-npm: uden en adresse at laese datoen fra er datoen ukendt (og dommen dermed roed, se ovenfor)', () => {
  assert.equal(py(`print(b.hent_dato(''))`), 'None');
});

test('butik-npm: en gyldig Last-Modified bliver til butikkens dato (panel 20/11: en datolaesning, der altid gav None, slap igennem)', () => {
  const ud = py(`class R:
    headers = {'Last-Modified': 'Wed, 15 Oct 2025 06:14:00 GMT'}
    def __enter__(self): return self
    def __exit__(self, *a): return False
b.urllib.request.urlopen = lambda *a, **k: R()
print(b.hent_dato('https://h/JDEH_1_30_3_0.crx').isoformat())`);
  assert.equal(ud, '2025-10-15T06:14:00+00:00');
});

test('butik-npm: en prerelease paa npm latest er roed straks - lavere, samme eller hoejere tal (panel 20/11)', () => {
  const t1 = tid('2026-11-17T00:00:00+00:00');
  assert.equal(py(`print(b.dom('1.33.0', '1.33.0-rc.1', ${t1}, ${NU})[0])`), 'True', 'samme tal');
  assert.equal(py(`print(b.dom('1.33.0', '1.34.0-beta.1', ${t1}, ${NU})[0])`), 'True', 'hoejere');
  assert.equal(py(`print(b.dom('1.33.0', '1.32.0-rc.1', ${t1}, ${NU}, ${t1})[0])`), 'True', 'lavere');
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
