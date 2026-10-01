/**
 * Udgivelsesjobbets hemmeligheder maa ikke vaere synlige for uafproevet kode (Astra + Opus-agent, 1/10-2026).
 *
 * Udgivelsesjobbet har butikkens fem CWS_*-hemmeligheder, adgang til at hente et OIDC-token (kan udstede npm- og
 * register-tokens) og et skrivbart GITHUB_TOKEN i miljoeet. Tre steder koerer kode som IKKE er laast til det vi har
 * revideret, mens det miljoe er til stede:
 *   1. pakketjekket: `npm install` af den udpakkede tarball opsloeser afhaengighederne efter INTERVAL paa
 *      udgivelsesdagen (tarballen indeholder ingen laasefil) og koerer deres installationsscripts;
 *   2. pakke-roegtesten starter den pakke med hele det arvede miljoe (`...process.env`);
 *   3. det kolde `npx -y` efter npm-udgivelsen opsloeser igen efter interval, med hele miljoeet.
 * Her: (1) installerer fra repoets egen laasefil uden scripts, (2) faar et tomt miljoe, (3) koeres med `env -i`.
 *
 * Ikke en isolationsgraense: kompromitteret kode paa SAMME runner kan stadig laese filer. Den fulde loesning er
 * et separat job uden hemmeligheder (backlog 1.30.2). Dette fjerner den billige vej: opportunistisk laesning af
 * miljoevariabler og uvist opsloeste afhaengighedsversioner paa udgivelsesdagen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const POSIX = process.platform === 'win32' && 'runbrowsermcpupdate.sh koerer kun paa macOS/Linux';
const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const roegtest = join(rod, 'scripts/pakke-roegtest.mjs');
const script = () => readFileSync(join(rod, 'runbrowsermcpupdate.sh'), 'utf8');

const HEMMELIGHEDER = {
  CWS_CLIENT_ID: 'h-cid', CWS_CLIENT_SECRET: 'h-sec', CWS_REFRESH_TOKEN: 'h-ref', CWS_EXTENSION_ID: 'h-ext', CWS_PUBLISHER_ID: 'h-pub',
  ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'h-oidc', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://h.example/oidc',
  GH_TOKEN: 'h-gh', GITHUB_TOKEN: 'h-gh2', NODE_AUTH_TOKEN: 'h-npm', NPM_TOKEN: 'h-npm2',
};

/** En falsk pakke der svarer paa initialize og lader serverInfo.version baere de hemmeligheder den kan SE. */
function pakkeDerRapporterer() {
  const d = mkdtempSync(join(tmpdir(), 'isolation-pakke-'));
  mkdirSync(join(d, 'bin'));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(d, 'bin/cli.js'), `
process.stdin.setEncoding('utf8');
let buf = '';
process.stdin.on('data', (c) => {
  buf += c;
  const i = buf.indexOf('\\n');
  if (i < 0) return;
  const m = JSON.parse(buf.slice(0, i));
  const set = Object.keys(process.env).filter((k) => /^(CWS_|ACTIONS_ID_TOKEN|GH_TOKEN|GITHUB_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN)/.test(k));
  const result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: 'ser=' + JSON.stringify(set) } };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});
setInterval(() => {}, 1000);
`);
  return d;
}

