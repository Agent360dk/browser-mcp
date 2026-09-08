// Daekningstest for HELE vaerktoejsfladen.
//
// Et browser-vaerktoej lever i tre lag, og de kan drive fra hinanden uden at nogen
// opdager det: definitionen i mcp-server/tools.js, oversaettelsen i mcp-server/index.js
// (methodMap), og selve handlingen i extension/background.js (dispatch-case). Fejler
// ét af de tre led, svarer serveren "Unknown tool" eller udvidelsen falder igennem til
// sin default — begge dele ser ud som en fejl paa siden, ikke som en manglende ledning.
//
// Maalt 21/8 ved at bygge denne test: README-tabellen paastod 42 vaerktoejer, havde 43
// raekker, manglede browser_about helt og stod med to dubletter.
//
// Testene er statiske (de laeser kilden) og har derfor ingen Chrome-afhaengighed —
// de kan koere i CI og fanger praecis den drift der ellers foerst ses i brug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const laes = (p) => readFileSync(join(rod, p), 'utf8');

const { TOOLS } = await import(join(rod, 'mcp-server/tools.js'));
const indexSrc = laes('mcp-server/index.js');
const bgSrc = laes('extension/background.js');
const readme = laes('README.md');

// Vaerktoejer som serveren selv besvarer — de har ingen dispatch-case i udvidelsen,
// fordi de aldrig naar browseren. Listen er bevidst kort og skal begrundes her:
//   browser_about             — rene links + metadata, ingen browser involveret
//   browser_provide_feedback  — selv-diagnose af installationen, spoerger npm, ikke Chrome
//   browser_extract_token     — sammensat: kalder selv 'navigate' og returnerer vejledning
const SERVER_LOKALE = new Set(['browser_about', 'browser_provide_feedback', 'browser_extract_token']);

const navne = TOOLS.map(t => t.name);

test('hvert vaerktoej har et unikt navn med browser_-praefiks', () => {
  assert.equal(new Set(navne).size, navne.length, 'dublet-navn i TOOLS');
  for (const n of navne) assert.match(n, /^browser_[a-z0-9_]+$/, `ugyldigt vaerktoejsnavn: ${n}`);
});

test('hvert vaerktoej har en beskrivelse der faktisk forklarer noget', () => {
  for (const t of TOOLS) {
    assert.ok(typeof t.description === 'string', `${t.name}: description mangler`);
    assert.ok(t.description.length >= 25, `${t.name}: description er for tynd til at vaelge paa (${t.description.length} tegn)`);
  }
});

test('hvert vaerktoej har et velformet inputSchema', () => {
  for (const t of TOOLS) {
    assert.equal(t.inputSchema?.type, 'object', `${t.name}: inputSchema.type skal vaere "object"`);
    assert.equal(typeof t.inputSchema.properties, 'object', `${t.name}: properties mangler`);
    for (const [felt, def] of Object.entries(t.inputSchema.properties)) {
      assert.ok(def.type || def.enum || def.oneOf || def.anyOf, `${t.name}.${felt}: ingen type`);
      assert.ok(def.description, `${t.name}.${felt}: ingen description — modellen kan ikke gaette hvad feltet er`);
    }
    for (const req of t.inputSchema.required || []) {
      assert.ok(req in t.inputSchema.properties, `${t.name}: required "${req}" findes ikke i properties`);
    }
  }
});

test('hvert vaerktoej naar frem til en handler — methodMap eller server-lokal', () => {
  const mapped = new Set(
    [...indexSrc.matchAll(/^\s{6}(browser_[a-z_]+): '([a-z_]+)',$/gm)].map(m => m[1]),
  );
  for (const n of navne) {
    if (SERVER_LOKALE.has(n)) {
      assert.match(indexSrc, new RegExp(`name === '${n}'`), `${n}: hverken i methodMap eller server-lokalt haandteret`);
    } else {
      assert.ok(mapped.has(n), `${n}: mangler i methodMap i index.js — serveren svarer "Unknown tool"`);
    }
  }
});

