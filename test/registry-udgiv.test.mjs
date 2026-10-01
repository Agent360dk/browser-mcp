/**
 * MCP-registret udgives som EGET trin, efter det kolde tjek (Astra runde 4-6, 1/10-2026).
 *
 * Foer 1/10 laa registret (trin 5b) EFTER det kolde tjek (5c) i udgivelsesscriptet, og scriptet standsede foer registret hvis den
 * udgivne pakke ikke svarede. Da det kolde tjek flyttede til et job uden rettigheder, endte registret FOER det. En pakke der ikke
 * starter kunne dermed blive annonceret i registret, og det blev opdaget bagefter. Nu kører `scripts/registry-udgiv.sh` i et job der
 * venter paa det kolde tjek. Prøverne her koerer scriptet mod en falsk `mcp-publisher` og en falsk `curl`.
 *
 * Registret slaas op PAA PRAECIST SERVERNAVN (`/v0/servers/<navn>/versions/latest`, maalt 1/10: 200 paa ~2 s), ikke med en substring-soegning
 * (som kunne finde en anden server og kraevede paginering). 404 = serveren findes ikke endnu; alt andet end 200 er et FEJLET opslag.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POSIX = process.platform === 'win32' && 'registry-udgiv.sh koerer kun paa macOS/Linux';
const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const script = join(rod, 'scripts/registry-udgiv.sh');
const SERVER_VERSION = JSON.parse(readFileSync(join(rod, 'mcp-server/server.json'), 'utf8')).version;
const NAVN = 'io.github.Agent360dk/browser-mcp';
const svar = (navn, version) => JSON.stringify({ server: { name: navn, version }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } } });

/**
 * Falsk mcp-publisher + curl. Registrets tilstand er to filer (status, body); en vellykket `publish` skriver server.json's version dertil.
 * Den falske curl forstaar -o <fil> og -w '%{http_code}' som den aegte.
 */
