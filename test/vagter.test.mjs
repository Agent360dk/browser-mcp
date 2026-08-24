/**
 * De sidste vagter — de adfaerder ingen test kunne se braekke.
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
// fast tegnantal. MAALT 23/8: faste vinduer blev roede hver gang en kommentar voksede —
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
  assert.match(blok, /ok: valgKlik\?\.landed !== false/,
    'custom-dropdown-grenen maa ikke haardkode ok:true — det var den halve rettelse ' +
    'der stod tilbage i to gennemloeb, fordi ingen test kiggede paa den anden gren');
  assert.ok(!/return \{ ok: true \};/.test(blok),
    'ingen ubetinget succes-retur i select_option');
});

// ── terminate maa kun kunne komme fra den forbindelse der faktisk arbejder.
//    Ellers kan en anden udvidelse — eller en zombie-forbindelse — lukke en session
//    der er midt i noget.
test('terminate er gated paa den aktive forbindelse', () => {
  const blok = blokFor(srv, 'terminate');
  assert.ok(blok, 'terminate-haandteringen findes');
  assert.match(blok, /activeConnection\(\)/,
    'terminate skal sammenholdes med den aktive forbindelse, ikke tages fra hvem som helst');
});

// ── Laasen findes for at 21 af 43 vaerktoejer ikke faldt paa at to udvidelser
//    skiftedes til at vinde serverens socket. Men laasen maa kunne gives fri igen
//    saa laenge intet arbejde er i gang — ellers kan en fejlagtig foerste-forbindelse
//    spaerre for den rigtige udvidelse resten af sessionen.
test('forbindelses-laasen gives fri saa laenge ingen kommando er sendt', () => {
  assert.match(srv, /let harSendtKommando = false;/, 'flaget skal findes');
  assert.match(srv, /if \(!harSendtKommando\) laastForbindelse = null;/,
    'uden den her linje kan en tilfaeldig foerste forbindelse spaerre for den rigtige');
  assert.match(srv, /harSendtKommando = true/,
    'flaget skal saettes naar der faktisk sendes en kommando');
});

// ── Naar udvidelsen er ny og serveren er gammel — eller omvendt i butikkens
//    1-3 dages review-vindue — skal ukendte metoder forklares, ikke bare fejle.
test('ukendte metoder forklares med en konkret erstatning', () => {
  assert.match(srv, /function forklarSkaevhed/,
    'forklaringen er det eneste der staar mellem brugeren og "Unknown method: X" ' +
    'i hele Chrome Web Stores review-vindue');
  // At funktionen FINDES er ikke nok — den skal ogsaa kaldes. Foerste udgave af denne
  // test tjekkede kun definitionen, saa en mutation der fjernede KALDET slap igennem.
  const kald = (srv.match(/forklarSkaevhed\(/g) || []).length;
  assert.ok(kald >= 2, `forklarSkaevhed defineres men kaldes kun ${kald - 1} sted(er) — ` +
    'en definition ingen bruger er ingen vagt');
  const iFejl = srv.indexOf('isError: true');
  assert.ok(iFejl > -1, 'der skal findes en fejl-sti');
  assert.match(srv, /ERSTATNINGER/, 'der skal findes en tabel over hvad man goer i stedet');
  const i = srv.indexOf('const ERSTATNINGER');
  const tabel = srv.slice(i, srv.indexOf('};', i));
  const antal = (tabel.match(/:/g) || []).length;
  assert.ok(antal >= 5, `kun ${antal} erstatninger — de 8 metoder fra v1.26 skal vaere daekket`);
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
// dem. Kaeden er fire led — Claude Code → wrapper → npm exec → serveren — og vagten
// kiggede kun paa naermeste led, altsaa npm exec.
//
// Selve logikken testes i test/vagt-kaede.test.mjs, hvor den KOERES mod stubbede
// fejl og procestraeer. Den her fil tjekker kun at index.js faktisk bruger den:
// en tidligere udgave greppede efter `process.kill(pid, 0)` og `for (const pid of
// vagtKaede)`, og begge mutationer der betoed noget — EPERM-fortolkningen og et
// kaede-loft klippet til ét led — slap igennem, fordi teksten stod der uaendret.
test('index.js bruger den testede vagt i stedet for sin egen kopi', () => {
  assert.match(srv, /import \{[^}]*ledErDoedt[^}]*\} from '\.\/vagt\.js'/,
    'doeds-dommen skal komme fra vagt.js, som kan koeres i en test — ' +
    'ikke fra en indlejret try/catch der kun kan grepped efter');
  assert.match(srv, /ledErDoedt\(pid\)/, 'og den skal faktisk kaldes i vagten');
  // MAALT 23/8: kaeden genlaeses nu naar noget SER doedt ud, i stedet for at stole paa
  // et snapshot fra opstarten. Et mellemled kan afslutte helt normalt mens ejeren
  // koerer videre — det udloeste "chatten er vaek" mens chatten var uroert.
  const iVagt = srv.indexOf('parentCheck = setInterval');
  const blokVagt = srv.slice(iVagt, srv.indexOf('}, 5000)', iVagt));
  assert.match(blokVagt, /forfaedreKaede\(process\.ppid, laesPpid\)/,
    'kaeden skal genlaeses foer vi lukker ned — ellers draeber et normalt afsluttet ' +
    'mellemled en chat der koerer fint');
  assert.match(blokVagt, /if \(frisk\.length\)/, 'og en levende vej op skal betyde: fortsaet');
  assert.match(srv, /forfaedreKaede\(parentPid, laesPpid\)/, 'kaeden ogsaa');
  assert.ok(!/process\.kill\(pid, 0\)/.test(srv),
    'ingen indlejret kopi tilbage i index.js — to udgaver af samme dom driver fra hinanden');
});

test('ps-opslaget har en frist', () => {
  const i = srv.indexOf('function laesPpid');
  const blok = srv.slice(i, i + 500);
  assert.match(blok, /timeout: \d+/,
    'et haengende ps ville blokere hele opstarten synkront — serveren naaede aldrig ' +
    'at printe noget, heller ikke MCP-haandtrykket. Maalt 22/8.');
});

test('idle-graensen er en bagstopper, ikke den primaere vagt', () => {
  const m = srv.match(/lastActivity > (\d+) \* 60 \* 60 \* 1000/);
  assert.ok(m, 'der skal findes en idle-graense');
  assert.ok(Number(m[1]) >= 2,
    `idle-graensen er ${m[1]} timer — for kort. En aaben chat der ikke bruger browseren ` +
    'i et stykke tid ville miste vaerktoejerne permanent, og det er en vaerre fejl end ' +
    'en port der staar optaget lidt for laenge. Den aegte vagt er foraeldre-kaeden.');
});

// ── Et skema der lover en parameter handleren kasserer, er en tavs loegn ────────
// MAALT 22/8: browser_set_combobox annoncerede `wait_ms`, setCombobox laeste
// opts.wait_ms — men handleren videregav kun multi og query_chars. En agent der bad
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
      `skemaet lover "${p}", men handleren naevner den ikke — parameteren kasseres tavst`);
  }
});

// ── En armering der forsvinder skal SVARE, ikke bare forsvinde ────────────────
// MAALT 22/8: afvaebnDialog fjernede lytteren og ryddede timeren — men opfyldte
// aldrig loeftet. En kalder med `wait: true` haengte derfor for evigt ad to helt
// almindelige veje: fanen blev lukket, eller et andet handle_dialog armerede paa
// samme fane. Ingen fejl, intet svar, bare stilhed.
test('en afvaebnet dialog-armering giver kalderen et svar', () => {
  const i = bg.indexOf('function afvaebnDialog');
  const blok = bg.slice(i, bg.indexOf('\n}', i));
  assert.match(blok, /opfyld\(/,
    'uden opfyld haenger en wait:true-kalder for evigt — ingen fejl, bare stilhed');
  assert.match(blok, /grund/, 'og den skal kunne fortaelle HVORFOR armeringen forsvandt');

  // Begge veje skal give en grund med.
  assert.match(bg, /afvaebnDialog\(tabId, '[^']+'\)/, 'fanen lukkes → svar med grund');
  assert.match(bg, /afvaebnDialog\(tab\.id, '[^']+'\)/, 'ny armering overtager → svar med grund');
});
