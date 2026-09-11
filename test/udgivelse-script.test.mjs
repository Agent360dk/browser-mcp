/**
 * Udgivelsesscriptets to sidste vagter, testet mod det de skal fange.
 *
 * MAALT 11/9 (Astra, efterproevet i koden):
 *  1) Pakketjekket godkendte en pakke der crasher ved start. Det fangede kun
 *     ERR_MODULE_NOT_FOUND/SyntaxError, og en manglende "server running"-linje gav kun en
 *     advarsel. En log-linje beviser heller ikke at serveren svarer.
 *  2) En halv udgivelse kunne ikke genoptages. Versionstjekket stoppede naar versionen var
 *     lig npm's nyeste, selvom npm-trinnet selv springer en allerede udgivet version over, og
 *     registret koerer efter npm.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const roegtest = join(rod, 'scripts/pakke-roegtest.mjs');
const script = () => readFileSync(join(rod, 'runbrowsermcpupdate.sh'), 'utf8');

// ── pakketjekket ─────────────────────────────────────────────────────────────

function pakke(cliKilde) {
  const d = mkdtempSync(join(tmpdir(), 'pakke-roegtest-'));
  mkdirSync(join(d, 'bin'));
  writeFileSync(join(d, 'bin/cli.js'), cliKilde);
  writeFileSync(join(d, 'package.json'), JSON.stringify({ type: 'module' }));
  return d;
}

// Standardfristen er rummelig: den skal kun faelde en pakke der ALDRIG svarer, og den test giver sin egen korte frist.
// MAALT 11/9 i fuld suite: med 2000 ms naaede en korrekt falsk pakke ikke at svare under belastning (6 s brugt) - alene 3/3 groen.
function koer(mappe, frist = '15000') {
  return spawnSync(process.execPath, [roegtest, mappe], {
    encoding: 'utf8',
    env: { ...process.env, PAKKE_ROEGTEST_FRIST_MS: frist },
    timeout: 40000,
  });
}

test('pakketjek: en pakke der crasher ved start afvises', () => {
  const d = pakke("process.stderr.write('[MCP] vagt-kaede: 1\\n');\nthrow new Error('simulated runtime failure');\n");
  try {
    const r = koer(d);
    assert.notEqual(r.status, 0, 'en crashende pakke blev godkendt');
    assert.match(r.stderr + r.stdout, /simulated runtime failure/, 'fejlen skal vises, saa man kan se hvorfor');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pakketjek: en pakke der siger "server running" men aldrig svarer afvises', () => {
  const d = pakke("process.stderr.write('[MCP] Agent360 Browser MCP server running (stdio)\\n');\nsetInterval(() => {}, 1000);\n");
  try {
    const r = koer(d, '1500');
    assert.notEqual(r.status, 0, 'en tavs pakke blev godkendt paa sin log-linje');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// En falsk pakke der besvarer initialize med `result` og derefter goer `efter` (fx crasher).
function svarendePakke(result, efter = '') {
  return pakke(`import { homedir } from 'node:os';
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  const i = buf.indexOf('\\n');
  if (i < 0) return;
  const m = JSON.parse(buf.slice(0, i));
  const result = ${JSON.stringify(result)};
  if (result.serverInfo && result.serverInfo.version === 'HJEM') result.serverInfo.version = 'hjem=' + homedir();
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
  ${efter}
});
`);
}
const GYLDIGT = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } };

test('pakketjek: en pakke der besvarer haandtrykket godkendes', () => {
  const d = svarendePakke(GYLDIGT);
  try {
    const r = koer(d);
    assert.equal(r.status, 0, `en korrekt pakke blev afvist: ${r.stderr}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// MAALT 11/9 af Astra (sign-off): {id:1,result:{serverInfo:{name:"broken"}}} efterfulgt af crash gav exit 0.
// Protokol og capabilities blev ikke valideret, og en pakke der doede lige efter svaret blev godkendt.
test('pakketjek: et svar uden protokol og vaerktoejer, efterfulgt af crash, afvises', () => {
  const d = svarendePakke({ serverInfo: { name: 'broken' } }, 'setTimeout(() => process.exit(1), 50);');
  try {
    assert.notEqual(koer(d).status, 0, 'et defekt svar efterfulgt af crash blev godkendt');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pakketjek: et gyldigt svar efterfulgt af crash afvises', () => {
  const d = svarendePakke(GYLDIGT, 'setTimeout(() => process.exit(1), 100);');
  try {
    const r = koer(d);
    assert.notEqual(r.status, 0, 'en pakke der doede lige efter svaret blev godkendt');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pakketjek: et gyldigt svar uden vaerktoejs-capability afvises', () => {
  const d = svarendePakke({ ...GYLDIGT, capabilities: {} });
  try {
    assert.notEqual(koer(d).status, 0, 'en server uden tools-capability blev godkendt');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pakketjek: et gyldigt svar fra en anden server afvises', () => {
  const d = svarendePakke({ ...GYLDIGT, serverInfo: { name: 'en-anden-server', version: '1' } });
  try {
    assert.notEqual(koer(d).status, 0, 'en anden servers svar blev godkendt som vores pakke');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pakketjek: repoets egen server besvarer haandtrykket', () => {
  const r = koer(join(rod, 'mcp-server'), '20000');
  assert.equal(r.status, 0, `repoets egen server fejlede pakketjekket: ${r.stderr}`);
  assert.match(r.stdout, /agent360-browser/);
});

// MAALT 11/9 af Fable (sign-off): pakketjekket starter bin/cli.js, og cli.js kopierer ved start sin udvidelse over
// ~/.browser-mcp/extension hvis den er nyere. En "test" af en kandidat der endnu ikke er udgivet, skrev altsaa i
// brugerens rigtige udvidelsesmappe.
test('pakketjek: pakken koeres med et midlertidigt hjem, ikke brugerens', () => {
  const d = svarendePakke({ ...GYLDIGT, serverInfo: { name: 'agent360-browser', version: 'HJEM' } });
  try {
    const r = koer(d);
    assert.equal(r.status, 0, r.stderr);
    const hjem = (r.stdout.match(/hjem=(\S+)/) || [])[1];
    assert.ok(hjem, `pakken fortalte ikke sit hjem: ${r.stdout}`);
    assert.notEqual(hjem, homedir(), 'pakketjekket koerte kandidaten med brugerens rigtige hjem');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('release-scriptet bruger pakketjekket og ikke log-linjen', () => {
  const s = script();
  assert.match(s, /node "\$REPO_ROOT\/scripts\/pakke-roegtest\.mjs" "\$SMOKE_DIR\/package"/,
    'release-scriptet kalder ikke pakketjekket');
  assert.doesNotMatch(s, /grep -q "server running"/, 'log-linjen er ikke et bevis for at pakken virker');
});

// ── versionstjekket ──────────────────────────────────────────────────────────

function tjek(ny, npm) {
  const s = script();
  const start = s.indexOf('versions_tjek() {');
  assert.ok(start > -1, 'versions_tjek() mangler i release-scriptet');
  const funktion = s.slice(start, s.indexOf('\n}\n', start) + 3);
  const r = spawnSync('bash', ['-c', `${funktion}\nversions_tjek "$1" "$2"`, '_', ny, npm], { encoding: 'utf8' });
  return { status: r.status, ud: r.stdout.trim() };
}

test('versionstjek: en nyere version er en ny udgivelse', () => {
  assert.deepEqual(tjek('1.29.1', '1.29.0'), { status: 0, ud: 'ny' });
  assert.deepEqual(tjek('1.10.0', '1.9.0'), { status: 0, ud: 'ny' }, 'tekstsammenligning ville sige 1.9.0 var nyest');
});

test('versionstjek: samme version som npm genoptager en halv udgivelse', () => {
  assert.deepEqual(tjek('1.29.1', '1.29.1'), { status: 0, ud: 'genoptag' });
});

test('versionstjek: en aeldre version stopper', () => {
  assert.notEqual(tjek('1.29.0', '1.29.1').status, 0);
  assert.notEqual(tjek('1.9.0', '1.10.0').status, 0);
});

// MAALT 11/9 af Fable (sign-off): samme version som npm + ny kode paa main (glemt versionsbump) blev kaldt "genoptag".
// Med --skip-cws blev main pushet, og GitHub-udgivelsens zip blev erstattet (--clobber) med kode der hverken var tagget
// eller paa npm. En halv udgivelse genoptages kun, hvis tagget for versionen peger paa netop den kode der udgives.
function genoptagTjek(opsaet) {
  const repo = mkdtempSync(join(tmpdir(), 'genoptag-'));
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'udgivet');
  opsaet(git);
  const s = script();
  const start = s.indexOf('genoptag_tjek() {');
  assert.ok(start > -1, 'genoptag_tjek() mangler i release-scriptet');
  const funktion = s.slice(start, s.indexOf('\n}\n', start) + 3);
  const r = spawnSync('bash', ['-c', `${funktion}\ncd "$2" && genoptag_tjek "$1"`, '_', '1.29.1', repo], { encoding: 'utf8' });
  rmSync(repo, { recursive: true, force: true });
  return r.status;
}

test('genoptag: tagget peger paa den kode der udgives -> genoptag tilladt', () => {
  assert.equal(genoptagTjek((git) => git('tag', 'v1.29.1')), 0);
});

test('genoptag: ny kode efter tagget (glemt versionsbump) -> stop', () => {
  assert.notEqual(genoptagTjek((git) => { git('tag', 'v1.29.1'); git('commit', '-q', '--allow-empty', '-m', 'ny kode'); }), 0);
});

test('genoptag: intet tag for versionen -> stop', () => {
  assert.notEqual(genoptagTjek(() => {}), 0);
});

test('release-scriptet koerer genoptag-tjekket naar versionen allerede er paa npm', () => {
  const s = script();
  const i = s.indexOf('if [[ "$VERSIONS_TILSTAND" == genoptag ]]; then');
  assert.ok(i > -1);
  assert.match(s.slice(i, i + 400), /genoptag_tjek "\$NEW_VERSION" \|\| die/, 'genoptag-grenen tjekker ikke tagget');
});

test('release-scriptet stopper paa versionstjekket og ikke paa den gamle lighed', () => {
  const s = script();
  assert.doesNotMatch(s, /"\$NEW_VERSION" != "\$NPM_LATEST"/, 'den gamle lighedsbetingelse er tilbage');
  assert.match(s, /versions_tjek "\$NEW_VERSION" "\$NPM_LATEST"/);
});
