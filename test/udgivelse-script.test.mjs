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

test('release-scriptet koerer ny_tag_tjek paa ny-vejen', () => {
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
  const stage = script().slice(script().indexOf('run git add '), script().indexOf('run git add ') + 420);
  assert.match(stage, /CHANGELOG\.md/, 'CHANGELOG.md stages ikke - omskrivningen naar aldrig ud i pushet');
});

// MAALT samme runde: fejler koerslen EFTER butiks-uploaden men FOER npm, afviser butikken den samme version ved en
// genkoersel, og scriptet doer foer GitHub. Hintet om --skip-cws stod kun paa genoptag-stien, som ligger efter npm.
test('butikstrinnet siger selv hvad man goer, hvis koerslen fejler efter det', () => {
  const i = script().indexOf('3. Chrome Web Store publish');
  assert.ok(i > -1, 'butikstrinnet findes');
  const blok = script().slice(i, i + 900);
  assert.match(blok, /warn "fejler koerslen EFTER dette trin, saa koer igen med --skip-cws/,
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
  const iGitHub = k.indexOf('4. GitHub: commit');
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
  const blok = k.slice(k.indexOf('2b. Flow-spaerre'), k.indexOf('Chrome Web Store publish'));
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

test('--skip-flow giver fritagelsen videre til butikstrinnet i stedet for at draebe det', () => {
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
  const nulstil = kode.indexOf('unset BMCP_FLOW_OK');
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
  const slut = c.indexOf('\nfi', c.indexOf('npm --prefix mcp-server run flow', start));
  const blok = c.slice(start, slut);
  // else-grenen erstattes af ét ord, saa vi maaler HVILKEN gren der vaelges uden at koere flow-testen.
  const linjer = blok.split('\n');
  const iElse = linjer.findIndex((l) => l === 'else');
  assert.ok(iElse > -1, 'else-grenen findes ikke - saa er der ingen gren der faktisk koerer flow-testen');
  return `${linjer.slice(0, iElse + 1).join('\n')}\n  echo KOERER_TESTEN\nfi`;
}

test('butikstrinnet alene koerer stadig flow-spaerren - beviset kommer kun fra trin 2b', () => {
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
