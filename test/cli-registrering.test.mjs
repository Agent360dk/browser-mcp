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
// koerer `install` fra, maa aldrig koere. Proeven koerer koerKlient fra cli.js med falsk platform, falsk PATH og falsk filsystem.
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
test('SIKKERHED (Windows): installeren koerer aldrig en klient fra arbejdsmappen, og finder klienterne under den', async () => {
  const { win32 } = await import('node:path');
  // Et falsk filsystem og en falsk PATH: koerKlient fra cli.js slaar selv op i PATH (R165), saa proeven bestemmer, hvilke filer
  // der findes, og ser hvad der koeres.
  const lav = ({ path, filer = [], mapper = [], aliaser = {}, appAlias = [], appAliasLink = [], doede = [], mappeLinks = [], utilgaengelige = [], cwd = 'C:\\proj', pathext = '.COM;.EXE;.BAT;.CMD', noegle = 'Path', comspec }) => {
    const kald = [];
    const tjekket = [];
    const execFileSync = (k, args, valg) => { kald.push({ k, args, valg }); return 'ok'; };
    const env = { SystemRoot: 'C:\\Windows', PATHEXT: pathext, [noegle]: path, ...(comspec ? { ComSpec: comspec } : {}) };
    const proc = { platform: 'win32', env, cwd: () => cwd };
    const lc = (x) => String(x).toLowerCase();
    // Som Windows: en relativ sti slaas op i arbejdsmappen, og et alias (8.3-navn, \\?\, junction) er samme mappe som sit maal.
    const aegte = (p) => {
      let r = win32.resolve(cwd, String(p));
      for (const [a, b] of Object.entries(aliaser)) if (lc(r) === lc(a) || lc(r).startsWith(lc(a) + '\\')) r = b + r.slice(a.length);
      return win32.resolve(r);
    };
    const kendte = new Set([cwd, ...mapper, ...utilgaengelige, ...[...filer, ...appAlias, ...appAliasLink, ...doede, ...mappeLinks].map((f) => win32.dirname(f))].map((m) => lc(aegte(m))));
    const realpathSync = { native: (p) => {
      // R167 (Astra): paa et netdrev kan realpath fejle med EACCES, selv om mappen og klienten findes.
      if (utilgaengelige.some((x) => lc(win32.resolve(x)) === lc(win32.resolve(cwd, String(p))))) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      const r = aegte(p); if (!kendte.has(lc(r))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return r;
    } };
    const statSync = (f) => {
      const r = lc(aegte(f)); tjekket.push(r);
      // R168 (Opus): ogsaa isSymbolicLink, saa en regel ikke kan bestaa via en TypeError.
      if (filer.some((x) => lc(x) === r)) return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
      if (mapper.some((x) => lc(x) === r)) return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
      // R168 (Opus N5): et link til en mappe, stat ikke maa aabne (ACL), giver EPERM; lstat ser kun linket.
      if (mappeLinks.some((x) => lc(x) === r)) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      // R167 (Opus L3b): en libuv, der falder tilbage til lstat for en App Execution Alias, svarer stat med et link.
      if (appAliasLink.some((x) => lc(x) === r)) return { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true };
      const alias = appAlias.some((x) => lc(x) === r);   // en App Execution Alias kan ikke stat'es (Node #36790)
      throw Object.assign(new Error(alias ? 'EACCES' : 'ENOENT'), { code: alias ? 'EACCES' : 'ENOENT' });
    };
    // En App Execution Alias og et doedt symlink kan begge lstat'es, men ikke stat'es: aliaset giver EACCES, det doede link ENOENT.
    const lstatSync = (f) => [...appAlias, ...doede, ...mappeLinks].some((x) => lc(x) === lc(aegte(f))) ? { isDirectory: () => false, isSymbolicLink: () => true } : statSync(f);
    const existsSync = (f) => { try { statSync(f); return true; } catch { return false; } };
    const fn = new Function('execFileSync', 'process', 'join', 'dirname', 'resolve', 'isAbsolute', 'existsSync', 'statSync', 'lstatSync', 'realpathSync',
      `${klientKilde()}; return koerKlient;`)(execFileSync, proc, win32.join, win32.dirname, win32.resolve, win32.isAbsolute, existsSync, statSync, lstatSync, realpathSync);
    return { fn, kald, tjekket };
  };
  const NPM = 'C:\\Users\\u\\AppData\\Roaming\\npm';
  // Windows' filsystem skelner ikke store og smaa bogstaver; endelsen kommer fra PATHEXT (.CMD).
  const lig = (faktisk, forventet, besked) => assert.equal(String(faktisk).toLowerCase(), String(forventet).toLowerCase(), besked);
  const koert = (h) => { h.fn('codex', ['mcp', 'add'], { stdio: 'pipe' }); assert.equal(h.kald.length, 1, 'netop én proces: klienten'); return h.kald[0]; };
  const ikke = (h, hvorfor) => { assert.throws(() => h.fn('codex', ['mcp'], {}), (e) => e.code === 'ENOENT', hvorfor); assert.deepEqual(h.kald, [], `${hvorfor} - og intet koeres`); };

  // Arbejdsmappen staar paa PATH og har en codex.bat: den springes over, og den rigtige klient koeres ved fuld sti.
  const a = koert(lav({ path: `C:\\proj;${NPM};C:\\Windows\\System32`, filer: ['C:\\proj\\codex.bat', `${NPM}\\codex.cmd`] }));
  lig(a.k, `"${NPM}\\codex.cmd"`, `klienten skal koeres ved den fundne fulde sti, fik ${a.k}`);
  assert.equal(a.valg.shell, 'C:\\Windows\\System32\\cmd.exe', `skallen skal vaere System32's cmd.exe, fik ${a.valg.shell}`);
  assert.equal(a.valg.env.NoDefaultCurrentDirectoryInExePath, '1');
  // Kun i arbejdsmappen, i en relativ PATH-post eller i arbejdsmappens node_modules (npx) = ikke installeret.
  ikke(lav({ path: 'C:\\proj', filer: ['C:\\proj\\codex.bat'] }), 'en klient der kun findes i arbejdsmappen, er ikke installeret');
  ikke(lav({ path: '.;bin;C:\\Windows\\System32', filer: ['C:\\proj\\codex.bat', 'C:\\proj\\bin\\codex.cmd'] }), 'en relativ PATH-post peger ind i arbejdsmappen');
  ikke(lav({ path: 'C:\\proj\\node_modules\\.bin', filer: ['C:\\proj\\node_modules\\.bin\\codex.cmd'] }), 'arbejdsmappens node_modules er arbejdsmappens');
  ikke(lav({ path: 'C:\\PROJ\\', filer: ['C:\\proj\\codex.bat'], cwd: 'c:\\proj' }), 'arbejdsmappen med anden skrivemaade');
  ikke(lav({ path: `${NPM};C:\\Windows\\System32`, filer: [] }), 'findes klienten ingen steder, er den ikke installeret');
  // R165 (Astra + Opus): fra hjemmemappen (PowerShells standard) og drevets rod ligger klienterne i UNDERMAPPER - de findes.
  for (const [cwd, mappe, fil] of [
    ['C:\\Users\\u', NPM, 'codex.cmd'],
    ['C:\\Users\\u\\', 'C:\\Users\\u\\.local\\bin', 'codex.exe'],
    ['C:\\', 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\bin', 'codex.cmd'],
  ]) {
    const k = koert(lav({ path: `${mappe};C:\\Windows\\System32`, filer: [`${mappe}\\${fil}`], cwd }));
    lig(k.k, `"${mappe}\\${fil}"`, `fra ${cwd} blev ${mappe}\\${fil} ikke fundet, eller stien blev ikke citeret`);
  }
  ikke(lav({ path: 'C:\\', filer: ['C:\\codex.bat'], cwd: 'C:\\' }), 'en codex.bat i drevets rod, naar install koerer fra roden');
  // R165 (Opus): en sti med ø (et dansk brugernavn) koeres som den er.
  const oe = koert(lav({ path: 'C:\\Users\\Søren\\AppData\\Roaming\\npm', filer: ['C:\\Users\\Søren\\AppData\\Roaming\\npm\\codex.cmd'] }));
  lig(oe.k, '"C:\\Users\\Søren\\AppData\\Roaming\\npm\\codex.cmd"');
  // R165 (Opus): npm's skript uden endelse ved siden af codex.cmd vaelges ikke; kun PATHEXT's endelser, i PATHEXT's raekkefoelge.
  lig(koert(lav({ path: NPM, filer: [`${NPM}\\codex`, `${NPM}\\codex.cmd`] })).k, `"${NPM}\\codex.cmd"`);
  lig(koert(lav({ path: NPM, filer: [`${NPM}\\codex.cmd`, `${NPM}\\codex.exe`] })).k, `"${NPM}\\codex.exe"`, '.EXE kommer foer .CMD i PATHEXT');
  // PATH's raekkefoelge afgoer, citerede poster virker, og variabelnavnet er uden forskel paa store og smaa bogstaver.
  lig(koert(lav({ path: `"C:\\A b";${NPM}`, filer: ['C:\\A b\\codex.cmd', `${NPM}\\codex.cmd`] })).k, '"C:\\A b\\codex.cmd"');
  lig(koert(lav({ path: NPM, filer: [`${NPM}\\codex.cmd`], noegle: 'PATH' })).k, `"${NPM}\\codex.cmd"`);
  // R166 (Astra): et traef skal vaere en fil. En MAPPE ved navn codex.exe (eller codex.cmd i en tidligere PATH-mappe) skygger ikke.
  lig(koert(lav({ path: 'C:\\tools', mapper: ['C:\\tools\\codex.exe'], filer: ['C:\\tools\\codex.cmd'] })).k, '"C:\\tools\\codex.cmd"');
  lig(koert(lav({ path: 'C:\\A;C:\\B', mapper: ['C:\\A', 'C:\\A\\codex.cmd'], filer: ['C:\\B\\codex.cmd'] })).k, '"C:\\B\\codex.cmd"');
  // R166 (Astra): et andet navn for arbejdsmappen er stadig arbejdsmappen - 8.3-navn, \\?\-sti, junction - og node_modules-roden er dens.
  ikke(lav({ path: 'C:\\LONGPR~1', filer: ['C:\\Long Project\\codex.bat'], cwd: 'C:\\Long Project', aliaser: { 'C:\\LONGPR~1': 'C:\\Long Project' } }), 'et 8.3-navn for arbejdsmappen');
  ikke(lav({ path: '\\\\?\\C:\\proj', filer: ['C:\\proj\\codex.bat'], aliaser: { '\\\\?\\C:\\proj': 'C:\\proj' } }), 'en \\\\?\\-sti til arbejdsmappen');
  ikke(lav({ path: 'C:\\link', filer: ['C:\\proj\\codex.bat'], aliaser: { 'C:\\link': 'C:\\proj' } }), 'en junction til arbejdsmappen');
  ikke(lav({ path: 'C:\\proj\\node_modules', filer: ['C:\\proj\\node_modules\\codex.cmd'] }), 'arbejdsmappens node_modules-rod');
  ikke(lav({ path: 'C:\\proj\\node_modules\\pakke\\bin', filer: ['C:\\proj\\node_modules\\pakke\\bin\\codex.cmd'] }), 'en mappe under arbejdsmappens node_modules');
  ikke(lav({ path: 'C:\\findes-ikke', filer: [] }), 'en PATH-mappe der ikke findes');
  // En App Execution Alias (WindowsApps) kan ikke stat'es, men er et program.
  const WA = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps';
  lig(koert(lav({ path: WA, appAlias: [`${WA}\\codex.exe`] })).k, `"${WA}\\codex.exe"`);
  lig(koert(lav({ path: WA, appAliasLink: [`${WA}\\codex.exe`] })).k, `"${WA}\\codex.exe"`, 'en App Execution Alias, som stat melder som link');
  // PATHEXT fra miljoeet afgoer raekkefoelgen (ikke en indbygget standard), og en endelse med bindestreg er en endelse.
  lig(koert(lav({ path: NPM, filer: [`${NPM}\\codex.cmd`, `${NPM}\\codex.exe`], pathext: '.CMD;.EXE' })).k, `"${NPM}\\codex.cmd"`);
  lig(koert(lav({ path: NPM, filer: [`${NPM}\\codex.my-ext`], pathext: '.MY-EXT' })).k, `"${NPM}\\codex.my-ext"`);
  // R166 (Opus): en drevrelativ post (C:bin) er ogsaa relativ til arbejdsmappen.
  ikke(lav({ path: 'C:bin', filer: ['C:\\proj\\bin\\codex.cmd'] }), 'en drevrelativ PATH-post');
  // R166 (Opus): npx laegger ogsaa forfaedrenes node_modules\.bin paa PATH, og C:\node_modules kan oprettes af enhver bruger.
  ikke(lav({ path: 'C:\\node_modules\\.bin', filer: ['C:\\node_modules\\.bin\\codex.cmd'], cwd: 'C:\\Users\\u' }), 'en forfaders node_modules\\.bin');
  ikke(lav({ path: 'C:\\Users\\node_modules\\.bin', filer: ['C:\\Users\\node_modules\\.bin\\codex.cmd'], cwd: 'C:\\Users\\u\\x' }), 'en anden forfaders node_modules\\.bin');
  // R166 (Opus): mappen foer endelsen - .cmd i foerste PATH-mappe slaar .exe i anden, som hos cmd.exe.
  lig(koert(lav({ path: 'C:\\A;C:\\B', filer: ['C:\\A\\codex.cmd', 'C:\\B\\codex.exe'] })).k, '"C:\\A\\codex.cmd"');
  // R166 (Opus): tomme PATHEXT-poster er ingen endelse - ellers kommer npm's skript uden endelse tilbage (N3).
  lig(koert(lav({ path: NPM, filer: [`${NPM}\\codex`, `${NPM}\\codex.cmd`], pathext: ';.COM;;.CMD;' })).k, `"${NPM}\\codex.cmd"`);
  // R166 (Opus): ComSpec fra miljoeet aendrer ikke skallen - den er System32's cmd.exe ved absolut sti.
  lig(koert(lav({ path: NPM, filer: [`${NPM}\\codex.cmd`], comspec: 'cmd.exe' })).valg.shell, 'C:\\Windows\\System32\\cmd.exe');
  // R167 (Astra): et doedt symlink er intet program - den gyldige codex.cmd ved siden af (eller i en senere mappe) vaelges.
  lig(koert(lav({ path: 'C:\\tools', doede: ['C:\\tools\\codex.exe'], filer: ['C:\\tools\\codex.cmd'] })).k, '"C:\\tools\\codex.cmd"');
  lig(koert(lav({ path: 'C:\\A;C:\\B', mapper: ['C:\\A'], doede: ['C:\\A\\codex.cmd'], filer: ['C:\\B\\codex.cmd'] })).k, '"C:\\B\\codex.cmd"');
  // R167 (Astra): filteret gaelder baade den skrevne og den aegte sti - en junction maa ikke foere node_modules\.bin uden om det.
  ikke(lav({ path: 'C:\\proj\\node_modules\\.bin', filer: ['C:\\proj\\payload\\codex.cmd'], aliaser: { 'C:\\proj\\node_modules\\.bin': 'C:\\proj\\payload' } }), 'node_modules\\.bin som junction til en anden mappe i projektet');
  ikke(lav({ path: 'C:\\proj\\node_modules\\.bin', filer: ['D:\\packages\\.bin\\codex.cmd'], aliaser: { 'C:\\proj\\node_modules': 'D:\\packages' } }), 'node_modules som junction til et andet drev');
  // R167 (Astra): arbejdsmappen sammenlignes ogsaa paa sin aegte sti - koeres install fra et 8.3-navn, er det lange navn stadig arbejdsmappen.
  ikke(lav({ path: 'C:\\Long Project', filer: ['C:\\Long Project\\codex.bat'], cwd: 'C:\\LONGPR~1', aliaser: { 'C:\\LONGPR~1': 'C:\\Long Project' } }), 'arbejdsmappens lange navn, naar install koerer fra 8.3-navnet');
  // R167 (Astra): kan realpath ikke laese en netdrevsmappe (EACCES), bruges den skrevne sti - klienten dér findes stadig.
  lig(koert(lav({ path: 'Z:\\bin', utilgaengelige: ['Z:\\bin'], filer: ['Z:\\bin\\codex.cmd'] })).k, '"Z:\\bin\\codex.cmd"');
  // R168 (Astra): hver regel ser begge stavemaader og er uden forskel paa store og smaa bogstaver.
  ikke(lav({ cwd: 'C:\\LONGPR~1', path: 'C:\\Long Project\\node_modules\\pkg\\bin', aliaser: { 'C:\\LONGPR~1': 'C:\\Long Project' },
    filer: ['C:\\Long Project\\node_modules\\pkg\\bin\\codex.cmd'] }), 'arbejdsmappen i 8.3-form, dens node_modules i lang form');
  ikke(lav({ cwd: 'R:\\proj', path: 'R:\\proj', utilgaengelige: ['R:\\proj'], filer: ['R:\\proj\\codex.bat'] }), 'arbejdsmappen, naar realpath ikke kan laese den');
  ikke(lav({ path: 'C:\\proj\\node_modules', aliaser: { 'C:\\proj\\node_modules': 'D:\\packages' }, filer: ['D:\\packages\\codex.cmd'] }), 'node_modules-roden som junction til et andet drev');
  ikke(lav({ path: 'C:\\x', aliaser: { 'C:\\x': 'C:\\proj\\NODE_MODULES\\pkg\\bin' }, filer: ['C:\\proj\\NODE_MODULES\\pkg\\bin\\codex.cmd'] }), 'et alias, hvis aegte sti staver node_modules med store bogstaver');
  ikke(lav({ cwd: 'C:\\Users\\u', path: 'C:\\NODE_MODULES\\.BIN', aliaser: { 'C:\\NODE_MODULES\\.BIN': 'C:\\pub\\x' }, filer: ['C:\\pub\\x\\codex.cmd'] }), 'NODE_MODULES\\.BIN med store bogstaver som junction');
  // R168 (Opus): kun App Execution Aliasens egen fejl (EACCES) giver lstat-vejen - et mappe-link (EPERM) eller et doedt link til en
  // server, der ikke svarer (UNKNOWN), er intet program, og den gyldige codex.cmd i en senere mappe vaelges.
  lig(koert(lav({ path: 'C:\\A;C:\\B', mapper: ['C:\\A'], mappeLinks: ['C:\\A\\codex.exe'], filer: ['C:\\B\\codex.cmd'] })).k, '"C:\\B\\codex.cmd"');
  // R168 (Opus N3): install koert fra drevets rod - C:\node_modules og dens undermapper er arbejdsmappens.
  ikke(lav({ cwd: 'C:\\', path: 'C:\\node_modules\\pkg\\bin', filer: ['C:\\node_modules\\pkg\\bin\\codex.cmd'] }), 'C:\\node_modules\\pkg\\bin, naar install koerer fra roden');
  // Opslaget starter ingen proces (heller ikke where.exe): det eneste kald er klienten.
  const t = lav({ path: `C:\\proj;${NPM}`, filer: [`${NPM}\\codex.cmd`] });
  koert(t);
  assert.ok(!t.tjekket.some((f) => /^c:\\proj\\/i.test(f)), `opslaget kiggede i arbejdsmappen: ${t.tjekket.join(', ')}`);
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
