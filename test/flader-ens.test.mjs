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
print(' | '.join(f.dom(None, None, {}, ${NU}, f.GRUND)[1]))`).split(/\r?\n/);
  assert.equal(ud[0], "{'tag_name': 'v1.31.0'}");
  assert.equal(ud[1], 'None');
  assert.equal(ud[2], "[('api.github.com', 'Bearer noegle-x'), ('registry.npmjs.org', None)]", 'noeglen maa kun sendes til GitHubs API');
  assert.equal(ud[3], "{'npm': 'HTTP 403'}");
  assert.equal(ud[4], '✗ UMAALT: npm latest kunne ikke laeses |     aarsag: HTTP 403', 'den roede koersel skal sige aarsagen (paa egen linje)');
});

test('flader-ens: arbejdsgangen sender maalingens udfald videre og giver noeglen til maalingen', () => {
  const wf = readFileSync(join(rod, '.github/workflows/flader-ens.yml'), 'utf8');
  assert.match(wf, /id: maal\n\s+env:\n(?:\s+#[^\n]*\n)*\s+GH_TOKEN: \$\{\{ github\.token \}\}/, 'maalingen skal have GH_TOKEN');
  assert.ok(wf.includes(`"\${{ steps.maal.outcome == 'success' && 'ok' || 'roed' }}"`), 'beskeden skal faa maalingens udfald, ikke et fast «ok»');
});

// Opus' deltagennemgang (20/11, #114 R2): hele scriptet som __main__ med simulerede HTTP-svar - ledningen mellem hent_* og
// dom/maal. Uden den overlevede 8 mutanter, heraf to der genaabnede Astras fund (sidens regex, ingen ny npm-laesning).
test('flader-ens: hele scriptet med simulerede HTTP-svar', () => {
  const kode = `
import io, json, re, runpy, sys, time, urllib.request, urllib.error, datetime as d, email.message
S = json.loads(sys.argv[1]); forside = open(sys.argv[2], encoding='utf-8').read()
nu = d.datetime.now(d.timezone.utc); iso = lambda t: (nu - d.timedelta(hours=t)).isoformat().replace('+00:00', 'Z')
npm_kald = [0]; sov = []
class Svar(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *a): return False
def fejl(url, k, vent=None):
    h = email.message.Message()
    if vent: h['Retry-After'] = vent
    raise urllib.error.HTTPError(url, k, 'x', h, None)
def falsk(req, timeout=None):
    u = req.full_url
    if 'npmjs' in u:
        n = S['npm'][min(npm_kald[0], len(S['npm']) - 1)]; npm_kald[0] += 1
        return Svar(json.dumps({'dist-tags': n['tags'], 'time': {k: iso(v) for k, v in n['tid'].items()}}).encode())
    if 'modelcontextprotocol' in u:
        return Svar(json.dumps({'servers': [{'server': {'name': a, 'version': v}} for a, v in S['register']]}).encode())
    if 'api.github.com' in u:
        if S.get('github_fejl'): fejl(u, S['github_fejl'], S.get('vent'))
        return Svar(json.dumps({'tag_name': 'v' + S['github'], 'name': 'Browser MCP ' + S['github']}).encode())
    if S.get('side_fejl'): fejl(u, S['side_fejl'])
    html = re.sub(r'"softwareVersion": "[^"]+"', '"softwareVersion": "%s"' % S['side'], forside)
    if S.get('oedelaeg'): html = html.replace('"@type": "SoftwareApplication",', '"@type": "SoftwareApplication",,')
    return Svar(html.encode())
urllib.request.urlopen = falsk; time.sleep = sov.append
try:
    runpy.run_path(sys.argv[3], run_name='__main__'); ud = 0
except SystemExit as e:
    ud = e.code
