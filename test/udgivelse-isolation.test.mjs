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
  writeFileSync(join(stubs, 'npx'), `#!/bin/sh\nread -r _\nenv | sed 's/=.*//' > "${miljoeFil}"\n${npxKilde}\n`);
  chmodSync(join(stubs, 'npx'), 0o755);
  const r = spawnSync('bash', [join(rod, 'scripts/koldt-tjek.sh'), '9.9.9'], { encoding: 'utf8', timeout: 60000,
    env: { PATH: `${stubs}:${process.env.PATH}`, HOME: process.env.HOME, KOLDT_PAUSE: '0', KOLDT_EFTERTID_MS: '300', KOLDT_FRIST_MS: '4000', ...miljoe } });
  const set = existsSync(miljoeFil) ? readFileSync(miljoeFil, 'utf8') : '';
  return { r, set, ryd: () => rmSync(d, { recursive: true, force: true }) };
}

test('koldt-tjek.sh: et gyldigt svar godkendes, og npx ser INGEN af udgivelsens hemmeligheder', { skip: POSIX }, () => {
  const k = koldt(`echo '${GYLDIGT}'\nsleep 3`, HEMMELIGHEDER);
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
  const k = koldt(`echo '${forkert({})}'\nsleep 3`);
  try { assert.equal(k.r.status, 0, `${k.r.stdout} ${k.r.stderr}`); } finally { k.ryd(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Astra runde 5 (1/10): «kandidat» har hverken npm-token eller id-token, men scriptets trin 5 havde et UBETINGET
// `die "NPM_TOKEN missing"` - ogsaa i proevetilstand. Hver normal proevekoersel af en ny version ville dermed doe i kandidat-jobbet.
// ═══════════════════════════════════════════════════════════════════════════

function koerNpmBlok({ ship, oidc = false, token = false, publiceret = false }) {
  const s = script();
  const a = s.indexOf('step "5. npm publish');
  const b = s.indexOf('# ── 2b. MCP registry');
  assert.ok(a > -1 && b > a, 'npm-blokken (trin 5) findes ikke i scriptet');
  const d = mkdtempSync(join(tmpdir(), 'isolation-npm-'));
  const stubs = join(d, 'stubs'); mkdirSync(stubs);
  writeFileSync(join(stubs, 'npm'), `#!/bin/sh\nif [ "$1" = view ]; then ${publiceret ? 'echo 9.9.9' : 'true'}; fi\nexit 0\n`);
  chmodSync(join(stubs, 'npm'), 0o755);
  const r = spawnSync('bash', ['-c', `set -u
step() { :; }; warn() { echo "WARN: $*"; }; die() { echo "DIE: $*"; exit 7; }; say() { echo "SAY: $*"; }; run() { echo "RUN: $*"; }
SKIP_NPM=0; NEW_VERSION=9.9.9; REPO_ROOT=/x; SHIP=${ship ? 1 : 0}; NPM_VIA_OIDC=${oidc ? 1 : 0}
${token ? 'NPM_TOKEN=tok' : ''}
${s.slice(a, b)}
echo SLUT`], { encoding: 'utf8', env: { PATH: `${stubs}:${process.env.PATH}`, HOME: process.env.HOME } });
  rmSync(d, { recursive: true, force: true });
  return r;
}

test('trin 5: en PROEVEkoersel af en ny version dør ikke af manglende npm-legitimation (kandidat-jobbet har ingen)', { skip: POSIX }, () => {
  const r = koerNpmBlok({ ship: false });
  assert.equal(r.status, 0, `en proevekoersel uden npm-token stoppede: ${r.stdout}`);
  assert.match(r.stdout, /RUN: .*npm publish/, 'proevekoerslen beskriver ikke hvad npm-udgivelsen ville goere');
  assert.match(r.stdout, /SLUT/);
});

test('trin 5 (modsat): en RIGTIG udgivelse uden npm-legitimation stopper stadig foer noget udgives', { skip: POSIX }, () => {
  const r = koerNpmBlok({ ship: true });
  assert.equal(r.status, 7, `en rigtig udgivelse uden token slap igennem: ${r.stdout}`);
  assert.match(r.stdout, /DIE: NPM_TOKEN missing/);
  assert.ok(!/RUN:/.test(r.stdout), 'npm publish blev forsoegt uden legitimation');
});

test('trin 5 (modsat): rigtig udgivelse via OIDC udgiver med provenance; med NPM_TOKEN bruges tokenet; allerede udgivet springes over', { skip: POSIX }, () => {
  const oidc = koerNpmBlok({ ship: true, oidc: true });
  assert.equal(oidc.status, 0, oidc.stdout);
  assert.match(oidc.stdout, /RUN: .*--provenance/);
  const tok = koerNpmBlok({ ship: true, token: true });
  assert.equal(tok.status, 0, tok.stdout);
  assert.match(tok.stdout, /RUN: .*_authToken/);
  const dobbelt = koerNpmBlok({ ship: true, publiceret: true });
  assert.equal(dobbelt.status, 0, dobbelt.stdout);
  assert.match(dobbelt.stdout, /already on npm/);
  assert.ok(!/RUN:/.test(dobbelt.stdout));
});

// ── Astra runde 5: svar-og-nedbrud, procestræets frist, stoejen foer svaret, og en strammere validering ──────────────

const STRENGE = {
  'jsonrpc er ikke 2.0': JSON.stringify({ jsonrpc: 'garbage', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } } }),
  'error: null ved siden af result': JSON.stringify({ jsonrpc: '2.0', id: 1, error: null, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } } }),
  'capabilities.tools er en liste': JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: [] }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } } }),
  'protocolVersion er ikke en dato': JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: 'bogus', capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } } }),
};
for (const [navn, svar] of Object.entries(STRENGE)) {
  test(`koldt-tjek.sh: afviser «${navn}»`, { skip: POSIX }, () => {
    const k = koldt(`echo '${svar.replace(/'/g, "'\\''")}'\nsleep 3`);
    try { assert.notEqual(k.r.status, 0, `blev godkendt: ${svar}`); } finally { k.ryd(); }
  });
}