test('pakke-roegtesten giver den afproevede pakke et miljoe UDEN udgivelsens hemmeligheder', () => {
  const d = pakkeDerRapporterer();
  try {
    const r = spawnSync(process.execPath, [roegtest, d], {
      encoding: 'utf8', timeout: 40000,
      env: { ...process.env, ...HEMMELIGHEDER, PAKKE_ROEGTEST_FRIST_MS: '15000' },
    });
    assert.equal(r.status, 0, `roegtesten fejlede (proeven maaler ikke noget): ${r.stderr}`);
    assert.match(r.stdout, /agent360-browser/, 'roegtesten printede ikke serverens svar - proeven kan ikke se hvad pakken saa');
    assert.match(r.stdout, /ser=\[\]/, `pakken kunne SE hemmeligheder i sit miljoe: ${r.stdout.trim()}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('modsat: roegtesten giver stadig pakken det den har brug for (PATH, eget HOME)', () => {
  // Kalibrering: en vagt der fjerner ALT, ville ogsaa fjerne HOME/PATH og faelde enhver pakke.
  const d = pakkeDerRapporterer();
  try {
    const r = spawnSync(process.execPath, [roegtest, d], { encoding: 'utf8', timeout: 40000,
      env: { ...process.env, PAKKE_ROEGTEST_FRIST_MS: '15000' } });
    assert.equal(r.status, 0, `en ren pakke blev afvist: ${r.stderr}`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── pakketjekkets installation ─────────────────────────────────────────────

/** Udtrækker pakke-blokken fra det aegte script og koerer den med en stub-npm der logger sine kald. */
function koerPakkeBlok() {
  const s = script();
  const start = s.indexOf('step "2. Pakke-tjek');
  assert.ok(start > -1, 'pakke-blokken blev ikke fundet i release-scriptet');
  const slut = s.indexOf('rm -rf "$SMOKE_DIR"', start);
  assert.ok(slut > -1, 'pakke-blokkens slutning blev ikke fundet');
  // blokken er nu `if [[ "$SKIP_PACK" == 1 ]]; then ... else { ... }; fi`: slut efter den afsluttende `fi`
  const blok = s.slice(start, s.indexOf('\nfi\n', slut) + 3);

  const arbejde = mkdtempSync(join(tmpdir(), 'isolation-blok-'));
  // en falsk repo-rod med en laasefil og en falsk pakke der kan svare paa initialize
  const repo = join(arbejde, 'repo'); mkdirSync(join(repo, 'mcp-server'), { recursive: true });
  writeFileSync(join(repo, 'mcp-server/package-lock.json'), '{"lockfileVersion":3,"LAAST":true}');
  const forside = pakkeDerRapporterer();
  const tarMappe = join(arbejde, 'tarmappe'); mkdirSync(tarMappe);
  cpSync(forside, join(tarMappe, 'package'), { recursive: true });
  // stub-npm: `pack` laver en tarball af den falske pakke; alt andet logges
  const stubs = join(arbejde, 'stubs'); mkdirSync(stubs);
  const log = join(arbejde, 'npm.log');
  writeFileSync(join(stubs, 'npm'), `#!/bin/sh
echo "$@" >> "${log}"
if [ "$1" = "pack" ]; then
  while [ $# -gt 0 ]; do [ "$1" = "--pack-destination" ] && dest="$2"; shift; done
  tar czf "$dest/agent360-browser-mcp-9.9.9.tgz" -C "${tarMappe}" package
fi
if [ "$1" = "ci" ] || [ "$1" = "install" ]; then
  [ -f package-lock.json ] && echo "LAASEFIL_TIL_STEDE: $(cat package-lock.json)" >> "${log}" || echo "INGEN_LAASEFIL" >> "${log}"
fi
exit 0
`);
  chmodSync(join(stubs, 'npm'), 0o755);
  const r = spawnSync('bash', ['-c', `set -u
step() { :; }; ok() { echo "OK: $*"; }; die() { echo "DIE: $*"; exit 1; }; warn() { echo "WARN: $*"; }
SKIP_PACK=0
REPO_ROOT="${repo.replace(/"/g, '\\"')}"
cp "${roegtest}" /dev/null
REPO_ROOT_SCRIPTS="${rod}"
${blok.replace('"$REPO_ROOT/scripts/pakke-roegtest.mjs"', `"${roegtest}"`)}
`], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PATH: `${stubs}:${process.env.PATH}`, PAKKE_ROEGTEST_FRIST_MS: '15000' } });
  const npmLog = existsSync(log) ? readFileSync(log, 'utf8') : '';
  return { r, npmLog, ryd: () => { rmSync(arbejde, { recursive: true, force: true }); rmSync(forside, { recursive: true, force: true }); } };
}

test('pakketjekket installerer fra repoets egen laasefil, med npm ci og uden installationsscripts', { skip: POSIX }, () => {
  const k = koerPakkeBlok();
  try {
    assert.match(k.r.stdout, /OK: tarballen starter og svarer paa initialize/, `blokken naaede ikke i mål (proeven maaler ikke noget): ${k.r.stdout} ${k.r.stderr}`);
    const kald = k.npmLog.split('\n').filter(Boolean);
    const installer = kald.find((l) => /^(ci|install)\b/.test(l));
    assert.ok(installer, `ingen installation blev kaldt: ${k.npmLog}`);
    assert.match(installer, /^ci\b/, `tarballen installeres med «${installer.split(' ')[0]}», ikke «npm ci»: afhaengighederne opsloeses efter interval paa udgivelsesdagen`);
    assert.match(installer, /--ignore-scripts/, 'afhaengighedernes installationsscripts koerer med hemmeligheder i miljoeet');
    assert.match(k.npmLog, /LAASEFIL_TIL_STEDE: .*LAAST/, 'repoets laasefil blev ikke kopieret ind i den udpakkede pakke foer installationen');
  } finally { k.ryd(); }
});

// ── det kolde npx-tjek ─────────────────────────────────────────────────────

test('det kolde npx-tjek koeres med tomt miljoe (env -i), ikke med udgivelsens hemmeligheder', { skip: POSIX }, () => {
  const s = script();
  const linjer = s.split('\n');
  const i = linjer.findIndex((l) => /npx -y "@agent360\/browser-mcp@\$\{NEW_VERSION\}"/.test(l));
  assert.ok(i > -1, 'det kolde npx-kald blev ikke fundet');
  // kaldet staar efter en pipe; kommandoen starter paa linjen foer eller paa samme linje
  const omkring = linjer.slice(Math.max(0, i - 1), i + 1).join('\n');
  assert.match(omkring, /env -i /, `det kolde npx-tjek arver hele miljoeet (OIDC-adgang, GH_TOKEN, CWS_*): ${omkring}`);
  assert.match(omkring, /HOME="\$KOLD_HJEM"/, 'det kolde tjek faar ikke sit eget friske hjem');
  assert.match(omkring, /PATH="\$PATH"/, 'env -i fjerner PATH, saa npx ikke kan findes - vagten er for streng');
});

// ═══════════════════════════════════════════════════════════════════════════
// Fuld adskillelse (Astra runde 3, 1/10): tests, pakkekørsel og kold pakkekørsel ligger i job UDEN udgivelsesrettigheder.
// Det privilegerede job (`udgiv`) har contents:write + id-token:write; afhængighedskode der kører dér, kan hente et OIDC-token og
// udgive en ondsindet version med ægte provenance. Derfor kører ingen afhængighedskode i `udgiv`.
// ═══════════════════════════════════════════════════════════════════════════

const workflow = () => readFileSync(join(rod, '.github/workflows/udgivelse.yml'), 'utf8');
/** Teksten for ét job: fra «  navn:» til næste job på samme niveau (eller filens slutning). */
function job(navn) {
  const t = workflow();
  const m = t.match(new RegExp(`^  ${navn}:\\n[\\s\\S]*?(?=^  [a-z][a-z0-9_-]*:\\n|(?![\\s\\S]))`, 'm'));
  assert.ok(m, `jobbet «${navn}» findes ikke i udgivelses-workflowet`);
  // ⛔ kun rigtige trin: en kommentar der FORKLARER hvorfor `npm ci` er udtaget, maa ikke faelde proeven om at der ingen npm ci er
  return m[0].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
}

test('workflow: «kandidat» koerer tests og pakketjek UDEN rettigheder, token eller miljoe', () => {
  const j = job('kandidat');
  assert.match(j, /needs:\s*spaerre/);
  assert.match(j, /permissions:\s*\n\s+contents: read/, 'kandidat-jobbet har ikke «contents: read»');
  assert.doesNotMatch(j, /id-token|contents: write/, 'kandidat-jobbet har udgivelsesrettigheder: tests ville koere med dem');
  assert.doesNotMatch(j, /environment:/, 'kandidat-jobbet har et miljoe (og dermed butikkens noegler)');
  assert.doesNotMatch(j, /secrets\./, 'kandidat-jobbet faar hemmeligheder');
  assert.match(j, /persist-credentials: false/, 'checkout efterlader et skrivbart token i .git/config');
  assert.match(j, /runbrowsermcpupdate\.sh/);
  assert.doesNotMatch(j, /--ship/, 'kandidat-jobbet maa aldrig udgive');
  assert.doesNotMatch(j, /brew install/, 'kandidat-jobbet henter en ufastlaast tredjepartsbinaer');
});

// Astra runde 4 (1/10): scriptets gate() ADVARER kun uden --ship, saa en fejlet testsuite lod kandidat-jobbet vaere groent. Testsuiten
// er derfor sit EGET trin hvis exitkode er jobbets resultat, og scriptet faar --skip-tests.
test('workflow: testsuiten er et eget obligatorisk trin i «kandidat» (exitkoden ER jobbets resultat)', () => {
  const j = job('kandidat');
  const trin = j.split(/\n      - /).find((t) => /npm (--prefix mcp-server )?test/.test(t));
  assert.ok(trin, 'kandidat-jobbet har intet selvstaendigt testtrin: en fejlet testsuite kan give et groent job');
  assert.doesNotMatch(trin, /continue-on-error|\|\|\s*true|if:/, `testtrinnet kan ignoreres: ${trin}`);
  const scriptTrin = j.split(/\n      - /).find((t) => /runbrowsermcpupdate\.sh/.test(t));
  assert.match(scriptTrin, /--skip-tests/, 'scriptet koerer testene en gang til (og dets gate() advarer kun)');
});

// Astra runde 4: --genoptag uden --ship afvises af scriptet, saa genoptagelse kunne ikke passere kandidat-jobbet.
test('workflow: genoptagelse passerer «kandidat» (testene koerer, scriptet koeres ikke med --genoptag uden --ship)', () => {
  const j = job('kandidat');
  const scriptTrin = j.split(/\n      - /).find((t) => /runbrowsermcpupdate\.sh/.test(t));
  assert.doesNotMatch(scriptTrin, /--genoptag/, 'kandidat sender --genoptag uden --ship, og scriptet afviser det');
  assert.match(scriptTrin, /if:\s*\$\{\{\s*!inputs\.genoptag\s*\}\}/, 'scriptet springes ikke over ved genoptagelse');
  const sha = j.match(/outputs:\s*\n\s+sha:/);
  assert.ok(sha, 'kandidat melder ikke hvilken commit den testede (genoptagelse kan ikke bindes til den)');
});

test('workflow: «udgiv» venter paa kandidaten, koerer INGEN afhaengighedskode, ingen npm ci og ingen ufastlaast binaer', () => {
  const j = job('udgiv');
  assert.match(j, /needs:\s*\[\s*spaerre,\s*kandidat\s*\]/, 'udgiv venter ikke paa kandidat-jobbet');
  for (const flag of ['--skip-tests', '--skip-pack', '--skip-cold', '--registry-eget-job']) assert.match(j, new RegExp(flag), `udgiv-jobbet sender ikke ${flag}`);
  assert.match(j, /UDGIVELSE_ISOLERET:\s*'?1'?/, 'udgiv-jobbet siger ikke at de tunge tjek koerte isoleret');
  assert.doesNotMatch(j, /npm ci|npm install --prefix/, 'udgiv-jobbet installerer afhaengigheder med udgivelsesrettighederne');
  assert.doesNotMatch(j, /brew install/, 'udgiv-jobbet henter en ufastlaast tredjepartsbinaer med udgivelsesrettighederne (Astra runde 4)');
  assert.match(j, /id-token: write/, 'kalibrering: udgiv-jobbet SKAL stadig have id-token (ellers kan det ikke udgive)');
  assert.match(j, /ref:.*needs\.kandidat\.outputs\.sha/, 'ved genoptagelse tjekker udgiv ikke den commit kandidat testede ud');
});

test('workflow: «efter» koerer det kolde tjek UDEN rettigheder, kun ved en rigtig udgivelse', () => {
  const j = job('efter');
  assert.match(j, /needs:\s*\[\s*kandidat,\s*udgiv\s*\]/);
  assert.match(j, /if:.*inputs\.ship/, 'det kolde tjek koerer ogsaa i en proevekoersel');
  assert.match(j, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(j, /id-token|contents: write|secrets\./);
  assert.match(j, /scripts\/koldt-tjek\.sh/);
});

// Astra runde 4: registret laa FOER det kolde tjek efter flytningen. Det er nu et eget job der venter paa det.
test('workflow: «registry» venter paa det kolde tjek, har KUN id-token, og henter mcp-publisher fastlaast med kontrolsum', () => {
  const j = job('registry');
  assert.match(j, /needs:\s*\[\s*kandidat,\s*udgiv,\s*efter\s*\]/, 'registry venter ikke paa det kolde tjek');
  assert.match(j, /needs\.efter\.result\s*==\s*'success'/, 'registry kraever ikke at det kolde tjek er groent ved en rigtig udgivelse');
  assert.match(j, /id-token: write/);
  assert.doesNotMatch(j, /contents: write|secrets\.|environment:/, 'registry-jobbet har skriverettigheder, hemmeligheder eller et miljoe (ekstra godkendelse)');
  assert.doesNotMatch(j, /brew install/, 'registry henter mcp-publisher uden fast version');
  assert.match(j, /shasum -a 256 -c/, 'mcp-publisher verificeres ikke mod en kontrolsum');
  assert.match(j, /mcp-publisher[^\n]*1\.8\.1|VER=1\.8\.1/, 'mcp-publisher er ikke fastlaast til en version');
  assert.match(j, /scripts\/registry-udgiv\.sh/);
});

test('workflow: tredjeparts-actions i de privilegerede job er fastlaast til commit-id, ikke flytbare tags', () => {
  for (const navn of ['udgiv', 'registry']) {
    const j = job(navn);
    const uses = [...j.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(uses.length > 0, `${navn}: ingen uses`);
    for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${navn}: «${u}» er et flytbart tag, ikke et commit-id`);
  }
});

