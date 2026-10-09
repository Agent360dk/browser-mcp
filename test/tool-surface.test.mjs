// Daekningstest for HELE vaerktoejsfladen.
//
// Et browser-vaerktoej lever i tre lag, og de kan drive fra hinanden uden at nogen
// opdager det: definitionen i mcp-server/tools.js, oversaettelsen i mcp-server/index.js
// (methodMap), og selve handlingen i extension/background.js (dispatch-case). Fejler
// ét af de tre led, svarer serveren "Unknown tool" eller udvidelsen falder igennem til
// sin default - begge dele ser ud som en fejl paa siden, ikke som en manglende ledning.
//
// Maalt 21/8 ved at bygge denne test: README-tabellen paastod 42 vaerktoejer, havde 43
// raekker, manglede browser_about helt og stod med to dubletter.
//
// Testene er statiske (de laeser kilden) og har derfor ingen Chrome-afhaengighed -
// de kan koere i CI og fanger praecis den drift der ellers foerst ses i brug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { caseBlok } from './hjaelp/kildeblok.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const laes = (p) => readFileSync(join(rod, p), 'utf8');

// MAALT 19/9: `await import(join(...))` giver paa Windows en sti som C:\\...\\tools.js,
// og dynamisk import kraever en file://-URL - "Only URLs with a scheme in: file, data,
// and node are supported". Windows-jobbet havde vaeret roedt saa laenge at det blokerede
// hver eneste PR. pathToFileURL loeser det og er en no-op paa mac og Linux.
const { TOOLS } = await import(pathToFileURL(join(rod, 'mcp-server/tools.js')).href);
const indexSrc = laes('mcp-server/index.js');
const bgSrc = laes('extension/background.js');
const readme = laes('README.md');

// Vaerktoejer som serveren selv besvarer - de har ingen dispatch-case i udvidelsen,
// fordi de aldrig naar browseren. Listen er bevidst kort og skal begrundes her:
//   browser_about             - rene links + metadata, ingen browser involveret
//   browser_provide_feedback  - selv-diagnose af installationen, spoerger npm, ikke Chrome
//   browser_extract_token     - sammensat: kalder selv 'navigate' og returnerer vejledning
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
      assert.ok(def.description, `${t.name}.${felt}: ingen description - modellen kan ikke gaette hvad feltet er`);
    }
    for (const req of t.inputSchema.required || []) {
      assert.ok(req in t.inputSchema.properties, `${t.name}: required "${req}" findes ikke i properties`);
    }
  }
});

test('hvert vaerktoej naar frem til en handler - methodMap eller server-lokal', () => {
  const mapped = new Set(
    [...indexSrc.matchAll(/^\s{6}(browser_[a-z_]+): '([a-z_]+)',$/gm)].map(m => m[1]),
  );
  for (const n of navne) {
    if (SERVER_LOKALE.has(n)) {
      assert.match(indexSrc, new RegExp(`name === '${n}'`), `${n}: hverken i methodMap eller server-lokalt haandteret`);
    } else {
      assert.ok(mapped.has(n), `${n}: mangler i methodMap i index.js - serveren svarer "Unknown tool"`);
    }
  }
});

test('hver methodMap-metode har en dispatch-case i background.js', () => {
  const par = [...indexSrc.matchAll(/^\s{6}(browser_[a-z_]+): '([a-z_]+)',$/gm)];
  // Vagten skal foelge vaerktoejerne, ikke et magisk tal. MAALT 22/8: den stod paa
  // ">= 40" og blev roed da tre udklipsholder-vaerktoejer blev fjernet - en test der
  // fejler paa en KORREKT aendring er et daarligt instrument. Nu udledes den.
  assert.ok(par.length >= TOOLS.length - 5,
    `fandt kun ${par.length} methodMap-linjer mod ${TOOLS.length} vaerktoejer - parseren er nok braekket`);
  const cases = new Set([...bgSrc.matchAll(/case '([a-z_]+)'/g)].map(m => m[1]));
  for (const [, vaerktoej, metode] of par) {
    assert.ok(cases.has(metode), `${vaerktoej} → '${metode}': ingen case '${metode}' i extension/background.js`);
  }
});