test('koldt-tjek.sh: et korrekt svar efterfulgt af et NEDBRUD er ikke groent (pakken skal blive i live)', { skip: POSIX }, () => {
  const k = koldt(`echo '${GYLDIGT}'\nexit 42`);
  try {
    assert.notEqual(k.r.status, 0, `en pakke der svarede og straks stoppede blev godkendt: ${k.r.stdout}`);
    assert.match(k.r.stdout, /stoppede/i, 'fejlen siger ikke at pakken stoppede lige efter sit svar');
  } finally { k.ryd(); }
});

test('koldt-tjek.sh: en JSON-RPC-notifikation foer svaret er tilladt; tekst paa stdout er det ikke', { skip: POSIX }, () => {
  const notifikation = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } });
  const a = koldt(`echo '${notifikation}'\necho '${GYLDIGT}'\nsleep 3`);
  const b = koldt(`echo 'velkommen til serveren'\necho '${GYLDIGT}'\nsleep 3`);
  try {
    assert.equal(a.r.status, 0, `en lovlig notifikation foer svaret blev afvist: ${a.r.stdout}`);
    assert.notEqual(b.r.status, 0, 'almindelig tekst paa stdout (ikke MCP) blev godkendt');
  } finally { a.ryd(); b.ryd(); }
});

test('koldt-tjek.sh: fristen gaelder hele procesgruppen - et barnebarn der holder stdout aaben overlever ikke (ALLE forsoeg)', { skip: POSIX }, () => {
  const pidFil = join(tmpdir(), `koldt-barnebarn-${process.pid}-${Date.now()}.pid`);
  // npx-stubben starter en baggrundsproces der arver stdout og aldrig svarer; foer fristen holdt den roeret aabent til den doede selv
  const t0 = Date.now(); // ⛔ Astra runde 6: starttiden stod EFTER det synkrone kald, saa proeven maalte intet
  const k = koldt(`sleep 30 &\necho $! >> "${pidFil}"\nwait`);
  try {
    const brugt = Date.now() - t0;
    assert.notEqual(k.r.status, 0);
    assert.ok(brugt < 45000, `fristen holdt ikke: ${brugt / 1000} s for seks forsoeg a 4 s`);
    assert.ok(existsSync(pidFil), 'stubben startede ikke sit barnebarn - proeven maaler intet');
    const pids = readFileSync(pidFil, 'utf8').split('\n').filter(Boolean).map(Number);
    assert.equal(pids.length, 6, `forventede ét barnebarn pr. forsoeg, fik ${pids.length}`);
    const levende = pids.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
    assert.deepEqual(levende, [], `barnebarn lever stadig efter fristen: ${levende}`);
  } finally { k.ryd(); rmSync(pidFil, { force: true }); }
});