test('hver methodMap-metode har en dispatch-case i background.js', () => {
  const par = [...indexSrc.matchAll(/^\s{6}(browser_[a-z_]+): '([a-z_]+)',$/gm)];
  // Vagten skal foelge vaerktoejerne, ikke et magisk tal. MAALT 22/8: den stod paa
  // ">= 40" og blev roed da tre udklipsholder-vaerktoejer blev fjernet — en test der
  // fejler paa en KORREKT aendring er et daarligt instrument. Nu udledes den.
  assert.ok(par.length >= TOOLS.length - 5,
    `fandt kun ${par.length} methodMap-linjer mod ${TOOLS.length} vaerktoejer — parseren er nok braekket`);
  const cases = new Set([...bgSrc.matchAll(/case '([a-z_]+)'/g)].map(m => m[1]));
  for (const [, vaerktoej, metode] of par) {
    assert.ok(cases.has(metode), `${vaerktoej} → '${metode}': ingen case '${metode}' i extension/background.js`);
  }
});

test('ingen forladt dispatch-case i background.js', () => {
  // En case uden vaerktoej er doed kode — eller et vaerktoej nogen glemte at definere.
  const cases = new Set([...bgSrc.matchAll(/case '([a-z_]+)'/g)].map(m => m[1]));
  const metoder = new Set([...indexSrc.matchAll(/^\s{6}browser_[a-z_]+: '([a-z_]+)',$/gm)].map(m => m[1]));
  // reload_extension styres af serveren direkte (auto-opdatering), ikke af et vaerktoej.
  const undtaget = new Set(['reload_extension']);
  for (const c of cases) {
    if (metoder.has(c) || undtaget.has(c)) continue;
    assert.fail(`case '${c}' i background.js svarer ikke til noget vaerktoej — doed kode eller glemt definition`);
  }
});

test('README-tabellen daekker praecis de vaerktoejer der findes', () => {
  const raekker = [...readme.matchAll(/^\| `(browser_[a-z_]+)`/gm)].map(m => m[1]);
  assert.equal(new Set(raekker).size, raekker.length,
    `README har dubletraekker: ${raekker.filter((r, i) => raekker.indexOf(r) !== i).join(', ')}`);
  const mangler = navne.filter(n => !raekker.includes(n));
  const overskydende = raekker.filter(r => !navne.includes(r));
  assert.deepEqual(mangler, [], `udokumenterede vaerktoejer i README: ${mangler.join(', ')}`);
  assert.deepEqual(overskydende, [], `README dokumenterer vaerktoejer der ikke findes: ${overskydende.join(', ')}`);
});