// ── vagten: skip-flagene maa kun bruges i den isolerede udgivelse ───────────

function koerVagt(args, miljoe = {}) {
  const s = script();
  const a = s.indexOf('# <<ISOLERET-VAGT');
  const b = s.indexOf('# ISOLERET-VAGT>>');
  assert.ok(a > -1 && b > a, 'vagt-blokken (# <<ISOLERET-VAGT ... # ISOLERET-VAGT>>) findes ikke i scriptet');
  const blok = s.slice(a, b);
  const r = spawnSync('bash', ['-c', `set -u
die() { echo "DIE: $*"; exit 7; }
SHIP=0; SKIP_TESTS=0; SKIP_PACK=0; SKIP_COLD=0; REGISTRY_EGET_JOB=0
for arg in "$@"; do case "$arg" in --ship) SHIP=1 ;; --skip-tests) SKIP_TESTS=1 ;; --skip-pack) SKIP_PACK=1 ;; --skip-cold) SKIP_COLD=1 ;; --registry-eget-job) REGISTRY_EGET_JOB=1 ;; esac; done
${blok}
echo "PASSERET tests=$SKIP_TESTS pack=$SKIP_PACK cold=$SKIP_COLD cws_skip=\${CWS_SKIP_TESTS:-}"`, '_', ...args],
  { encoding: 'utf8', env: { PATH: process.env.PATH, ...miljoe } });
  return r;
}