// ── Astra runde 6 (1/10): frist tæt paa graensen, afkortet diagnostik, afbrydelse, MCP-livscyklus ──────────────────────

test('koldt-tjek.sh: et svar tæt paa fristen afvises ikke (svartimeren afmeldes ved et gyldigt svar)', { skip: POSIX }, () => {
  const k = koldt(`sleep 1.2\necho '${GYLDIGT}'\nsleep 5`, { KOLDT_FRIST_MS: '1500', KOLDT_EFTERTID_MS: '600' });
  try { assert.equal(k.r.status, 0, `et gyldigt svar efter 1,2 s af 1,5 s blev afvist: ${k.r.stdout}`); } finally { k.ryd(); }
});

test('koldt-tjek.sh: en stor stderr-udskrift afkorter ikke diagnostikken (slutmarkoeren naar frem)', { skip: POSIX }, () => {
  const k = koldt(`head -c 600000 /dev/zero | tr '\\0' 'x' >&2\necho >&2\necho SLUTMARKOER-FRA-NPX >&2\nexit 1`);
  try {
    assert.notEqual(k.r.status, 0);
    assert.match(k.r.stdout, /SLUTMARKOER-FRA-NPX/, 'diagnostikken blev afkortet af process.exit() foer den var skrevet');
  } finally { k.ryd(); }
});

test('koldt-tjek.sh: et lovligt server-ping foer svaret afvises ikke; en notifikation med forkert jsonrpc gør', { skip: POSIX }, () => {
  const ping = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' });
  const brudt = JSON.stringify({ jsonrpc: 'broken', method: 'not-a-real-notification' });
  const a = koldt(`echo '${ping}'\necho '${GYLDIGT}'\nsleep 3`);
  const b = koldt(`echo '${brudt}'\necho '${GYLDIGT}'\nsleep 3`);
  try {
    assert.equal(a.r.status, 0, `et lovligt ping foer svaret blev afvist: ${a.r.stdout}`);
    assert.notEqual(b.r.status, 0, 'en notifikation med jsonrpc «broken» blev godkendt');
  } finally { a.ryd(); b.ryd(); }
});

test('koldt-tjek.sh: tekst paa stdout EFTER svaret er ogsaa en fejl (kontrollen stopper ikke ved det foerste svar)', { skip: POSIX }, () => {
  const k = koldt(`echo '${GYLDIGT}'\nsleep 0.1\necho 'ikke json efter svaret'\nsleep 3`, { KOLDT_EFTERTID_MS: '1000' });
  try { assert.notEqual(k.r.status, 0, 'stoej efter svaret blev godkendt'); } finally { k.ryd(); }
});

for (const pv of ['9999-99-99', '2026-01-01']) {
  test(`koldt-tjek.sh: protocolVersion ${pv} er ikke en MCP-version vi taler (eksplicit liste)`, { skip: POSIX }, () => {
    const svar = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: pv, capabilities: { tools: {} }, serverInfo: { name: 'agent360-browser', version: '9.9.9' } } });
    const k = koldt(`echo '${svar}'\nsleep 3`);
    try { assert.notEqual(k.r.status, 0, `${pv} blev godkendt`); } finally { k.ryd(); }
  });
}

test('koldt-tjek.sh: klienten sender notifications/initialized, og en server der doer paa den fanges', { skip: POSIX }, () => {
  const dod = koldt(`echo '${GYLDIGT}'\nread -r _\nexit 42`);
  const levende = koldt(`echo '${GYLDIGT}'\nread -r _\nsleep 3`);
  try {
    assert.notEqual(dod.r.status, 0, 'en server der doer paa notifications/initialized blev godkendt');
    assert.equal(levende.r.status, 0, `en server der klarer notifications/initialized blev afvist: ${levende.r.stdout}`);
  } finally { dod.ryd(); levende.ryd(); }
});

