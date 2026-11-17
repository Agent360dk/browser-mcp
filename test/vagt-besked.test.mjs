/**
 * scripts/vagt-besked.sh - en roed vagt naar et menneske, og en groen lukker sagen (#107).
 *
 * 17/11-2026: scriptet ledte efter bottens issue med --author "app/github-actions". Maalt mod GitHub samme dag gav det
 * filter ingen issues, mens "github-actions[bot]" fandt #108; den groenne koersel 15/11 lukkede derfor intet. Attrappen
 * herunder svarer som GitHub gjorde: et --author-filter matcher kun forfatterens login ordret, og --jq koeres med ægte jq.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const rod = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKRIPT = join(rod, 'scripts/vagt-besked.sh');
const POSIX = process.platform === 'win32' && 'vagt-besked.sh koerer kun paa Linux (Actions)';
const BOT = 'github-actions[bot]';

const ATTRAP = `#!/usr/bin/env bash
{ printf '%s' "$*" | tr '\\n' ' '; echo; } >> "$FAKE_LOG"   # ét kald pr. linje, ogsaa naar en krop har linjeskift
case "$1 $2" in
  "issue list")
    author=""; q="."; shift 2
    while [ $# -gt 0 ]; do case "$1" in --author) author=$2; shift 2;; --jq) q=$2; shift 2;; *) shift;; esac; done
    jq -c --arg a "$author" '[.[] | select($a == "" or .author == $a) | {number, title}]' "$FAKE_ISSUES" | jq -r "$q" ;;
  "issue view") printf '%s' "\${FAKE_BODY:-}" ;;
esac
`;

function koer({ status, issues = [], fund = '', body = '' }) {
  const d = mkdtempSync(join(tmpdir(), 'vagt-besked-'));
  try {
    const bin = join(d, 'bin');
    spawnSync('mkdir', ['-p', bin]);
    writeFileSync(join(bin, 'gh'), ATTRAP); chmodSync(join(bin, 'gh'), 0o755);
    writeFileSync(join(d, 'issues.json'), JSON.stringify(issues));
    const fil = join(d, 'fund.txt'); writeFileSync(fil, fund);
    const log = join(d, 'gh.log');
    const r = spawnSync('bash', [SKRIPT, 'svartid', status, fil], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log, FAKE_ISSUES: join(d, 'issues.json'), FAKE_BODY: body,
        GITHUB_REPOSITORY: 'Agent360dk/browser-mcp', GITHUB_SERVER_URL: 'https://github.com', GITHUB_RUN_ID: '1' },
    });
    const kald = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    return { kode: r.status, kald, ud: r.stdout + r.stderr };
  } finally { rmSync(d, { recursive: true, force: true }); }
}
const skriv = (kald) => kald.filter((k) => !/^issue (list|view)\b/.test(k)).map((k) => k.split(' --')[0]);
const aftrykAf = (fund) => spawnSync('git', ['hash-object', '--stdin'], { input: fund, encoding: 'utf8' }).stdout.slice(0, 16);

test('vagt-besked: filteret bruger bottens login, saa GitHub faktisk finder issuen', () => {
  const s = readFileSync(SKRIPT, 'utf8');
  assert.match(s, /--author "github-actions\[bot\]"/);
  assert.doesNotMatch(s, /--author "app\/github-actions"/, 'det filter fandt ingen issues paa GitHub 17/11-2026');
});

test('vagt-besked: groen lukker bottens aabne issue', { skip: POSIX }, () => {
  const r = koer({ status: 'ok', issues: [{ number: 108, title: 'vagt roed: svartid', author: BOT }] });
  assert.equal(r.kode, 0, r.ud);
  assert.deepEqual(skriv(r.kald), ['issue close 108']);
});

test('vagt-besked: groen roerer aldrig en fremmeds issue med samme titel', { skip: POSIX }, () => {
  const r = koer({ status: 'ok', issues: [{ number: 7, title: 'vagt roed: svartid', author: 'nogen' }] });
  assert.equal(r.kode, 0, r.ud);
  assert.deepEqual(skriv(r.kald), []);
});

test('vagt-besked: roed uden aaben issue opretter én', { skip: POSIX }, () => {
  const r = koer({ status: 'roed', fund: '#106 Visual cursor\n' });
  assert.equal(r.kode, 0, r.ud);
  assert.deepEqual(skriv(r.kald), ['issue create']);
});

test('vagt-besked: roed med samme fund som sidst skriver intet', { skip: POSIX }, () => {
  const fund = '#106 Visual cursor';
  const r = koer({ status: 'roed', fund: fund + '\n', issues: [{ number: 108, title: 'vagt roed: svartid', author: BOT }], body: `x <!-- aftryk:${aftrykAf(fund)} -->` });
  assert.equal(r.kode, 0, r.ud);
  assert.deepEqual(skriv(r.kald), []);
});

test('vagt-besked: roed med nye fund kommenterer foerst og retter saa issuen (ingen ny issue)', { skip: POSIX }, () => {
  const r = koer({ status: 'roed', fund: '#106 Visual cursor\n', issues: [{ number: 108, title: 'vagt roed: svartid', author: BOT }], body: 'x <!-- aftryk:0000000000000000 -->' });
  assert.equal(r.kode, 0, r.ud);
  assert.deepEqual(skriv(r.kald), ['issue comment 108', 'issue edit 108']);
});