test('ingen forladt dispatch-case i background.js', () => {
  // En case uden vaerktoej er doed kode - eller et vaerktoej nogen glemte at definere.
  const cases = new Set([...bgSrc.matchAll(/case '([a-z_]+)'/g)].map(m => m[1]));
  const metoder = new Set([...indexSrc.matchAll(/^\s{6}browser_[a-z_]+: '([a-z_]+)',$/gm)].map(m => m[1]));
  // reload_extension styres af serveren direkte (auto-opdatering), ikke af et vaerktoej.
  const undtaget = new Set(['reload_extension']);
  for (const c of cases) {
    if (metoder.has(c) || undtaget.has(c)) continue;
    assert.fail(`case '${c}' i background.js svarer ikke til noget vaerktoej - doed kode eller glemt definition`);
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
//   select_option beregnede `return !!opt` og SMED SVARET VAEK - derefter
//   `return { ok: true }` ubetinget. Matchede ingen mulighed, skete der intet,
//   og svaret sagde stadig at det var lykkedes.
//   upload_file pakkede DOM.getDocument ud som {result:{root}} i stedet for {root},
//   saa den doede paa "Cannot read properties of undefined" ved hvert eneste kald.
// Samme fejlklasse som klikket der svarede ok:true uden at siden reagerede.

// Henter en hel `case '<navn>'`-blok ud af udvidelsen ved dens EGNE graenser - fra case'et
// til det naeste. Et fast antal tegn (`slice(i, i + 3200)`) gaar tavst i stykker den dag
// nogen skriver et kommentar-afsnit ind: assertionen falder uden at noget er brudt. Maalt
// 8/9, hvor praecis det skete for select_option-vagten (jf. issue #14).
// caseBlok bor nu i test/hjaelp/kildeblok.mjs - samme graenser, ét sted at rette.

test('select_option kaster ikke resultatet af sit eget valg vaek', () => {
  const blok = caseBlok(bgSrc, 'select_option');
  assert.ok(blok.length > 500, 'select_option-blokken kunne ikke findes');
  assert.ok(!/return \{ ok: true, type: 'native_select' \};/.test(blok),
    'ubetinget ok:true er tilbage - vaerktoejet kan lyve om at have valgt noget');
  assert.match(blok, /if \(!r\.found\) return \{ ok: false/, 'et manglende match skal give ok:false');
  assert.match(blok, /r\.actual === r\.wanted|r\.actual !== r\.wanted/,
    'der skal laeses TILBAGE fra feltet - en select kan rulle valget tilbage');
  assert.match(blok, /available/, 'ved manglende match skal de mulige valg med, ellers kan agenten ikke rette sig selv');
});

// MAALT 8/9 paa forbrugeragenten.dk/penge-tilbage: vagten ovenfor var for skarp. Den
// laeste feltet SYNKRONT efter dispatch og kaldte enhver afvigelse "rullet tilbage" - men
// et styret felt der ARBEJDER ser praecis saadan ud (onChange gemmer valget et andet sted
// og nulstiller sin egen value). Vaerktoejet svarede ok:false om et valg der landede;
// chippen "Norlys Energi ×" stod paa siden bagefter. Den omvendte udgave af issue #19.
test('en select der nulstiller sig selv, men aendrer siden, regnes som lykkedes', () => {
  const blok = caseBlok(bgSrc, 'select_option');
  assert.match(blok, /aftryk/,
    'der tages ikke et aftryk af siden - saa kan "rullet tilbage" ikke skelnes fra "komponenten gik videre"');
  assert.match(blok, /e\.aftryk !== r\.foer/,
    'aftrykket sammenlignes ikke - vagten kan stadig kalde et vellykket valg for en rollback');
  const iRollback = blok.indexOf('The selection was rolled back');
  assert.ok(iRollback > -1, 'rollback-beskeden findes ikke laengere');
  assert.match(blok.slice(iRollback, iRollback + 300), /nothing else on the page changed/,
    'rollback maa kun meldes naar INTET andet aendrede sig - ellers er det en falsk negativ');
});

test('upload_file pakker DOM.getDocument ud som CDP faktisk svarer', () => {
  const i = bgSrc.indexOf("case 'upload_file'");
  // ⛔ Fast antal tegn RAKTE IND I NABO-BLOKKEN (maalt 21/9). caseBlok skaerer ved den aegte graense.
  const blok = caseBlok(bgSrc, 'upload_file');
  assert.ok(!/const \{ result: docResult \} = await cdpSend\(tab\.id, 'DOM\.getDocument'/.test(blok),
    'DOM.getDocument svarer {root}, ikke {result:{root}} - den gamle udpakning er tilbage');
  assert.match(blok, /const docResult = await cdpSend\(tab\.id, 'DOM\.getDocument'/, 'kaldet mangler');
  assert.match(blok, /if \(!docResult\?\.root\?\.nodeId\)/, 'et manglende rod-element skal give en laeselig fejl');
});

test('parameter-aliasser findes hvor navnene historisk er blevet forvekslet', () => {
  // execute_script fik `script` som alias for `code` i v1.26 efter samme faelde.
  // De her tre gav tavse fejl: [undefined] som filsti, "undefined" som soegetekst.
  const par = [
    ['upload_file', /params\.file_path/, 'upload_file mangler file_path-alias'],
    ['drop_file', /params\.file_path/, 'drop_file mangler file_path-alias'],
    ['select_option', /params\.option \?\? params\.value \?\? params\.label/, 'select_option mangler value/label-alias'],
    ['select_frame', /params\.script/, 'select_frame mangler script-alias'],
  ];
  for (const [navn, moenster, besked] of par) {
    assert.match(caseBlok(bgSrc, navn), moenster, besked);
  }
});

test('select_frame bygger ikke funktioner i service-workeren', () => {
  const i = bgSrc.indexOf("case 'select_frame'");
  // Kommentarer strippes: forklaringen af fejlen citerer den gamle kode, og en
  // negativ paastand maa ikke fyre paa sin egen dokumentation.
  // ⛔ Fast antal tegn RAKTE IND I NABO-BLOKKEN (maalt 21/9). caseBlok skaerer ved den aegte graense.
  const blok = caseBlok(bgSrc, 'select_frame').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/func: new Function\(/.test(blok),
    "new Function() i selve executeScript-kaldet koeres i service-workeren, hvor udvidelsens CSP forbyder eval - vaerktoejet fejlede paa hver eneste side");
  assert.match(blok, /args: \[code\]/, 'koden skal sendes med som argument');
  assert.match(blok, /func: \(codeStr\) =>/, 'funktionen skal bygges INDE i den injicerede func, hvor sidens CSP gaelder');
});

// Testen for det strukturelle overlay-spor er FJERNET 22/8 sammen med sporet selv:
// findCloseAffordance matcher paa delstrenge, saa sweepet gjorde "Cancel subscription"
// og "Book a demo" klikbare paa hver eneste side. offsetParent-rettelsen i isVisible
// (den maalte fejl) staar tilbage og er daekket af flow-harnessen.


test('overlay-synlighed hviler ikke paa offsetParent', () => {
  // MAALT 21/8: offsetParent er ALTID null for et position:fixed-element - det er
  // definitionen, ikke en browserfejl. Med `!el.offsetParent` som synligheds-test var
  // dismiss_overlays blind for netop den slags elementer som cookie-bannere,
  // samtykke-bjaelker og modaler er. Den svarede count:0 og skipped:[] - altsaa
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
    'offsetParent-testen er tilbage - fixed-overlays bliver usynlige igen');
  assert.match(blok, /st\.display === 'none' \|\| st\.visibility === 'hidden'/,
    'synlighed skal laeses af den beregnede stil');
  assert.match(blok, /parseFloat\(st\.opacity\) === 0/, 'et helt gennemsigtigt element er ikke synligt');
});

test('ask_user sender kun serialiserbare argumenter til Chrome', () => {
  // MAALT 21/8: `args: [params.message, params.title, ...]` sendte params.title raat.
  // Skemaet siger at title er VALGFRI med standarden "Agent360 - Action Required",
  // men udelades den er vaerdien undefined - og chrome.scripting.executeScript
  // afviser HELE kaldet: "Error at property 'args': Error at index 1: Value is
  // unserializable". Saa human-in-the-loop-vaerktoejet - 2FA, kodeord, CAPTCHA -
  // styrtede hver gang en agent fulgte sit eget skema.
  //
  // Det blev aldrig opdaget fordi ask_user stod som SPRUNGET i flowtesten. Et
  // vaerktoej ingen tester er ikke daekket, det er bare tavst.
  // ⛔ Her stod `slice(i, i + 20000)` paa en blok der er 8.310 tegn. De sidste ~11.700 tegn
  // var NABO-BLOKKENES kode, saa `args: [...]`-matchet kunne lige saa godt have ramt et
  // andet vaerktoejs argumentliste. Maalt 21/9.
  // 8/10: argumenterne samles nu i `spec`, som drawAskPrompt sender videre ved hver
  // tegning (ogsaa efter en navigation) - det er dem der skal vaere serialiserbare.
  const blok = caseBlok(bgSrc, 'ask_user');
  const m = blok.match(/const spec = \{([\s\S]*?)\n {6}\};/);
  assert.ok(m, 'fandt ikke spec-objektet i ask_user');
  const args = m[1];
  assert.match(bgSrc, /args: \[\{ \.\.\.ask\.spec, position: lastAskPosition \}, Boolean\(replay\)\]/,
    'drawAskPrompt sender ikke spec videre');
  assert.ok(!/params\.title\s*[,\]]/.test(args), 'params.title sendes raat - undefined braekker hele kaldet');
  assert.ok(!/params\.message\s*[,\]]/.test(args), 'params.message sendes raat - samme faelde');
  assert.match(args, /Agent360 - Action Required/, 'standard-titlen fra skemaet anvendes ikke');
  assert.match(args, /String\(params\.message \?\? ''\)/, 'message tvinges ikke til en streng');
});

test('ingen andre executeScript-kald sender raa valgfrie parametre', () => {
  // Samme fejlklasse kan ramme hvert eneste args-kald. Et raat `params.X` hvor X er
  // valgfrit i skemaet, braekker hele kaldet i det oejeblik nogen udelader det.
  // Undtagelse med begrundelse: execute_script afviser eksplicit et manglende eller
  // tomt `code` FOER kaldet ("Missing code. Pass a JavaScript EXPRESSION…"), saa
  // vaerdien kan aldrig naa Chrome som undefined. Det er den rigtige maade at vagte
  // paa - og derfor er den lovlig her.
  assert.match(bgSrc, /if \(typeof params\.code !== 'string' \|\| !params\.code\.trim\(\)\)/,
    'execute_script vagter ikke laengere params.code - saa er undtagelsen nedenfor ugyldig');
  const VAGTEDE = new Set(['params.code']);
  for (const m of bgSrc.matchAll(/args: \[([^\]]*)\]/g)) {
    const raa = m[1].split(',').map(x => x.trim())
      .filter(x => /^params\.[a-z_]+$/.test(x) && !VAGTEDE.has(x));
    assert.deepEqual(raa, [],
      `raa uvagtede parametre i et args-kald: ${raa.join(', ')} - udelades de, afviser Chrome hele kaldet`);
  }
});

// ── MAALT 8/9 paa forbrugeragenten.dk/penge-tilbage ─────────────────────────
// To fill-kald efter hinanden gav "test@example.dkanden@example.dk" - og BEGGE
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
    'der laeses ikke tilbage efter rydningen - saa kan fill stadig skrive oven i det gamle');
  const iRest = blok.indexOf('restVaerdi');
  assert.match(blok.slice(iRest), /setter\.call\(el, ''\)|el\.value = ''/,
    'der er ingen reserve-rydning naar tastetrykkene ikke slog igennem');
  assert.ok(blok.indexOf('Input.insertText') > iRest,
    'teksten indsaettes FOER kontrollen af at feltet er tomt - saa virker kontrollen ikke');
});