test('koldt-forsoeg.mjs: SIGTERM til hjælperen draeber stadig npx-gruppen (ingen forældreløs proces)', { skip: POSIX }, async () => {
  const { spawn } = await import('node:child_process');
  const d = mkdtempSync(join(tmpdir(), 'koldt-sigterm-'));
  const stubs = join(d, 'stubs'); mkdirSync(stubs);
  const pidFil = join(d, 'pid');
  writeFileSync(join(stubs, 'npx'), `#!/bin/sh\nread -r _\nsleep 40 &\necho $! > "${pidFil}"\nwait\n`);
  chmodSync(join(stubs, 'npx'), 0o755);
  const barn = spawn(process.execPath, [join(rod, 'scripts/koldt-forsoeg.mjs'), '9.9.9', d], { env: { PATH: `${stubs}:${process.env.PATH}`, HOME: d, KOLDT_FRIST_MS: '30000' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 50 && !existsSync(pidFil); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(existsSync(pidFil), 'stubben naaede ikke at starte sit barn');
    const pid = Number(readFileSync(pidFil, 'utf8').trim());
    const afsluttet = new Promise((r) => barn.on('exit', r));
    barn.kill('SIGTERM');
    await afsluttet;
    await new Promise((r) => setTimeout(r, 300));
    let lever = true; try { process.kill(pid, 0); } catch { lever = false; }
    assert.equal(lever, false, `npx' barn (pid ${pid}) lever efter SIGTERM til hjælperen`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// Astra runde 6 (1/10): `grep` returnerer 1 naar intet matcher, og med `set -eo pipefail` doede scriptet TAVST paa LATEST_TAG-linjen i et checkout
// uden semver-tags (ingen `tag:none` blev vist). Paa runneren er der tags, men forudsaetningen var implicit.
test('LATEST_TAG: et checkout uden semver-tags stopper ikke scriptet tavst', { skip: POSIX }, () => {
  const linje = script().split('\n').find((l) => l.startsWith('LATEST_TAG='));
  assert.ok(linje, 'LATEST_TAG-linjen findes ikke');
  const d = mkdtempSync(join(tmpdir(), 'isolation-tags-'));
  try {
    const r = spawnSync('bash', ['-c', `set -euo pipefail
cd "${d}" && git init -q . && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m x && git tag minetiket
${linje}
echo "LATEST_TAG=[$LATEST_TAG]"`], { encoding: 'utf8' });
    assert.equal(r.status, 0, `scriptet doede paa en tom tagliste: ${r.stdout} ${r.stderr}`);
    assert.match(r.stdout, /LATEST_TAG=\[\]/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
test('LATEST_TAG (modsat): med semver-tags vaelges det hoejeste', { skip: POSIX }, () => {
  const linje = script().split('\n').find((l) => l.startsWith('LATEST_TAG='));
  const d = mkdtempSync(join(tmpdir(), 'isolation-tags-'));
  try {
    const r = spawnSync('bash', ['-c', `set -euo pipefail
cd "${d}" && git init -q . && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m x && git tag v1.9.0 && git tag v1.10.2 && git tag v1.2.0 && git tag noget
${linje}
echo "LATEST_TAG=[$LATEST_TAG]"`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /LATEST_TAG=\[1\.10\.2\]/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// Astra runde 5-6: spaerre og kandidat opløste hver for sig tagget ved genoptagelse. Spaerrens EGEN checkout-commit meldes nu som output
// (workflow_call), og kandidaten stopper hvis den har tjekket en anden commit ud. Billigere end et nyt job, og kæden afprøves allerede i en
// normal proevekoersel (ship=false).
// ═══════════════════════════════════════════════════════════════════════════

const spaerreYml = () => readFileSync(join(rod, '.github/workflows/spaerre.yml'), 'utf8');

test('spaerre.yml melder den commit den faktisk testede som workflow_call-output', () => {
  const t = spaerreYml();
  assert.match(t, /workflow_call:[\s\S]*?outputs:\s*\n\s+sha:[\s\S]*?value:\s*\$\{\{\s*jobs\.spaerre\.outputs\.sha\s*\}\}/, 'workflow_call har intet sha-output');
  const j = t.slice(t.indexOf('\njobs:'));
  assert.match(j, /outputs:\s*\n\s+sha:\s*\$\{\{\s*steps\.sha\.outputs\.sha\s*\}\}/, 'jobbet eksporterer ikke steps.sha.outputs.sha');
  assert.match(j, /id: sha[\s\S]*?git rev-parse HEAD[\s\S]*?GITHUB_OUTPUT/, 'sha-trinnet laeser ikke HEAD ind i GITHUB_OUTPUT');
  assert.ok(j.indexOf('actions/checkout') < j.indexOf('id: sha'), 'sha-trinnet staar foer checkout');
});

function kandidatSammenligning() {
  const j = job('kandidat');
  const trin = j.split(/\n      - /).find((t) => /needs\.spaerre\.outputs\.sha/.test(t));
  assert.ok(trin, 'kandidat sammenligner ikke sin commit med spaerrens');
  return { trin, j };
}

test('kandidat: stopper hvis den ikke har tjekket SAMME commit ud som spaerren testede (og foer testene)', () => {
  const { trin, j } = kandidatSammenligning();
  assert.doesNotMatch(trin, /continue-on-error|\|\|\s*true/, 'sammenligningen kan ignoreres');
  assert.ok(j.indexOf('needs.spaerre.outputs.sha') < j.indexOf('npm --prefix mcp-server test'), 'sammenligningen staar efter testene');
});

test('kandidat: sammenligningstrinnets shell - ens commit godkendes, anden commit og manglende output stopper', { skip: POSIX }, () => {
  const { trin } = kandidatSammenligning();
  const run = trin.match(/run:\s*\|\n([\s\S]*)$/)?.[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n');
  assert.ok(run, 'kunne ikke laese trinnets shell');
  const d = mkdtempSync(join(tmpdir(), 'isolation-sha-'));
  try {
    const git = (a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
    git(['init', '-q', '.']); git(['commit', '-q', '--allow-empty', '-m', 'a']);
    const head = git(['rev-parse', 'HEAD']).stdout.trim();
    git(['commit', '-q', '--allow-empty', '-m', 'b']);
    const kor = (sha) => spawnSync('bash', ['-c', `set -e\n${run}`], { cwd: d, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, SPAERRE_SHA: sha } });
    const nu = git(['rev-parse', 'HEAD']).stdout.trim();
    assert.equal(kor(nu).status, 0, 'samme commit blev afvist');
    assert.notEqual(kor(head).status, 0, 'en anden commit blev godkendt');
    assert.notEqual(kor('').status, 0, 'et manglende output blev godkendt');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

// ── Astra runde 7 (1/10): kuverten paa server-beskeder og rest-stdout uden linjeskift ───────────────────────────────

for (const [navn, besked] of Object.entries({
  'request-id som objekt': { jsonrpc: '2.0', id: { x: 1 }, method: 'ping' },
  'params er false': { jsonrpc: '2.0', method: 'notifications/message', params: false },
  'method er tom': { jsonrpc: '2.0', method: '' },
})) {
  test(`koldt-tjek.sh: server-besked med ugyldig kuvert afvises (${navn})`, { skip: POSIX }, () => {
    const k = koldt(`echo '${JSON.stringify(besked)}'\necho '${GYLDIGT}'\nsleep 3`);
    try { assert.notEqual(k.r.status, 0, `${navn} blev godkendt`); } finally { k.ryd(); }
  });
}
test('koldt-tjek.sh: en lovlig server-besked (streng-id, params som objekt eller liste) afvises ikke', { skip: POSIX }, () => {
  const a = { jsonrpc: '2.0', id: 'srv-1', method: 'ping' };
  const b = { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info' } };
  const c = { jsonrpc: '2.0', method: 'notifications/x', params: [1] };
  const k = koldt(`echo '${JSON.stringify(a)}'\necho '${JSON.stringify(b)}'\necho '${JSON.stringify(c)}'\necho '${GYLDIGT}'\nsleep 3`);
  try { assert.equal(k.r.status, 0, `lovlige beskeder blev afvist: ${k.r.stdout}`); } finally { k.ryd(); }
});
test('koldt-tjek.sh: stoej uden afsluttende linjeskift efter svaret er ogsaa en fejl', { skip: POSIX }, () => {
  const k = koldt(`echo '${GYLDIGT}'\nsleep 0.1\nprintf 'halv linje uden linjeskift'\nsleep 3`, { KOLDT_EFTERTID_MS: '800' });
  try { assert.notEqual(k.r.status, 0, 'en ufuldstaendig linje paa stdout blev godkendt'); } finally { k.ryd(); }
});
