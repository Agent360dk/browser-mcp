/**
 * Udgivelsens aerligheds-port (2c) og maalingens dom (27/9).
 *
 * Foer sammenlignede 2c kun datoer: et RESULTAT med en LOEGN i - eller maalt paa en anden kode end den
 * der udgives - slap igennem, bare filen var nyere. Nu skriver maal.mjs en maskinlaesbar dom og den
 * maalte commit, og 2c kraever «0 LOEGN» og at den maalte kode ER den der udgives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { osDom } from './aerlighed/maal.mjs';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
// Proever der KOERER udgivelses-scriptets shell, springes over paa Windows (se udgivelse-script.test.mjs).
const POSIX_SKRIPT = process.platform === 'win32' && 'runbrowsermcpupdate.sh koerer kun paa macOS/Linux';

test('osDom: kun tre sande udfald er «0 LOEGN» - en loegn eller et hul er aldrig groent', () => {
  assert.equal(osDom({ dom: 'SAND-JA', dom_select: 'SAND-JA', dom_upload: 'SAND-JA' }), '0 LOEGN');
  assert.equal(osDom({ dom: 'SAND-NEJ', dom_select: 'UVIST', dom_upload: 'SAND-JA' }), '0 LOEGN');
  assert.equal(osDom({ dom: 'SAND-JA', dom_select: 'LOEGN', dom_upload: 'SAND-JA' }), 'LOEGN');
  assert.equal(osDom({ dom: 'LOEGN', dom_select: undefined, dom_upload: 'FEJL' }), 'LOEGN', 'en loegn skal vinde over et hul');
  assert.equal(osDom({ dom: 'SAND-JA', dom_select: 'SAND-JA' }), 'IKKE MAALT', 'et manglende upload-udfald blev kaldt bestaaet');
  assert.equal(osDom({ dom: 'SAND-JA', dom_select: 'FEJL', dom_upload: 'SAND-JA' }), 'IKKE MAALT');
  assert.equal(osDom(null), 'IKKE MAALT');
});

test('maal.mjs skriver dommen og commit\'en for os selv og svarer 1 paa alt andet end «0 LOEGN»', () => {
  const kode = readFileSync(join(rod, 'test/aerlighed/maal.mjs'), 'utf8');
  assert.match(kode, /console\.log\(`MAALT-COMMIT: \$\{commit\}`\)/);
  assert.match(kode, /console\.log\(`AERLIGHED-DOM: \$\{dom\}`\)/);
  assert.match(kode, /if \(dom !== '0 LOEGN'\) process\.exitCode = 1;/, 'en LOEGN hos os selv giver ikke exitkode 1');
});

/** Koerer scriptets EGEN 2c-blok i et lille repo. */
function koer2c({ resultat, efterMaaling = null, gitAdvarsel = false }) {
  const s = readFileSync(join(rod, 'runbrowsermcpupdate.sh'), 'utf8');
  const blok = s.slice(s.indexOf('step "2c.'), s.indexOf('step "1. Version'));
  assert.ok(blok.includes('MAALT_COMMIT'), '2c-blokken blev ikke fundet');
  const d = mkdtempSync(join(tmpdir(), 'aerlighed-port-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', env }).trim();
  try {
    for (const f of ['extension/background.js', 'extension/offscreen.js', 'mcp-server/tools.js', 'mcp-server/index.js', 'README.md']) {
      mkdirSync(join(d, dirname(f)), { recursive: true }); writeFileSync(join(d, f), `${f}\n`);
    }
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'kode');
    const maalt = git('rev-parse', 'HEAD');
    mkdirSync(join(d, 'test/aerlighed'), { recursive: true });
    writeFileSync(join(d, 'test/aerlighed/RESULTAT-proeve.md'), resultat(maalt));
    git('add', '.'); git('commit', '-q', '-m', 'resultat');
    if (efterMaaling) { writeFileSync(join(d, efterMaaling), 'aendret\n'); git('commit', '-q', '-am', 'efter'); }
    // Astra runde 3 (1/10): en lokal git-launcher skrev en `confstr()`-advarsel paa STDERR, og 2c blandede stderr ind i listen over
    // aendrede filer (`2>&1`) - saa en tom diff blev laest som en produktforskel. Skyggen genskaber det: advarsel paa stderr, tom diff paa stdout.
    let pathen = process.env.PATH;
    if (gitAdvarsel) {
      const rigtigGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      const skygge = join(d, '.skygge'); mkdirSync(skygge);
      writeFileSync(join(skygge, 'git'), `#!/bin/sh\n[ "$1" = "diff" ] && echo "warning: harmloes advarsel fra git" >&2\nexec "${rigtigGit}" "$@"\n`, { mode: 0o755 });
      pathen = `${skygge}:${process.env.PATH}`;
    }
    const r = spawnSync('bash', ['-c', `set -euo pipefail
      ok(){ echo "OK:$*"; }; gate(){ echo "GATE:$*"; }; warn(){ echo "WARN:$*"; }; step(){ :; }
      cd '${d}'; SKIP_AERLIGHED=0
      ${blok}`], { encoding: 'utf8', env: { ...process.env, PATH: pathen } });
    return { kode: r.status, ud: r.stdout + r.stderr };
  } finally { rmSync(d, { recursive: true, force: true }); }
}