// MAALT 7/10 (1.30.2, skive 1): tre beskrivelser lovede noget koden ikke goer. list_tabs sagde «all open
// browser tabs», men case'et returnerer kun sessionens egne. solve_captcha sagde «returns a screenshot» og
// at ask_human «shows overlay», men intet trin tager et billede eller viser noget. provide_feedback sagde
// «read-only» og «never sends anything anywhere», men den skriver en linje i ~/.browser-mcp/feedback.jsonl.
// Hvert loefte bindes nu til koden (konsulentrunde 32 fandt mutanter der slap igennem foerste udgave).
const beskrivelse = (navn) => TOOLS.find(t => t.name === navn).description;
// Serverens instruktioner (INSTRUCTIONS i index.js) gaar til agenten ved hver tilslutning - konsulentrunde 33 fandt
// at de stadig lovede overlay og «often passes», efter at tools.js var rettet.
const captchaInstruks = () => {
  const i = indexSrc.indexOf('## CAPTCHA handling');
  assert.ok(i > -1, 'INSTRUCTIONS har et CAPTCHA-afsnit');
  const j = indexSrc.indexOf('\n## ', i + 5);
  return indexSrc.slice(i, j).trimEnd();
};
const funktionKrop = (src, navn) => {
  const i = src.indexOf(`async function ${navn}(`);
  assert.ok(i > -1, `fandt ikke ${navn}`);
  const n = src.slice(i + 10).search(/\n(async )?function /);
  return n < 0 ? src.slice(i) : src.slice(i, i + 10 + n);
};

test('list_tabs lover kun sessionens egne faner, og det er dem case\'et returnerer', () => {
  const blok = caseBlok(bgSrc, 'list_tabs');
  assert.match(blok, /getSession\(port\)/, 'list_tabs slaar sessionen op');
  assert.match(blok, /session\.tabIds/, 'og gennemloeber kun dens egne faner');
  const d = beskrivelse('browser_list_tabs');
  assert.doesNotMatch(d, /\b(all|every)\b[^.]{0,40}\btabs?\b/i, 'beskrivelsen maa ikke love alle faner, naar koden kun ser sessionens');
  assert.match(d, /session/i, 'beskrivelsen siger hvis faner det er');
  assert.match(blok, /active: tab\.active/, 'vagten forudsaetter at `active` er Chromes tab.active - ellers ret tekst og kontrakt');
  assert.match(d, /in front of its window/i, '`active` er Chromes forgrundsfane, ikke sessionens arbejdsfane - det skal staa');
});

