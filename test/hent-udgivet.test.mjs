/**
 * scripts/hent-udgivet.py henter det en fremmed faar i dag (butikkens udvidelse, npm-serveren) til
 * flow-spaerren - beviset for kriterie 1. Proeverne koerer scriptets egne funktioner mod en syntetisk
 * CRX og et lille git-repo med et tag. Intet hentes fra nettet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const py = (kode) => execFileSync('python3', ['-c', `import importlib.util, sys, json
spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(join(rod, 'scripts/hent-udgivet.py'))})
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
${kode}`], { encoding: 'utf8' }).trim();

function repoMedTag(filer) {
  const d = mkdtempSync(join(tmpdir(), 'hent-tag-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  mkdirSync(join(d, 'extension'));
  for (const [n, v] of Object.entries(filer)) writeFileSync(join(d, 'extension', n), v);
  execFileSync('git', ['init', '-q'], { cwd: d });
  execFileSync('git', ['add', 'extension'], { cwd: d });
  execFileSync('git', ['commit', '-q', '-m', 't'], { cwd: d, env });
  execFileSync('git', ['tag', 'v9.9.9'], { cwd: d, env });
  return d;
}

const TAG = { 'manifest.json': JSON.stringify({ version: '9.9.9', name: 'x' }), 'background.js': 'kode();\n' };

test('en CRX pakkes ud fra zip-delen efter headeren', () => {
  const d = mkdtempSync(join(tmpdir(), 'crx-'));
  try {
    const ud = py(`import io, zipfile, os
b = io.BytesIO(); z = zipfile.ZipFile(b, 'w'); z.writestr('manifest.json', '{"version":"9.9.9"}'); z.close()
crx = b'Cr24\\x03\\x00\\x00\\x00' + b'\\x00' * 40 + b.getvalue()
h.pak_crx_ud(crx, ${JSON.stringify(d)})
print(open(os.path.join(${JSON.stringify(d)}, 'manifest.json')).read())`);
    assert.equal(ud, '{"version":"9.9.9"}');
    const fejl = spawnSync('python3', ['-c', `import importlib.util
spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(join(rod, 'scripts/hent-udgivet.py'))})
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
h.pak_crx_ud(b'<html>fejlside</html>', ${JSON.stringify(d)})`], { encoding: 'utf8' });
    assert.notEqual(fejl.status, 0, 'en fejlside blev pakket ud som om den var en udvidelse');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('butikkens pakke sammenlignes byte for byte med tagget - kun butikkens egne felter tilgives', () => {
  const repo = repoMedTag(TAG);
  const butik = mkdtempSync(join(tmpdir(), 'butik-'));
  try {
    const sml = () => JSON.parse(py(`print(json.dumps(h.forskelle_mod_tag(${JSON.stringify(butik)}, '9.9.9', ${JSON.stringify(repo)})))`));
    // Som butikken udleverer: tagget + _metadata + key/update_url i manifestet.
    mkdirSync(join(butik, '_metadata'));
    writeFileSync(join(butik, '_metadata/verified_contents.json'), '{}');
    writeFileSync(join(butik, 'manifest.json'), JSON.stringify({ version: '9.9.9', name: 'x', key: 'K', update_url: 'U' }));
    writeFileSync(join(butik, 'background.js'), 'kode();\n');
    assert.deepEqual(sml(), [], 'butikkens egne tilfoejelser blev regnet som forskelle');
    writeFileSync(join(butik, 'background.js'), 'kode(); // aendret\n');
    assert.match(sml().join(' '), /background\.js: ikke byte-identisk/, 'en aendret fil slap igennem');
    writeFileSync(join(butik, 'background.js'), 'kode();\n');
    writeFileSync(join(butik, 'ekstra.js'), 'x');
    assert.match(sml().join(' '), /ekstra\.js: findes ikke i tagget/, 'en fil tagget ikke har, slap igennem');
    rmSync(join(butik, 'ekstra.js'));
    writeFileSync(join(butik, 'manifest.json'), JSON.stringify({ version: '9.9.9', name: 'y' }));
    assert.match(sml().join(' '), /manifest\.json: afviger/, 'et aendret manifest slap igennem');
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(butik, { recursive: true, force: true }); }
});

test('flow_nulstil_arv fjerner ogsaa serveren - kandidatens spaerre maaler aldrig en anden server', () => {
  const r = spawnSync('bash', ['-c', `. '${join(rod, 'scripts/flow-daekning.sh')}'; BMCP_SERVER_INDEX=/et/andet/sted; flow_nulstil_arv; echo "[\${BMCP_SERVER_INDEX:-tom}]"`], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '[tom]', 'en arvet BMCP_SERVER_INDEX overlevede nulstillingen');
});

test('spaerren og flow-testen starter den udgivne server naar BMCP_SERVER_INDEX er sat', () => {
  for (const fil of ['scripts/flow-isoleret.mjs', 'test/flow/run.mjs']) {
    const kode = readFileSync(join(rod, fil), 'utf8');
    assert.match(kode, /spawn\(process\.execPath, \[process\.env\.BMCP_SERVER_INDEX \|\| join\(/,
      `${fil} starter ikke serveren fra BMCP_SERVER_INDEX - saa maales repoets server i stedet for den udgivne`);
  }
});

test('spaerre.yml saetter det udgivne EFTER nulstillingen og kun fra hent-trinnet', () => {
  const wf = readFileSync(join(rod, '.github/workflows/spaerre.yml'), 'utf8');
  const nul = wf.indexOf('flow_nulstil_arv');
  const saet = wf.indexOf('export BMCP_SERVER_INDEX="$UDGIVET_SERVER"');
  const koer = wf.indexOf('node scripts/flow-isoleret.mjs --spaerre');
  assert.ok(nul > 0 && saet > nul && koer > saet, 'det udgivne skal saettes efter flow_nulstil_arv og foer spaerren');
  assert.match(wf, /if: \$\{\{ github\.event_name == 'workflow_dispatch' &&/, 'hent-trinnet koerer ogsaa ved PR og udgivelse');
});
