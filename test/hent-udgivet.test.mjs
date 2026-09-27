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
    // 27/9 (Astra): en pakke der MANGLER en fil fra tagget blev kaldt «lig tagget».
    writeFileSync(join(butik, 'manifest.json'), JSON.stringify({ version: '9.9.9', name: 'x' }));
    rmSync(join(butik, 'background.js'));
    assert.match(sml().join(' '), /background\.js: findes i tagget v9\.9\.9, men mangler i pakken/, 'en manglende fil slap igennem');
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

/** En syntetisk CRX med de givne filer. */
const crxPy = (filer) => `import io, zipfile
b = io.BytesIO(); z = zipfile.ZipFile(b, 'w')
for n, v in ${JSON.stringify(Object.entries(filer))}: z.writestr(n, v)
z.close()
CRX = b'Cr24\\x03\\x00\\x00\\x00' + b'\\x00' * 40 + b.getvalue()
class Svar:
    def __init__(self, data): self.data = data
    def read(self): return self.data
`;

test('hent_udvidelse: hver hentning faar sin egen mappe - en genbrugt --ud blander ikke gamle filer ind (Astra 27/9)', () => {
  const repo = repoMedTag(TAG);
  const ud = mkdtempSync(join(tmpdir(), 'hent-ud-'));
  try {
    const hent = (filer) => spawnSync('python3', ['-c', `import importlib.util, sys, os
spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(join(rod, 'scripts/hent-udgivet.py'))})
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
${crxPy(filer)}
h.urllib.request.urlopen = lambda *a, **k: Svar(CRX)
print(h.hent_udvidelse('9.9.9', ${JSON.stringify(ud)}, ${JSON.stringify(repo)}))`], { encoding: 'utf8' });
    const foerste = hent(TAG);
    assert.equal(foerste.status, 0, foerste.stderr);
    const mappe1 = foerste.stdout.trim();
    assert.ok(mappe1.startsWith(ud), 'mappen ligger ikke under --ud');
    // Anden hentning i SAMME --ud, men butikken mangler background.js. Den gamle ligger stadig i
    // den foerste mappe - den maa ikke blive maalt som om butikken udleverede den.
    const anden = hent({ 'manifest.json': TAG['manifest.json'] });
    assert.notEqual(anden.status, 0, 'en pakke uden background.js blev godkendt - den gamle fil fra forrige hentning talte med');
    assert.match(anden.stderr, /background\.js: findes i tagget v9\.9\.9, men mangler i pakken/, anden.stderr);
    const forkert = hent({ ...TAG, 'manifest.json': JSON.stringify({ version: '9.9.8', name: 'x' }) });
    assert.match(forkert.stderr, /butikken udleverer 9\.9\.8, ikke 9\.9\.9/);
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(ud, { recursive: true, force: true }); }
});

