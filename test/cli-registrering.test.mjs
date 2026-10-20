/**
 * `npx @agent360/browser-mcp install` skal registrere serveren hos de klienter brugeren faktisk har.
 *
 * Plan 8.2 (Fable, 11/9): installationen registrerede kun hos Claude Code; Codex, Cursor og VS Code var manuelle skridt,
 * selvom de er tre af de fire klienter guiderne naevner. Samtidig er foerste lektie fra juli stadig gaeldende: at skrive en
 * konfigurationsfil en klient ikke laeser, er en installation der siger succes og intet goer. Derfor:
 *   · Codex og VS Code registreres med deres EGNE kommandoer (codex mcp add, code --add-mcp).
 *   · Cursor har ingen kommando; dens globale fil ~/.cursor/mcp.json flettes, og eksisterende servere bevares.
 *   · En klient der ikke findes, roeres ikke, og der skrives ikke "registreret" om den.
 *
 * Testen koerer den rigtige bin/cli.js med et midlertidigt hjem og falske klient-kommandoer paa PATH, saa maskinens
 * rigtige Claude Code, Codex og VS Code aldrig roeres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(rod, 'mcp-server/bin/cli.js');

function installer({ klienter = [], codeKanAddMcp = true, cursor = false, cursorIndhold } = {}) {
  const hjem = mkdtempSync(join(tmpdir(), 'cli-hjem-'));
  const bin = mkdtempSync(join(tmpdir(), 'cli-bin-'));
  const log = join(hjem, 'kald.log');
  // MAALT 19/9: attrapperne var #!/bin/sh-scripts uden endelse, og PATH blev samlet med
  // ':'. Ingen af delene virker paa Windows, saa `codex` og `code` blev aldrig fundet,
  // og de to proever var roede der - laenge nok til at blokere hver eneste PR i repoet.
  // cli.js koerer rigtigt paa Windows for rigtige brugere, saa proeven skal ogsaa goere
  // det; en platform-skip ville skjule den ene platform hvor stien er svaerest.
  const win = process.platform === 'win32';
  for (const k of klienter) {
    const kanAdd = k === 'code' && codeKanAddMcp;
    if (win) {
      const hjaelp = kanAdd
        ? 'echo   --add-mcp ^<json^>  Adds a Model Context Protocol server definition'
        : 'echo.';
      writeFileSync(join(bin, k + '.cmd'),
        // MAALT 29/9 paa GitHub: cli.js citerer argumenterne gennem cmd.exe, saa %1 er "--help" MED citationstegn og
        // sammenligningen ramte aldrig - attrappen loggede «code --help», og --add-mcp blev aldrig fundet. %~1 fjerner dem.
        `@echo off\r\nif "%~1"=="--help" ( ${hjaelp} & exit /b 0 )\r\n` +
        `>>"${log}" echo ${k} %*\r\nexit /b 0\r\n`);
    } else {
      const hjaelp = kanAdd ? 'echo "  --add-mcp <json>  Adds a Model Context Protocol server definition"' : 'true';
      writeFileSync(join(bin, k), `#!/bin/sh\nif [ "$1" = "--help" ]; then ${hjaelp}; exit 0; fi\nprintf '%s\\n' "${k} $*" >> "${log}"\nexit 0\n`);
      chmodSync(join(bin, k), 0o755);
    }
  }
  if (!win) symlinkSync(process.execPath, join(bin, 'node'));
  if (cursor) {
    mkdirSync(join(hjem, '.cursor'));
    if (cursorIndhold !== undefined) writeFileSync(join(hjem, '.cursor', 'mcp.json'), cursorIndhold);
  }
  const r = spawnSync(process.execPath, [cli, 'install', '--skip-extension'], {
    encoding: 'utf8', timeout: 30000,
    shell: process.platform === 'win32',
    env: process.platform === 'win32'
      // R162 (Astra): ogsaa paa Windows et minimalt miljoe - brugerens Path og nodes mappe (hvor globale klienter kan ligge)
      // er ude; kun attrap-mappen og Windows' egne mapper, som cmd.exe skal bruge.
      ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT, TEMP: process.env.TEMP, TMP: process.env.TMP,
          Path: `${bin};${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`, HOME: hjem, USERPROFILE: hjem,
          APPDATA: join(hjem, 'AppData', 'Roaming'), LOCALAPPDATA: join(hjem, 'AppData', 'Local') }
      // 20/10: PATH bar hele nodes mappe, og dér ligger globalt installerede klienter (codex kom i nvm's mappe 20/10 17.29) -
      // installeren fandt saa den RIGTIGE codex og «registrerede» i en proeve, hvor ingen klienter maa findes. Kun node selv
      // laegges ind, som et link i attrap-mappen.
      : { PATH: `${bin}:/usr/bin:/bin`, HOME: hjem, USERPROFILE: hjem },
  });
  // MAALT 19/9: paa Windows koeres klienterne gennem cmd.exe med citerede argumenter
  // (ellers kan .cmd-attrapper slet ikke findes), saa loggen faar 'codex "mcp" "add" ...'.
  // Citaterne er et artefakt af skallen, ikke af det cli.js beder om. Normaliser dem vaek,
  // saa proeven maaler KALDET og ikke hvilken skal der laa imellem.
  const raa = existsSync(log) ? readFileSync(log, 'utf8') : '';
  // Kun paa Windows, og kun paa HELE tokens. Et foerste forsoeg brugte et globalt regex
  // og afciterede ogsaa JSON'ens indre noegler, saa argumentet ikke laengere var JSON -
  // ogsaa paa mac, hvor der intet var at rette. Skallens citering sidder yderst omkring
  // hvert argument; den pilles af dér og kun dér.
  const afciter = (t) => (t.length > 1 && t.startsWith('"') && t.endsWith('"')
    ? t.slice(1, -1).replace(/\\(["\\])/g, '$1') : t);
  const kald = process.platform === 'win32'
    ? raa.replace(/\r/g, '').split('\n').map((l) => l.split(' ').map(afciter).join(' ')).join('\n')
    : raa;
  const cursorFil = join(hjem, '.cursor', 'mcp.json');
  const cursorEfter = existsSync(cursorFil) ? readFileSync(cursorFil, 'utf8') : null;
  rmSync(bin, { recursive: true, force: true });
  rmSync(hjem, { recursive: true, force: true });
  return { status: r.status, ud: r.stdout + r.stderr, kald, cursorEfter };
}

test('install registrerer hos Codex med codex mcp add, naar codex findes', () => {
  const { status, ud, kald } = installer({ klienter: ['codex'] });
  assert.equal(status, 0, ud);
  assert.match(kald, /^codex mcp add browser-mcp -- npx @agent360\/browser-mcp@latest$/m, `codex blev ikke kaldt rigtigt: ${kald}`);
  assert.match(ud, /Codex/);
});

test('install registrerer hos VS Code med code --add-mcp, naar code kan det', () => {
  const { kald } = installer({ klienter: ['code'] });
  const linje = kald.split('\n').find((l) => l.startsWith('code --add-mcp '));
  assert.ok(linje, `code --add-mcp blev ikke kaldt: ${kald}`);
  const def = JSON.parse(linje.slice('code --add-mcp '.length));
  assert.deepEqual(def, { name: 'browser-mcp', command: 'npx', args: ['@agent360/browser-mcp@latest'] });
});

test('en VS Code uden --add-mcp faar ikke et flag den ikke kender', () => {
  const { kald } = installer({ klienter: ['code'], codeKanAddMcp: false });
  assert.doesNotMatch(kald, /--add-mcp/);
});

test('install fletter serveren ind i Cursors globale fil og bevarer de servere der stod der', () => {
  const { cursorEfter, ud } = installer({ cursor: true, cursorIndhold: JSON.stringify({ mcpServers: { anden: { command: 'x' } } }) });
  assert.ok(cursorEfter, 'Cursor-filen blev ikke skrevet');
  const d = JSON.parse(cursorEfter);
  assert.deepEqual(d.mcpServers.anden, { command: 'x' }, 'en eksisterende server blev fjernet');
  assert.deepEqual(d.mcpServers['browser-mcp'], { command: 'npx', args: ['@agent360/browser-mcp@latest'] });
  assert.match(ud, /Cursor/);
});

test('findes Cursor-mappen men ingen fil, oprettes filen', () => {
  const { cursorEfter } = installer({ cursor: true });
  assert.deepEqual(JSON.parse(cursorEfter || '{}').mcpServers?.['browser-mcp'], { command: 'npx', args: ['@agent360/browser-mcp@latest'] });
});

test('en Cursor-fil der ikke kan laeses, overskrives ikke', () => {
  const { cursorEfter } = installer({ cursor: true, cursorIndhold: '{ ikke gyldig json' });
  assert.equal(cursorEfter, '{ ikke gyldig json', 'brugerens Cursor-konfiguration blev overskrevet');
});

// SIKKERHED (20/10): paa Windows soeger cmd.exe og CreateProcess i arbejdsmappen foer PATH. En codex.bat i den mappe, brugeren
// koerer `install` fra, maa aldrig koere - heller ikke en where.exe dér. Proeven koerer koerKlient fra cli.js med falsk platform.
function klientKilde() {
  const kilde = readFileSync(cli, 'utf8');
  const i = kilde.indexOf('function koerKlient(');
  assert.ok(i >= 0, 'fandt ikke koerKlient i cli.js');
  let d = 0;
  // kroppen starter efter parameterlisten (`valg = {}` har sin egen kroelparentes)
  for (let k = kilde.indexOf(') {', i) + 2; k < kilde.length; k++) {
    if (kilde[k] === '{') d++;
    else if (kilde[k] === '}' && --d === 0) return kilde.slice(i, k + 1);
  }
  throw new Error('koerKlient: ingen afsluttende kroelparentes');
}
test('SIKKERHED (Windows): installeren koerer aldrig en klient eller where.exe fra arbejdsmappen', async () => {
  const { win32 } = await import('node:path');
  const lav = (whereSvar, cwd = 'C:\\proj') => {
    const kald = [];
    const execFileSync = (k, args, valg) => {
      kald.push({ k, args, valg });
      if (kald.length === 1) { if (whereSvar instanceof Error) throw whereSvar; return whereSvar; }
      return 'ok';
    };
    const proc = { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, cwd: () => cwd };
    const fn = new Function('execFileSync', 'process', 'join', 'dirname', `${klientKilde()}; return koerKlient;`)(execFileSync, proc, win32.join, win32.dirname);
    return { fn, kald };
  };
  const a = lav('C:\\proj\\codex.bat\r\nC:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd\r\n');
  a.fn('codex', ['mcp', 'add'], { stdio: 'pipe' });
  assert.equal(a.kald[0].k, 'C:\\Windows\\System32\\where.exe', `where skal koeres ved absolut sti, fik ${a.kald[0].k}`);
  assert.equal(a.kald[0].valg.cwd, 'C:\\Windows\\System32', 'where skal koere uden for brugerens arbejdsmappe');
  assert.equal(a.kald[0].valg.env.NoDefaultCurrentDirectoryInExePath, '1');
  assert.equal(a.kald.length, 2);
  assert.match(String(a.kald[1].k), /AppData\\Roaming\\npm\\codex\.cmd/, `klienten skal koeres ved den fundne absolutte sti uden for arbejdsmappen, fik ${a.kald[1].k}`);
  assert.doesNotMatch(String(a.kald[1].k), /\\proj\\/, 'en codex.bat i arbejdsmappen blev koert');
  assert.equal(a.kald[1].valg.env.NoDefaultCurrentDirectoryInExePath, '1');
  // R165 (Astra): skallen er System32's cmd.exe ved absolut sti - ikke «cmd.exe» ved navn, som Node falder tilbage paa uden ComSpec.
  assert.equal(a.kald[1].valg.shell, 'C:\\Windows\\System32\\cmd.exe', `skallen skal vaere System32's cmd.exe, fik ${a.kald[1].valg.shell}`);
  // R165 (Astra): kun selve arbejdsmappen afvises. Koeres install fra hjemmemappen (PowerShells standard), ligger npm's globale
  // programmer, Claude Code og VS Code i UNDERMAPPER af den - de er installeret og skal findes.
  for (const [cwd, klient] of [
    ['C:\\Users\\u', 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd'],
    ['C:\\Users\\u\\', 'C:\\Users\\u\\.local\\bin\\claude.exe'],
    ['C:\\', 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd'],
  ]) {
    const h = lav(`${klient}\r\n`, cwd);
    h.fn('codex', ['mcp'], {});
    assert.equal(h.kald.length, 2, `fra ${cwd} blev ${klient} afvist som om den laa i arbejdsmappen`);
    assert.equal(h.kald[1].k, `"${klient}"`);
  }
  const hjemFil = lav('C:\\Users\\u\\codex.bat\r\n', 'C:\\Users\\U');
  assert.throws(() => hjemFil.fn('codex', ['mcp'], {}), (e) => e.code === 'ENOENT', 'en codex.bat direkte i arbejdsmappen (anden skrivemaade) blev koert');
  const rodFil = lav('C:\\codex.bat\r\n', 'C:\\');
  assert.throws(() => rodFil.fn('codex', ['mcp'], {}), (e) => e.code === 'ENOENT', 'en codex.bat i drevets rod blev koert, da install koerte fra roden');
  const kunCwd = lav('C:\\proj\\codex.bat\r\n');
  assert.throws(() => kunCwd.fn('codex', ['mcp'], {}), (e) => e.code === 'ENOENT', 'en klient der kun findes i arbejdsmappen, er ikke installeret');
  assert.equal(kunCwd.kald.length, 1, 'og intet andet koeres');
  const ingen = lav(Object.assign(new Error('INFO: Could not find files'), { status: 1 }));
  assert.throws(() => ingen.fn('codex', ['mcp'], {}), (e) => e.code === 'ENOENT');
  assert.equal(ingen.kald.length, 1);
  // R164 (Astra): kunne opslaget ikke koeres (where.exe mangler, adgang naegtet), er klienten IKKE dermed «ikke installeret».
  for (const fejl of [Object.assign(new Error('spawn where.exe ENOENT'), { code: 'ENOENT' }), Object.assign(new Error('EACCES'), { code: 'EACCES' })]) {
    const f = lav(fejl);
    assert.throws(() => f.fn('codex', ['mcp'], {}), (e) => e.code === 'OPSLAG_FEJLEDE', `en opslagsfejl (${fejl.code}) blev til «ikke installeret»`);
  }
});

test('en opslagsfejl siges som «kunne ikke tjekke», ikke som «installeret» eller tavst «ikke installeret» (R164)', () => {
  const kilde = readFileSync(cli, 'utf8');
  const hent = (navn) => {
    const i = kilde.indexOf(`function ${navn}(`);
    let d = 0;
    for (let k = kilde.indexOf(') {', i) + 2; k < kilde.length; k++) {
      if (kilde[k] === '{') d++; else if (kilde[k] === '}' && --d === 0) return kilde.slice(i, k + 1);
    }
    throw new Error(`${navn} blev ikke fundet i cli.js`);
  };
  const koer = (navn) => {
    const linjer = [];
    const koerKlient = () => { throw Object.assign(new Error('could not check'), { code: 'OPSLAG_FEJLEDE' }); };
    const fn = new Function('koerKlient', 'console', 'SERVER_NAVN', 'SERVER_KOMMANDO', 'SERVER_ARGS', `${hent(navn)}; return ${navn};`)(
      koerKlient, { log: (t) => linjer.push(t) }, 'browser-mcp', 'npx', ['@agent360/browser-mcp@latest']);
    return { svar: fn(), tekst: linjer.join('\n') };
  };
  const codex = koer('registerWithCodex');
  assert.equal(codex.svar, false, 'Codex: en opslagsfejl maa ikke give null (tavst sprunget over)');
  assert.match(codex.tekst, /Could not check whether Codex is installed/);
  assert.doesNotMatch(codex.tekst, /Codex is installed, but/);
  const vsc = koer('registerWithVSCode');
  assert.equal(vsc.svar, false, 'VS Code: en opslagsfejl maa ikke give null (tavst sprunget over)');
  assert.match(vsc.tekst, /Could not check whether VS Code is installed/);
  const claude = koer('registerWithClaudeCode');
  assert.equal(claude.svar, false);
  assert.match(claude.tekst, /could not check whether the `claude` command is installed/);
  assert.doesNotMatch(claude.tekst, /command was not found/);
});

test('klienter der ikke findes, roeres ikke og kaldes ikke registreret', () => {
  const { status, ud, kald, cursorEfter } = installer({});
  assert.equal(status, 0, ud);
  assert.equal(kald, '');
  assert.equal(cursorEfter, null, 'en Cursor-fil blev oprettet uden at Cursor findes');
  assert.doesNotMatch(ud, /Registered with (Codex|Cursor|VS Code)/, 'installationen paastod en registrering der ikke skete');
  // R163 (Opus): paa Windows gav en manglende codex et ikke-nul exit fra cmd.exe i stedet for ENOENT, og installeren skrev
  // «Codex is installed, but registration failed» til hver Windows-bruger uden Codex.
  assert.doesNotMatch(ud, /Codex is installed/, 'installationen paastod at Codex er installeret, selv om den ikke findes');
});

// MAALT 13/9 paa den KOLDE sti, som en ny bruger gaar den: `npx @agent360/browser-mcp --version`
// faldt igennem til hjaelpeteksten. Det er praecis den kommando en bruger koerer naar de melder
// en fejl, og de fik et afsnit uden et eneste tal i. Vi bad dem om versionen i fejl-skabelonen
// og gav dem ingen maade at finde den paa.
test('--version skriver pakkens version, ikke hjaelpeteksten', () => {
  const forventet = JSON.parse(readFileSync(join(rod, 'mcp-server/package.json'), 'utf8')).version;
  for (const flag of ['--version', '-v']) {
    const r = spawnSync(process.execPath, [cli, flag], { encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, `${flag} gav exit ${r.status}`);
    assert.equal(r.stdout.trim(), forventet,
      `${flag} skrev ikke versionen. En bruger der skal oplyse sin version, faar ${JSON.stringify(r.stdout.slice(0, 60))}`);
    assert.doesNotMatch(r.stdout, /Usage:/,
      `${flag} skriver stadig hele hjaelpeteksten - tallet drukner i den`);
  }
});

test('hjaelpeteksten naevner --version, ellers finder ingen den', () => {
  const r = spawnSync(process.execPath, [cli, 'sludder'], { encoding: 'utf8', timeout: 30000 });
  assert.match(r.stdout, /--version/, 'hjaelpeteksten fortaeller ikke at flaget findes');
});