test('vagten: en rigtig udgivelse maa ikke springe tests/pakke/kold over uden den isolerede workflow', { skip: POSIX }, () => {
  for (const flag of ['--skip-tests', '--skip-pack', '--skip-cold', '--registry-eget-job']) {
    const r = koerVagt(['--ship', flag]);
    assert.equal(r.status, 7, `${flag} i en rigtig udgivelse uden UDGIVELSE_ISOLERET slap igennem: ${r.stdout}`);
    assert.match(r.stdout, /DIE:.*UDGIVELSE_ISOLERET/);
  }
});

test('vagten (modsat): med UDGIVELSE_ISOLERET=1, og i en proevekoersel, maa flagene bruges', { skip: POSIX }, () => {
  const a = koerVagt(['--ship', '--skip-tests', '--skip-pack', '--skip-cold', '--registry-eget-job'], { UDGIVELSE_ISOLERET: '1' });
  assert.equal(a.status, 0, `den isolerede udgivelse blev afvist: ${a.stdout}`);
  assert.match(a.stdout, /tests=1 pack=1 cold=1/);
  const b = koerVagt(['--skip-tests', '--skip-pack']);
  assert.equal(b.status, 0, `en proevekoersel blev afvist: ${b.stdout}`);
  const c = koerVagt(['--ship']);
  assert.equal(c.status, 0, `en almindelig udgivelse (uden flag) blev afvist: ${c.stdout}`);
});

