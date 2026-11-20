/**
 * scripts/flader-ens.py - Gustav 19/11-2026: «… og alt andet er ens e2e». Vagten holder MCP-registret, GitHubs seneste
 * udgivelse og browsermcp.dev op mod npm latest; butikken mod npm vogtes af butik-npm.py. Proeverne koerer scriptets
 * egne funktioner (dom, ren) og dets selvtest, og laeser arbejdsgangens filter mod gentagelser; netvaerket roeres ikke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rod = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKRIPT = join(rod, 'scripts/flader-ens.py');
const py = (kode) => {
  const r = spawnSync('python3', ['-c', `import importlib.util, datetime as d\ns = importlib.util.spec_from_file_location('f', ${JSON.stringify(SKRIPT)}); f = importlib.util.module_from_spec(s); s.loader.exec_module(f)\n${kode}`], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const tid = (iso) => `d.datetime.fromisoformat(${JSON.stringify(iso)})`;
const NU = tid('2026-11-20T12:00:00+00:00');
const alle = (v) => `{'MCP-registret': ${v}, 'GitHub release': ${v}, 'browsermcp.dev': ${v}}`;

test('flader-ens: alle flader = npm latest er groen', () => {
  assert.equal(py(`print(f.dom('1.31.0', ${tid('2026-11-01T00:00:00+00:00')}, ${alle("'1.31.0'")}, ${NU})[0])`), 'False');
});

test('flader-ens: en afvigende flade er groen i hoejst 1 dag efter npm, derefter roed', () => {
  const siden = `{'MCP-registret': '1.33.0', 'GitHub release': '1.33.0', 'browsermcp.dev': '1.31.0'}`;
  assert.equal(py(`print(f.dom('1.33.0', ${tid('2026-11-19T12:00:00+00:00')}, ${siden}, ${NU})[0])`), 'False', 'praecis 1 dag');
  assert.equal(py(`print(f.dom('1.33.0', ${tid('2026-11-19T11:59:59+00:00')}, ${siden}, ${NU})[0])`), 'True', '1 dag + 1 sekund');
});

test('flader-ens: en flade foran npm er ogsaa en afvigelse (fx GitHub-udgivelse uden npm)', () => {
  assert.equal(py(`print(f.dom('1.31.0', ${tid('2026-11-01T00:00:00+00:00')}, {'MCP-registret': '1.31.0', 'GitHub release': '1.33.0', 'browsermcp.dev': '1.31.0'}, ${NU})[0])`), 'True');
});

test('flader-ens: et svar, der ikke kan laeses, er aldrig groent', () => {
  assert.equal(py(`print(f.dom('1.31.0', ${tid('2026-11-01T00:00:00+00:00')}, {'MCP-registret': None, 'GitHub release': '1.31.0', 'browsermcp.dev': '1.31.0'}, ${NU})[0])`), 'True');
  assert.equal(py(`print(f.dom(None, None, ${alle("'1.31.0'")}, ${NU})[0])`), 'True');
});

test('flader-ens: GitHubs «v»-praefiks fjernes, og andet end en version er ukendt', () => {
  assert.equal(py(`print(f.ren('v1.33.0'), f.ren('1.34.0-beta.1'), f.ren(''), f.ren('latest'))`), '1.33.0 1.34.0-beta.1 None None');
});

test('flader-ens: samme fejl giver samme fund to dage i traek, efter arbejdsgangens eget filter', () => {
  const wf = readFileSync(join(rod, '.github/workflows/flader-ens.yml'), 'utf8');
  const m = wf.match(/sed -E 's\/(.+?)\/\/'/);
  assert.ok(m, 'arbejdsgangens filter (sed -E) blev ikke fundet');
  const filter = (s) => s.replace(new RegExp(m[1], 'g'), '');
  const siden = `{'MCP-registret': '1.33.0', 'GitHub release': '1.33.0', 'browsermcp.dev': '1.31.0'}`;
  const fund = (nu) => py(`print([l for l in f.dom('1.33.0', ${tid('2026-11-10T00:00:00+00:00')}, ${siden}, ${nu})[1] if l.startswith('✗')][0])`);
  const a = fund(tid('2026-11-18T12:00:00+00:00')), b = fund(tid('2026-11-19T12:00:00+00:00'));
  assert.notEqual(a, b, 'dagetallet skal aendre sig (ellers maaler proeven intet)');
  assert.equal(filter(a), filter(b), 'efter filteret skal fundet vaere ens, ellers kommer en ny besked hver morgen');
});

test('flader-ens: selvtesten er groen, og arbejdsgangen sender roedt til vagt-besked', () => {
  const r = spawnSync('python3', [SKRIPT, '--selvtest'], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const wf = readFileSync(join(rod, '.github/workflows/flader-ens.yml'), 'utf8');
  assert.match(wf, /set -o pipefail/);
  assert.match(wf, /bash scripts\/vagt-besked\.sh flader-ens /);
});
