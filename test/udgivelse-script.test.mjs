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
import { tmpdir } from 'node:os';
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

function koer(mappe, frist = '2000') {
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

test('pakketjek: en pakke der besvarer haandtrykket godkendes', () => {
  const d = pakke(`process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  const i = buf.indexOf('\\n');
  if (i < 0) return;
  const m = JSON.parse(buf.slice(0, i));
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'falsk', version: '9.9.9' } } }) + '\\n');
});
`);
  try {
    const r = koer(d);
    assert.equal(r.status, 0, `en korrekt pakke blev afvist: ${r.stderr}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('pakketjek: repoets egen server besvarer haandtrykket', () => {
  const r = koer(join(rod, 'mcp-server'), '20000');
  assert.equal(r.status, 0, `repoets egen server fejlede pakketjekket: ${r.stderr}`);
  assert.match(r.stdout, /agent360-browser/);
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

test('release-scriptet stopper paa versionstjekket og ikke paa den gamle lighed', () => {
  const s = script();
  assert.doesNotMatch(s, /"\$NEW_VERSION" != "\$NPM_LATEST"/, 'den gamle lighedsbetingelse er tilbage');
  assert.match(s, /versions_tjek "\$NEW_VERSION" "\$NPM_LATEST"/);
});
