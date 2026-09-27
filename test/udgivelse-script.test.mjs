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
import { spawnSync, execFileSync } from 'node:child_process';


// 27/9: prøver der KØRER udgivelses-scriptets shell, springes over paa Windows. Scriptet koerer kun
// paa macOS/Linux (udgivelse.yml: macos-latest; Gustavs Mac), og paa Windows fejlede de paa miljoeet
// (perl -i paa tvaers af drev, CRLF i checkouten) - ikke paa koden. Stoej i Windows-jobbet har foer
// skjult en AEGTE Windows-fejl (se bin/cli.js, koerKlient), saa det job skal kun vaere roedt paa det
// der faktisk koerer paa Windows.
const POSIX_SKRIPT = process.platform === 'win32' && 'runbrowsermcpupdate.sh koerer kun paa macOS/Linux';
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

test('release-scriptet bruger pakketjekket og ikke log-linjen', { skip: POSIX_SKRIPT }, () => {
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

test('versionstjek: en aeldre version stopper', { skip: POSIX_SKRIPT }, () => {
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

test('release-scriptet koerer genoptag-tjekket naar versionen allerede er paa npm', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const i = s.indexOf('if [[ "$VERSIONS_TILSTAND" == genoptag ]]; then');
  assert.ok(i > -1);
  assert.match(s.slice(i, i + 400), /genoptag_tjek "\$NEW_VERSION" \|\| die/, 'genoptag-grenen tjekker ikke tagget');
});

// MAALT 11/9 af Fable (e2e-review): "ny"-vejen (npm mangler versionen) tjekker ikke et eksisterende tag. Stoppede en
// udgivelse efter push+tag (fx --skip-npm eller en registerfejl), og kom der én commit mere, ville naeste koersel pushe,
// erstatte zippen med --clobber og udgive npm fra HEAD - mens v1.29.1 blev staaende paa den gamle commit.
function nyTagTjek(opsaet) {
  const repo = mkdtempSync(join(tmpdir(), 'nytag-'));
  const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'start');
  opsaet(git);
  const s = script();
  const start = s.indexOf('ny_tag_tjek() {');
  assert.ok(start > -1, 'ny_tag_tjek() mangler i release-scriptet');
  const funktion = s.slice(start, s.indexOf('\n}\n', start) + 3);
  const r = spawnSync('bash', ['-c', `${funktion}\ncd "$2" && ny_tag_tjek "$1"`, '_', '1.29.1', repo], { encoding: 'utf8' });
  rmSync(repo, { recursive: true, force: true });
  return r.status;
}

test('ny udgivelse uden tag for versionen: fint', () => {
  assert.equal(nyTagTjek(() => {}), 0);
});

test('ny udgivelse hvor tagget allerede peger paa HEAD (genoptaget efter npm-fejl): fint', () => {
  assert.equal(nyTagTjek((git) => git('tag', 'v1.29.1')), 0);
});

test('ny udgivelse hvor tagget peger paa en AELDRE commit: stop', () => {
  assert.notEqual(nyTagTjek((git) => { git('tag', 'v1.29.1'); git('commit', '-q', '--allow-empty', '-m', 'ny kode'); }), 0);
});

test('release-scriptet koerer ny_tag_tjek paa ny-vejen', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const i = s.indexOf('if [[ "$VERSIONS_TILSTAND" == genoptag ]]; then');
  assert.ok(i > -1);
  const blok = s.slice(i, i + 900);
  assert.match(blok, /else[\s\S]*ny_tag_tjek "\$NEW_VERSION" \|\| die/, 'ny-vejen tjekker ikke et eksisterende tag');
});

// MAALT 11/9 af Fable (e2e runde 2): GitHub-udgivelsen fik én generisk linje ("Install: npx ..."), mens kladden og
// ja-blokken lovede at CHANGELOG-afsnittet fulgte med ordret. Udgivelsesnoterne hentes nu ud af CHANGELOG.md.
function noter(indhold, version = '1.29.1') {
  const d = mkdtempSync(join(tmpdir(), 'noter-'));
  writeFileSync(join(d, 'CHANGELOG.md'), indhold);
  const s = script();
  const start = s.indexOf('udgivelsesnoter() {');
  assert.ok(start > -1, 'udgivelsesnoter() mangler i release-scriptet');
  const funktion = s.slice(start, s.indexOf('\n}\n', start) + 3);
  const r = spawnSync('bash', ['-c', `${funktion}\ncd "$2" && udgivelsesnoter "$1"`, '_', version, d], { encoding: 'utf8' });
  rmSync(d, { recursive: true, force: true });
  return r.stdout;
}

test('udgivelsesnoter: afsnittet for versionen hentes ud af CHANGELOG', () => {
  const ud = noter('# Changelog\n\n## 1.29.1 (not released yet)\n\n- foerste punkt\n- andet punkt\n\n## 1.29.0 (2026-09-07)\n\n- gammelt punkt\n');
  assert.match(ud, /foerste punkt/);
  assert.match(ud, /andet punkt/);
  assert.doesNotMatch(ud, /gammelt punkt/, 'den forrige udgaves punkter kom med');
  assert.doesNotMatch(ud, /^## /m, 'overskriften skal ikke med - GitHub saetter sin egen titel');
});

test('udgivelsesnoter: en version uden afsnit giver ingenting (og udgivelsen falder tilbage)', () => {
  assert.equal(noter('# Changelog\n\n## 1.29.0\n\n- gammelt\n', '1.30.0').trim(), '');
});

test('release-scriptet bruger CHANGELOG-afsnittet som udgivelsesnoter', () => {
  const s = script();
  const i = s.indexOf('run gh release create');   // ikke oversigten oeverst i filen, men selve kaldet
  assert.ok(i > -1);
  const blok = s.slice(Math.max(0, i - 600), i + 400);
  assert.match(blok, /udgivelsesnoter "\$NEW_VERSION"/, 'noterne hentes ikke fra CHANGELOG');
  assert.match(blok, /--notes-file/, 'noterne sendes ikke med til gh release create');
});

test('release-scriptet stopper paa versionstjekket og ikke paa den gamle lighed', () => {
  const s = script();
  assert.doesNotMatch(s, /"\$NEW_VERSION" != "\$NPM_LATEST"/, 'den gamle lighedsbetingelse er tilbage');
  assert.match(s, /versions_tjek "\$NEW_VERSION" "\$NPM_LATEST"/);
});

// MAALT 12/9 af Fable (e2e runde 3): CHANGELOG-afsnittet staar som "## X.Y.Z (not released yet)" mens der arbejdes,
// og INTET trin skrev overskriften om. Den gik derfor offentlig i den pushede CHANGELOG.md - i en fil der selv lover
// at "Dates are when the version was published".
test('udgivelsen skriver CHANGELOG-overskriften om fra "not released yet" til datoen', () => {
  assert.match(script(), /not released yet/, 'overskriften skrives ikke om - den gaar offentlig som "not released yet"');
  assert.match(script(), /CHANGELOG\.md/, 'CHANGELOG.md roeres ikke af versionsbumpet');
  assert.match(script(), /die "CHANGELOG still says/, 'der er ingen gate: glider regexen, opdager ingen det');
  // MAALT 12/9 af Astra: omskrivningen skete i arbejdstraeet, men CHANGELOG.md stod hverken i MANAGED eller i `git add`.
  // Den pushede fil sagde derfor fortsat "not released yet" - og filen stod beskidt, saa naeste koersel doede paa den.
  const forvaltet = script().slice(script().indexOf('MANAGED=('), script().indexOf('is_managed()'));
  assert.match(forvaltet, /^\s*CHANGELOG\.md\s*$/m, 'CHANGELOG.md er ikke forvaltet - saa staar den beskidt efter koerslen');
  // 26/9: udgivelsen committer ikke laengere selv. Omskrivningen sker med --prepare paa en gren og
  // merges gennem en PR; --ship doer hvis trin 1 stadig har noget at skrive (1g).
  assert.match(script(), /die "kandidaten er ikke forberedt/,
    'udgivelsen stopper ikke paa et uforberedt traee - saa gaar "not released yet" ud igen');
});

// MAALT samme runde: fejler koerslen EFTER butiks-uploaden men FOER npm, afviser butikken den samme version ved en
// genkoersel, og scriptet doer foer GitHub. Hintet om --skip-cws stod kun paa genoptag-stien, som ligger efter npm.
test('butikstrinnet siger selv hvad man goer, hvis koerslen fejler efter det', () => {
  const i = script().indexOf('3. Chrome Web Store publish');
  assert.ok(i > -1, 'butikstrinnet findes');
  const blok = script().slice(i, i + 900);
  assert.match(blok, /warn "fejler koerslen EFTER dette trin, saa genoptag \(--genoptag/,
    'butikstrinnet advarer ikke selv om at en genkoersel afvises - hintet stod kun paa genoptag-stien, efter npm');
});

// MAALT samme runde: udgivelsestitlen var "vX.Y.Z - Chrome extension + MCP server", mens kladden til Gustav lovede
// "Browser MCP X.Y.Z". Titlen er det foerste mennesker ser paa udgivelsessiden.
test('GitHub-udgivelsen har den titel kladden lover', () => {
  assert.match(script(), /--title "Browser MCP \$\{NEW_VERSION\}"/, 'udgivelsestitlen matcher ikke kladden');
});

// MAALT 12/9: flow-spaerren laa INDE i butikstrinnet, saa `--skip-cws` sprang ogsaa SPAERREN over - og npm og GitHub
// fik koden uden at den levende kontrol havde koert. Astra: "uden den udgiver du reelt i blinde". Spaerren har nu sit
// eget trin FOER alt uigenkaldeligt, og den kan kun springes over med et eksplicit flag der siger hvad det koster.
test('flow-spaerren har sit eget trin FOER butik, GitHub og npm', () => {
  const k = script();
  const iFlow = k.indexOf('2b. Flow-spaerre');
  assert.ok(iFlow > -1, 'der er intet selvstaendigt flow-trin - saa forsvinder spaerren sammen med --skip-cws');
  const iButik = k.indexOf('3. Chrome Web Store publish');
  // 26/9: GitHub-kanalen starter nu i trin 3b (tagget). Et anker der ikke findes, gav -1 og en
  // sammenligning der ikke maaler noget - derfor tjekkes ankeret ogsaa.
  const iGitHub = k.indexOf('step "2d. Tag');
  assert.ok(iButik > -1 && iGitHub > -1, 'ankrene blev ikke fundet - proeven maaler intet');
  assert.ok(iFlow < iButik && iFlow < iGitHub,
    'flow-trinnet ligger EFTER en uigenkaldelig kanal - det er for sent at opdage at koden ikke koerer');
});

test('spaerren kan kun springes over med et eksplicit flag', () => {
  const k = script();
  assert.match(k, /--skip-flow/, 'der er ingen maade at springe spaerren over bevidst');
  assert.match(k, /udgiver i blinde/, 'flaget siger ikke hvad det koster');
});

// MAALT 12/9 af Astra: roegtesten koerer paa TARBALLEN foer npm (pakke-roegtest.mjs). Intet tjekkede at den
// UDGIVNE pakke kan installeres koldt og svare paa et MCP-haandtryk. Og der stod ikke ét ord om tilbagerulning -
// npm kan kun traekkes inden for 72 timer, og versionsnummeret er braendt for altid.
test('den udgivne pakke tjekkes koldt EFTER npm', () => {
  const k = script();
  const iNpm = k.indexOf('5. npm publish');
  const iKold = k.indexOf('5c. Koldt tjek');
  assert.ok(iKold > -1, 'intet tjekker den pakke brugerne faktisk faar');
  assert.ok(iKold > iNpm, 'det kolde tjek skal koere EFTER npm - ellers tjekker det tarballen igen');
  assert.match(k, /npx[^\n]*@agent360\/browser-mcp@/, 'det kolde tjek henter ikke pakken fra registret');
});

test('scriptet siger hvad man goer, hvis udgivelsen var forkert', () => {
  assert.match(script(), /72 timer|npm unpublish/,
    'der staar intet om tilbagerulning - og en sikkerhedsudgivelse er netop den man kan faa brug for at traekke');
});

// MAALT 12/9, min egen fejl: trin 2b's spaerre tjekkede kun for ordet "kode-aftryk". Koert mod Gustavs rigtige Chrome
// fejlede flowtesten med "forkert dom: conflict - udvidelsen er foraeldet, i konflikt eller ikke forbundet" - og den
// streng indeholder ikke "kode-aftryk", saa spaerren sagde GROENT paa en konflikt. Beviset for at det er KANDIDATEN
// der koerer, er hele provide_feedback-tjekket, ikke én formulering af det.
test('spaerren stopper paa ENHVER fejl i selv-diagnosen, ikke kun paa aftrykket', () => {
  const k = script();
  const i = k.indexOf('2b. Flow-spaerre');
  const blok = k.slice(i, k.indexOf('3. Chrome Web Store publish'));
  assert.match(blok, /provide_feedback/,
    'spaerren ser ikke paa selv-diagnosen som helhed - en konflikt eller en foraeldet udvidelse slipper igennem');
  assert.doesNotMatch(blok, /grep -q "kode-aftryk"/,
    'spaerren hviler stadig paa én formulering af fejlen i stedet for paa tjekket');
});

// MAALT 12/9 af Fable: fem fund i de tre commits jeg selv skrev en time foer. De to vaerste er mine egne usande linjer.
test('spaerren siger kun GROENT naar der ikke er uventede fejl - ikke naar aftrykket tilfaeldigvis passer', () => {
  const k = script();
  const blok = k.slice(k.indexOf('2b. Flow-spaerre'), k.indexOf('Chrome Web Store publish'));
  // Fable: den rapport jeg kaldte "groen" har 5 FEJL. Mit trin sagde GROENT, fordi provide_feedback ikke var blandt dem.
  // publish-cws.sh stopper paa praecis samme rapport (KENDTE_FEJL er tom). To spaerrer med to forskellige barer er én spaerre.
  assert.match(blok, /KENDTE_FEJL/, 'spaerren bruger ikke samme kendte-fejl-liste som butikstrinnet');
  assert.match(blok, /UVENTEDE/, 'spaerren taeller ikke uventede fejl - saa vinker den roede vaerktoejer igennem');
});

test('spaerren doer ikke i toerloeb - planen skal kunne ses hele vejen', () => {
  const k = script();
  // 26/9: kun trin 2b selv (til 2c). Foer gik udsnittet helt til butikken og saa dermed ogsaa 1g's
  // stop, som kun gaelder --ship og derfor ikke kan skjule planen i en toerloeb.
  const blok = k.slice(k.indexOf('2b. Flow-spaerre'), k.indexOf('step "2c.'));
  assert.ok(blok.length > 0, 'trin 2b blev ikke fundet');
  assert.doesNotMatch(blok, /\n\s*die "/, 'trin 2b bruger die i stedet for gate - saa viser toerloebet ikke trin 3-6');
  assert.match(blok, /gate /, 'trin 2b bruger ikke gate()');
});

test('spaerren koerer FOER versionsbumpet - ellers doer foerste ship-pas altid', () => {
  const k = script();
  // Fable: trin 1 bumper manifest.json til den nye version, men den INDLAESTE udvidelse svarer stadig den gamle.
  // Flowets server laeser den nye. Koerer spaerren efter bumpet, fejler den paa versionsforskellen hver eneste gang.
  assert.ok(k.indexOf('2b. Flow-spaerre') < k.indexOf('step "1. Version'),
    'spaerren ligger efter versionsbumpet - saa doer foerste --ship-pas altid paa en forskel scriptet selv lavede');
});

test('tilbagerulnings-raadet peger paa den forrige version, ikke paa den braekkede', () => {
  const k = script();
  // Forankret i step-linjerne, ikke i de bare tal: scriptets overskrift naevner nu de samme trin, og en
  // indexOf paa "5b. MCP registry" ramte overskriften i stedet for trinnet - saa blev blokken TOM og proeven
  // groen uanset hvad koden gjorde. (MAALT 13/9: den fejl ramte to proever paa én gang.)
  const blok = k.slice(k.indexOf('step "5c.'), k.indexOf('step "5b.'));
  assert.ok(blok.length > 0, 'trin 5c kunne ikke findes i scriptet');
  assert.match(blok, /NPM_LATEST/, 'raadet bruger CUR_PKG, som paa en genkoersel ER den braekkede version');
  assert.doesNotMatch(blok, /dist-tag add[^\n]*CUR_PKG/, 'dist-tag peger stadig paa CUR_PKG');
});

test('et fejlet koldt tjek stopper udgivelsen i stedet for at fortsaette', () => {
  const k = script();
  // Forankret i step-linjerne, ikke i de bare tal: scriptets overskrift naevner nu de samme trin, og en
  // indexOf paa "5b. MCP registry" ramte overskriften i stedet for trinnet - saa blev blokken TOM og proeven
  // groen uanset hvad koden gjorde. (MAALT 13/9: den fejl ramte to proever paa én gang.)
  const blok = k.slice(k.indexOf('step "5c.'), k.indexOf('step "5b.'));
  assert.ok(blok.length > 0, 'trin 5c kunne ikke findes i scriptet');
  assert.match(blok, /gate |die "/, 'det kolde tjek advarer kun - saa udgives registret mod en pakke der lige dumpede');
  // MAALT 13/9 af Astra: den foerste udgave matchede paa en blok der STARTER med kommentaren - og kommentaren
  // indeholder selv ordet "forsoeg". Hun fjernede loekken helt og fik samme resultat som baseline. Proeven maa
  // kun se paa KODEN, ikke paa forklaringen af den.
  const kode = blok.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(kode, /for forsoeg in 1 2 3 4 5 6/,
    'for faa forsoeg. MAALT 13/9 under den aegte udgivelse: npm svarede ja og skrev selv "may take a few \
minutes", og tjekket doede efter 45 sekunder - saa scriptet stoppede foer registret paa en udgivelse der lykkedes');
  assert.match(kode, /sleep \d+/, 'der ventes ikke mellem forsoegene');
  // MAALT 13/9 af Fable: kaldet havde ingen tidsgraense. Det er SIDSTE spaerre foer registret, og den koerer
  // EFTER at npm er udgivet - et haengende download ville altsaa standse udgivelsen halvvejs, uden en fejl.
  // `head -1` lukker roeret, men ikke processen.
  assert.match(kode, /timeout \d+|TIMEOUT_CMD/, 'det kolde tjek kan haenge i det uendelige - der er ingen tidsgraense paa npx');
});


// ── Noedudgangen ──────────────────────────────────────────────────────────────
// MAALT 13/9, af Astra og Fable uafhaengigt af hinanden: `--skip-flow` var ikke en noedudgang. Trin 2b sprang over
// uden at sige det videre, saa butikstrinnet koerte sin EGEN flow-test EFTER versionsbumpet og doede paa den
// versionsforskel bumpet lige havde lavet. Flaget lovede "udgiv i blinde" og standsede koerslen - efter at seks
// filer var skrevet. Proeven koerer den AEGTE gren, ikke en beskrivelse af den.
function skipGrenen() {
  const k = script();
  const start = k.indexOf('if [[ "$SKIP_FLOW" == 1');
  const slut = k.indexOf('\nelse', start);
  assert.ok(start > -1 && slut > start, 'skip-grenen i trin 2b findes ikke laengere');
  return `${k.slice(start, slut)}\nfi`;
}

test('--skip-flow giver fritagelsen videre til butikstrinnet i stedet for at draebe det', { skip: POSIX_SKRIPT }, () => {
  const gren = skipGrenen().replace(/^\s*warn .*$/m, ':');
  const r = spawnSync('bash', ['-c', `set -eu\nSKIP_FLOW=1\n${gren}\nprintenv SPRING_FLOW_OVER || echo TOM`], {
    encoding: 'utf8', env: { PATH: process.env.PATH },
  });
  assert.equal(r.status, 0, `skip-grenen kunne ikke koere: ${r.stderr}`);
  const ud = r.stdout.trim();
  assert.equal(ud, '1',
    'skip-grenen sender ikke fritagelsen videre. Butikstrinnet koerer saa sin egen flow-test efter bumpet og ' +
    'doer paa en forskel scriptet selv lavede - midt i udgivelsen, efter at versionsfilerne er skrevet.');
});

test('beviset for en groen browser kan ikke arves fra skallen', () => {
  // MAALT 13/9: min foerste udgave af denne proeve brugte indexOf paa selve strengen - og en mutation der
  // kommenterede linjen UD forblev groen, fordi strengen stadig stod dér, nu bare i en kommentar. Praecis den
  // fejl Astra fandt i 5c-proeven samme dag. Proeven ser nu kun paa kode.
  const kode = script().split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  // ⛔ 21/9: nulstillingen flyttede ind i scripts/flow-daekning.sh, saa BEGGE udgivelses-veje
  // deler den. Proeven maa derfor ikke laengere lede efter `unset` i dette script alene - men
  // den skal stadig bevise at det SKER, ikke bare at en funktion kaldes. Derfor to led:
  // funktionen kaldes her foer trin 2b, OG den faelles fil nulstiller faktisk begge flag.
  const faelles = readFileSync(join(rod, 'scripts', 'flow-daekning.sh'), 'utf8');
  for (const flag of ['BMCP_FLOW_OK', 'FLOW_KUN_BAGGRUND']) {
    assert.match(faelles, new RegExp('unset ' + flag),
      `den faelles vagt nulstiller ikke ${flag} - en eksporteret variabel fra en anden chat kan `
      + 'saa forfalske beviset i begge udgivelses-veje');
  }
  const nulstil = kode.indexOf('flow_nulstil_arv');
  assert.ok(nulstil > -1,
    'flaget nulstilles ikke ved start. En eksporteret variabel fra en tidligere koersel - eller fra en anden ' +
    'chat i samme skal - kunne saa slukke flow-spaerren for kode ingen har set koere i en browser.');
  assert.ok(nulstil < kode.indexOf('step "2b.'), 'flaget nulstilles efter trin 2b - saa nulstiller det trinnets eget bevis');
});

// Butikstrinnet kan koeres alene (`npm run publish:cws`). Saa er der ingen trin 2b til at give det et bevis, og
// spaerren SKAL koere. Proeven koerer den aegte beslutningskaede i tre miljoeer i stedet for at laese den.
function flowBeslutningen() {
  const c = readFileSync(new URL('../scripts/publish-cws.sh', import.meta.url), 'utf8');
  const start = c.indexOf('if [[ "${BMCP_FLOW_OK:-}" == "1" ]]; then');
  assert.ok(start > -1, 'beslutningskaeden i publish-cws.sh findes ikke laengere');
  // ⛔ 21/9: spaerren koerer nu i sin EGEN browser (scripts/flow-isoleret.mjs), ikke i
  // menneskets Chrome. Ankeret foelger med - men proeven maaler stadig HVILKEN gren der
  // vaelges, ikke at en bestemt kommando staar der. Findes kommandoen ikke, er det en
  // fejl i sig selv: saa er der ingen gren der faktisk koerer spaerren.
  const iKald = c.indexOf('flow-isoleret.mjs', start);
  assert.ok(iKald > -1, 'publish-cws.sh koerer ikke laengere flow-spaerren i en isoleret browser');
  const slut = c.indexOf('\nfi', iKald);
  const blok = c.slice(start, slut);
  // else-grenen erstattes af ét ord, saa vi maaler HVILKEN gren der vaelges uden at koere flow-testen.
  const linjer = blok.split('\n');
  const iElse = linjer.findIndex((l) => l === 'else');
  assert.ok(iElse > -1, 'else-grenen findes ikke - saa er der ingen gren der faktisk koerer flow-testen');
  return `${linjer.slice(0, iElse + 1).join('\n')}\n  echo KOERER_TESTEN\nfi`;
}

test('butikstrinnet alene koerer stadig flow-spaerren - beviset kommer kun fra trin 2b', { skip: POSIX_SKRIPT }, () => {
  const kaede = flowBeslutningen();
  const koer = (env) => {
    const r = spawnSync('bash', ['-c', `set -eu\n${kaede}`], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    assert.equal(r.status, 0, `beslutningskaeden kunne ikke koere: ${r.stderr}`);
    return r.stdout;
  };
  assert.match(koer({}), /KOERER_TESTEN/,
    'uden bevis og uden fritagelse springer butikstrinnet flow-testen over - saa kan en udgivelse koeres alene ' +
    'uden at nogen har set koden virke i en browser');
  assert.doesNotMatch(koer({ BMCP_FLOW_OK: '1' }), /KOERER_TESTEN/,
    'beviset fra trin 2b bliver ikke respekteret - saa koerer spaerren igen EFTER bumpet og doer paa den ' +
    'versionsforskel scriptet selv lavede');
  assert.doesNotMatch(koer({ SPRING_FLOW_OVER: '1' }), /KOERER_TESTEN/,
    'fritagelsen bliver ikke respekteret - saa er --skip-flow stadig en doedsfaelde i trin 3');
});

// ── Alt hvad udgivelsen SKRIVER, skal den ogsaa COMMITTE ─────────────────────
//
// FUNDET 17/9 i en toer-koersel af 1.29.2. Tre lister i scriptet skal passe sammen:
//   JSON_FILES + TOOLCOUNT_FILES  - det trin 1 skriver i
//   MANAGED                       - det stray-tjekket taaler bagefter
//   `git add` i trin 4            - det der kommer med i commit, tag og push
// `gemini-extension.json` blev 13/9 sat i de to foerste, men ikke i den tredje. Ved --ship
// ville den blive bumpet til den nye version paa disken og aldrig naa GitHub - og Gemini
// CLI's galleri laeser netop GitHub. Praecis den fejl Astra fandt paa CHANGELOG.md 12/9,
// dengang rettet for den ene fil. Denne proeve vogter MOENSTRET: ingen skrevet fil maa
// mangle i commit'et, uanset hvad den hedder.
test('hver fil trin 1 skriver i, er forvaltet - og udgivelsen kraever dem rene', () => {
  const kode = script().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const liste = (navn) => {
    const m = kode.match(new RegExp(`^${navn}="([^"]+)"`, 'm'));
    assert.ok(m, `${navn} blev ikke fundet i scriptet - proeven maaler intet`);
    return m[1].split(/\s+/).filter(Boolean);
  };
  const skrevet = [...new Set([...liste('JSON_FILES'), ...liste('TOOLCOUNT_FILES')])];
  assert.ok(skrevet.length >= 8, `kun ${skrevet.length} skrevne filer fundet - udtraekket er for tyndt`);

  const mStart = kode.indexOf('MANAGED=(');
  const forvaltet = kode.slice(mStart, kode.indexOf(')', mStart)).split(/\s+/).slice(1).filter(Boolean);
  const erForvaltet = (f) => forvaltet.some((m) => f === m || f.startsWith(m + '/'));

  // 26/9 (Astra): --prepare regenererer sitet, og sitemappet skifter dato. Er det ikke forvaltet,
  // stopper en genkoersel af prepare paa sit eget output.
  skrevet.push('docs/sitemap.xml');
  const uforvaltet = skrevet.filter((f) => !erForvaltet(f));
  assert.deepEqual(uforvaltet, [],
    `trin 1 skriver i ${uforvaltet.join(', ')}, men MANAGED kender dem ikke - naeste koersels stray-tjek doer paa dem`);
  // 26/9: filerne committes med --prepare i en PR; udgivelsen doer hvis nogen af dem er beskidt.
  assert.match(kode, /git status --porcelain[\s\S]*?die "kandidaten er ikke forberedt/,
    'udgivelsen kraever ikke at trin 1s filer er rene - saa kan en uforberedt kandidat udgives');
});

// ── npm-noeglens udloeb ──────────────────────────────────────────────────────
//
// MAALT 18/9: pre-flight spurgte om noeglen VIRKER, ikke hvor laenge. Noeglen doede to
// dage efter, og intet i en koersel sagde det. Havde vi ikke opdaget det i haanden, var
// den foerste besked om sagen en fejlet udgivelse.
//
// npm udleverer ikke et tokens udloeb, saa den eneste kilde er kommentaren i .env.
// Det er skroebeligt, og derfor siger advarslen ogsaa hvor tallet kommer fra.
test('pre-flight regner dage til npm-noeglens udloeb ud af .env', { skip: POSIX_SKRIPT }, () => {
  const fn = script().slice(script().indexOf('dage_til_udloeb()'));
  const krop = fn.slice(0, fn.indexOf('\n}') + 2);
  assert.ok(krop.includes('expires'), 'funktionen leder ikke efter udloebs-datoen');

  const d = mkdtempSync(join(tmpdir(), 'udloeb-'));
  const koer = (indhold) => {
    if (indhold === null) return spawnSync('bash', ['-c', `${krop}\ndage_til_udloeb "${d}/mangler"`], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(d, '.env'), indhold);
    return spawnSync('bash', ['-c', `${krop}\ndage_til_udloeb "${d}/.env"`], { encoding: 'utf8' }).stdout.trim();
  };
  // MAALT 19/9: toISOString() giver UTC-datoen, og scriptet regner i LOKAL tid
  // (datetime.date.today()). Paa en maskine i UTC+7 er de to datoer forskellige en
  // stor del af doegnet, saa proeven var groen om formiddagen og roed om aftenen paa
  // uaendret kode. Byg datoen af lokale felter, ellers maaler proeven tidszonen.
  const om = (dage) => {
    const t = new Date(); t.setDate(t.getDate() + dage);
    const to = (n) => String(n).padStart(2, '0');
    return `${t.getFullYear()}-${to(t.getMonth() + 1)}-${to(t.getDate())}`;
  };

  assert.equal(koer(`# token - expires ${om(30)}\nNPM_TOKEN=x\n`), '30', '30 dage frem blev ikke regnet rigtigt');
  assert.equal(koer(`# token - expires ${om(2)}\nNPM_TOKEN=x\n`), '2', 'to dage frem blev ikke regnet rigtigt');
  assert.equal(koer(`# token - expires ${om(-3)}\nNPM_TOKEN=x\n`), '-3', 'en udloebet noegle gav ikke et negativt tal');
  assert.equal(koer('NPM_TOKEN=x\n'), 'ukendt', 'uden dato skal svaret vaere uvist, ikke et gaet');
  assert.equal(koer(null), 'ukendt', 'uden .env skal svaret vaere uvist');
});

test('pre-flight siger fra naar noeglen er ved at udloebe', () => {
  const kode = script().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const blok = kode.slice(kode.indexOf('NPM_UDLOEB='), kode.indexOf('NPM_UDLOEB=') + 700);
  assert.match(blok, /NPM_UDLOEB < 14/, 'der advares ikke i god tid foer udloebet');
  assert.match(blok, /NPM_UDLOEB < 0/, 'en allerede udloebet noegle stopper ikke koerslen');
  assert.match(blok, /gate /, 'en udloebet noegle giver kun en advarsel, ikke en spaerre');
});

test('det kolde tjek maa ikke doe paa en tom timeout-array', { skip: POSIX_SKRIPT }, () => {
  // MAALT 19/9 under udgivelsen af 1.29.2: maskinen har ingen timeout(1), saa TIMEOUT_CMD
  // blev en TOM array - og "${TIMEOUT_CMD[@]}" fejler med "unbound variable" under `set -u`
  // paa macOS' bash 3.2, hvor tom og usat er samme ting. Seks forsoeg, seks syntaksfejl, og
  // saa konklusionen "den udgivne pakke svarede ikke" med en opfordring til at afpublicere
  // en pakke der virkede. Det SIDSTE vaern foer en tilbagerulning var selv i stykker.
  const s = script();
  // Den SIKRE form indeholder selv den usikre streng, saa et bart doesNotMatch ville
  // vaere roedt paa den rigtige kode. Tael i stedet: hver forekomst skal vaere vogtet.
  const alle = (s.match(/"\$\{TIMEOUT_CMD\[@\]\}"/g) || []).length;
  const vogtede = (s.match(/\$\{TIMEOUT_CMD\[@\]\+"\$\{TIMEOUT_CMD\[@\]\}"\}/g) || []).length;
  assert.ok(vogtede >= 1, 'den sikre udvidelse mangler helt');
  assert.equal(alle, vogtede,
    'en uvogtet udvidelse af TIMEOUT_CMD er tilbage - det kolde tjek dropper ud paa enhver ' +
    'maskine uden timeout(1), praecis som det gjorde 19/9');

  // Og egenskaben, ikke bare formuleringen: koer begge former i en rigtig bash.
  const koer = (udtryk) => spawnSync('bash', ['-c',
    `set -euo pipefail; A=(); echo ok | ${udtryk} cat`], { encoding: 'utf8' });

  // Den sikre form skal virke i ENHVER bash. Det er det egentlige krav.
  assert.equal(koer('${A[@]+"${A[@]}"}').status, 0, 'den sikre form virker ikke i denne bash');

  // Kalibreringen - "kan denne bash overhovedet vise fejlen?" - kan kun koeres hvor
  // fejlen findes. MAALT 19/9: foerste udgave paastod at den gamle form ALTID fejler.
  // Det gaelder bash 3.2 (macOS' egen), ikke bash 5 (Linux, og dermed CI), hvor en tom
  // array-udvidelse er lovlig under `set -u`. Proeven maalte min maskine, ikke reglen,
  // og gjorde hele CI roed en time efter at den blev skrevet. Paa en moderne bash kan
  // dette miljoe ikke demonstrere fejlen, og saa er kilde-tjekket ovenfor hele vagten.
  const gammelFejler = koer('"${A[@]}"').status !== 0;
  const bashVer = spawnSync('bash', ['-c', 'echo ${BASH_VERSINFO[0]}'], { encoding: 'utf8' }).stdout.trim();
  if (Number(bashVer) < 5) {
    assert.ok(gammelFejler,
      `bash ${bashVer} burde fejle paa den bare udvidelse men gjorde ikke - saa maaler kalibreringen intet`);
  }
});

// ── npm trusted publisher, spurgt FOER butik og tag (25/9) ───────────────────
// Udgivelsen tager butikken og GitHub-tagget foer npm. Uden dette tjek opdages en manglende
// trusted publisher foerst i trin 5 - efter en halv udgivelse. Proeven stiller en falsk GitHub
// (id-token) og en falsk npm (token-bytning) op og koerer tjek-scriptet mod dem.

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

const oidcTjek = join(rod, 'scripts/npm-oidc-tjek.py');
const NPM_STI = '/-/npm/v1/oidc/token/exchange/package/@agent360%2fbrowser-mcp';

async function koerOidcTjek(npmSvar) {
  const set = [];
  const server = createServer((req, res) => {
    set.push(`${req.method} ${req.url} ${req.headers.authorization || ''}`);
    if (req.url.startsWith('/idtoken')) {
      const ok = req.headers.authorization === 'Bearer gh-noegle' && req.url.includes('audience=npm%3A127.0.0.1');
      res.writeHead(ok ? 200 : 403).end(ok ? JSON.stringify({ value: 'id-token-fra-github' }) : '{}');
    } else if (req.method === 'POST' && req.url === NPM_STI && req.headers.authorization === 'Bearer id-token-fra-github') {
      res.writeHead(npmSvar.status).end(JSON.stringify(npmSvar.krop));
    } else {
      res.writeHead(404).end(JSON.stringify({ message: 'forkert sti eller noegle' }));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    return await new Promise((r) => execFile('python3', [oidcTjek, '@agent360/browser-mcp'], {
      env: {
        ...process.env,
        ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${port}/idtoken?api-version=2.0`,
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'gh-noegle',
        NPM_REGISTRY: `http://127.0.0.1:${port}`,
      },
    }, (fejl, stdout) => r({ kode: fejl ? fejl.code : 0, ud: stdout, set })));
  } finally { server.close(); }
}

test('npm-tjek: npm udleverer et token -> ja, og tokenet skrives aldrig ud', async () => {
  const s = await koerOidcTjek({ status: 201, krop: { token: 'HEMMELIG-NPM-TOKEN' } });
  assert.equal(s.kode, 0, s.ud);
  assert.equal(s.ud.trim(), 'ok');
  assert.ok(!s.ud.includes('HEMMELIG') && !s.ud.includes('id-token-fra-github'));
});

test('npm-tjek: npm afviser udgiveren -> nej, med grunden', async () => {
  const s = await koerOidcTjek({ status: 404, krop: { message: 'No trusted publisher found' } });
  assert.equal(s.kode, 1);
  assert.match(s.ud, /HTTP 404.*No trusted publisher found/);
});

test('npm-tjek: npm svarer 200 uden token -> nej', async () => {
  const s = await koerOidcTjek({ status: 200, krop: {} });
  assert.equal(s.kode, 1);
});

test('npm-tjek: uden id-token-rettighed -> nej, og det siger hvorfor', async () => {
  const r = spawnSync('python3', [oidcTjek, '@agent360/browser-mcp'], {
    env: { PATH: process.env.PATH }, encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /id-token: write/);
});

test('release-scriptet spoerger npm FOER butikken, og kun naar det udgiver', () => {
  const s = script();
  const tjek = s.indexOf('scripts/npm-oidc-tjek.py');
  const butik = s.indexOf('step "3. Chrome Web Store publish"');
  assert.ok(tjek > 0 && butik > 0 && tjek < butik, 'tjekket skal ligge foer trin 3');
  const blok = s.slice(s.lastIndexOf('if [[ "$SHIP" == 1 ]]; then', tjek), tjek);
  assert.ok(blok.length > 0 && blok.length < 400, 'tjekket skal sidde i --ship-grenen');
  assert.match(s.slice(tjek, tjek + 400), /\|\| die "npm afviser/);
});

test('release-scriptet koerer docs-vagten foer butikken og stopper paa roedt', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const fra = s.indexOf('# 1f.');
  // Kun 1f: fra 26/9 ligger 1g (kandidat-tjekket) imellem og har sine egne proever.
  const til = s.indexOf('# 1g. 26/9');
  assert.ok(fra > 0 && til > fra && til < s.indexOf('step "3. Chrome Web Store publish"'), 'docs-vagten skal ligge foer trin 3');
  const blok = s.slice(fra, til);
  // Blokken koeres for alvor mod en falsk docs-vagt: roed skal give gate, groen skal give ok.
  const koer = (kode) => {
    const d = mkdtempSync(join(tmpdir(), 'docs-vagt-'));
    mkdirSync(join(d, 'scripts'));
    writeFileSync(join(d, 'scripts/check-docs.py'), `import sys; print("docs-fejl"); sys.exit(${kode})\n`);
    const r = spawnSync('bash', ['-c', `ok(){ echo "OK:$1"; }; gate(){ echo "GATE:$1"; }; REPO_ROOT='${d}'\n${blok}`], { encoding: 'utf8' });
    rmSync(d, { recursive: true, force: true });
    return r.stdout;
  };
  assert.match(koer(1), /GATE:docs-vagten er roed/);
  assert.doesNotMatch(koer(1), /OK:/);
  assert.match(koer(0), /OK:docs-vagt ren/);
});

// ── Udgivelsen skriver aldrig til main (26/9, panel + fuld review) ───────────
// Trin 4 skubbede selv versions-commit'en til main med jobbets noegle. Main kraever fem tjek som
// den noegle ikke kan springe over, saa en rigtig koersel ville doe EFTER butikken. Nu forberedes
// versionen med --prepare paa en gren (PR med alle tjek), og udgivelsen tagger den testede commit.

const kodeLinjer = (tekst) => tekst.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('udgivelsen committer og skubber aldrig til main - tagget skubbes FOER butikken', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const pakke = s.indexOf('step "2. Pakke-tjek');
  const tag = s.indexOf('step "2d. Tag');
  const butik = s.indexOf('step "3. Chrome Web Store publish"');
  const fire = s.indexOf('step "4. GitHub');
  const npm = s.indexOf('step "5. npm publish');
  assert.ok(pakke > 0 && pakke < tag && tag < butik && butik < fire && fire < npm,
    'raekkefoelgen skal vaere pakketjek -> tag -> butik -> release -> npm');
  const blok = kodeLinjer(s.slice(tag, npm));
  for (const [moenster, hvad] of [[/git push origin main/, 'skubber til main'], [/git commit/, 'committer'],
    [/run git add/, 'stager filer'], [/run git reset/, 'nulstiller indekset']]) {
    assert.doesNotMatch(blok, moenster, `udgivelsen ${hvad} - main kraever tjek som udgivelsens noegle ikke kan springe over`);
  }
  assert.match(kodeLinjer(s.slice(tag, butik)), /run git push origin "v\$\{NEW_VERSION\}"/, 'tagget skubbes ikke foer butikken');
});

test('README-datoen flyttes ikke naar versionen allerede staar der - et forberedt traee forbliver rent', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const linje = s.split('\n').find((l) => l.includes('run perl') && l.includes('latest release v'));
  assert.ok(linje, 'README-daten-linjen blev ikke fundet');
  const perl = linje.trim().replace(/^run /, '');
  const d = mkdtempSync(join(tmpdir(), 'readme-dato-'));
  try {
    const f = join(d, 'README.md');
    const koer = (indhold) => {
      writeFileSync(f, indhold);
      execFileSync('bash', ['-c', `NEW_VERSION=1.30.1; f='${f}'; ${perl}`]);
      return readFileSync(f, 'utf8');
    };
    // En fast, gammel dato: med dagens dato ville omskrivningen give samme tekst, og proeven var blind
    // (fanget af mutationsbeviset 26/9 - fixturens dato var tilfaeldigvis dagens danske dato).
    assert.equal(koer('latest release v1.30.1 (2020-01-01)\n'), 'latest release v1.30.1 (2020-01-01)\n',
      'datoen blev flyttet selv om versionen allerede stod der - udgivelsen en anden dag bliver beskidt');
    assert.match(koer('latest release v1.30.0 (2026-09-20)\n'), /latest release v1\.30\.1 \(\d{4}-\d{2}-\d{2}\)/,
      'en ny version faar ikke laengere sin dato');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

/**
 * Koerer scriptets EGEN 1g-blok i et lille repo med en fjern-main - med scriptets shell-indstillinger.
 * trin1 er en stand-in der goer det trin 1 goer ved en kandidat: skriver versionen, daterer CHANGELOG
 * og synker mcp-server/server.json fra roden. Ship koerer den i arbejdstraeet foer 1g, som scriptet.
 */
function koerKandidatBlok({ ship, forberedt = true, usynk = false, beskidt = false, foranOrigin = false, trin1Fejler = false, diffKode = null, regen = 'ens' }) {
  const s = script();
  const blok = s.slice(s.indexOf('# 1g. 26/9'), s.indexOf('\n# ── 2. Pakke-tjek'));
  assert.ok(blok.includes('declare -f trin1'), '1g koerer ikke trin 1 i en kopi - saa kan proevekoersel og ship vaere uenige');
  assert.match(s, /^gate\(\) \{ if \[\[ "\$SHIP" == 1 \]\]; then die "\$1"; else warn /m,
    'scriptets gate() doer ikke laengere i ship - fixturens stub spejler den ikke');
  const d = mkdtempSync(join(tmpdir(), 'kandidat-'));
  const git = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    const v = forberedt ? '1.30.1' : '1.30.0';
    mkdirSync(join(d, 'extension')); mkdirSync(join(d, 'mcp-server'));
    writeFileSync(join(d, 'extension/manifest.json'), `{"version": "${v}"}\n`);
    writeFileSync(join(d, 'CHANGELOG.md'), forberedt ? '## 1.30.1 (2020-01-01)\n' : '## 1.30.1 (not released yet)\n');
    writeFileSync(join(d, 'server.json'), '{"icons": ["a.png"]}\n');
    writeFileSync(join(d, 'mcp-server/server.json'), usynk ? '{}\n' : '{"icons": ["a.png"]}\n');
    writeFileSync(join(d, 'mcp-server/index.js'), 'server();\n');
    // En stub-generator som docs-gaten koerer: den skriver sitemappet. 'afviger' = det committede
    // sitemap er ikke det generatoren skaber (som efter en squash); 'doer' = generatoren fejler.
    mkdirSync(join(d, 'scripts')); mkdirSync(join(d, 'docs'));
    writeFileSync(join(d, 'scripts/generate-docs.py'), regen === 'doer' ? 'import sys; sys.exit("generatoren doede")\n'
      : "open('docs/sitemap.xml', 'w').write('<lastmod>2026-09-27</lastmod>\\n')\n");
    writeFileSync(join(d, 'docs/sitemap.xml'), regen === 'afviger' ? '<lastmod>1900-01-01</lastmod>\n' : '<lastmod>2026-09-27</lastmod>\n');
    git('init', '-q', '-b', 'main'); git('add', 'extension', 'mcp-server', 'CHANGELOG.md', 'server.json', 'scripts', 'docs'); git('commit', '-q', '-m', 'kandidat');
    const origin = d + '-origin.git';
    execFileSync('git', ['clone', '-q', '--bare', d, origin]);
    git('remote', 'add', 'origin', origin); git('fetch', '-q', 'origin');
    if (foranOrigin) { writeFileSync(join(d, 'ny.txt'), 'x'); git('add', 'ny.txt'); git('commit', '-q', '-m', 'lokal'); }
    // En fil trin 1 IKKE roerer - ellers overskriver stand-in'en snavset, og proeven maaler intet.
    if (beskidt) writeFileSync(join(d, 'mcp-server/index.js'), 'server(); // ucommitteret\n');
    // En diff der ikke kan sammenligne (fx en ulaeselig fil) svarer 2 - ikke 0 og ikke 1.
    const shim = d + '-shim';
    mkdirSync(shim);
    if (diffKode !== null) {
      writeFileSync(join(shim, 'diff'), `#!/bin/bash\necho "diff: kan ikke laese" >&2\nexit ${diffKode}\n`);
      execFileSync('chmod', ['+x', join(shim, 'diff')]);
    }
    const skal = `set -euo pipefail
      # gate som scriptets egen: doer i ship, advarer i proevekoersel (linje «gate() {» i scriptet).
      ok(){ echo "OK:$*"; }; gate(){ if [[ "$SHIP" == 1 ]]; then die "$*"; else echo "GATE:$*"; fi; }; warn(){ echo "WARN:$*"; }; say(){ :; }; die(){ echo "DIE:$*"; exit 1; }
      SHIP=${ship ? 1 : 0}; PREPARE=0; NEW_VERSION=1.30.1; BRANCH=main; REPO_ROOT='${d}'
      trin1(){
        printf '{"version": "1.30.1"}\\n' > extension/manifest.json
        printf '## 1.30.1 (2020-01-01)\\n' > CHANGELOG.md
        cp server.json mcp-server/server.json
        ${trin1Fejler ? "false  # en kommando midt i trin 1 fejler - resten maa ALDRIG koere\n        echo SKULLE-IKKE-KOERE" : ''}
      }
      cd '${d}'
      if [[ "$SHIP" == 1 ]]; then trin1; fi
      ${blok}`;
    const r = spawnSync('bash', ['-c', skal], { encoding: 'utf8', env: { ...process.env, PATH: `${shim}:${process.env.PATH}` } });
    return { kode: r.status, ud: r.stdout + r.stderr };
  } finally {
    rmSync(d, { recursive: true, force: true }); rmSync(d + '-origin.git', { recursive: true, force: true });
    rmSync(d + '-shim', { recursive: true, force: true });
  }
}

test('ship: en forberedt, merget kandidat gaar videre', { skip: POSIX_SKRIPT }, () => {
  const r = koerKandidatBlok({ ship: true });
  assert.equal(r.kode, 0, r.ud);
  assert.match(r.ud, /OK:kandidaten er forberedt og merget/);
});

test('ship: et beskidt traee stopper foer butikken', { skip: POSIX_SKRIPT }, () => {
  const r = koerKandidatBlok({ ship: true, beskidt: true });
  assert.equal(r.kode, 1, r.ud);
  assert.match(r.ud, /DIE:kandidaten er ikke forberedt: trin 1 aendrede/);
});

test('ship: en committet men uforberedt kandidat stopper - trin 1 aendrer den', { skip: POSIX_SKRIPT }, () => {
  const r = koerKandidatBlok({ ship: true, forberedt: false });
  assert.equal(r.kode, 1, r.ud);
  assert.match(r.ud, /DIE:kandidaten er ikke forberedt: trin 1 aendrede/);
});

test('ship: en commit der ikke er paa origin/main stopper FOER butikken', { skip: POSIX_SKRIPT }, () => {
  const r = koerKandidatBlok({ ship: true, foranOrigin: true });
  assert.equal(r.kode, 1, r.ud);
  assert.match(r.ud, /DIE:HEAD er ikke paa origin\/main/);
});

test('proevekoersel: koerer trin 1 i en kopi og siger hvad den ville aendre - ogsaa en usynket server.json', { skip: POSIX_SKRIPT }, () => {
  const r = koerKandidatBlok({ ship: false, forberedt: false });
  assert.match(r.ud, /GATE:kandidaten er ikke forberedt - trin 1 ville aendre: .*manifest\.json/, r.ud);
  assert.doesNotMatch(r.ud, /OK:kandidaten v1\.30\.1 er forberedt/);
  const usynk = koerKandidatBlok({ ship: false, usynk: true });
  assert.match(usynk.ud, /GATE:kandidaten er ikke forberedt - trin 1 ville aendre: .*server\.json/,
    'en usynket mcp-server/server.json blev kaldt forberedt - ship ville doe paa den');
  const ok = koerKandidatBlok({ ship: false });
  assert.match(ok.ud, /OK:kandidaten v1\.30\.1 er forberedt/, ok.ud);
  assert.match(ok.ud, /OK:arbejdstraeet er rent/, ok.ud);
});

test('proevekoersel: ucommittede aendringer siges hoejt - ship ville stoppe paa dem', { skip: POSIX_SKRIPT }, () => {
  const r = koerKandidatBlok({ ship: false, beskidt: true });
  // 27/9: og den siger HVILKEN fil - paa GitHub-maskinen tav den, og aarsagen kunne ikke findes.
  assert.match(r.ud, /GATE:arbejdstraeet har ucommittede aendringer - ship ville stoppe paa dem: .*mcp-server\/index\.js/, r.ud);
});

test('pre-flight naevner forvaltede filer der allerede er beskidte - «clean» er kun rent (27/9)', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const fra = s.indexOf('MANAGED=(');
  const slutMarkoer = 'ok "working tree clean"\nfi\n';
  const blok = s.slice(fra, s.indexOf(slutMarkoer, fra) + slutMarkoer.length);
  assert.ok(fra > 0 && blok.includes('FORVALTET_BESKIDT'), 'pre-flight-blokken blev ikke fundet');
  const d = mkdtempSync(join(tmpdir(), 'preflight-snavs-'));
  const git = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    writeFileSync(join(d, 'README.md'), 'a\n'); writeFileSync(join(d, 'andet.txt'), 'a\n');
    git('init', '-q'); git('add', '.'); git('commit', '-q', '-m', 'a');
    const koer = () => spawnSync('bash', ['-c', `set -euo pipefail
      ok(){ echo "OK:$*"; }; warn(){ echo "WARN:$*"; }; die(){ echo "DIE:$*"; exit 1; }
      cd '${d}'; ALLOW_DIRTY=0
      ${blok}`], { encoding: 'utf8' });
    assert.match(koer().stdout, /OK:working tree clean/);
    writeFileSync(join(d, 'README.md'), 'b\n');
    const forvaltet = koer();
    assert.equal(forvaltet.status, 0, forvaltet.stdout + forvaltet.stderr);
    assert.match(forvaltet.stdout, /WARN:forvaltede filer er allerede aendret foer udgivelsen: README\.md;/,
      'en beskidt forvaltet fil blev kaldt «clean»');
    assert.doesNotMatch(forvaltet.stdout, /OK:working tree clean/);
    writeFileSync(join(d, 'andet.txt'), 'b\n');
    assert.match(koer().stdout, /DIE:commit\/stash these first/, 'en fremmed beskidt fil blev ikke stoppet');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('proevekoersel: et trin 1 der fejler MIDT I kaldes ikke forberedt (Astra R3)', { skip: POSIX_SKRIPT }, () => {
  // ⛔ 27/9: trin 1 blev kaldt inde i en `if`, og dér slaar bash fejlstoppet fra - ogsaa inde i
  // funktionen. En fejlet kommando fortsatte til `return 0`, og proevekoerslen meldte groent.
  const r = koerKandidatBlok({ ship: false, trin1Fejler: true });
  assert.match(r.ud, /GATE:trin 1 fejlede i en kopi af den committede kode/, r.ud);
  assert.doesNotMatch(r.ud, /OK:kandidaten v1\.30\.1 er forberedt/, 'et fejlet trin 1 blev kaldt forberedt');
  assert.doesNotMatch(r.ud, /SKULLE-IKKE-KOERE/, 'trin 1 fortsatte efter en fejlet kommando');
});

test('proevekoersel: en diff der ikke kan sammenligne er ikke «ens» (Astra R3)', { skip: POSIX_SKRIPT }, () => {
  const r = koerKandidatBlok({ ship: false, diffKode: 2 });
  assert.match(r.ud, /GATE:kandidaten kunne ikke efterproeves - diff svarede 2/, r.ud);
  assert.doesNotMatch(r.ud, /OK:kandidaten v1\.30\.1 er forberedt/, 'en diff-fejl blev kaldt en forberedt kandidat');
});

/** Koerer scriptets --prepare-afslutning i et lille repo med en stub-generator. */
function koerPrepareBlok(d, { generatorLaverNyFil = false } = {}) {
  const s = script();
  const gen = s.indexOf('python3 "$REPO_ROOT/scripts/generate-docs.py" >/dev/null || die "generate-docs.py fejlede"');
  const fra = s.lastIndexOf('if [[ "$PREPARE" == 1 ]]; then', gen);
  const blok = s.slice(fra, s.indexOf('\nfi\n', gen) + 4);
  assert.ok(fra > 0 && blok.includes('exit 0'), 'prepare-blokken blev ikke fundet');
  // Generatoren ligger i en SEPARAT rod (som scriptets REPO_ROOT) - ellers er den selv en ny fil i fixturen.
  const rodDir = d + '-rod';
  mkdirSync(join(rodDir, 'scripts'), { recursive: true });
  writeFileSync(join(rodDir, 'scripts/generate-docs.py'), `import datetime
open('docs/sitemap.xml','w').write('<lastmod>' + datetime.date.today().isoformat() + '</lastmod>\\n')
${generatorLaverNyFil ? "open('docs/ny-side.html','w').write('x')" : ''}
`);
  return spawnSync('bash', ['-c', `set -euo pipefail
    ok(){ echo "OK:$*"; }; say(){ echo "SAY:$*"; }; die(){ echo "DIE:$*"; exit 1; }
    cd '${d}'; PREPARE=1; NEW_VERSION=1.30.1; BRANCH=hotfix; REPO_ROOT='${rodDir}'
    ${blok}
    echo EFTER-BLOKKEN`], { encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
}

test('en kandidat hvis docs/ ikke genskabes af generatoren, naar ALDRIG butikken (Astra R4)', { skip: POSIX_SKRIPT }, () => {
  // Den strukturelle docs-vagt (check-docs.py) bestaar en forkert sitemap-dato; kun regen-diff ser den.
  const ship = koerKandidatBlok({ ship: true, regen: 'afviger' });
  assert.equal(ship.kode, 1, ship.ud);
  assert.match(ship.ud, /DIE:docs\/ afviger fra generatorens output paa kandidaten: .*docs\/sitemap\.xml/, ship.ud);
  const proeve = koerKandidatBlok({ ship: false, regen: 'afviger' });
  assert.match(proeve.ud, /GATE:docs\/ afviger fra generatorens output/, proeve.ud);
  const doer = koerKandidatBlok({ ship: true, regen: 'doer' });
  assert.equal(doer.kode, 1, doer.ud);
  assert.match(doer.ud, /DIE:docs-regenereringen kunne ikke koere paa kandidaten: .*generatoren doede/, doer.ud);
  const ok = koerKandidatBlok({ ship: true });
  assert.match(ok.ud, /OK:docs\/ genskabes uaendret af generatoren/, ok.ud);
  assert.equal(ok.kode, 0, ok.ud);
});

test('--prepare committer selv sit output - og en genkoersel committer intet nyt (Astra R3)', { skip: POSIX_SKRIPT }, () => {
  const d = mkdtempSync(join(tmpdir(), 'prepare-commit-'));
  const git = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    git('init', '-q', '-b', 'hotfix');
    mkdirSync(join(d, 'docs'));
    writeFileSync(join(d, 'docs/index.html'), 'v1.30.0'); writeFileSync(join(d, 'docs/sitemap.xml'), '<lastmod>2020-01-01</lastmod>\n');
    git('add', 'docs'); git('commit', '-q', '-m', 'start');
    // Det trin 1 goer: skriver versionen i en forvaltet fil.
    writeFileSync(join(d, 'docs/index.html'), 'v1.30.1');
    const r1 = koerPrepareBlok(d);
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.doesNotMatch(r1.stdout, /EFTER-BLOKKEN/, 'prepare fortsatte efter sin afslutning');
    assert.equal(git('log', '-1', '--format=%s').trim(), 'release: forbered v1.30.1', 'prepare committede ikke sit output');
    assert.equal(git('status', '--porcelain').trim(), '', 'prepare efterlod et beskidt traee');
    assert.match(git('show', '--name-only', '--format=', 'HEAD'), /docs\/sitemap\.xml/, 'sitemappet kom ikke med i samme commit');
    const foer = git('rev-parse', 'HEAD').trim();
    const r2 = koerPrepareBlok(d);
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /OK:kandidaten v1\.30\.1 var allerede forberedt/);
    assert.equal(git('rev-parse', 'HEAD').trim(), foer, 'en genkoersel lavede en tom eller ny commit');
    // En generator der skaber en NY fil: `git add -u` tager den ikke med, og det skal siges hoejt.
    const r3 = koerPrepareBlok(d, { generatorLaverNyFil: true });
    assert.equal(r3.status, 1, r3.stdout + r3.stderr);
    assert.match(r3.stdout, /DIE:prepare efterlod filer uden for commit'en/);
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(d + '-rod', { recursive: true, force: true }); }
});

test('--genoptag koerer paa den taggede commit (detached) - en almindelig udgivelse kraever stadig main', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const fra = s.indexOf('BRANCH="$(git branch --show-current)"');
  const blok = s.slice(fra, s.indexOf('\nfi\n', fra) + 4);
  assert.ok(blok.includes('GENOPTAG'), 'grenkontrollen kender ikke genoptagelse');
  const d = mkdtempSync(join(tmpdir(), 'genoptag-gren-'));
  const git = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    git('init', '-q', '-b', 'main'); git('commit', '-q', '--allow-empty', '-m', 'a'); git('tag', 'v1.30.1');
    git('commit', '-q', '--allow-empty', '-m', 'main flyttede sig'); git('checkout', '-q', 'v1.30.1');
    const koer = (genoptag) => spawnSync('bash', ['-c', `set -euo pipefail
      ok(){ echo "OK:$*"; }; die(){ echo "DIE:$*"; exit 1; }
      cd '${d}'; PREPARE=0; GENOPTAG=${genoptag}
      ${blok}`], { encoding: 'utf8' });
    assert.match(koer(1).stdout, /OK:genoptag: koerer paa/, 'genoptagelse paa den taggede commit blev afvist');
    assert.match(koer(0).stdout, /DIE:on branch '' - releases ship from 'main'/, 'en almindelig udgivelse gik igennem uden for main');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('genoptagelse checker tagget ud, og spaerren tester den samme commit (Astra R3)', () => {
  const wf = readFileSync(join(rod, '.github/workflows/udgivelse.yml'), 'utf8');
  const ref = "ref: ${{ inputs.genoptag && format('v{0}', inputs.version) || '' }}";
  const spaerreJob = wf.slice(wf.indexOf('  spaerre:'), wf.indexOf('  udgiv:'));
  assert.ok(spaerreJob.includes('with:') && spaerreJob.includes(ref), 'spaerren faar ikke tagget ved genoptagelse - den tester main');
  const udgivJob = wf.slice(wf.indexOf('  udgiv:'));
  const checkout = udgivJob.slice(udgivJob.indexOf('actions/checkout'), udgivJob.indexOf('actions/setup-node'));
  assert.ok(checkout.includes(ref), 'udgivelsen checker ikke tagget ud ved genoptagelse - main kan have flyttet sig');
  const sp = readFileSync(join(rod, '.github/workflows/spaerre.yml'), 'utf8');
  assert.match(sp, /workflow_call:\s*\n\s+inputs:\s*\n\s+ref:/, 'spaerren tager ikke imod en ref');
  const spCheckout = sp.slice(sp.indexOf('actions/checkout'), sp.indexOf('actions/setup-node'));
  assert.match(spCheckout, /ref: \$\{\{ inputs\.ref \|\| '' \}\}/, 'spaerrens checkout bruger ikke den ref den faar');
});
test('--prepare og --ship sammen afvises, og --prepare naegtes paa main', { skip: POSIX_SKRIPT }, () => {
  const kor = (args, cwd) => { try { execFileSync('bash', [join(rod, 'runbrowsermcpupdate.sh'), ...args], { cwd, encoding: 'utf8', stdio: 'pipe', env: { PATH: process.env.PATH, HOME: tmpdir() } }); return { kode: 0, ud: '' }; } catch (e) { return { kode: e.status, ud: String(e.stdout) + String(e.stderr) }; } };
  const begge = kor(['9.9.9', '--prepare', '--ship'], rod);
  assert.equal(begge.kode, 1);
  assert.match(begge.ud, /to trin/, 'kombinationen blev ikke afvist med en forklaring');

  // En lokal klon paa main: --prepare maa ikke skrive versionen direkte paa main.
  const d = mkdtempSync(join(tmpdir(), 'prepare-main-'));
  try {
    // ⛔ Astra 26/9: `--branch main` kraevede en LOKAL main i kilden - en PR-checkout paa CI har ingen.
    // main oprettes derfor i fixturen selv.
    execFileSync('git', ['clone', '-q', '--local', rod, d]);
    execFileSync('git', ['-C', d, 'checkout', '-q', '-B', 'main']);
    execFileSync('cp', [join(rod, 'runbrowsermcpupdate.sh'), join(d, 'runbrowsermcpupdate.sh')]);
    const paaMain = (() => { try { execFileSync('bash', ['runbrowsermcpupdate.sh', '9.9.9', '--prepare'], { cwd: d, encoding: 'utf8', stdio: 'pipe', env: { PATH: process.env.PATH, HOME: tmpdir() } }); return { kode: 0, ud: '' }; } catch (e) { return { kode: e.status, ud: String(e.stdout) + String(e.stderr) }; } })();
    assert.equal(paaMain.kode, 1, '--prepare koerte paa main');
    assert.match(paaMain.ud, /--prepare laves paa en gren/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('aerligheds-resultatet vaelges efter git-tid, ikke efter filtid', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const fra = s.indexOf('SENESTE_AERLIGHED=""; SENESTE_TID=0');
  const til = s.indexOf('done', fra) + 4;
  assert.ok(fra > 0, 'valget af aerligheds-resultat blev ikke fundet');
  const valg = s.slice(fra, til);
  const d = mkdtempSync(join(tmpdir(), 'aerlighed-valg-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: d, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
    git('init', '-q');
    mkdirSync(join(d, 'test/aerlighed'), { recursive: true });
    writeFileSync(join(d, 'test/aerlighed/RESULTAT-gammel.md'), 'a');
    git('add', '.'); git('commit', '-q', '-m', 'gammel', '--date', '2026-01-01T00:00:00');
    execFileSync('bash', ['-c', `cd '${d}' && GIT_COMMITTER_DATE=2026-01-01T00:00:00 git -c user.name=t -c user.email=t@t commit -q --amend --no-edit --date 2026-01-01T00:00:00`]);
    writeFileSync(join(d, 'test/aerlighed/RESULTAT-ny.md'), 'b');
    git('add', '.'); git('commit', '-q', '-m', 'ny');
    // Filtiden vendes om: den gamle faar den nyeste mtime, som paa en frisk checkout kan ske.
    execFileSync('touch', ['-t', '203001010000', join(d, 'test/aerlighed/RESULTAT-gammel.md')]);
    const valgt = execFileSync('bash', ['-c', `cd '${d}' && ${valg}\nprintf '%s' "$SENESTE_AERLIGHED"`], { encoding: 'utf8' });
    assert.equal(valgt, 'test/aerlighed/RESULTAT-ny.md', `valgte ${valgt} - filtiden vandt over git-tiden`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('udgivelses-workflowet: én ad gangen, genoptag springer kun butikken over, spaerrens resultat sendes med', () => {
  const wf = readFileSync(join(rod, '.github/workflows/udgivelse.yml'), 'utf8');
  // Forankret ved linjestart: `x-concurrency:` indeholder ordet og slap igennem mutationsbeviset.
  assert.match(wf, /^concurrency:\s*\n\s+group: udgivelse\s*\n\s+cancel-in-progress: false/m, 'to udgivelser kan koere samtidig');
  assert.match(wf, /SPAERRE_RESULTAT: \$\{\{ needs\.spaerre\.result \}\}/, 'spaerrens resultat sendes ikke med');
  assert.match(wf, /if \[\[ "\$GENOPTAG" == "true" \]\]; then[\s\S]*?flag\+=\(--skip-cws\)/, 'genoptag springer ikke butikken over');
  const s = script();
  assert.match(s, /if \[\[ "\$\{SPAERRE_RESULTAT:-\}" == "success" \]\]; then\s*\n\s*ok "flow-spaerren koerte/,
    'advarslen «i blinde» fjernes paa noget andet end spaerrens resultat');
});

test('--genoptag kraever tagget paa HEAD og butikkens eget ja', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const fn = s.slice(s.indexOf('genoptag_tjek() {'), s.indexOf('\n}', s.indexOf('genoptag_tjek() {')) + 2);
  // Blokken EFTER cws_har_version - grenkontrollen har en `elif [[ "$GENOPTAG" == 1 ]]` foer den.
  const fraBlok = s.indexOf('\nif [[ "$GENOPTAG" == 1 ]]; then', s.indexOf('cws_har_version() {')) + 1;
  const blok = s.slice(fraBlok, s.indexOf('\nfi\n', fraBlok) + 4);
  assert.ok(fn.length > 20 && blok.length > 50, 'genoptag-koden blev ikke fundet');
  const d = mkdtempSync(join(tmpdir(), 'genoptag-'));
  const git = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe', env: { ...process.env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  try {
    git('init', '-q'); writeFileSync(join(d, 'a'), 'a'); git('add', 'a'); git('commit', '-q', '-m', 'a');
    const koer = ({ ship = 1, butik = 0 }) => spawnSync('bash', ['-c', `set -euo pipefail
      ok(){ echo "OK:$*"; }; die(){ echo "DIE:$*"; exit 1; }
      cd '${d}'; SHIP=${ship}; GENOPTAG=1; NEW_VERSION=1.30.1
      ${fn}
      cws_har_version(){ return ${butik}; }
      ${blok}`], { encoding: 'utf8' });
    assert.match(koer({}).stdout, /DIE:--genoptag kraever tagget/, 'genoptag uden tag gik igennem - saa kan en ny version udgives uden butikken');
    git('tag', '-a', 'v1.30.1', '-m', 'v');
    assert.match(koer({ butik: 1 }).stdout, /DIE:--genoptag: butikken har ikke/, 'genoptag gik igennem selv om butikken ikke har versionen');
    assert.match(koer({ butik: 2 }).stdout, /DIE:--genoptag kan ikke spoerge butikken/);
    assert.match(koer({ butik: 0 }).stdout, /OK:butikken har v1\.30\.1/);
    assert.match(koer({ ship: 0 }).stdout, /DIE:--genoptag bruges kun med --ship/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('cws_har_version laeser butikkens svar: kun en revision med netop versionen tæller', { skip: POSIX_SKRIPT }, () => {
  const s = script();
  const slut = "sys.exit(1)' \"$v\"\n}";
  const fn = s.slice(s.indexOf('cws_har_version() {'), s.indexOf(slut) + slut.length);
  assert.ok(fn.includes('fetchStatus'), 'cws_har_version blev ikke fundet');
  const d = mkdtempSync(join(tmpdir(), 'cws-svar-'));
  try {
    const status = (json) => {
      writeFileSync(join(d, 'curl'), `#!/bin/bash\ncase "$*" in *oauth2*) echo '{"access_token":"T"}';; *) echo '${json}';; esac\n`);
      execFileSync('chmod', ['+x', join(d, 'curl')]);
      return spawnSync('bash', ['-c', `${fn}\ncws_har_version 1.30.1; echo "kode:$?"`], { encoding: 'utf8',
        env: { PATH: `${d}:${process.env.PATH}`, CWS_CLIENT_ID: 'c', CWS_REFRESH_TOKEN: 'r', CWS_PUBLISHER_ID: 'p', CWS_EXTENSION_ID: 'e' } }).stdout.trim();
    };
    assert.equal(status('{"submittedItemRevisionStatus":{"state":"PENDING_REVIEW","distributionChannels":[{"crxVersion":"1.30.1"}]}}'), 'kode:0');
    assert.equal(status('{"publishedItemRevisionStatus":{"state":"PUBLISHED","distributionChannels":[{"crxVersion":"1.30.1"}]}}'), 'kode:0');
    assert.equal(status('{"publishedItemRevisionStatus":{"state":"PUBLISHED","distributionChannels":[{"crxVersion":"1.30.0"}]}}'), 'kode:1',
      'en butik med en ANDEN version blev kaldt en butik med 1.30.1');
    for (const tilstand of ['REJECTED', 'CANCELLED']) {
      assert.equal(status(`{"submittedItemRevisionStatus":{"state":"${tilstand}","distributionChannels":[{"crxVersion":"1.30.1"}]}}`), 'kode:1',
        `en ${tilstand} indsendelse blev kaldt en butik der har versionen`);
    }
    assert.equal(status('<html>fejl</html>'), 'kode:1');
    const uden = spawnSync('bash', ['-c', `${fn}\ncws_har_version 1.30.1; echo "kode:$?"`], { encoding: 'utf8', env: { PATH: process.env.PATH } }).stdout.trim();
    assert.equal(uden, 'kode:2', 'uden noegler skal svaret vaere «kan ikke spoerge», ikke «nej»');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('sitets faste sider faar dagens dato naar filen er beskidt - ellers er prepare -> commit ikke stabilt', () => {
  const gen = readFileSync(join(rod, 'scripts/generate-docs.py'), 'utf8');
  const fn = gen.slice(gen.indexOf('def _fast_dato(relsti):'), gen.indexOf('\n_sm = ['));
  assert.ok(fn.includes('git'), '_fast_dato blev ikke fundet');
  const d = mkdtempSync(join(tmpdir(), 'fast-dato-'));
  try {
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      GIT_AUTHOR_DATE: '2020-01-01T12:00:00', GIT_COMMITTER_DATE: '2020-01-01T12:00:00' };
    execFileSync('git', ['init', '-q'], { cwd: d }); writeFileSync(join(d, 'index.html'), 'a');
    execFileSync('git', ['add', 'index.html'], { cwd: d }); execFileSync('git', ['commit', '-q', '-m', 'a'], { cwd: d, env });
    const kald = () => execFileSync('python3', ['-c', `import os, subprocess
REPO = ${JSON.stringify(d + '/')}
TODAY = 'I-DAG'
__file__ = ${JSON.stringify(join(d, 'x.py'))}
${fn}
print(_fast_dato('index.html'))`], { encoding: 'utf8' }).trim();
    assert.equal(kald(), '2020-01-01', 'en ren fil skal have sin commitdato');
    writeFileSync(join(d, 'index.html'), 'b');
    assert.equal(kald(), 'I-DAG', 'en beskidt fil fik sin gamle commitdato - saa aendres sitemap naar kandidaten committes');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('sitemap-datoen er den samme foer og efter prepares commit (Astra R3: commitgraensen)', () => {
  // prepare regenererer mens filen er beskidt (-> i dag) og committer i samme oejeblik (-> forfatterdato
  // = i dag). Proeven koerer den AEGTE _fast_dato med den aegte dato-kilde paa begge sider af commit'en.
  const gen = readFileSync(join(rod, 'scripts/generate-docs.py'), 'utf8');
  const fn = gen.slice(gen.indexOf('def _fast_dato(relsti):'), gen.indexOf('\n_sm = ['));
  const d = mkdtempSync(join(tmpdir(), 'fast-dato-graense-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  try {
    execFileSync('git', ['init', '-q'], { cwd: d }); writeFileSync(join(d, 'index.html'), 'v1.30.0');
    execFileSync('git', ['add', 'index.html'], { cwd: d });
    execFileSync('git', ['commit', '-q', '-m', 'gammel'], { cwd: d, env: { ...env, GIT_AUTHOR_DATE: '2020-01-01T12:00:00', GIT_COMMITTER_DATE: '2020-01-01T12:00:00' } });
    const kald = () => execFileSync('python3', ['-c', `import os, subprocess, datetime
REPO = ${JSON.stringify(d + '/')}
TODAY = datetime.date.today().isoformat()
__file__ = ${JSON.stringify(join(d, 'x.py'))}
${fn}
print(_fast_dato('index.html'))`], { encoding: 'utf8' }).trim();
    writeFileSync(join(d, 'index.html'), 'v1.30.1');
    const foerCommit = kald();
    execFileSync('git', ['commit', '-q', '-am', 'release: forbered v1.30.1'], { cwd: d, env });
    const efterCommit = kald();
    assert.notEqual(foerCommit, '2020-01-01', 'den beskidte fil fik sin gamle dato');
    assert.equal(efterCommit, foerCommit, `sitemap-datoen skiftede over commit'en (${foerCommit} -> ${efterCommit}) - docs-gaten ville regenerere noget andet`);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('udgivelses-workflowet installerer med npm ci og genoptager med --genoptag', () => {
  const wf = readFileSync(join(rod, '.github/workflows/udgivelse.yml'), 'utf8');
  assert.match(wf, /run: npm ci --prefix mcp-server/, 'npm install omskriver lockfilen, og ship doer paa et beskidt traee');
  assert.doesNotMatch(wf, /run: npm install --prefix mcp-server/);
  assert.match(wf, /flag\+=\(--genoptag\)/, 'genoptag bruger ikke scriptets --genoptag-vagter');
  assert.doesNotMatch(wf, /GENOPTAG[\s\S]{0,200}flag\+=\(--skip-cws\)/, 'genoptag springer stadig blindt butikken over');
});

test('det AEGTE trin 1: prepare lykkes, og en udgivelse bagefter aendrer intet - med scriptets shell-indstillinger', { skip: POSIX_SKRIPT }, () => {
  // ⛔ 27/9: trin 1 blev en funktion, og dens sidste kommando (`grep ... && die`) returnerede 1 i det
  // GODE tilfaelde. Med set -e doede hver rigtig udgivelse i trin 1. Proeverne brugte en stand-in for
  // trin 1 og kunne ikke se det; proevekoerslen mod den rigtige kode fandt det. Her koeres det AEGTE
  // trin 1 paa repoets egen committede kode: foerst som --prepare (skriver versionen), saa som ship
  // (skal intet have at skrive).
  const s = script();
  const fn = s.slice(s.indexOf('trin1() {'), s.indexOf('\n}\ntrin1\n') + 2);
  const toolcount = s.split('\n').find((l) => l.startsWith('TOOL_COUNT='));
  assert.ok(fn.length > 500 && toolcount, 'trin1 eller TOOL_COUNT blev ikke fundet');
  const prep = mkdtempSync(join(tmpdir(), 'trin1-prep-'));
  const ship = mkdtempSync(join(tmpdir(), 'trin1-ship-'));
  const koer = (d) => spawnSync('bash', ['-c', `set -euo pipefail
      R=''; Z=''; C=''; B=''; Y=''
      say(){ :; }; ok(){ :; }; warn(){ :; }; die(){ echo "DIE:$*"; exit 1; }; run(){ "$@"; }
      SHIP=1; NEW_VERSION='9.9.9'
      cd '${d}'
      ${toolcount}
      ${fn}
      trin1
      echo TRIN1-OK`], { encoding: 'utf8' });
  try {
    execFileSync('bash', ['-c', `git -C '${rod}' archive HEAD | tar -x -C '${prep}'`]);
    const r1 = koer(prep);
    assert.match(r1.stdout, /TRIN1-OK/, `trin 1 doede som --prepare (exit ${r1.status}): ${r1.stdout}${r1.stderr}`);
    execFileSync('bash', ['-c', `cp -R '${prep}/.' '${ship}/'`]);
    const r2 = koer(ship);
    assert.match(r2.stdout, /TRIN1-OK/, `trin 1 doede paa en forberedt kandidat (exit ${r2.status}): ${r2.stdout}${r2.stderr}`);
    const diff = spawnSync('diff', ['-rq', prep, ship], { encoding: 'utf8' });
    assert.equal(diff.status, 0, `trin 1 aendrede en forberedt kandidat - ship ville doe paa sit eget output (diff ${diff.status}):\n${diff.stdout}${diff.stderr}`);
  } finally { rmSync(prep, { recursive: true, force: true }); rmSync(ship, { recursive: true, force: true }); }
});
