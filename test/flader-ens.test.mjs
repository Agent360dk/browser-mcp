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

// Astras gennemgang af dc8ab79 (20/11-2026, panel-2026-11-20/astra-114.md): fire fund og tre overlevende mutanter.
test('flader-ens: siden laeses kun fra gyldig ld+json for Browser MCP (ikke kommentar, broedtekst eller andet produkt)', () => {
  const blok = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;
  const app = (v, name = 'Browser MCP') => ({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name, softwareVersion: v });
  const sider = [
    blok(app('1.31.0')),                                                         // gyldig
    blok({ '@graph': [{ '@type': 'FAQPage' }, app('1.31.0')] }),                 // indlejret i @graph
    '<!-- "softwareVersion": "1.31.0" -->',                                      // kun en kommentar
    '<p>"softwareVersion": "1.31.0"</p>',                                        // kun broedtekst
    blok(app('1.31.0')) + '<script type="application/ld+json">{ikke json</script>', // en oedelagt blok
    blok(app('1.31.0', 'Computer MCP')),                                         // et andet produkt
    blok(app('1.31.0')) + blok(app('1.33.0')),                                   // to versioner
    '<html></html>',                                                             // ingenting
  ];
  const ud = py(`import json\nfor h in json.loads(${JSON.stringify(JSON.stringify(sider))}): print(f.side_version(h))`).split(/\r?\n/);
  assert.deepEqual(ud, ['1.31.0', '1.31.0', 'None', 'None', 'None', 'None', 'None', 'None']);
});

test('flader-ens: et npm-svar, der ikke er en version, mangler tidszone eller ligger i fremtiden, er roedt', () => {
  const ok = alle("'1.31.0'");
  assert.equal(py(`print(f.dom('latest', ${tid('2026-11-20T09:00:00+00:00')}, ${ok}, ${NU})[0])`), 'True', '«latest» er ikke en version');
  assert.equal(py(`print(f.dom('1.31.0', ${tid('2027-11-20T12:00:00+00:00')}, ${ok}, ${NU})[0])`), 'True', 'et aar frem');
  assert.equal(py(`print(f.dom('1.31.0', ${tid('2026-11-20T12:59:00+00:00')}, ${ok}, ${NU})[0])`), 'False', 'under en time frem (urforskel) er ok');
  assert.equal(py(`print(f.dom('1.31.0', ${tid('2026-11-01T00:00:00')}, ${ok}, ${NU})[0])`), 'True', 'uden tidszone: roedt, ingen TypeError');
});

test('flader-ens: en flade, der ikke kan laeses, er roed ogsaa i det foerste doegn efter npm', () => {
  assert.equal(py(`print(f.dom('1.33.0', ${tid('2026-11-20T09:00:00+00:00')}, {'MCP-registret': '1.33.0', 'GitHub release': None, 'browsermcp.dev': '1.31.0'}, ${NU})[0])`), 'True');
});

test('flader-ens: en udgivelse midt i maalingen giver ikke falsk alarm, og alt ulaeseligt er roedt', () => {
  const maal = (npmSvar, flader) => py(`\nsvar = iter(${npmSvar})\nnu = ${NU}\nprint(f.maal(lambda: next(svar), lambda: ${flader}, lambda: nu)[1])`);
  const gammel = `('1.31.0', ${tid('2026-11-01T00:00:00+00:00')})`;
  const ny = `('1.33.0', ${tid('2026-11-20T09:00:00+00:00')})`;
  assert.equal(maal(`[${gammel}, ${ny}]`, alle("'1.33.0'")), 'False', 'npm skiftede, mens fladerne blev laest');
  assert.equal(maal(`[${gammel}, ${gammel}]`, alle("'1.33.0'")), 'True', 'npm staar stille: fladerne er foran');
  assert.equal(maal(`[(None, None), (None, None)]`, alle('None')), 'True', 'alle hentninger fejlede');
});

test('flader-ens: kun GitHubs API faar noeglen, og en fejlet hentning gemmer sin aarsag', () => {
  const ud = py(`
import os, io, urllib.error
os.environ['GH_TOKEN'] = 'noegle-x'
kald = []
class Svar(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False
def falsk(req, timeout=None):
    kald.append((req.full_url.split('/')[2], req.get_header('Authorization')))
    if 'npmjs' in req.full_url: raise urllib.error.HTTPError(req.full_url, 403, 'Forbidden', {}, None)
    return Svar(b'{"tag_name": "v1.31.0"}')
f.urllib.request.urlopen = falsk
f.time.sleep = lambda s: None
print(f.hent('https://api.github.com/repos/x/releases/latest', 'GitHub release'))
print(f.hent('https://registry.npmjs.org/x', 'npm'))
print(sorted(set(kald)))
print(f.GRUND)
print(f.dom(None, None, {}, ${NU}, f.GRUND)[1][0])`).split(/\r?\n/);
  assert.equal(ud[0], "{'tag_name': 'v1.31.0'}");
  assert.equal(ud[1], 'None');
  assert.equal(ud[2], "[('api.github.com', 'Bearer noegle-x'), ('registry.npmjs.org', None)]", 'noeglen maa kun sendes til GitHubs API');
  assert.equal(ud[3], "{'npm': 'HTTP 403'}");
  assert.equal(ud[4], '✗ UMAALT: npm latest kunne ikke laeses (HTTP 403)', 'den roede besked skal sige aarsagen');
});

test('flader-ens: arbejdsgangen sender maalingens udfald videre og giver noeglen til maalingen', () => {
  const wf = readFileSync(join(rod, '.github/workflows/flader-ens.yml'), 'utf8');
  assert.match(wf, /id: maal\n\s+env:\n(?:\s+#[^\n]*\n)*\s+GH_TOKEN: \$\{\{ github\.token \}\}/, 'maalingen skal have GH_TOKEN');
  assert.ok(wf.includes(`"\${{ steps.maal.outcome == 'success' && 'ok' || 'roed' }}"`), 'beskeden skal faa maalingens udfald, ikke et fast «ok»');
});