print(json.dumps({'exit': ud, 'sov': sov}))`;
  const koer = (s) => {
    const r = spawnSync('python3', ['-c', kode, JSON.stringify(s), join(rod, 'docs/index.html'), SKRIPT], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    assert.equal(r.status, 0, r.stderr);
    const linjer = r.stdout.trim().split(/\r?\n/);
    return { ...JSON.parse(linjer.pop()), tekst: linjer.join('\n') };
  };
  const VOR = 'io.github.Agent360dk/browser-mcp';
  const gammel = { tags: { latest: '1.31.0' }, tid: { '1.31.0': 480, modified: 480 } };
  // 0: alt ens (rigtig forside); en anden server staar foerst i registrets soegning
  const s0 = koer({ npm: [gammel], register: [['io.github.someone/browser-mcp-fork', '9.9.9'], [VOR, '1.31.0']], github: '1.31.0', side: '1.31.0' });
  assert.equal(s0.exit, 0, s0.tekst);
  // 1: npm skifter mellem foerste og anden laesning (en udgivelse midt i maalingen)
  const s1 = koer({ npm: [gammel, { tags: { latest: '1.33.0' }, tid: { '1.31.0': 480, '1.33.0': 1, modified: 1 } }],
    register: [[VOR, '1.33.0']], github: '1.33.0', side: '1.33.0' });
  assert.equal(s1.exit, 0, s1.tekst);
  // 2: siden glemt i 20 dage, mens npm-metadata blev aendret for 2 timer siden (en next-version)
  const s2 = koer({ npm: [{ tags: { latest: '1.31.0', next: '1.34.0-beta.1' }, tid: { '1.31.0': 480, '1.34.0-beta.1': 2, modified: 2 } }],
    register: [[VOR, '1.31.0']], github: '1.31.0', side: '1.30.0' });
  assert.equal(s2.exit, 1, s2.tekst);
  assert.match(s2.tekst, /✗ browsermcp\.dev viser 1\.30\.0/);
  // 3: sidens ld+json er oedelagt, men versionsteksten staar der stadig
  const s3 = koer({ npm: [gammel], register: [[VOR, '1.31.0']], github: '1.31.0', side: '1.31.0', oedelaeg: true });
  assert.equal(s3.exit, 1, s3.tekst);
  assert.match(s3.tekst, /✗ UMAALT: browsermcp\.dev kunne ikke laeses\s*\n\s*aarsag: ingen gyldig ld\+json/);
  // 4: siden svarer 503, GitHub ratebegraenser med Retry-After 7
  const s4 = koer({ npm: [gammel], register: [[VOR, '1.31.0']], github: '1.31.0', side: '1.31.0', side_fejl: 503, github_fejl: 429, vent: '7' });
  assert.equal(s4.exit, 1, s4.tekst);
  assert.match(s4.tekst, /browsermcp\.dev kunne ikke laeses\s*\n\s*aarsag: HTTP 503/);
  assert.match(s4.tekst, /GitHub release kunne ikke laeses\s*\n\s*aarsag: HTTP 429/);
  assert.ok(s4.sov.includes(7), 'Retry-After skal respekteres: ' + JSON.stringify(s4.sov));
});

test('flader-ens: en fejlaarsag, der skifter fra dag til dag, giver ikke en ny besked hver morgen', () => {
  const wf = readFileSync(join(rod, '.github/workflows/flader-ens.yml'), 'utf8');
  const m = wf.match(/sed -E 's\/(.+?)\/\/'/);
  assert.ok(m, 'arbejdsgangens filter (sed -E) blev ikke fundet');
  const filter = (s) => s.split(/\r?\n/).filter((l) => l.includes('✗')).map((l) => l.replace(new RegExp(m[1], 'g'), '')).join('\n');
  const linjer = (grund) => py(`print('\\n'.join(f.dom('1.31.0', ${tid('2026-11-01T00:00:00+00:00')}, {'MCP-registret': None, 'GitHub release': '1.31.0', 'browsermcp.dev': '1.31.0'}, ${NU}, {'MCP-registret': ${JSON.stringify(grund)}})[1]))`);
  const a = linjer('HTTP 503'), b = linjer('URLError');
  assert.notEqual(a, b, 'aarsagen skal staa i koerslens tekst (ellers maaler proeven intet)');
  assert.match(a, /aarsag: HTTP 503/);
  assert.equal(filter(a), filter(b), 'fundet efter arbejdsgangens filter skal vaere ens, ellers kommer en ny besked hver morgen');
});