test('README-overskriften oplyser det rigtige antal vaerktoejer', () => {
  const m = readme.match(/^## (\d+) Tools$/m);
  assert.ok(m, 'fandt ingen "## N Tools"-overskrift i README');
  assert.equal(Number(m[1]), TOOLS.length, `README siger ${m[1]} vaerktoejer, tools.js har ${TOOLS.length}`);
});

test('server-instruktionerne naevner de vaerktoejer der skal kaldes af sig selv', () => {
  // Et vaerktoej modellen skal bruge uopfordret findes kun hvis instruktionen siger det.
  for (const n of ['browser_provide_feedback', 'browser_ask_user', 'browser_about']) {
    assert.ok(indexSrc.includes(n), `INSTRUCTIONS naevner ikke ${n}`);
  }
});

// ── aerlige svar: et vaerktoej maa ikke sige at det lykkedes naar det ikke gjorde ──
//
// MAALT 21/8 i flow-harnessen. To vaerktoejer loeb fast paa hver sin udgave af
// samme fejl, og begge var usynlige uden en aegte browser:
//   select_option beregnede `return !!opt` og SMED SVARET VAEK — derefter
//   `return { ok: true }` ubetinget. Matchede ingen mulighed, skete der intet,
//   og svaret sagde stadig at det var lykkedes.
//   upload_file pakkede DOM.getDocument ud som {result:{root}} i stedet for {root},
//   saa den doede paa "Cannot read properties of undefined" ved hvert eneste kald.
// Samme fejlklasse som klikket der svarede ok:true uden at siden reagerede.

// Henter en hel `case '<navn>'`-blok ud af udvidelsen ved dens EGNE graenser — fra case'et
// til det naeste. Et fast antal tegn (`slice(i, i + 3200)`) gaar tavst i stykker den dag
// nogen skriver et kommentar-afsnit ind: assertionen falder uden at noget er brudt. Maalt
// 8/9, hvor praecis det skete for select_option-vagten (jf. issue #14).
function caseBlok(kilde, navn) {
  const start = kilde.indexOf(`case '${navn}'`);
  if (start < 0) return '';
  const naeste = kilde.indexOf("\n      case '", start + 10);
  return kilde.slice(start, naeste > start ? naeste : start + 8000);
}

test('select_option kaster ikke resultatet af sit eget valg vaek', () => {
  const blok = caseBlok(bgSrc, 'select_option');
  assert.ok(blok.length > 500, 'select_option-blokken kunne ikke findes');
  assert.ok(!/return \{ ok: true, type: 'native_select' \};/.test(blok),
    'ubetinget ok:true er tilbage — vaerktoejet kan lyve om at have valgt noget');
  assert.match(blok, /if \(!r\.found\) return \{ ok: false/, 'et manglende match skal give ok:false');
  assert.match(blok, /r\.actual === r\.wanted|r\.actual !== r\.wanted/,
    'der skal laeses TILBAGE fra feltet — en select kan rulle valget tilbage');
  assert.match(blok, /available/, 'ved manglende match skal de mulige valg med, ellers kan agenten ikke rette sig selv');
});

// MAALT 8/9 paa forbrugeragenten.dk/penge-tilbage: vagten ovenfor var for skarp. Den
// laeste feltet SYNKRONT efter dispatch og kaldte enhver afvigelse "rullet tilbage" — men
// et styret felt der ARBEJDER ser praecis saadan ud (onChange gemmer valget et andet sted
// og nulstiller sin egen value). Vaerktoejet svarede ok:false om et valg der landede;
// chippen "Norlys Energi ×" stod paa siden bagefter. Den omvendte udgave af issue #19.
test('en select der nulstiller sig selv, men aendrer siden, regnes som lykkedes', () => {
  const blok = caseBlok(bgSrc, 'select_option');
  assert.match(blok, /aftryk/,
    'der tages ikke et aftryk af siden — saa kan "rullet tilbage" ikke skelnes fra "komponenten gik videre"');
  assert.match(blok, /e\.aftryk !== r\.foer/,
    'aftrykket sammenlignes ikke — vagten kan stadig kalde et vellykket valg for en rollback');
  const iRollback = blok.indexOf('Valget blev rullet tilbage');
  assert.ok(iRollback > -1, 'rollback-beskeden findes ikke laengere');
  assert.match(blok.slice(iRollback, iRollback + 300), /intet andet paa siden aendrede sig/,
    'rollback maa kun meldes naar INTET andet aendrede sig — ellers er det en falsk negativ');
});

test('upload_file pakker DOM.getDocument ud som CDP faktisk svarer', () => {
  const i = bgSrc.indexOf("case 'upload_file'");
  const blok = bgSrc.slice(i, i + 2600);
  assert.ok(!/const \{ result: docResult \} = await cdpSend\(tab\.id, 'DOM\.getDocument'/.test(blok),
    'DOM.getDocument svarer {root}, ikke {result:{root}} — den gamle udpakning er tilbage');
  assert.match(blok, /const docResult = await cdpSend\(tab\.id, 'DOM\.getDocument'/, 'kaldet mangler');
  assert.match(blok, /if \(!docResult\?\.root\?\.nodeId\)/, 'et manglende rod-element skal give en laeselig fejl');
});

test('parameter-aliasser findes hvor navnene historisk er blevet forvekslet', () => {
  // execute_script fik `script` som alias for `code` i v1.26 efter samme faelde.
  // De her tre gav tavse fejl: [undefined] som filsti, "undefined" som soegetekst.
  const par = [
    ["case 'upload_file'", /params\.file_path/, 'upload_file mangler file_path-alias'],
    ["case 'drop_file'", /params\.file_path/, 'drop_file mangler file_path-alias'],
    ["case 'select_option'", /params\.option \?\? params\.value \?\? params\.label/, 'select_option mangler value/label-alias'],
    ["case 'select_frame'", /params\.script/, 'select_frame mangler script-alias'],
  ];
  for (const [anker, moenster, besked] of par) {
    const i = bgSrc.indexOf(anker);
    assert.ok(i > -1, `fandt ikke ${anker}`);
    assert.match(bgSrc.slice(i, i + 3200), moenster, besked);
  }
});

test('select_frame bygger ikke funktioner i service-workeren', () => {
  const i = bgSrc.indexOf("case 'select_frame'");
  // Kommentarer strippes: forklaringen af fejlen citerer den gamle kode, og en
  // negativ paastand maa ikke fyre paa sin egen dokumentation.
  const blok = bgSrc.slice(i, i + 2400).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/func: new Function\(/.test(blok),
    "new Function() i selve executeScript-kaldet koeres i service-workeren, hvor udvidelsens CSP forbyder eval — vaerktoejet fejlede paa hver eneste side");
  assert.match(blok, /args: \[code\]/, 'koden skal sendes med som argument');
  assert.match(blok, /func: \(codeStr\) =>/, 'funktionen skal bygges INDE i den injicerede func, hvor sidens CSP gaelder');
});

// Testen for det strukturelle overlay-spor er FJERNET 22/8 sammen med sporet selv:
// findCloseAffordance matcher paa delstrenge, saa sweepet gjorde "Cancel subscription"
// og "Book a demo" klikbare paa hver eneste side. offsetParent-rettelsen i isVisible
// (den maalte fejl) staar tilbage og er daekket af flow-harnessen.


test('overlay-synlighed hviler ikke paa offsetParent', () => {
  // MAALT 21/8: offsetParent er ALTID null for et position:fixed-element — det er
  // definitionen, ikke en browserfejl. Med `!el.offsetParent` som synligheds-test var
  // dismiss_overlays blind for netop den slags elementer som cookie-bannere,
  // samtykke-bjaelker og modaler er. Den svarede count:0 og skipped:[] — altsaa
  // "der var ingenting", ikke "jeg kunne ikke se det".
  // Vinduet afgraenses med klamme-matchning, ikke et fast tegnantal. MAALT 23/8:
  // med `slice(i, i + 3000)` faldt getComputedStyle uden for vinduet saa snart
  // veto-listen blev tilfoejet, og testen blev roed af en KORREKT aendring.
  const i = bgSrc.indexOf('async function dismissOverlays(');
  let dybde = 0, slut = i;
  for (let k = bgSrc.indexOf('{', i); k < bgSrc.length; k++) {
    if (bgSrc[k] === '{') dybde++;
    else if (bgSrc[k] === '}' && --dybde === 0) { slut = k + 1; break; }
  }
  const blok = bgSrc.slice(i, slut).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/!el\.offsetParent/.test(blok),
    'offsetParent-testen er tilbage — fixed-overlays bliver usynlige igen');
  assert.match(blok, /st\.display === 'none' \|\| st\.visibility === 'hidden'/,
    'synlighed skal laeses af den beregnede stil');
  assert.match(blok, /parseFloat\(st\.opacity\) === 0/, 'et helt gennemsigtigt element er ikke synligt');
});

test('ask_user sender kun serialiserbare argumenter til Chrome', () => {
  // MAALT 21/8: `args: [params.message, params.title, ...]` sendte params.title raat.
  // Skemaet siger at title er VALGFRI med standarden "Agent360 — Action Required",
  // men udelades den er vaerdien undefined — og chrome.scripting.executeScript
  // afviser HELE kaldet: "Error at property 'args': Error at index 1: Value is
  // unserializable". Saa human-in-the-loop-vaerktoejet — 2FA, kodeord, CAPTCHA —
  // styrtede hver gang en agent fulgte sit eget skema.
  //
  // Det blev aldrig opdaget fordi ask_user stod som SPRUNGET i flowtesten. Et
  // vaerktoej ingen tester er ikke daekket, det er bare tavst.
  const i = bgSrc.indexOf("case 'ask_user'");
  const blok = bgSrc.slice(i, i + 20000);
  const m = blok.match(/args: \[([\s\S]*?)\],/);
  assert.ok(m, 'fandt ikke args-listen i ask_user');
  const args = m[1];
  assert.ok(!/params\.title\s*[,\]]/.test(args), 'params.title sendes raat — undefined braekker hele kaldet');
  assert.ok(!/params\.message\s*[,\]]/.test(args), 'params.message sendes raat — samme faelde');
  assert.match(args, /Agent360 — Action Required/, 'standard-titlen fra skemaet anvendes ikke');
  assert.match(args, /String\(params\.message \?\? ''\)/, 'message tvinges ikke til en streng');
});

test('ingen andre executeScript-kald sender raa valgfrie parametre', () => {
  // Samme fejlklasse kan ramme hvert eneste args-kald. Et raat `params.X` hvor X er
  // valgfrit i skemaet, braekker hele kaldet i det oejeblik nogen udelader det.
  // Undtagelse med begrundelse: execute_script afviser eksplicit et manglende eller
  // tomt `code` FOER kaldet ("Missing code. Pass a JavaScript EXPRESSION…"), saa
  // vaerdien kan aldrig naa Chrome som undefined. Det er den rigtige maade at vagte
  // paa — og derfor er den lovlig her.
  assert.match(bgSrc, /if \(typeof params\.code !== 'string' \|\| !params\.code\.trim\(\)\)/,
    'execute_script vagter ikke laengere params.code — saa er undtagelsen nedenfor ugyldig');
  const VAGTEDE = new Set(['params.code']);
  for (const m of bgSrc.matchAll(/args: \[([^\]]*)\]/g)) {
    const raa = m[1].split(',').map(x => x.trim())
      .filter(x => /^params\.[a-z_]+$/.test(x) && !VAGTEDE.has(x));
    assert.deepEqual(raa, [],
      `raa uvagtede parametre i et args-kald: ${raa.join(', ')} — udelades de, afviser Chrome hele kaldet`);
  }
});

