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
function opsaet({ foer = '0.0.1', loginFejler = false, publishFejler = false, opdatererIkke = false, navn = 'io.github.Agent360dk/browser-mcp', andenServer = null, versionDefekt = false, opslagFejler = false, foerstFejler = 0 } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'registry-udgiv-'));
  const stubs = join(d, 'stubs'); mkdirSync(stubs);
  const reg = join(d, 'registry-version'); writeFileSync(reg, foer);
  const log = join(d, 'kald.log'); writeFileSync(log, '');
  writeFileSync(join(stubs, 'mcp-publisher'), `#!/bin/sh
echo "$*" >> "${log}"
case "$1" in
  --version) ${versionDefekt ? 'echo BROKEN; exit 126' : 'echo "mcp-publisher 1.8.1"; exit 0'} ;;
  login) ${loginFejler ? 'exit 3' : 'exit 0'} ;;
  publish) ${publishFejler ? 'exit 4' : opdatererIkke ? 'exit 0' : `node -e "process.stdout.write(require('./server.json').version)" > "${reg}"; exit 0`} ;;
esac
exit 0
`);
  writeFileSync(join(stubs, 'curl'), `#!/bin/sh
${opslagFejler ? 'exit 22' : ''}
n=$(cat "${join(d, 'curl-taeller')}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${join(d, 'curl-taeller')}"
[ "$n" -le ${foerstFejler} ] && exit 28
v="$(cat "${reg}")"
printf '{"servers":[%s{"server":{"name":"${navn}","version":"%s"},"_meta":{"io.modelcontextprotocol.registry/official":{"isLatest":true}}}]}' '${andenServer ? JSON.stringify({ server: { name: andenServer.navn, version: andenServer.version }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } } }) + ',' : ''}' "$v"
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

// ═══ Astra runde 5 (1/10): falske grønne udfald i registry-scriptet ═══════════════════════════════════════════════

function falskServerJson(indhold) {
  const d = mkdtempSync(join(tmpdir(), 'registry-sj-'));
  const f = join(d, 'server.json'); writeFileSync(f, JSON.stringify(indhold));
  return { f, ryd: () => rmSync(d, { recursive: true, force: true }) };
}

test('registry-udgiv: en defekt mcp-publisher (--version fejler) bestaar IKKE proevekoerslen', { skip: POSIX }, () => {
  const o = opsaet({ versionDefekt: true });
  try {
    const r = o.koer([SERVER_VERSION], OIDC);
    assert.notEqual(r.status, 0, `en binaer der ikke kan koeres bestod proevekoerslen: ${r.stdout}`);
  } finally { o.ryd(); }
});

test('registry-udgiv: en ANDEN server med navn som substring (browser-mcp-other) tæller ikke som vores', { skip: POSIX }, () => {
  const o = opsaet({ andenServer: { navn: 'io.github.Agent360dk/browser-mcp-other', version: SERVER_VERSION } });
  try {
    const r = o.koer([SERVER_VERSION, '--ship'], OIDC);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.ok(o.kald().some((l) => l.startsWith('publish')), 'en anden servers version fik scriptet til at tro at vi allerede var udgivet');
  } finally { o.ryd(); }
});

test('registry-udgiv: tilbagelaesningen godkender ikke en anden servers version', { skip: POSIX }, () => {
  const o = opsaet({ opdatererIkke: true, andenServer: { navn: 'io.github.Agent360dk/browser-mcp-other', version: SERVER_VERSION } });
  try { assert.notEqual(o.koer([SERVER_VERSION, '--ship'], OIDC).status, 0, 'en anden servers version blev laest som vores'); } finally { o.ryd(); }
});

for (const [navn, indhold] of Object.entries({
  'tom {}': {},
  'ingen topversion': { packages: [{ version: SERVER_VERSION }] },
  'ingen packages': { version: SERVER_VERSION },
  'pakke uden version': { version: SERVER_VERSION, packages: [{}] },
  'tom packages-liste': { version: SERVER_VERSION, packages: [] },
})) {
  test(`registry-udgiv: server.json uden versionsfelter afvises (${navn})`, { skip: POSIX }, () => {
    const o = opsaet(); const sj = falskServerJson(indhold);
    try {
      const r = o.koer([SERVER_VERSION], { ...OIDC, REGISTRY_SERVER_JSON: sj.f });
      assert.notEqual(r.status, 0, `en server.json uden versionsfelt gav grøn: ${r.stdout}`);
    } finally { o.ryd(); sj.ryd(); }
  });
}
test('registry-udgiv (modsat): en komplet server.json godkendes', { skip: POSIX }, () => {
  const o = opsaet(); const sj = falskServerJson({ version: SERVER_VERSION, packages: [{ version: SERVER_VERSION }] });
  try { assert.equal(o.koer([SERVER_VERSION], { ...OIDC, REGISTRY_SERVER_JSON: sj.f }).status, 0); } finally { o.ryd(); sj.ryd(); }
});

test('registry-udgiv: et opslag der FEJLER er ikke "ukendt version": proevekoersel og rigtig udgivelse stopper', { skip: POSIX }, () => {
  for (const args of [[SERVER_VERSION], [SERVER_VERSION, '--ship']]) {
    const o = opsaet({ opslagFejler: true });
    try {
      const r = o.koer(args, OIDC);
      assert.notEqual(r.status, 0, `${args.join(' ')}: et fejlet registeropslag gav grøn: ${r.stdout}`);
      assert.ok(!o.kald().some((l) => /^(login|publish)/.test(l)), 'der blev logget ind/publiceret uden at kunne laese registret');
    } finally { o.ryd(); }
  }
});

test('registry-udgiv: ukendte argumenter afvises', { skip: POSIX }, () => {
  for (const args of [[SERVER_VERSION, '--typo'], [SERVER_VERSION, '--typo', '--ship'], [SERVER_VERSION, '--ship', '--ekstra']]) {
    const o = opsaet();
    try { assert.notEqual(o.koer(args, OIDC).status, 0, `${args.join(' ')} blev accepteret`); } finally { o.ryd(); }
  }
});

// Maalt 1/10: det ægte register har en koldstart paa op til 27 s (første opslag), derefter ~1 s. En kort frist uden gentagelser
// ville have faaet første opslag i en rigtig koersel til at fejle.
test('registry-udgiv: et opslag der fejler en-to gange (koldstart) gentages og lykkes', { skip: POSIX }, () => {
  const o = opsaet({ foerstFejler: 2 });
  try {
    const r = o.koer([SERVER_VERSION], OIDC);
    assert.equal(r.status, 0, `to forbigaaende opslagsfejl stoppede proeven: ${r.stdout} ${r.stderr}`);
  } finally { o.ryd(); }
});
test('registry-udgiv: et opslag der fejler tre gange i traek giver op (ingen uendelig loekke)', { skip: POSIX }, () => {
  const o = opsaet({ foerstFejler: 3 });
  try { assert.notEqual(o.koer([SERVER_VERSION], OIDC).status, 0); } finally { o.ryd(); }
});
test('registry-udgiv: opslagets frist er mindst 45 s (registrets koldstart er maalt til 27 s)', { skip: POSIX }, () => {
  const kilde = readFileSync(script, 'utf8');
  const m = kilde.match(/--max-time (\d+)/);
  assert.ok(m && Number(m[1]) >= 45, `fristen er ${m ? m[1] : 'ukendt'} s - for kort til registrets koldstart`);
});
