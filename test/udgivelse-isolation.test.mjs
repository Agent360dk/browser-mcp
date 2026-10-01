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
  const blok = s.slice(start, s.indexOf('}', slut) + 1);

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
