/**
 * scripts/stjerner.py bager de samme tal som gustavlouv.com. En kilde, der fejler, maa ikke kassere det forrige tal,
 * og npm-summen maa ikke falde. Proeverne koerer funktionerne uden netvaerk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKRIPT = join(rod, 'scripts/stjerner.py');
const py = (kode) => {
  const r = spawnSync('python3', ['-c', `import importlib.util, datetime as d\ns = importlib.util.spec_from_file_location('st', ${JSON.stringify(SKRIPT)}); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)\n${kode}`], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.replace(/\r\n/g, '\n').trim();
};

test('stjerner: et manglende tal beholder det forrige, og npm kan kun vokse', () => {
  assert.equal(py(`print(m.behold(64, None), m.behold(64, 0), m.behold(64, False), m.behold(64, 68), m.behold(None, '9'))`), '64 64 64 68 None');
  assert.equal(py(`print(m.behold_voks(23555, 20000), m.behold_voks(23555, 23555), m.behold_voks(23555, 24000), m.behold_voks(23555, None), m.behold_voks(None, 10))`), '23555 23555 24000 23555 10');
});

test('stjerner: datoen skrives som siden viser den, og en ugyldig dato kasseres', () => {
  assert.equal(py(`print(m.vis_dato(d.date(2026, 11, 25)), m.iso_dato('2026-11-25'), m.iso_dato('2026-13-01'), m.iso_dato('i gaar'))`), '25 Nov 2026 2026-11-25 None None');
});

test('stjerner: henter ikke butikssiden og bruger gustavlouv.coms adresser og felter', () => {
  const s = readFileSync(SKRIPT, 'utf8');
  assert.doesNotMatch(s, /chromewebstore\.google\.com/);
  assert.match(s, /https:\/\/gustavlouv\.com\/tal\.json/);
  assert.match(s, /https:\/\/api\.github\.com\/repos\/Agent360dk\/browser-mcp/);
  assert.match(s, /https:\/\/api\.npmjs\.org\/downloads\/range\//);
  assert.match(s, /\['cws'\]/);
  assert.match(s, /npm_i_alt/);
  assert.match(s, /stargazers_count/);
  assert.doesNotMatch(s, /cws_butik|npm_30_dage/);
});

test('stjerner: --tjek bliver ikke roed, naar den foretrukne kilde ikke svarede', () => {
  const ud = py(`
side = {'stjerner': 68, 'npm': 23555, 'cws': 2968}
ud = {'stjerner': 67, 'npm': 100, 'cws': 2000}
print(m.afviger(side, ud, {'stjerner': 'tal.json', 'npm': 'tal.json', 'cws': None}))
print(m.afviger(side, {'stjerner': 70, 'npm': 24000, 'cws': 3000}, {'stjerner': 'github', 'npm': 'npm', 'cws': 'tal.json'}))
print(m.afviger(side, side, {'stjerner': 'github', 'npm': 'npm', 'cws': 'tal.json'}))
`);
  assert.equal(ud, '[]\n'
    + "['stjerner 68 != 70', 'npm 23555 != 24000', 'chrome 2968 != 3000']\n"
    + '[]');
});
