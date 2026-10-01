/**
 * MCP-registret udgives som EGET trin, efter det kolde tjek (Astra runde 4, 1/10-2026).
 *
 * Foer 1/10 laa registret (trin 5b) EFTER det kolde tjek (5c) i udgivelsesscriptet, og scriptet standsede foer registret hvis den
 * udgivne pakke ikke svarede. Da det kolde tjek flyttede til et job uden rettigheder, endte registret FOER det. En pakke der ikke
 * starter kunne dermed blive annonceret i registret, og det blev opdaget bagefter. Nu kører `scripts/registry-udgiv.sh` i et job der
 * venter paa det kolde tjek. Prøverne her koerer scriptet mod en falsk `mcp-publisher` og en falsk `curl`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POSIX = process.platform === 'win32' && 'registry-udgiv.sh koerer kun paa macOS/Linux';
const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(rod, 'scripts/registry-udgiv.sh');
const SERVER_VERSION = JSON.parse(readFileSync(join(rod, 'mcp-server/server.json'), 'utf8')).version;

/** Falsk mcp-publisher + curl. Registret holder sin version i en fil; en vellykket `publish` skriver server.json's version dertil. */
function opsaet({ foer = '0.0.1', loginFejler = false, publishFejler = false, opdatererIkke = false } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'registry-udgiv-'));
  const stubs = join(d, 'stubs'); mkdirSync(stubs);
  const reg = join(d, 'registry-version'); writeFileSync(reg, foer);
  const log = join(d, 'kald.log'); writeFileSync(log, '');
  writeFileSync(join(stubs, 'mcp-publisher'), `#!/bin/sh
echo "$*" >> "${log}"
case "$1" in
  login) ${loginFejler ? 'exit 3' : 'exit 0'} ;;
  publish) ${publishFejler ? 'exit 4' : opdatererIkke ? 'exit 0' : `node -e "process.stdout.write(require('./server.json').version)" > "${reg}"; exit 0`} ;;
esac
exit 0
`);
  writeFileSync(join(stubs, 'curl'), `#!/bin/sh
v="$(cat "${reg}")"
printf '{"servers":[{"server":{"version":"%s"},"_meta":{"io.modelcontextprotocol.registry/official":{"isLatest":true}}}]}' "$v"
`);
  for (const f of ['mcp-publisher', 'curl']) chmodSync(join(stubs, f), 0o755);
  const koer = (args, miljoe = {}) => spawnSync('bash', [script, ...args], {
    encoding: 'utf8', timeout: 60000,
    env: { PATH: `${stubs}:${process.env.PATH}`, HOME: process.env.HOME, REGISTRY_PAUSE: '0', REGISTRY_FORSOEG: '3', ...miljoe },
  });
  const kald = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { koer, kald, registreret: () => readFileSync(reg, 'utf8'), ryd: () => rmSync(d, { recursive: true, force: true }) };
}
const OIDC = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'x', GITHUB_ACTIONS: 'true' };

test('registry-udgiv: version i server.json skal vaere den der udgives, ellers publiceres intet', { skip: POSIX }, () => {
  const o = opsaet();
  try {
    const r = o.koer(['9.9.9', '--ship'], OIDC);
    assert.notEqual(r.status, 0, `en forkert version slap igennem: ${r.stdout}`);
    assert.deepEqual(o.kald(), [], 'mcp-publisher blev kaldt trods forkert version');
  } finally { o.ryd(); }
});

test('registry-udgiv: proevekoersel (uden --ship) logger ikke ind og udgiver ikke, men melder hvad den ville', { skip: POSIX }, () => {
  const o = opsaet();
  try {
    const r = o.koer([SERVER_VERSION], OIDC);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.ok(!o.kald().some((l) => /^(login|publish)/.test(l)), `en proevekoersel loggede ind eller publicerede: ${o.kald()}`);
    assert.match(r.stdout, /ville/i);
    assert.equal(o.registreret(), '0.0.1', 'registret blev aendret i en proevekoersel');
  } finally { o.ryd(); }
});

test('registry-udgiv: registret er allerede paa versionen -> intet gøres (genoptagelse)', { skip: POSIX }, () => {
  const o = opsaet({ foer: SERVER_VERSION });
  try {
    const r = o.koer([SERVER_VERSION, '--ship'], OIDC);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.deepEqual(o.kald(), [], 'der blev publiceret igen paa en version der allerede var der');
  } finally { o.ryd(); }
});

test('registry-udgiv: --ship uden GitHubs id-token afvises foer noget kaldes', { skip: POSIX }, () => {
  const o = opsaet();
  try {
    const r = o.koer([SERVER_VERSION, '--ship'], {});
    assert.notEqual(r.status, 0, `uden id-token slap det igennem: ${r.stdout}`);
    assert.deepEqual(o.kald(), []);
  } finally { o.ryd(); }
});

test('registry-udgiv: en rigtig udgivelse logger ind med OIDC, publicerer og laeser tilbage', { skip: POSIX }, () => {
  const o = opsaet();
  try {
    const r = o.koer([SERVER_VERSION, '--ship'], OIDC);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    const k = o.kald();
    assert.equal(k[0], 'login github-oidc', `forkert raekkefoelge: ${k}`);
    assert.match(k[1], /^publish server\.json$/, `forkert raekkefoelge: ${k}`);
    assert.equal(o.registreret(), SERVER_VERSION);
  } finally { o.ryd(); }
});

test('registry-udgiv: afvist login stopper foer publish', { skip: POSIX }, () => {
  const o = opsaet({ loginFejler: true });
  try {
    const r = o.koer([SERVER_VERSION, '--ship'], OIDC);
    assert.notEqual(r.status, 0);
    assert.ok(!o.kald().some((l) => l.startsWith('publish')), `publish blev kaldt efter et afvist login: ${o.kald()}`);
  } finally { o.ryd(); }
});

test('registry-udgiv: mislykket publish fejler', { skip: POSIX }, () => {
  const o = opsaet({ publishFejler: true });
  try { assert.notEqual(o.koer([SERVER_VERSION, '--ship'], OIDC).status, 0); } finally { o.ryd(); }
});

test('registry-udgiv: hvis registret aldrig viser versionen efter publish, fejler jobbet (ingen falsk groen)', { skip: POSIX }, () => {
  const o = opsaet({ opdatererIkke: true });
  try {
    const r = o.koer([SERVER_VERSION, '--ship'], OIDC);
    assert.notEqual(r.status, 0, `en udgivelse registret ikke viser blev meldt groen: ${r.stdout}`);
    assert.match(r.stderr + r.stdout, /still advertises|viser stadig/i);
  } finally { o.ryd(); }
});