// ── MAALT 8/9 paa forbrugeragenten.dk/penge-tilbage ─────────────────────────
// To fill-kald efter hinanden gav "test@example.dkanden@example.dk" — og BEGGE
// svarede ok:true. Vaerktoejet meldte succes og gjorde noget andet end det lovede.
// Et fill paa et TOMT felt var rent i samme maaling, saa fejlen sad alene i rydningen:
// `clearFieldAttached` sender Cmd/Ctrl+A + Backspace som aegte tastetryk, og det tommer
// ikke et React-styret felt. Samme princip som select-rettelsen: tjek effekten.
test('fill tjekker at feltet faktisk blev tomt, i stedet for at stole paa tastetryk', () => {
  const i = bgSrc.indexOf('async function debuggerFill');
  const blok = bgSrc.slice(i, bgSrc.indexOf('\nasync function', i + 30));
  assert.ok(blok.length > 500, 'debuggerFill kunne ikke findes');
  assert.match(blok, /clearFieldAttached/, 'rydningen er vaek');
  assert.match(blok, /restVaerdi/,
    'der laeses ikke tilbage efter rydningen — saa kan fill stadig skrive oven i det gamle');
  const iRest = blok.indexOf('restVaerdi');
  assert.match(blok.slice(iRest), /setter\.call\(el, ''\)|el\.value = ''/,
    'der er ingen reserve-rydning naar tastetrykkene ikke slog igennem');
  assert.ok(blok.indexOf('Input.insertText') > iRest,
    'teksten indsaettes FOER kontrollen af at feltet er tomt — saa virker kontrollen ikke');
});