const god = (sha) => `# Maaling\n\nMAALT-COMMIT: ${sha}\nAERLIGHED-DOM: 0 LOEGN\n`;

test('2c: en maaling med «0 LOEGN» af PRAECIS den kode der udgives, gaar igennem', { skip: POSIX_SKRIPT }, () => {
  const r = koer2c({ resultat: god });
  assert.equal(r.kode, 0, r.ud);
  assert.match(r.ud, /OK:aerligheds-maalingen gaelder den kode der udgives: 0 LOEGN, maalt paa [0-9a-f]{7}/);
  // En aendring UDEN for de fire filer (README) aendrer ikke hvad vaerktoejerne svarer.
  assert.match(koer2c({ resultat: god, efterMaaling: 'README.md' }).ud, /OK:aerligheds-maalingen gaelder/);
});

test('2c: en LOEGN i maalingen stopper udgivelsen - ogsaa naar filen er nyere end koden', { skip: POSIX_SKRIPT }, () => {
  const r = koer2c({ resultat: (sha) => `MAALT-COMMIT: ${sha}\nAERLIGHED-DOM: LOEGN\n` });
  assert.match(r.ud, /GATE:aerligheds-maalingen af vores eget vaerktoej siger «LOEGN»/, r.ud);
  assert.doesNotMatch(r.ud, /OK:aerligheds-maalingen gaelder/);
  assert.match(koer2c({ resultat: (sha) => `MAALT-COMMIT: ${sha}\nAERLIGHED-DOM: IKKE MAALT\n` }).ud, /GATE:.*siger «IKKE MAALT»/);
});

test('2c: et resultat uden maalingens linjer kan ikke bindes til koden', { skip: POSIX_SKRIPT }, () => {
  const r = koer2c({ resultat: () => '# Tre gange SAND-JA - skrevet i haanden\n' });
  assert.match(r.ud, /GATE:aerligheds-resultatet \(RESULTAT-proeve\.md\) har ingen MAALT-COMMIT\/AERLIGHED-DOM/, r.ud);
});

test('2c: en maalt commit der ikke findes, stopper', { skip: POSIX_SKRIPT }, () => {
  const r = koer2c({ resultat: () => `MAALT-COMMIT: ${'d'.repeat(40)}\nAERLIGHED-DOM: 0 LOEGN\n` });
  assert.match(r.ud, /GATE:den maalte commit d{40} findes ikke i repoet/, r.ud);
});

test('2c: aendres vaerktoejernes kode efter maalingen, gaelder maalingen ikke laengere', { skip: POSIX_SKRIPT }, () => {
  for (const f of ['extension/background.js', 'extension/offscreen.js', 'mcp-server/tools.js', 'mcp-server/index.js']) {
    const r = koer2c({ resultat: god, efterMaaling: f });
    assert.match(r.ud, new RegExp(`GATE:aerligheds-maalingen gaelder [0-9a-f]{7}, men koden er aendret siden: ${f.replace(/[./]/g, '\\$&')}`), `${f}: ${r.ud}`);
  }
});

test('spaerre.yml kan tage aerligheds-maalingen paa GitHub, og en LOEGN er roed', () => {
  const wf = readFileSync(join(rod, '.github/workflows/spaerre.yml'), 'utf8');
  assert.match(wf, /\n      aerlighed:\n(?:        .*\n)*?        type: boolean\n/, 'haandkoerslen har ingen aerlighed-knap');
  const trin = wf.slice(wf.indexOf('- name: aerligheds-maalingen'), wf.indexOf('- name: gem loggen'));
  assert.match(trin, /if: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.aerlighed \}\}/);
  assert.match(trin, /\n\s+shell: bash\n/, 'uden pipefail skjuler tee maalingens exitkode');
  assert.match(trin, /--koer test\/aerlighed\/maal\.mjs --kun os/);
  assert.match(trin, /if \[\[ "\$KODE" != 0 \]\]; then[\s\S]*?exit 1/, 'en maaling med exitkode 1 blev ikke roed');
  const gem = wf.slice(wf.indexOf('- name: gem loggen'));
  assert.match(gem, /aerlighed\.log/, 'aerligheds-loggen gemmes ikke');
});

test('2c: en harmloes advarsel fra git paa stderr er ikke en produktforskel (Astra runde 3)', { skip: POSIX_SKRIPT }, () => {
  const r = koer2c({ resultat: god, gitAdvarsel: true });
  assert.equal(r.kode, 0, r.ud);
  assert.match(r.ud, /OK:aerligheds-maalingen gaelder den kode der udgives/,
    `en gyldig maaling blev afvist fordi git skrev en advarsel paa stderr: ${r.ud}`);
});

test('2c (modsat): en ÆGTE produktforskel afvises stadig, ogsaa naar git skriver en advarsel', { skip: POSIX_SKRIPT }, () => {
  const r = koer2c({ resultat: god, efterMaaling: 'extension/offscreen.js', gitAdvarsel: true });
  assert.match(r.ud, /GATE:aerligheds-maalingen gaelder/, `en aendret produktfil slap igennem: ${r.ud}`);
});