/** Et falsk `npm` der «installerer» en pakke med den givne package.json og brugerindgang. */
function koerHentServer({ version = '9.9.9', bin = { 'browser-mcp': './bin/cli.js' }, cli = `#!/usr/bin/env node\nconsole.log('9.9.9')`, link = true } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'hent-server-'));
  const shim = join(d, 'shim'); mkdirSync(shim);
  const pakke = JSON.stringify({ name: '@agent360/browser-mcp', version, bin });
  writeFileSync(join(shim, 'npm'), `#!/bin/bash
while [[ $# -gt 0 ]]; do [[ "$1" == --prefix ]] && { P="$2"; shift; }; shift; done
M="$P/node_modules/@agent360/browser-mcp"; mkdir -p "$M/bin"
cat > "$M/package.json" <<'JSON'
${pakke}
JSON
${cli === null ? '' : `cat > "$M/bin/cli.js" <<'JS'\n${cli}\nJS\nchmod +x "$M/bin/cli.js"`}
${link ? `mkdir -p "$P/node_modules/.bin"; ln -sf ../@agent360/browser-mcp/bin/cli.js "$P/node_modules/.bin/browser-mcp"` : ''}
`);
  execFileSync('chmod', ['+x', join(shim, 'npm')]);
  try {
    return spawnSync('python3', ['-c', `import importlib.util
spec = importlib.util.spec_from_file_location('h', ${JSON.stringify(join(rod, 'scripts/hent-udgivet.py'))})
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
print(h.hent_server('9.9.9', ${JSON.stringify(join(d, 'ud'))}))`], { encoding: 'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH}` } });
  } finally { rmSync(d, { recursive: true, force: true }); }
}

test('hent_server: den udgivne servers BRUGERINDGANG (bin) proeves og bruges - ikke index.js (Astra 27/9)', () => {
  const god = koerHentServer();
  assert.equal(god.status, 0, god.stderr);
  assert.match(god.stdout.trim(), /node_modules\/@agent360\/browser-mcp\/bin\/cli\.js$/, 'spaerren faar ikke brugerindgangen - saa proeves npx-vejen ikke');
  const mangler = koerHentServer({ cli: null });
  assert.notEqual(mangler.status, 0, 'en pakke hvis bin-fil mangler, blev godkendt');
  assert.match(mangler.stderr, /brugerindgang \.\/bin\/cli\.js findes ikke/);
  const ingenBin = koerHentServer({ bin: {} });
  assert.match(ingenBin.stderr, /erklaerer ingen brugerindgang/);
  const forkertSvar = koerHentServer({ cli: `#!/usr/bin/env node\nconsole.log('1.0.0')` });
  assert.match(forkertSvar.stderr, /svarede ikke 9\.9\.9 paa --version/, 'en brugerindgang der svarer en anden version blev godkendt');
  const doer = koerHentServer({ cli: `#!/usr/bin/env node\nthrow new Error('braekket')` });
  assert.match(doer.stderr, /svarede ikke 9\.9\.9 paa --version \(exit 1\)/, 'en brugerindgang der doer blev godkendt');
  // 27/9 (Astra R2): npx koerer kommandoen gennem shebang'en - `node cli.js` saa det ikke.
  const udenShebang = koerHentServer({ cli: `console.log('9.9.9')` });
  assert.notEqual(udenShebang.status, 0, 'en brugerindgang UDEN shebang blev godkendt - npx kan ikke starte den');
  assert.match(udenShebang.stderr, /npm-kommandoen browser-mcp (kan ikke startes|svarede ikke 9\.9\.9)/, udenShebang.stderr);
  const forkertFortolker = koerHentServer({ cli: `#!/findes/ikke/node\nconsole.log('9.9.9')` });
  assert.notEqual(forkertFortolker.status, 0, 'en shebang til en fortolker der ikke findes blev godkendt');
  const intetLink = koerHentServer({ link: false });
  assert.match(intetLink.stderr, /npm lavede ingen kommando «browser-mcp»/, 'en pakke uden npm-kommando blev godkendt');
  const forkertVersion = koerHentServer({ version: '9.9.8' });
  assert.match(forkertVersion.stderr, /npm udleverede 9\.9\.8, ikke 9\.9\.9/);
});

test('det aegte bin/cli.js svarer sin version paa --version - det hent_server kraever af den udgivne', () => {
  const v = JSON.parse(readFileSync(join(rod, 'mcp-server/package.json'), 'utf8')).version;
  const bin = JSON.parse(readFileSync(join(rod, 'mcp-server/package.json'), 'utf8')).bin['browser-mcp'];
  assert.equal(execFileSync('node', [join(rod, 'mcp-server', bin), '--version'], { encoding: 'utf8' }).trim(), v);
});

test('spaerre.yml: det udgivne kommer fra hent-trinnets OUTPUTS, ikke fra arvet miljoe (Astra 27/9)', () => {
  const wf = readFileSync(join(rod, '.github/workflows/spaerre.yml'), 'utf8');
  const hent = wf.slice(wf.indexOf('- name: hent det udgivne'), wf.indexOf('- name: spaerren, isoleret'));
  assert.match(hent, /\n\s+id: hent\n/, 'hent-trinnet har intet id - dets outputs kan ikke laeses');
  assert.match(hent, />> "\$GITHUB_OUTPUT"/, 'hent-trinnet skriver ikke til sine outputs');
  // Bundet til STRUKTUREN (en skrivning til filen), ikke ordet - trinnets egen kommentar naevner $GITHUB_ENV.
  assert.doesNotMatch(wf, />>\s*"\$GITHUB_ENV"/, 'det udgivne sendes stadig gennem miljoeet, som alle senere trin arver');
  const spaerre = wf.slice(wf.indexOf('- name: spaerren, isoleret'), wf.indexOf('- name: gem loggen'));
  const env = spaerre.slice(spaerre.indexOf('env:'), spaerre.indexOf('run: |'));
  assert.match(env, /UDGIVET_UDVIDELSE: \$\{\{ steps\.hent\.outputs\.UDGIVET_UDVIDELSE \}\}/,
    'spaerretrinnet saetter ikke UDGIVET_UDVIDELSE eksplicit - et arvet vaerdi kan genaktivere en fremmed udvidelse');
  assert.match(env, /UDGIVET_SERVER: \$\{\{ steps\.hent\.outputs\.UDGIVET_SERVER \}\}/,
    'spaerretrinnet saetter ikke UDGIVET_SERVER eksplicit');
});

test('spaerre.yml: loggen skal BEVISE at det udgivne blev maalt - ellers roedt', () => {
  const wf = readFileSync(join(rod, '.github/workflows/spaerre.yml'), 'utf8');
  const spaerre = wf.slice(wf.indexOf('- name: spaerren, isoleret'), wf.indexOf('- name: gem loggen'));
  const fra = spaerre.indexOf("grep -m1 '^DAEKNING:' spaerre.log");
  assert.ok(fra > 0, 'efter-tjekket blev ikke fundet');
  const blok = spaerre.slice(fra).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  const d = mkdtempSync(join(tmpdir(), 'spaerre-log-'));
  try {
    const koer = (log, env) => {
      writeFileSync(join(d, 'spaerre.log'), log);
      return spawnSync('bash', ['-e', '-c', blok], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    };
    const DAEK = 'DAEKNING: 40/40 vaerktoejer beroert · 52 OK · 0 FEJL · 0 SPRUNGET\n';
    const rigtig = `MAALT-UDVIDELSE: /u\nMAALT-SERVER: /s/cli.js\nFLOW-SERVER: /s/cli.js\n${DAEK}`;
    assert.equal(koer(rigtig, { UDGIVET_UDVIDELSE: '/u', UDGIVET_SERVER: '/s/cli.js' }).status, 0);
    const repoets = `MAALT-UDVIDELSE: repoets\nMAALT-SERVER: /s/cli.js\nFLOW-SERVER: /s/cli.js\n${DAEK}`;
    assert.notEqual(koer(repoets, { UDGIVET_UDVIDELSE: '/u', UDGIVET_SERVER: '/s/cli.js' }).status, 0,
      'en koersel der maalte repoets udvidelse blev godkendt som butikkens');
    const flowRepoets = `MAALT-UDVIDELSE: /u\nMAALT-SERVER: /s/cli.js\nFLOW-SERVER: repoets\n${DAEK}`;
    assert.notEqual(koer(flowRepoets, { UDGIVET_UDVIDELSE: '/u', UDGIVET_SERVER: '/s/cli.js' }).status, 0,
      'flow-testen startede repoets server, og koerslen blev godkendt som npm-serverens');
    // En almindelig PR-koersel (intet hentet) kraever ingen maerker.
    assert.equal(koer(`MAALT-UDVIDELSE: repoets\n${DAEK}`, {}).status, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('flow-isoleret og flow-testen skriver hvad de FAKTISK maaler, med samme udtryk som de starter', () => {
  const iso = readFileSync(join(rod, 'scripts/flow-isoleret.mjs'), 'utf8');
  assert.match(iso, /console\.log\(`MAALT-UDVIDELSE: \$\{process\.env\.BMCP_UDVIDELSE_KILDE \|\| 'repoets'\}`\)/);
  assert.match(iso, /console\.log\(`MAALT-SERVER: \$\{process\.env\.BMCP_SERVER_INDEX \|\| 'repoets'\}`\);\n\s+server = spawn\(process\.execPath, \[process\.env\.BMCP_SERVER_INDEX \|\|/);
  const run = readFileSync(join(rod, 'test/flow/run.mjs'), 'utf8');
  assert.match(run, /console\.log\(`FLOW-SERVER: \$\{process\.env\.BMCP_SERVER_INDEX \|\| 'repoets'\}`\);\nconst srv = spawn\(process\.execPath, \[process\.env\.BMCP_SERVER_INDEX \|\|/);
});

test('spaerre.yml: et flow med FEJL er roedt, ogsaa med fuld daekning (Astra R2: pipefail)', () => {
  const wf = readFileSync(join(rod, '.github/workflows/spaerre.yml'), 'utf8');
  const trin = wf.slice(wf.indexOf('- name: spaerren, isoleret'), wf.indexOf('- name: gem loggen'));
  assert.match(trin, /\n\s+shell: bash\n/, 'spaerretrinnet koerer uden pipefail - tee skjuler flowets exitkode');
  const run = trin.slice(trin.indexOf('run: |') + 'run: |'.length).split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  const d = mkdtempSync(join(tmpdir(), 'spaerre-trin-'));
  try {
    mkdirSync(join(d, 'scripts')); mkdirSync(join(d, 'shim'));
    writeFileSync(join(d, 'scripts/flow-daekning.sh'), readFileSync(join(rod, 'scripts/flow-daekning.sh'), 'utf8'));
    const koer = (log, kode) => {
      // Et falsk `node`: skriver en koersels-udskrift og svarer med flowets exitkode.
      writeFileSync(join(d, 'shim/node'), `#!/bin/bash\ncat <<'LOG'\n${log}LOG\nexit ${kode}\n`);
      execFileSync('chmod', ['+x', join(d, 'shim/node')]);
      // Som GitHubs `shell: bash`: bash --noprofile --norc -eo pipefail
      return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', run], { cwd: d, encoding: 'utf8',
        env: { PATH: `${join(d, 'shim')}:${process.env.PATH}` } });
    };
    const groen = koer('DAEKNING: 40/40 vaerktoejer beroert · 52 OK · 0 FEJL · 0 SPRUNGET\n', 0);
    assert.equal(groen.status, 0, groen.stdout + groen.stderr);
    const fejl = koer('FEJL:\n  browser_click: noget gik galt\n====\nDAEKNING: 40/40 vaerktoejer beroert · 51 OK · 1 FEJL · 0 SPRUNGET\n', 1);
    assert.notEqual(fejl.status, 0, 'et flow med 1 FEJL og fuld daekning blev groent');
    assert.match(fejl.stdout, /::error::flow-spaerren endte med exit 1: .*browser_click/, fejl.stdout);
    const kastede = koer('DAEKNING: 40/40 vaerktoejer beroert · 52 OK · 0 FEJL · 0 SPRUNGET\n', 3);
    assert.notEqual(kastede.status, 0, 'et flow der sluttede med exit 3 blev groent');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