test('vagten: --skip-tests faar butiksscriptet til ikke at koere testene en gang til', { skip: POSIX }, () => {
  const r = koerVagt(['--skip-tests'], { UDGIVELSE_ISOLERET: '1' });
  assert.match(r.stdout, /cws_skip=1/, 'CWS_SKIP_TESTS blev ikke sat: butiksscriptet koerer testene igen i det privilegerede job');
  const cws = readFileSync(join(rod, 'scripts/publish-cws.sh'), 'utf8');
  assert.match(cws, /CWS_SKIP_TESTS:-\}"\s*==\s*"?1"?/, 'publish-cws.sh respekterer ikke CWS_SKIP_TESTS');
});

// ── det kolde tjek som eget script ─────────────────────────────────────────

/** Et svar som serveren faktisk sender (maalt 1/10: serverInfo.version er pakkens version). */
const GYLDIGT = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } } });

function koldt(npxKilde, miljoe = {}) {
  const d = mkdtempSync(join(tmpdir(), 'isolation-koldt-'));
  const stubs = join(d, 'stubs'); mkdirSync(stubs);
  const miljoeFil = join(d, 'npx-miljoe.txt');
  writeFileSync(join(stubs, 'npx'), `#!/bin/sh\ncat >/dev/null\nenv | sed 's/=.*//' > "${miljoeFil}"\n${npxKilde}\n`);
  chmodSync(join(stubs, 'npx'), 0o755);
  const r = spawnSync('bash', [join(rod, 'scripts/koldt-tjek.sh'), '9.9.9'], { encoding: 'utf8', timeout: 60000,
    env: { PATH: `${stubs}:${process.env.PATH}`, HOME: process.env.HOME, KOLDT_PAUSE: '0', ...miljoe } });
  const set = existsSync(miljoeFil) ? readFileSync(miljoeFil, 'utf8') : '';
  return { r, set, ryd: () => rmSync(d, { recursive: true, force: true }) };
}

