/**
 * De sidste vagter - de adfaerder ingen test kunne se braekke.
 *
 * MAALT 22/8: en systematisk mutations-gennemgang braekkede 15 aegte adfaerder én
 * ad gangen. Kun 6 blev opdaget. Denne fil lukker resten. Hver test er verificeret
 * ved at braekke praecis den kode den vogter og se den blive roed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');

// ── select_option loej paa den ene gren i maaneder: den native <select>-gren blev
//    rettet, men custom-dropdown-grenen returnerede stadig `{ ok: true }` haardkodet,
//    uanset om klikket landede. Fundet 21/8 af en agent paa tredje gennemloeb.

// Afgraenser `if (msg.type === '<type>') { ... }` med klamme-matchning i stedet for et
// fast tegnantal. MAALT 23/8: faste vinduer blev roede hver gang en kommentar voksede -
// altsaa af korrekte aendringer. Tre gange paa én aften.
function blokFor(kilde, type) {
  const i = kilde.indexOf(`msg.type === '${type}'`);
  if (i < 0) return '';
  let d = 0;
  for (let k = kilde.indexOf('{', i); k < kilde.length; k++) {
    if (kilde[k] === '{') d++;
    else if (kilde[k] === '}' && --d === 0) return kilde.slice(i, k + 1);
  }
  return kilde.slice(i);
}

test('select_option melder sandt paa BEGGE grene', () => {
  const i = bg.indexOf("case 'select_option'");
  assert.ok(i > -1, 'select_option-handleren skal findes');
  const blok = bg.slice(i, bg.indexOf("case '", i + 20));

  const nativeGren = blok.match(/type: 'native_select'/g) || [];
  assert.ok(nativeGren.length >= 3,
    'den native gren skal kunne svare baade "fandt ikke", "rullet tilbage" og "ok"');
  assert.match(blok, /ok: false, type: 'native_select'/,
    'den skal kunne melde at valget IKKE lykkedes');

  // Custom-dropdown-grenen: resultatet skal afhaenge af om klikket landede.
  // 11/9 (Astra, tredje runde): reglen "landed !== false" lod et uvist klik (landed:null) blive til ok:true.
  // Grenen skal nu bruge den faelles regel klikLandede - samme som click og click_xy.
  assert.match(blok, /ok: klikLandede\(valgKlik\),\n/,
    'custom-dropdown-grenen maa ikke haardkode ok:true eller bruge sin egen regel - det var den halve ' +
    'rettelse der stod tilbage i to gennemloeb, fordi ingen test kiggede paa den anden gren');
  assert.ok(!/return \{ ok: true \};/.test(blok),
    'ingen ubetinget succes-retur i select_option');
});

// ── terminate maa kun kunne komme fra den forbindelse der faktisk arbejder.
//    Ellers kan en anden udvidelse - eller en zombie-forbindelse - lukke en session
//    der er midt i noget.
test('terminate er gated paa den aktive forbindelse', () => {
  const blok = blokFor(srv, 'terminate');
  assert.ok(blok, 'terminate-haandteringen findes');
  assert.match(blok, /activeConnection\(bane\)/,
    'terminate skal sammenholdes med den aktive forbindelse paa sin egen bane, ikke tages fra hvem som helst');
});

// ── Laasen findes for at 21 af 43 vaerktoejer ikke faldt paa at to udvidelser
//    skiftedes til at vinde serverens socket. Men laasen maa kunne gives fri igen
//    saa laenge intet arbejde er i gang - ellers kan en fejlagtig foerste-forbindelse
//    spaerre for den rigtige udvidelse resten af sessionen.
test('forbindelses-laasen gives fri saa laenge ingen kommando er sendt', () => {
  // R115: flaget harSendtKommando er erstattet af banens installationslaas (bane.laas), som saettes ved foerste kommando.
  // Flaget var blevet en kopi af laasen (Astra/Opus R115): to tilstande for én kendsgerning kan kun komme ud af trit.
  assert.match(srv, /laas: null,/, 'laasen skal findes (paa banen, lavBane)');
  const tilslut = srv.slice(srv.indexOf('bane.connections.add(conn);'), srv.indexOf('bane.connections.add(conn);') + 700);
  assert.match(tilslut, /\n    bane\.laastForbindelse = null;/,
    'uden den her linje kan en tilfaeldig foerste forbindelse spaerre for den rigtige');
  assert.match(srv, /bane\.laas = \{ instans: conn\.instance \|\| null, conn \};/,
    'laasen skal saettes naar der faktisk sendes en kommando');
  const kode = srv.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(kode, /harSendtKommando/, 'flaget er tilbage ved siden af laasen');
});

// ── Naar udvidelsen er ny og serveren er gammel - eller omvendt i butikkens
//    1-3 dages review-vindue - skal ukendte metoder forklares, ikke bare fejle.
test('ukendte metoder forklares med en konkret erstatning', () => {
  assert.match(srv, /function forklarSkaevhed/,
    'forklaringen er det eneste der staar mellem brugeren og "Unknown method: X" ' +
    'i hele Chrome Web Stores review-vindue');
  // At funktionen FINDES er ikke nok - den skal ogsaa kaldes. Foerste udgave af denne
  // test tjekkede kun definitionen, saa en mutation der fjernede KALDET slap igennem.
  const kald = (srv.match(/forklarSkaevhed\(/g) || []).length;
  assert.ok(kald >= 2, `forklarSkaevhed defineres men kaldes kun ${kald - 1} sted(er) - ` +
    'en definition ingen bruger er ingen vagt');
  const iFejl = srv.indexOf('isError: true');
  assert.ok(iFejl > -1, 'der skal findes en fejl-sti');
  assert.match(srv, /ERSTATNINGER/, 'der skal findes en tabel over hvad man goer i stedet');
  const i = srv.indexOf('const ERSTATNINGER');
  const tabel = srv.slice(i, srv.indexOf('};', i));
  const antal = (tabel.match(/:/g) || []).length;
  assert.ok(antal >= 5, `kun ${antal} erstatninger - de 8 metoder fra v1.26 skal vaere daekket`);
});

// ── Hjerteslaget er det eneste der opdager at broen er doed. Uden alarmen sker der
//    ingenting overhovedet, og udvidelsen ligger doed indtil brugeren selv opdager det.
test('hjerteslags-alarmen oprettes faktisk', () => {
  const i = bg.indexOf("chrome.alarms.get('ensure-offscreen'");
  assert.ok(i > -1, 'alarmen skal slaas op');
  const blok = bg.slice(i, i + 400);
  assert.match(blok, /chrome\.alarms\.create\('ensure-offscreen'/,
    'uden create sker der aldrig et hjerteslag, og en doed bro opdages aldrig');
  assert.match(blok, /periodInMinutes:\s*\d/, 'den skal gentage sig');
  assert.ok(!/false\s*&&\s*chrome\.alarms\.create/.test(bg),
    'alarmen maa ikke vaere gjort uopnaaelig');
  assert.match(bg, /chrome\.alarms\.onAlarm\.addListener/, 'og der skal lyttes paa den');
});

// ── Broen skal melde fra naar en session forsvinder, ellers frigives fanerne aldrig
//    og loftet fyldes op med faner ingen ejer.
test('en lukket forbindelse frigiver sessionens faner', () => {
  assert.match(bg, /msg\.type === 'session_disconnect'/, 'beskeden skal haandteres');
  const i = bg.indexOf("msg.type === 'session_disconnect'");
  assert.match(bg.slice(i, i + 200), /releaseSession\(/,
    'uden frigivelsen hober faner sig op som ingen session ejer');
});

// ── HVORNAAR LUKKER EN SERVER SIN PORT? ───────────────────────────────────────
// Symptomet Gustav har set flere gange: tyve porte optaget, ingen chats i live bag
// dem. Kaeden er fire led - Claude Code → wrapper → npm exec → serveren - og vagten
// kiggede kun paa naermeste led, altsaa npm exec.
//
// Selve logikken testes i test/vagt-kaede.test.mjs, hvor den KOERES mod stubbede
// fejl og procestraeer. Den her fil tjekker kun at index.js faktisk bruger den:
// en tidligere udgave greppede efter `process.kill(pid, 0)` og `for (const pid of
// vagtKaede)`, og begge mutationer der betoed noget - EPERM-fortolkningen og et
// kaede-loft klippet til ét led - slap igennem, fordi teksten stod der uaendret.
test('index.js bruger den testede vagt i stedet for sin egen kopi', () => {
  assert.match(srv, /import \{[^}]*ledErDoedt[^}]*\} from '\.\/vagt\.js'/,
    'doeds-dommen skal komme fra vagt.js, som kan koeres i en test - ' +
    'ikke fra en indlejret try/catch der kun kan grepped efter');
  assert.match(srv, /ledErDoedt\(pid\)/, 'og den skal faktisk kaldes i vagten');
  // MAALT 23/8: kaeden genlaeses nu naar noget SER doedt ud, i stedet for at stole paa
  // et snapshot fra opstarten. Et mellemled kan afslutte helt normalt mens ejeren
  // koerer videre - det udloeste "chatten er vaek" mens chatten var uroert.
  const iVagt = srv.indexOf('parentCheck = setInterval');
  const blokVagt = srv.slice(iVagt, srv.indexOf('}, 5000)', iVagt));
  assert.match(blokVagt, /forfaedreKaede\(process\.ppid, laesPpid\)/,
    'kaeden skal genlaeses foer vi lukker ned - ellers draeber et normalt afsluttet ' +
    'mellemled en chat der koerer fint');
  assert.match(blokVagt, /if \(frisk\.length\)/, 'og en levende vej op skal betyde: fortsaet');
  assert.match(srv, /forfaedreKaede\(parentPid, laesPpid\)/, 'kaeden ogsaa');
  assert.ok(!/process\.kill\(pid, 0\)/.test(srv),
    'ingen indlejret kopi tilbage i index.js - to udgaver af samme dom driver fra hinanden');
});

test('ps-opslaget har en frist', () => {
  const i = srv.indexOf('function laesPpid');
  const blok = srv.slice(i, i + 500);
  assert.match(blok, /timeout: \d+/,
    'et haengende ps ville blokere hele opstarten synkront - serveren naaede aldrig ' +
    'at printe noget, heller ikke MCP-haandtrykket. Maalt 22/8.');
});

// ── SIKKERHED (20/10, privat rapport): intet kald i serveren maa koere en fil fra arbejdsmappen ──────────────
// `execSync` med en tekststreng gaar gennem en skal, og paa Windows leder cmd.exe i arbejdsmappen FOER PATH: en ps.bat,
// ps.cmd eller ps.exe i den mappe, brugeren aabnede, koerte, saa snart serveren startede. npm-tjekket (BROWSER_MCP_CHECK_NPM=1)
// havde samme moenster: CreateProcess soeger ogsaa i arbejdsmappen. Proeverne koerer de to funktioner fra index.js med falske
// procesfunktioner og en falsk platform.
function funktionsKilde(kilde, navn) {
  const i = kilde.indexOf(`function ${navn}(`);
  assert.ok(i >= 0, `fandt ikke function ${navn} i index.js`);
  let d = 0;
  for (let k = kilde.indexOf('{', i); k < kilde.length; k++) {
    if (kilde[k] === '{') d++;
    else if (kilde[k] === '}' && --d === 0) return kilde.slice(i, k + 1);
  }
  throw new Error(`function ${navn}: ingen afsluttende krølparentes`);
}

test('SIKKERHED: ps-opslaget koerer ingen fil fra arbejdsmappen - Windows starter intet, ellers absolut sti uden skal', () => {
  const kilde = funktionsKilde(srv, 'laesPpid');
  const lav = (platform, findes = () => true) => {
    const kald = [];
    const execSync = (...a) => { kald.push(['execSync', ...a]); return '42\n'; };
    const execFileSync = (...a) => { kald.push(['execFileSync', ...a]); return '42\n'; };
    const fn = new Function('execSync', 'execFileSync', 'existsSync', 'process', `${kilde}; return laesPpid;`)(
      execSync, execFileSync, findes, { platform });
    return { fn, kald };
  };
  const w = lav('win32');
  assert.equal(w.fn(1234), null);
  assert.deepEqual(w.kald.map((k) => k[0]), [], 'paa Windows startede ps-opslaget en proces - cmd.exe finder en ps.bat i arbejdsmappen foer PATH');
  const m = lav('darwin');
  assert.equal(m.fn(1234), 42);
  assert.equal(m.kald.length, 1, 'ét opslag');
  const [hvem, kommando, args, valg] = m.kald[0];
  assert.equal(hvem, 'execFileSync', 'ps skal startes uden skal (execFileSync), ikke som tekststreng gennem en skal');
  assert.ok(typeof kommando === 'string' && kommando.startsWith('/'), `ps skal have en absolut sti, fik ${kommando}`);
  assert.deepEqual(args, ['-o', 'ppid=', '-p', '1234']);
  assert.ok(!valg || !valg.shell, 'ingen shell-indstilling');
  // R164 (Astra): ogsaa Linux-grenen, hvor ps ligger i /usr/bin.
  const lin = lav('linux', (sti) => sti === '/usr/bin/ps');
  assert.equal(lin.fn(1234), 42);
  assert.equal(lin.kald[0][1], '/usr/bin/ps', `paa Linux uden /bin/ps skal /usr/bin/ps bruges, fik ${lin.kald[0][1]}`);
  // R164 (Opus): NixOS har kun systemprofilens ps.
  const nix = lav('linux', (sti) => sti === '/run/current-system/sw/bin/ps');
  assert.equal(nix.fn(1234), 42);
  assert.equal(nix.kald[0][1], '/run/current-system/sw/bin/ps', `paa NixOS skal systemprofilens ps bruges, fik ${nix.kald[0][1]}`);
  const intet = lav('linux', () => false);
  assert.equal(intet.fn(1234), null, 'findes ps ikke, er svaret null');
  assert.deepEqual(intet.kald, [], 'og intet startes');
});

test('SIKKERHED: npm-tjekket starter paa Windows aldrig «npm» fra arbejdsmappen', async () => {
  const kilde = funktionsKilde(srv, 'npmLatestVersion');
  const { win32, posix } = await import('node:path');
  const HJEM = '/hjem/bruger';
  const lav = (platform, findes, svar = '9.9.9\n') => {
    const kald = [];
    const execFile = (kommando, args, valg, cb) => { kald.push([kommando, args, valg]); cb(null, svar); };
    const sti = platform === 'win32' ? win32 : posix;
    const proc = { platform, execPath: platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/local/bin/node' };
    const fn = new Function('execFile', 'existsSync', 'process', 'join', 'dirname', 'homedir', 'TJEK_NPM', 'NPM_LATEST_TTL_MS',
      `let npmLatestCache = null; ${kilde}; return npmLatestVersion;`)(execFile, findes, proc, sti.join, sti.dirname, () => HJEM, true, 0);
    return { fn, kald, proc };
  };
  const w = lav('win32', () => true);
  assert.equal(await w.fn(), '9.9.9');
  assert.equal(w.kald.length, 1);
  assert.equal(w.kald[0][0], w.proc.execPath, `paa Windows skal npm koeres som node + npm-cli.js ved absolut sti, ikke «${w.kald[0][0]}»`);
  // R164 (Astra): den praecise, absolutte sti ved siden af node - ikke blot et navn, der ender paa npm-cli.js.
  assert.equal(w.kald[0][1][0], win32.join('C:\\Program Files\\nodejs', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  assert.ok(!w.kald[0][2] || !w.kald[0][2].shell, 'ingen skal');
  const mangler = lav('win32', () => false);
  assert.equal(await mangler.fn(), null, 'uden npm-cli.js ved siden af node er svaret ukendt');
  assert.deepEqual(mangler.kald, [], 'og intet startes');
  const mac = lav('darwin', () => true);
  assert.equal(await mac.fn(), '9.9.9');
  assert.equal(mac.kald[0][0], 'npm', 'paa macOS og Linux er npm-opslaget uaendret');
  // R164 (Opus): npm laeser .npmrc i arbejdsmappen. Opslaget koeres fra hjemmemappen paa alle platforme.
  for (const k of [w, mac]) assert.equal(k.kald[0][2] && k.kald[0][2].cwd, HJEM, 'npm-opslaget skal koeres fra hjemmemappen, ikke fra arbejdsmappen');
  // Et fremmed register kan svare med fritekst efter tallet; kun et rent versionsnummer naar videre til agenten.
  assert.equal(await lav('darwin', () => true, '1.99.0 - INDSAT TEKST til agenten\n').fn(), null, 'fritekst efter versionsnummeret slap igennem');
  assert.equal(await lav('darwin', () => true, '1.31.0-beta.1\n').fn(), '1.31.0-beta.1', 'en forhaandsudgave er stadig et versionsnummer');
});

test('idle-graensen er en bagstopper, ikke den primaere vagt', () => {
  const m = srv.match(/lastActivity > (\d+) \* 60 \* 60 \* 1000/);
  assert.ok(m, 'der skal findes en idle-graense');
  assert.ok(Number(m[1]) >= 2,
    `idle-graensen er ${m[1]} timer - for kort. En aaben chat der ikke bruger browseren ` +
    'i et stykke tid ville miste vaerktoejerne permanent, og det er en vaerre fejl end ' +
    'en port der staar optaget lidt for laenge. Den aegte vagt er foraeldre-kaeden.');
});

// ── Et skema der lover en parameter handleren kasserer, er en tavs loegn ────────
// MAALT 22/8: browser_set_combobox annoncerede `wait_ms`, setCombobox laeste
// opts.wait_ms - men handleren videregav kun multi og query_chars. En agent der bad
// om laengere ventetid til en langsom liste fik standarden 3000 ms og ingen besked.
test('set_combobox videregiver hver parameter den annoncerer', async () => {
  const { TOOLS } = await import('../mcp-server/tools.js');
  const t = TOOLS.find((x) => x.name === 'browser_set_combobox');
  assert.ok(t, 'vaerktoejet skal findes');

  const i = bg.indexOf("case 'set_combobox'");
  const blok = bg.slice(i, bg.indexOf("case '", i + 20));

  // value/values haandteres saerskilt (samles til en liste), resten skal videregives.
  const skalVidere = Object.keys(t.inputSchema.properties)
    .filter((k) => !['selector', 'value', 'values'].includes(k));

  for (const p of skalVidere) {
    assert.match(blok, new RegExp(p),
      `skemaet lover "${p}", men handleren naevner den ikke - parameteren kasseres tavst`);
  }
});

// ── En armering der forsvinder skal SVARE, ikke bare forsvinde ────────────────
// MAALT 22/8: afvaebnDialog fjernede lytteren og ryddede timeren - men opfyldte
// aldrig loeftet. En kalder med `wait: true` haengte derfor for evigt ad to helt
// almindelige veje: fanen blev lukket, eller et andet handle_dialog armerede paa
// samme fane. Ingen fejl, intet svar, bare stilhed.
test('en afvaebnet dialog-armering giver kalderen et svar', () => {
  const i = bg.indexOf('function afvaebnDialog');
  const blok = bg.slice(i, bg.indexOf('\n}', i));
  assert.match(blok, /opfyld\(/,
    'uden opfyld haenger en wait:true-kalder for evigt - ingen fejl, bare stilhed');
  assert.match(blok, /grund/, 'og den skal kunne fortaelle HVORFOR armeringen forsvandt');

  // Begge veje skal give en grund med.
  assert.match(bg, /afvaebnDialog\(tabId, '[^']+'\)/, 'fanen lukkes → svar med grund');
  assert.match(bg, /afvaebnDialog\(tab\.id, '[^']+'\)/, 'ny armering overtager → svar med grund');
});