function opsaet({ foer = '0.0.1', status = 200, body = null, loginFejler = false, publishFejler = false, opdatererIkke = false, versionDefekt = false, foerstFejler = 0 } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'registry-udgiv-'));
  const stubs = join(d, 'stubs'); mkdirSync(stubs);
  const filStatus = join(d, 'status'); writeFileSync(filStatus, String(status));
  const filBody = join(d, 'body'); writeFileSync(filBody, body ?? svar(NAVN, foer));
  const log = join(d, 'kald.log'); writeFileSync(log, '');
  const urls = join(d, 'urls.log'); writeFileSync(urls, '');
  const taeller = join(d, 'taeller');
  writeFileSync(join(stubs, 'mcp-publisher'), `#!/bin/sh
echo "$*" >> "${log}"
case "$1" in
  --version) ${versionDefekt ? 'echo BROKEN; exit 126' : 'echo "mcp-publisher 1.8.1"; exit 0'} ;;
  login) ${loginFejler ? 'exit 3' : 'exit 0'} ;;
  publish) ${publishFejler ? 'exit 4' : opdatererIkke ? 'exit 0' : `v=$(node -e "process.stdout.write(require('./server.json').version)"); printf '%s' '{"server":{"name":"${NAVN}","version":"'"$v"'"},"_meta":{}}' > "${filBody}"; echo 200 > "${filStatus}"; exit 0`} ;;
esac
exit 0
`);
  writeFileSync(join(stubs, 'curl'), `#!/bin/sh
out=""; w=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -w) w="$2"; shift ;; --connect-timeout|--max-time) shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
echo "$url" >> "${urls}"
n=$(cat "${taeller}" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${taeller}"
[ "$n" -le ${foerstFejler} ] && exit 28
if [ -n "$out" ]; then cat "${filBody}" > "$out"; else cat "${filBody}"; fi
case "$w" in *http_code*) printf '%s' "$(cat "${filStatus}")" ;; esac
exit 0
`);
  for (const f of ['mcp-publisher', 'curl']) chmodSync(join(stubs, f), 0o755);
  const koer = (args, miljoe = {}) => spawnSync('bash', [script, ...args], {
    encoding: 'utf8', timeout: 90000,
    env: { PATH: `${stubs}:${process.env.PATH}`, HOME: process.env.HOME, REGISTRY_PAUSE: '0.05', REGISTRY_BUDGET: '2', ...miljoe },
  });
  const kald = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
  const besoegte = () => readFileSync(urls, 'utf8').split('\n').filter(Boolean);
  return { koer, kald, besoegte, registreret: () => JSON.parse(readFileSync(filBody, 'utf8')).server?.version, ryd: () => rmSync(d, { recursive: true, force: true }) };
}
const OIDC = { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.example/token', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'x', GITHUB_ACTIONS: 'true' };
const publiceret = (o) => o.kald().some((l) => l.startsWith('publish'));

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

test('registry-udgiv: opslaget gaar paa PRAECIST servernavn (ikke en substring-soegning)', { skip: POSIX }, () => {
  const o = opsaet();
  try {
    o.koer([SERVER_VERSION], OIDC);
    const u = o.besoegte();
    assert.ok(u.length > 0, 'ingen opslag blev lavet');
    for (const url of u) assert.match(url, /\/v0\/servers\/io\.github\.Agent360dk%2Fbrowser-mcp\/versions\/latest$/, `forkert opslag: ${url}`);
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

test('registry-udgiv: serveren findes ikke i registret endnu (404) -> proeve OK, og en rigtig udgivelse publicerer', { skip: POSIX }, () => {
  const a = opsaet({ status: 404, body: '{"error":"not found"}' });
  const b = opsaet({ status: 404, body: '{"error":"not found"}' });
  try {
    const p = a.koer([SERVER_VERSION], OIDC);
    assert.equal(p.status, 0, `404 stoppede proevekoerslen: ${p.stdout} ${p.stderr}`);
    const r = b.koer([SERVER_VERSION, '--ship'], OIDC);
    assert.equal(r.status, 0, `${r.stdout} ${r.stderr}`);
    assert.ok(publiceret(b), 'en server der ikke findes endnu blev ikke publiceret');
  } finally { a.ryd(); b.ryd(); }
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
    assert.notEqual(o.koer([SERVER_VERSION, '--ship'], OIDC).status, 0);
    assert.ok(!publiceret(o), `publish blev kaldt efter et afvist login: ${o.kald()}`);
  } finally { o.ryd(); }
});

test('registry-udgiv: mislykket publish fejler', { skip: POSIX }, () => {
  const o = opsaet({ publishFejler: true });
  try { assert.notEqual(o.koer([SERVER_VERSION, '--ship'], OIDC).status, 0); } finally { o.ryd(); }
});

test('registry-udgiv: hvis registret aldrig viser versionen efter publish, fejler jobbet inden for budgettet (ingen falsk groen)', { skip: POSIX }, () => {
  const o = opsaet({ opdatererIkke: true });
  try {
    const t0 = Date.now();
    const r = o.koer([SERVER_VERSION, '--ship'], OIDC);
    assert.notEqual(r.status, 0, `en udgivelse registret ikke viser blev meldt groen: ${r.stdout}`);
    assert.match(r.stderr + r.stdout, /still advertises|viser stadig/i);
    assert.ok(Date.now() - t0 < 30000, 'pollingen overholdt ikke sit budget');
  } finally { o.ryd(); }
});

// ═══ Astra runde 5-6 (1/10): falske grønne udfald ═════════════════════════════════════════════════════════════════

function falskServerJson(indhold) {
  const d = mkdtempSync(join(tmpdir(), 'registry-sj-'));
  const f = join(d, 'server.json'); writeFileSync(f, JSON.stringify(indhold));
  return { f, ryd: () => rmSync(d, { recursive: true, force: true }) };
}

test('registry-udgiv: en defekt mcp-publisher (--version fejler) bestaar IKKE proevekoerslen', { skip: POSIX }, () => {
  const o = opsaet({ versionDefekt: true });
  try { assert.notEqual(o.koer([SERVER_VERSION], OIDC).status, 0, 'en binaer der ikke kan koeres bestod proevekoerslen'); } finally { o.ryd(); }
});

for (const [navn, body] of Object.entries({
  'en ANDEN servers navn': svar('io.github.Agent360dk/browser-mcp-other', SERVER_VERSION),
  'tomt objekt {}': '{}',
  'fejlobjekt': '{"error":"unavailable"}',
  'server uden version': JSON.stringify({ server: { name: NAVN } }),
  'version som tal': JSON.stringify({ server: { name: NAVN, version: 5 } }),
  'server er en liste': JSON.stringify({ server: [] }),
  'ikke JSON': 'Bad Gateway',
})) {
  test(`registry-udgiv: et 200-svar der ikke er vores serveroplysninger (${navn}) er et FEJLET opslag, ikke "ingen version"`, { skip: POSIX }, () => {
    for (const args of [[SERVER_VERSION], [SERVER_VERSION, '--ship']]) {
      const o = opsaet({ body });
      try {
        const r = o.koer(args, OIDC);
        assert.notEqual(r.status, 0, `${args.join(' ')}: ${navn} gav grøn: ${r.stdout}`);
        assert.ok(!publiceret(o), 'der blev publiceret uden at kunne laese registret ordentligt');
      } finally { o.ryd(); }
    }
  });
}

test('registry-udgiv: en HTTP-fejl (500) er et fejlet opslag, ikke "ingen version" (kun 404 er det)', { skip: POSIX }, () => {
  for (const args of [[SERVER_VERSION], [SERVER_VERSION, '--ship']]) {
    const o = opsaet({ status: 500, body: 'oops' });
    try {
      assert.notEqual(o.koer(args, OIDC).status, 0, `${args.join(' ')}: HTTP 500 gav grøn`);
      assert.ok(!publiceret(o));
    } finally { o.ryd(); }
  }
});

// server.json: hvert felt sammenlignes HELT med den forventede vaerdi (ikke ord for ord efter join/ordopdeling)
const NAVN_OK = { name: NAVN };
for (const [navn, indhold] of Object.entries({
  'tom {}': {},
  'ingen topversion': { ...NAVN_OK, packages: [{ version: SERVER_VERSION }] },
  'ingen packages': { ...NAVN_OK, version: SERVER_VERSION },
  'pakke uden version': { ...NAVN_OK, version: SERVER_VERSION, packages: [{}] },
  'tom packages-liste': { ...NAVN_OK, version: SERVER_VERSION, packages: [] },
  'blank version': { ...NAVN_OK, version: ' ', packages: [{ version: '\t' }] },
  'sammensat version': { ...NAVN_OK, version: `${SERVER_VERSION} ${SERVER_VERSION}`, packages: [{ version: SERVER_VERSION }] },
  'forkert servernavn': { name: 'io.github.Other/other', version: SERVER_VERSION, packages: [{ version: SERVER_VERSION }] },
})) {
  test(`registry-udgiv: server.json afvises (${navn})`, { skip: POSIX }, () => {
    const o = opsaet(); const sj = falskServerJson(indhold);
    try {
      const r = o.koer([SERVER_VERSION], { ...OIDC, REGISTRY_SERVER_JSON: sj.f });
      assert.notEqual(r.status, 0, `en ugyldig server.json gav grøn: ${r.stdout}`);
    } finally { o.ryd(); sj.ryd(); }
  });
}
test('registry-udgiv (modsat): en komplet server.json godkendes', { skip: POSIX }, () => {
  const o = opsaet(); const sj = falskServerJson({ name: NAVN, version: SERVER_VERSION, packages: [{ version: SERVER_VERSION }] });
  try { assert.equal(o.koer([SERVER_VERSION], { ...OIDC, REGISTRY_SERVER_JSON: sj.f }).status, 0); } finally { o.ryd(); sj.ryd(); }
});

test('registry-udgiv: testoverstyringen REGISTRY_SERVER_JSON maa ikke bruges med --ship (validering og publicering skal vaere samme fil)', { skip: POSIX }, () => {
  const o = opsaet(); const sj = falskServerJson({ name: NAVN, version: SERVER_VERSION, packages: [{ version: SERVER_VERSION }] });
  try {
    const r = o.koer([SERVER_VERSION, '--ship'], { ...OIDC, REGISTRY_SERVER_JSON: sj.f });
    assert.notEqual(r.status, 0, 'overstyringen blev accepteret ved en rigtig udgivelse');
    assert.deepEqual(o.kald(), []);
  } finally { o.ryd(); sj.ryd(); }
});

// Maalt 1/10: det aegte register har en koldstart paa op til 27 s (foerste opslag), derefter ~1 s.
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
test('registry-udgiv: opslagets frist er mindst 45 s, og pollingen har et samlet budget der passer i jobbet (15 min)', { skip: POSIX }, () => {
  const kilde = readFileSync(script, 'utf8');
  const m = kilde.match(/--max-time (\d+)/);
  assert.ok(m && Number(m[1]) >= 45, `fristen er ${m ? m[1] : 'ukendt'} s - for kort til registrets koldstart`);
  const b = kilde.match(/REGISTRY_BUDGET:-(\d+)/);
  assert.ok(b && Number(b[1]) <= 300, `pollingens samlede budget er ${b ? b[1] : 'ukendt'} s`);
  const wf = readFileSync(join(rod, '.github/workflows/udgivelse.yml'), 'utf8');
  const jobTid = Number(wf.slice(wf.indexOf('\n  registry:')).match(/timeout-minutes:\s*(\d+)/)[1]) * 60;
  // foerste opslag (3 x 45 s + pauser) + budget + installation/publicering skal rummes af jobbets grænse
  assert.ok(3 * 45 + 2 * 3 + Number(b[1]) + 120 < jobTid, `${3 * 45 + Number(b[1]) + 126} s kan ikke rummes af jobbets ${jobTid} s`);
});

test('registry-udgiv: ukendte argumenter afvises', { skip: POSIX }, () => {
  for (const args of [[SERVER_VERSION, '--typo'], [SERVER_VERSION, '--typo', '--ship'], [SERVER_VERSION, '--ship', '--ekstra']]) {
    const o = opsaet();
    try { assert.notEqual(o.koer(args, OIDC).status, 0, `${args.join(' ')} blev accepteret`); } finally { o.ryd(); }
  }
});