test('koldt-tjek.sh: et gyldigt svar godkendes, og npx ser INGEN af udgivelsens hemmeligheder', { skip: POSIX }, () => {
  const k = koldt(`echo '${GYLDIGT}'`, HEMMELIGHEDER);
  try {
    assert.equal(k.r.status, 0, `et gyldigt svar blev afvist: ${k.r.stdout} ${k.r.stderr}`);
    assert.ok(k.set.length > 0, 'npx-stubben optog ikke sit miljoe - proeven kan ikke maale noget');
    for (const nokkel of Object.keys(HEMMELIGHEDER)) assert.doesNotMatch(k.set, new RegExp(`^${nokkel}$`, 'm'), `npx saa ${nokkel}`);
    assert.match(k.set, /^npm_config_ignore_scripts$/m, 'installationsscripts er ikke slaaet fra');
  } finally { k.ryd(); }
});

test('koldt-tjek.sh (modsat): en pakke der ikke svarer afvises efter alle forsoeg', { skip: POSIX }, () => {
  const k = koldt('echo "ikke json"');
  try { assert.notEqual(k.r.status, 0, 'en pakke der ikke svarede blev godkendt'); } finally { k.ryd(); }
});

// Astra runde 4 (1/10): to substring-kontroller paa foerste linje godkendte ugyldig JSON, fejlsvar, forkert version og forkert id.
const forkert = (andet) => JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' }, ...andet } });
const AFVISES = {
  'forkert version (0.0.0)': JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '0.0.0' } } }),
  'JSON-RPC-fejl med de samme ord': JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'initialize fejlede', data: { serverInfo: { name: 'agent360-browser' } } } }),
  'ugyldig JSON med markoererne': '{"serverInfo": agent360-browser',
  'forkert request-id': JSON.stringify({ jsonrpc: '2.0', id: 2, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } } }),
  'manglende protocolVersion': JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } } }),
  'en anden server': JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'noget-andet', version: '9.9.9' } } }),
};
for (const [navn, svar] of Object.entries(AFVISES)) {
  test(`koldt-tjek.sh: afviser «${navn}» (kraever et rigtigt MCP-svar, ikke to ord)`, { skip: POSIX }, () => {
    const k = koldt(`echo '${svar.replace(/'/g, "'\\''")}'`);
    try { assert.notEqual(k.r.status, 0, `blev godkendt: ${svar}`); } finally { k.ryd(); }
  });
}
test('koldt-tjek.sh (modsat): et fuldt og rigtigt svar godkendes stadig', { skip: POSIX }, () => {
  const k = koldt(`echo '${forkert({})}'`);
  try { assert.equal(k.r.status, 0, `${k.r.stdout} ${k.r.stderr}`); } finally { k.ryd(); }
});