test('solve_captcha lover hverken billede eller overlay, som hverken case eller hjaelpere leverer', () => {
  const kode = caseBlok(bgSrc, 'solve_captcha') + ['detectCaptcha', 'clickRecaptchaCheckbox', 'clickCaptchaGridCells'].map(n => funktionKrop(bgSrc, n)).join('\n');
  const tool = TOOLS.find(t => t.name === 'browser_solve_captcha');
  const tekst = tool.description + ' ' + tool.inputSchema.properties.action.description + ' ' + captchaInstruks();
  const tagerBillede = /captureScreenshot|captureVisibleTab/.test(kode);
  const viserOverlay = /showOverlay|ask_user|askUser\(/.test(kode.replace(/Call browser_ask_user[^']*/g, ''));
  const loeverBillede = /(returns?|attach(es|ed)?|with)\s+(a|an|the)\s+(screenshot|image)|screenshot attached/i.test(tekst);
  assert.equal(loeverBillede, tagerBillede, 'teksten og koden er uenige om, hvorvidt der kommer et billede tilbage');
  if (!tagerBillede) assert.match(tool.description, /returns no image/i, 'uden billede skal beskrivelsen sige det');
  if (!viserOverlay) assert.doesNotMatch(tekst, /overlay/i, 'ask_human viser intet selv - ingen overlay-loefter');
  assert.doesNotMatch(tekst, /automatically|often passes/i, 'intet trin loeser af sig selv, og en succesrate er aldrig maalt');
});

test('provide_feedback beskriver logbogen og npm-opslaget som koden goer dem', () => {
  const d = beskrivelse('browser_provide_feedback');
  assert.ok(/appendFileSync\(FEEDBACK_LOG/.test(indexSrc), 'vagten forudsaetter at logbogen skrives med appendFileSync(FEEDBACK_LOG - ellers skal testen skrives om');
  assert.doesNotMatch(d, /read[- ]?only|never sends|sends nothing/i, 'den skriver feedback.jsonl, saa den er ikke read-only');
  assert.match(d, /feedback\.jsonl/, 'beskrivelsen naevner filen, den skriver');
  assert.match(indexSrc, /setteFingeraftryk\.has\(/, 'vagten forudsaetter at gentagelser springes over via fingeraftrykket - ellers ret tekst og kontrakt');
  assert.match(d, /tries to add one line/i, 'en gentagelse skrives ikke, og en fejlet skrivning giver ingen linje - «tries»');
  // Skive 5: «not again for a repeat of the same report» lovede mere end aftrykket sammenligner, og en fejlet skrivning
  // spaerrede for den samme rapport. Teksten siger nu hvad der sammenlignes, og at en fejlet skrivning proeves igen.
  assert.match(d, /same kind, tool and first 160 characters of what_happened, with numbers and long hex strings ignored/, 'teksten siger ikke hvad fingeraftrykket sammenligner');
  assert.match(indexSrc, /\.slice\(0, 160\);\n  return `\$\{kind\}\|\$\{tool \|\| '-'\}\|\$\{kerne\}`;/, 'vagten forudsaetter aftrykket kind|tool|160 tegn - ellers ret tekst og kontrakt');
  assert.match(d, /again only if the earlier write failed/, 'en fejlet skrivning proeves igen - det skal staa');
  assert.match(d, /replaced with \[email\] and \[number\] in what_happened, attempted and worked before they are written or put in the issue link/, 'rensningen skal staa i beskrivelsen');
  assert.match(indexSrc, /execFile\('npm', \['view'/, 'vagten forudsaetter at npm-tjekket er `npm view` - ellers ret tekst og kontrakt');
  assert.match(indexSrc, /^const TJEK_NPM = process\.env\.BROWSER_MCP_CHECK_NPM === '1';$/m, 'npm-tjekket er et tilvalg (=1) - teksterne siger «off by default»');
  assert.match(indexSrc, /^const FEEDBACK_LOG = join\(homedir\(\), '\.browser-mcp', 'feedback\.jsonl'\);$/m, 'teksten naevner stien ~/.browser-mcp/feedback.jsonl');
  assert.match(d, /npm view/, 'npm-tjekket er `npm view` mod brugerens opsaetning, ikke et fast offentligt register');
});

// Tekstkontrakt (konsulentrunde 32, Astra): regulaere udtryk kan ikke bevise betydning - en omskrivning med andre ord
// slipper igennem. De godkendte ordlyde er derfor laast her. Aendres en af dem, skal den nye tekst
// holdes op mod koden igen (case, hjaelpere, logbog og npm-opslag) foer kontrakten opdateres.
const KONTRAKT = {
  "lt": "List the tabs this session owns (tabs it opened or adopted): id, URL, title, and each tab's active flag (whether Chrome shows it in front of its window, not which tab this session is working in). Tabs of other sessions are not included.",
  "sc": "Detect CAPTCHAs on the current page and work through them, one action per call. \"detect\" reports reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile and FunCaptcha. \"click_checkbox\" tries the reCAPTCHA checkbox and detects again. \"click_grid\" clicks the reCAPTCHA image-challenge cells you choose; this tool returns no image, so take one with browser_screenshot first. \"ask_human\" returns the message to show the user with browser_ask_user.",
  "act": "Action to take. \"detect\" scans for CAPTCHAs. \"click_checkbox\" clicks the reCAPTCHA checkbox. \"click_grid\" clicks specific reCAPTCHA grid cells (pass cells, and grid 3 or 4). \"ask_human\" returns the message to show the user with browser_ask_user; it shows nothing itself. Default: \"detect\"",
  "fbHel": "Self-diagnosis + feedback in one call. Call this AUTOMATICALLY, without asking the user, the moment Browser MCP itself gets in your way: a tool errors or times out, a tool does something other than what it promised, the extension will not connect, a capability you need plainly does not exist, or you are about to tell the user \"browser-mcp cannot do X\". It first CHECKS THE INSTALL - the connected Chrome extension's version against this server (set BROWSER_MCP_CHECK_NPM=1 to also compare this server against the latest published on npm; it is off by default so the call stays fast and works offline), and whether more than one Browser MCP extension is connected at once, also the same extension connected more than once, for instance from several Chrome profiles or browsers (a known cause of tabs and sessions behaving randomly) - so a problem that is really \"your copy is outdated\" or \"you have two extensions loaded\" is identified as such instead of reported as a bug. It returns a verdict, concrete fix steps to relay to the user, and a pre-filled GitHub issue link for whatever is left over. Cheap to call speculatively. It uploads nothing: it returns the report to you and tries to add one line to ~/.browser-mcp/feedback.jsonl on this machine (a report with the same kind, tool and first 160 characters of what_happened, with numbers and long hex strings ignored, is written once per server run, and again only if the earlier write failed; logged_locally says whether a line was written). Email addresses and numbers of six or more characters are replaced with [email] and [number] in what_happened, attempted and worked before they are written or put in the issue link. With BROWSER_MCP_CHECK_NPM=1 it also runs `npm view` against your configured npm registry.",
  "capt": "## CAPTCHA handling\nbrowser_solve_captcha runs one action per call; it does not solve a CAPTCHA on its own:\n1. Call browser_solve_captcha() - detects the CAPTCHA type on the page\n2. If a reCAPTCHA v2 checkbox is found → call browser_solve_captcha(action=\"click_checkbox\") - tries the checkbox and detects again\n3. If a reCAPTCHA image challenge appears → call browser_screenshot, analyze the grid visually, then call browser_solve_captcha(action=\"click_grid\", cells=[2,5,7], grid=3) with the correct cell indices and the grid size you see\n4. If that does not clear it → call browser_ask_user and let the user solve it (action=\"ask_human\" only returns that message)\n5. After solving, retry the action that was blocked\n\nFor image grid challenges: cells are 0-indexed, left-to-right, top-to-bottom. A 3x3 grid has cells 0-8. A 4x4 grid has cells 0-15. Pass grid=3 or grid=4 to say which you see; without it, click_grid reads the grid as 4x4 only when an index is 9 or higher."
};
test('de godkendte beskrivelser og CAPTCHA-instruksen staar ordret som gennemgaaet', () => {
  const sc = TOOLS.find(t => t.name === 'browser_solve_captcha');
  assert.equal(beskrivelse('browser_list_tabs'), KONTRAKT.lt);
  assert.equal(sc.description, KONTRAKT.sc);
  assert.equal(sc.inputSchema.properties.action.description, KONTRAKT.act);
  assert.equal(beskrivelse('browser_provide_feedback'), KONTRAKT.fbHel);
  assert.equal(captchaInstruks(), KONTRAKT.capt);
});

test('list_tabs gennemloeber sessionens egne faner og spoerger ikke Chrome om alle', () => {
  const blok = caseBlok(bgSrc, 'list_tabs');
  assert.match(blok, /for \(const tabId of session\.tabIds\)/, 'listen bygges af sessionens egne id\'er');
  assert.doesNotMatch(blok, /chrome\.tabs\.query/, 'en forespoergsel paa alle faner ville vise brugerens og andre sessioners');
});

// Adfaerdsprøver (konsulentrunde 33, Astra): kildeord kan ikke vise at koden GOER det teksten lover. Her
// koeres de udtrukne blokke med falske Chrome-kald, saa en tom liste, et forkert `active`, et sprunget
// gen-tjek eller et overlay der alligevel vises bliver roedt.
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const helFunktion = (src, navn) => {
  const i = src.search(new RegExp(`(async )?function ${navn}\\(`));
  assert.ok(i > -1, `fandt ikke ${navn}`);
  return src.slice(i, src.indexOf('\n}', i) + 2);
};

test('list_tabs returnerer sessionens egne faner med Chromes active, og spoerger aldrig om andres', async () => {
  const session = { tabIds: new Set([11, 12, 13]), activeTabId: 11, label: 'Claude 1', color: 'blue' };
  const faner = new Map([
    [11, { id: 11, url: 'https://egen.example/a', title: 'Egen A', active: false }],
    [12, { id: 12, url: 'https://egen.example/b', title: 'Egen B', active: true }],
    [21, { id: 21, url: 'https://anden-session.example/', title: 'Anden', active: false }],
    [99, { id: 99, url: 'https://bruger.example/', title: 'Bruger', active: true }],
  ]);
  const opslag = [];
  const chrome = { tabs: { get: async (id) => { opslag.push(id); if (!faner.has(id)) throw new Error('No tab with id: ' + id); return faner.get(id); } } };
  const h = new AsyncFunction('chrome', 'getSession', 'port', `switch ('list_tabs') { ${caseBlok(bgSrc, 'list_tabs')} }`);
  const svar = await h(chrome, () => session, 9876);
  assert.deepEqual(svar.tabs, [
    { id: 11, url: 'https://egen.example/a', title: 'Egen A', active: false },
    { id: 12, url: 'https://egen.example/b', title: 'Egen B', active: true },
  ], 'kun egne faner, felterne som Chrome har dem, active = Chromes - ikke sessionens arbejdsfane (11)');
  assert.deepEqual(opslag, [11, 12, 13], 'kun sessionens egne id\'er slaas op');
  assert.deepEqual([...session.tabIds], [11, 12], 'en lukket fane fjernes fra sessionen');
});

test('solve_captcha koerer praecis den valgte handling og viser intet ved ask_human', async () => {
  const koer = async (action, cells = [0], grid) => {
    const kald = [];
    const h = new AsyncFunction('getSessionTab', 'port', 'params', 'detectCaptcha', 'clickRecaptchaCheckbox', 'clickCaptchaGridCells', 'setTimeout', 'dispatch', 'chrome',
      `switch ('solve_captcha') { ${caseBlok(bgSrc, 'solve_captcha')} }`);
    const params = action === undefined ? {} : { action, cells, ...(grid === undefined ? {} : { grid }) };
    const svar = await h(async () => ({ id: 11 }), 9876, params,
      async () => { kald.push('detect'); return { found: true }; },
      async () => { kald.push('checkbox'); return { clicked: true }; },
      async (tabId, valgte, g) => { kald.push('grid:' + tabId + ':' + JSON.stringify(valgte) + (g === undefined ? '' : ':' + g)); return { clicked: true }; },
      (cb) => cb(),
      async (_p, metode) => { kald.push('dispatch:' + metode); return {}; },
      new Proxy({}, { get: () => { kald.push('chrome'); return new Proxy(() => {}, { get: () => () => {} }); } }));
    return { svar, kald };
  };
  assert.deepEqual((await koer(undefined)).kald, ['detect'], 'uden action er standarden detect (\"Default: detect\") - intet klik');
  assert.deepEqual((await koer('detect')).kald, ['detect']);
  assert.deepEqual((await koer('click_checkbox')).kald, ['checkbox', 'detect'], 'click_checkbox tjekker igen bagefter, som teksten siger');
  assert.deepEqual((await koer('click_grid', [3, 7])).kald, ['grid:11:[3,7]'], 'click_grid sender de valgte celler uaendret til hjaelperen, paa sessionens fane');
  assert.deepEqual((await koer('click_grid', [8], 4)).kald, ['grid:11:[8]:4'], 'click_grid sender agentens gitterstoerrelse videre');
  const menneske = await koer('ask_human');
  assert.deepEqual(menneske.kald, [], 'ask_human kalder intet - den viser ikke selv noget');
  assert.equal(menneske.svar.method, 'human');
  assert.match(menneske.svar.instructions, /browser_ask_user/, 'den returnerer beskeden til browser_ask_user');
});

test('click_grid bruger agentens gitterstoerrelse, og gaetter kun naar den mangler', async () => {
  // 8/10 (1.30.2 skive 1b, fundet af Astra R33): et 4x4-gitter med kun [8] blev klikket som 3x3.
  const vm = await import('node:vm');
  const koer = async (cells, grid) => {
    const klik = [];
    const frame = { x: 100, y: 200, width: 428, height: 600 };
    const ctx = {
      debuggerAttach: async () => {}, debuggerDetach: async () => {},
      cdpSend: async (_id, metode, args) => {
        if (metode === 'Runtime.evaluate') return { result: { value: JSON.stringify({ found: true, ...frame }) } };
        klik.push({ metode, ...args }); return {};
      },
      dispatchTaalmodigt: async (_id, args) => { klik.push({ metode: 'Input.dispatchMouseEvent', ...args }); },
      setTimeout: (cb) => cb(), Math: Object.assign(Object.create(Math), { random: () => 0.5 }), JSON,
    };
    vm.createContext(ctx);
    vm.runInContext(helFunktion(bgSrc, 'clickCaptchaGridCells') + '\nthis.koer = clickCaptchaGridCells;', ctx);
    const svar = await ctx.koer(11, cells, grid);
    svar.musehaendelser = klik.filter(k => k.metode === 'Input.dispatchMouseEvent').length;
    return svar;
  };
  const gaet = await koer([8]);
  assert.equal(gaet.grid, '3x3'); assert.deepEqual([gaet.cells[0].row, gaet.cells[0].col], [2, 2]);
  assert.match(gaet.gridFrom, /guessed/, 'svaret siger at gitteret er gaettet');
  const ni = await koer([9]);
  assert.equal(ni.grid, '4x4', 'uden grid gaettes 4x4 netop naar et indeks er 9 eller mere (som teksten siger)');
  assert.deepEqual([ni.cells[0].row, ni.cells[0].col], [2, 1]);
  const fire = await koer([8], 4);
  assert.equal(fire.grid, '4x4', 'grid: 4 vinder over gaetteriet');
  assert.deepEqual([fire.cells[0].row, fire.cells[0].col], [2, 0], 'celle 8 i et 4x4-gitter er raekke 2, kolonne 0');
  assert.equal(fire.gridFrom, 'given');
  const tre = await koer([12], 3);
  assert.equal(tre.clicked, false, 'grid: 3 med indeks 12 er uden for gitteret');
  const blandet = await koer([2, 12], 3);
  assert.equal(blandet.clicked, false, 'grid: 3 med en celle uden for gitteret afvises helt - ingen tavs delvis klikning');
  assert.match(blandet.error, /do not fit a 3x3 grid/);
  assert.equal(blandet.musehaendelser, 0, 'intet maa klikkes foer afvisningen (R40)');
  const negativ = await koer([-1, 2], 3);
  assert.equal(negativ.clicked, false); assert.equal(negativ.musehaendelser, 0, 'et negativt indeks afviser hele kaldet');
  const seksten = await koer([2, 16]);
  assert.equal(seksten.clicked, false, 'indeks 16 er aldrig gyldigt - ogsaa uden grid'); assert.equal(seksten.musehaendelser, 0);
  const nul = await koer([8], null);
  assert.equal(nul.grid, '3x3', 'grid: null behandles som udeladt'); assert.match(nul.gridFrom, /guessed/);
  const decimal = await koer([0, 3.9], 4);
  assert.equal(decimal.clicked, false, 'et decimalt indeks afvises helt (R40)'); assert.match(decimal.error, /whole numbers/);
  assert.equal(decimal.musehaendelser, 0, 'intet maa klikkes foer et decimalt indeks afvises (R41)');
  const decimalUden = await koer([2.9]);
  assert.equal(decimalUden.clicked, false, 'ogsaa uden grid'); assert.equal(decimalUden.musehaendelser, 0);
  assert.equal(TOOLS.find(t => t.name === 'browser_solve_captcha').inputSchema.properties.cells.items.type, 'integer', 'skemaet kraever heltal');
  const forkert = await koer([0], 5);
  assert.equal(forkert.clicked, false); assert.match(forkert.error, /grid must be 3 or 4/);
  const props = TOOLS.find(t => t.name === 'browser_solve_captcha').inputSchema.properties;
  assert.deepEqual(props.grid.enum, [3, 4], 'skemaet tillader kun 3 og 4');
  assert.equal(props.grid.type, 'number', 'grid er et tal i skemaet, ikke en tekst');
  const skema = TOOLS.find(t => t.name === 'browser_solve_captcha').inputSchema;
  assert.ok(!(skema.required || []).includes('grid'), 'grid er valgfri - et kald uden grid skal stadig vaere gyldigt');
  assert.match(props.cells.description, /Pass grid to say which grid you see; without it, the grid is read as 4x4 only when an index is 9 or higher/);
});


test('BROWSER_MCP_CHECK_NPM taendes kun af vaerdien 1', () => {
  const linje = indexSrc.match(/^const TJEK_NPM = [^\n]+$/m);
  assert.ok(linje, 'index.js laeser flaget i én linje `const TJEK_NPM = ...`');
  const tolk = (env) => new Function('process', linje[0] + '\nreturn TJEK_NPM;')({ env });
  assert.equal(tolk({}), false);
  for (const v of ['', '0', 'false', 'no', 'true', ' 1']) assert.equal(tolk({ BROWSER_MCP_CHECK_NPM: v }), false, `vaerdien ${JSON.stringify(v)} maa ikke taende npm-tjekket`);
  assert.equal(tolk({ BROWSER_MCP_CHECK_NPM: '1' }), true);
});

test('npm-tjekket koerer kun med BROWSER_MCP_CHECK_NPM=1, som `npm view`, og husker svaret', async () => {
  const lav = (tilvalgt) => {
    const kald = [];
    const f = new Function('TJEK_NPM', 'execFile', `let npmLatestCache = null; const NPM_LATEST_TTL_MS = 600000; ${helFunktion(indexSrc, 'npmLatestVersion')} return npmLatestVersion;`)(
      tilvalgt, (cmd, args, _o, cb) => { kald.push([cmd, ...args]); cb(null, '1.30.1\n'); });
    return { f, kald };
  };
  const fra = lav(false);
  assert.equal(await fra.f(), null); assert.equal(await fra.f(), null);
  assert.deepEqual(fra.kald, [], 'uden tilvalg startes ingen npm-proces');
  const til = lav(true);
  assert.equal(await til.f(), '1.30.1'); assert.equal(await til.f(), '1.30.1');
  assert.deepEqual(til.kald, [['npm', 'view', '@agent360/browser-mcp', 'version']], 'med tilvalg: ét `npm view`, derefter cache');
});

test('CAPTCHA-raekkerne i README\'erne og paa /docs/tools har ikke de gamle loefter', () => {
  for (const fil of ['README.md', 'mcp-server/README.md', 'content/browsermcp-docs-tools.md']) {
    const raekke = laes(fil).split('\n').find(l => l.startsWith('| `browser_solve_captcha` |'));
    assert.ok(raekke, `${fil} har en raekke for browser_solve_captcha`);
    assert.doesNotMatch(raekke, /automatically|often passes|AI vision guided|overlay|returns? (a|the) screenshot|then .* then/i, `${fil}: CAPTCHA-raekken lover igen noget koden ikke goer`);
    assert.match(raekke, /one (step|action) per call/i, `${fil}: raekken siger at trinene koeres ét ad gangen`);
  }
});

// R43 (Astra): serverens instruktioner navngav felter, svarene ikke har: `faktisk` (fill svarer `actual`),
// `uvist` (scroll svarer `unknown`) og `vedhaeftet` (upload/drop svarer `attached`). Hvert navn bindes til koden.
test('de feltnavne instruktionerne beder agenten laese, findes i svarene', () => {
  const i = indexSrc.indexOf('const INSTRUCTIONS');
  const instruks = indexSrc.slice(i, indexSrc.indexOf('`;', i));
  assert.doesNotMatch(instruks, /\b(faktisk|uvist|vedhaeftet)\b/, 'et gammelt dansk feltnavn staar stadig i instruktionen');
  assert.match(instruks, /browser_fill with differs: true[^\n]*read actual/, 'fill-raadet naevner actual');
  assert.match(instruks, /browser_scroll uses unknown/, 'scroll-raadet naevner unknown');
  assert.match(instruks, /also report attached/, 'upload-raadet naevner attached');
  assert.match(caseBlok(bgSrc, 'scroll'), /\bunknown: true\b/, 'scroll svarer med unknown');
  assert.match(bgSrc, /attached: vedhaeftet\.navne/, 'upload og drop svarer med attached');
  // Hver differs-svar i fill (alle grene) har actual, saa raadet kan foelges uanset gren.
  const fill = caseBlok(bgSrc, 'fill');
  const differs = [...fill.matchAll(/\{[^{}]*differs: true[^{}]*\}/g)].map(m => m[0]);
  assert.ok(differs.length >= 1, 'fill har mindst ét differs-svar');
  for (const o of differs) assert.match(o, /\bactual:/, `et differs-svar i fill mangler actual: ${o.slice(0, 80)}`);
  assert.doesNotMatch(fill, /`faktisk`/, 'en note i fill peger paa feltet faktisk, som ikke findes');
});

// R43 (Opus): bind det mekanisk - de gamle navne staar i CHANGELOG 1.30.0's omdoebningstabel og -afsnit; ingen
// af dem maa staa i det agenten laeser (serverens instruktioner og vaerktoejsbeskrivelserne).
test('ingen af de omdoebte felt- og fejlnavne fra 1.30.0 staar i det agenten laeser', () => {
  const log = laes('CHANGELOG.md');
  const i = log.indexOf('**Renamed response fields.**');
  assert.ok(i > -1, 'CHANGELOG har omdoebningstabellen');
  const afsnit = log.slice(i, log.indexOf('\n\n**', log.indexOf('**Renamed error codes.**', i) + 5) + 1 || undefined);
  const gamle = new Set([
    ...[...afsnit.matchAll(/^\|\s*`([^`]+)`\s*\|\s*`[^`]+`\s*\|/gm)].map(m => m[1]),
    ...[...afsnit.matchAll(/`([^`]+)`\s*→/g)].map(m => m[1]),
  ]);
  assert.ok(gamle.size >= 13, `fandt kun ${gamle.size} gamle navne i CHANGELOG - parseren er blind`);
  assert.ok(gamle.has('faktisk') && gamle.has('uvist') && gamle.has('vedhaeftet'), 'kalibrering: de tre kendte navne findes');
  const j = indexSrc.indexOf('const INSTRUCTIONS');
  const agenttekst = indexSrc.slice(j, indexSrc.indexOf('`;', j)) + '\n' + TOOLS.map(t => JSON.stringify(t)).join('\n');
  const fund = [...gamle].filter(n => new RegExp(`(^|[^A-Za-z0-9_-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`).test(agenttekst));
  assert.deepEqual(fund, [], `gamle navne fra foer 1.30.0 i det agenten laeser: ${fund.join(', ')}`);
});

// 8/10 (agent360.dk-panelet, Astra + Opus, efterproevet i koden): beskrivelsen lovede «read its API token from the page».
// Vaerktoejet navigerer og returnerer en instruktion; hos 4 af 9 er siden en indstillings- eller app-liste, og en ukendt
// udbyder svarer kun «Unknown provider». Teksten skal sige netop det - og nævne hver udbyder, koden kender.
test('extract_token beskriver de udbydere og sider, koden faktisk har', async () => {
  const { TOOLS, PROVIDER_PAGES } = await import('../mcp-server/tools.js');
  const t = TOOLS.find((x) => x.name === 'browser_extract_token');
  for (const p of Object.keys(PROVIDER_PAGES)) assert.match(t.description, new RegExp(`\\b${p}\\b`), `udbyderen ${p} mangler i beskrivelsen`);
  assert.match(t.description, /reads nothing itself/, 'beskrivelsen lover at vaerktoejet laeser tokenet');
  assert.match(t.description, /Unknown provider/, 'en ukendt udbyder er ikke beskrevet');
  const etTrinFoer = Object.entries(PROVIDER_PAGES).filter(([, v]) => !/apikeys|account\/api|settings\/api|api_webhooks|apis\/credentials/.test(v.url)).map(([k]) => k);
  assert.deepEqual(etTrinFoer.sort(), ['hubspot', 'linkedin', 'shopify', 'slack'], 'listen over sider uden selve tokenet passer ikke laengere med koden');
  // R52 (Opus): «one step before the token» passede ikke - kodens egne instruktioner siger 2-5 trin.
  assert.match(t.description, /HubSpot, Slack, Shopify and LinkedIn the page is a settings or app list on the way to the token, not the token page itself/);
  assert.doesNotMatch(t.description, /one step before the token/);
  assert.doesNotMatch(t.description, /read its API token from the page/);
});

// R52 (Astra, MAALT): «constructor», «toString» og «__proto__» gik uden om «Unknown provider», og handleren navigerede
// til url undefined. Den rigtige handler koeres med en falsk udvidelse.
test('extract_token answers Unknown provider for names that only exist on the prototype', async () => {
  const kilde = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');
  const start = kilde.indexOf('async function handleExtractToken(');
  let d = 0, i = kilde.indexOf('{', start);
  for (; i < kilde.length; i++) { if (kilde[i] === '{') d++; else if (kilde[i] === '}' && --d === 0) break; }
  const { PROVIDER_PAGES } = await import('../mcp-server/tools.js');
  const navigeret = [];
  const h = new Function('PROVIDER_PAGES', 'sendToExtension', `${kilde.slice(start, i + 1)}\nreturn handleExtractToken;`)(
    PROVIDER_PAGES, async (m, p) => { navigeret.push(p.url); return { title: 't' }; });
  for (const navn of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nope']) {
    const r = await h({ provider: navn });
    assert.match(r.content[0].text, /^Unknown provider/, `${navn} did not answer Unknown provider`);
  }
  assert.deepEqual(navigeret, [], 'the handler navigated for an unknown provider');
  await h({ provider: 'stripe' });
  assert.deepEqual(navigeret, ['https://dashboard.stripe.com/apikeys'], 'a known provider no longer navigates');
});

// 1.30.2 skive 20 (Opus R38, MAALT 9/10 i headless Chrome): udvidelsens egen CSP (connect-src 'self' ws://127.0.0.1:*
// http://127.0.0.1:*) blokerede browser_fetch mod ENHVER ekstern adresse - ogsaa i den udgivne 1.30.1 - mens beskrivelsen
// lovede API-kald til Google, Stripe og Slack. connect-src faar https:, og beskrivelsen siger graensen.
test('browser_fetch kan naa https-adresser, og beskrivelsen siger at http kun gaar til 127.0.0.1', async () => {
  for (const f of ['extension/manifest.json', 'mcp-server/extension/manifest.json']) {
    const csp = JSON.parse(readFileSync(join(rod, f), 'utf8')).content_security_policy.extension_pages;
    const connect = (csp.match(/connect-src ([^;]*)/) || [])[1] || '';
    // R54 (Astra): en ekstra navngiven http-vaert («http://bank.test:*») overlevede de enkelte tjek. Hele saettet laases.
    assert.deepEqual(connect.trim().split(/\s+/).sort(), ["'self'", 'http://127.0.0.1:*', 'https:', 'ws://127.0.0.1:*'].sort(),
      `${f}: connect-src er ikke praecis 'self', broen til 127.0.0.1 (ws og http) og https: - ${connect}`);
  }
  const { TOOLS } = await import('../mcp-server/tools.js');
  const d = TOOLS.find((t) => t.name === 'browser_fetch').description;
  assert.match(d, /HTTPS request/);
  assert.match(d, /Plain http works only to 127\.0\.0\.1/);
});

// R53 (Opus): samme fejlklasse som extract_token - methodMap[name] fandt «constructor» paa prototypen.
test('vaerktoejsnavne slaas kun op blandt methodMap\'s egne noegler', () => {
  assert.match(indexSrc, /const method = Object\.hasOwn\(methodMap, name\) \? methodMap\[name\] : undefined;/);
  assert.doesNotMatch(indexSrc, /const method = methodMap\[name\];/);
});

// R55 (Opus, MAALT i Chrome): browser_fetch bar brugerens cookies til enhver https-adresse og gemte svarets cookies.
// Kaldet koeres gennem den rigtige dispatch med en falsk fetch, og optionerne tjekkes.
test('browser_fetch sender ikke brugerens cookies og gemmer ikke svarets, men agentens headers kommer med', async () => {
  const { indlaesUdvidelse } = await import('./hjaelp/udvidelses-sele.mjs');
  const u = indlaesUdvidelse();
  await u.hent('dispatch')(9876, 'fetch', { url: 'https://api.example/v1/x', headers: { Authorization: 'Bearer t' } });
  const kald = u.optager.til('fetch');
  assert.equal(kald.length, 1, 'browser_fetch kaldte ikke fetch');
  const opts = kald[0].args[1];
  assert.equal(opts.credentials, 'omit', 'fetch bruger brugerens cookies (credentials er ikke omit)');
  assert.equal(opts.headers.Authorization, 'Bearer t', 'agentens egne headers kom ikke med');
  const { TOOLS } = await import('../mcp-server/tools.js');
  assert.match(TOOLS.find((t) => t.name === 'browser_fetch').description, /Your browser cookies are not sent and the answer's cookies are not stored: pass a token in headers/);
});

// R55 (Opus): kun tools.js var bundet - README-raekken og /docs/tools kunne love almindelig http eller cookies igen.
test('browser_fetch-raekkerne i README og /docs/tools siger https, ingen cookies og http kun til 127.0.0.1', () => {
  for (const [f, start] of [['README.md', '| `browser_fetch` |'], ['mcp-server/README.md', '| `browser_fetch` |'], ['content/browsermcp-docs-tools.md', '| `browser_fetch` |']]) {
    const l = laes(f).split('\n').find((x) => x.startsWith(start));
    assert.ok(l, `${f}: browser_fetch-raekken findes ikke`);
    assert.match(l, /HTTPS request/, `${f}: siger ikke at det er https`);
    // R58 (Astra): ordet «cookies» alene lod «with your browser cookies» passere.
    assert.match(l, /(without your browser cookies \(none are sent, none are stored\)|Your browser cookies are not sent and the answer's cookies are not stored)/, `${f}: siger ikke at cookies hverken sendes eller gemmes`);
    assert.match(l, /plain http (works )?only to 127\.0\.0\.1/i, `${f}: siger ikke at almindelig http kun gaar til 127.0.0.1`);
  }
});

// 1.30.2 (planens punkt om CHANGELOG): afsnittet skal naevne hvert nyt svar en agent kan se, og hvert svar skal findes i koden.
test('CHANGELOG 1.30.2 naevner hvert nyt svar, og hvert findes i koden', () => {
  const log = laes('CHANGELOG.md');
  const afsnit = log.slice(log.indexOf('## 1.30.2'), log.indexOf('## 1.30.1'));
  assert.ok(afsnit.length > 1000, 'afsnittet for 1.30.2 findes ikke');
  const kode = laes('extension/background.js') + laes('mcp-server/index.js');
  const svar = {
    covered: /error: 'covered'/, 'field-is-readonly': /'field-is-' \+ blocked[\s\S]*'readonly'|'readonly'[\s\S]*'field-is-' \+ blocked/,
    'field-is-disabled': /'field-is-' \+ blocked[\s\S]*'disabled'|'disabled'[\s\S]*'field-is-' \+ blocked/,
    tab_closed: /action: 'tab_closed'/, replaced: /action: 'replaced'/, navigated: /action: 'navigated'/,
    removed_by_page: /removed_by_page/, 'file-access-off': /file-access-off/, scroll_method: /scroll_method:/,
    extension_connections: /extension_connections:/, worked: /\bworked\b/, covered_by: /covered_by:/,
    // R62 (Astra, MAALT): raekkerne om vinduessvaret og viewport-noten kunne fjernes, uden at proeven blev roed.
    eget_vindue: /eget_vindue: iEgetVindue/, advarsel: /advarsel: !iEgetVindue/, file_access: /file_access: tilladt/,
  };
  for (const [navn, iKode] of Object.entries(svar)) {
    assert.ok(afsnit.includes('`' + navn) || afsnit.includes('"' + navn), `CHANGELOG 1.30.2 naevner ikke ${navn}`);
    assert.match(kode, iKode, `${navn} staar i CHANGELOG, men ikke i koden`);
  }
  assert.match(afsnit, /also not\s+to 127\.0\.0\.1, where 1\.30\.1 did/, 'cookie-aendringen for 127.0.0.1 skal staa der (planens punkt)');
  // Viewport-noten har intet feltnavn; raekken skal staa der, og noten skal findes i serveren.
  assert.match(afsnit, /\| a viewport note next to the image \| `browser_screenshot` \|/);
  assert.match(laes('mcp-server/index.js'), /Viewport: \$\{vp\.css_width\}×\$\{vp\.css_height\} CSS pixels, devicePixelRatio/);
  // file-access-off: raekken skal naevne begge tilfaelde, som koden har dem (R62).
  assert.match(afsnit, /`file_access: false`\) or Chrome could not tell \(`file_access: null`/);
});
