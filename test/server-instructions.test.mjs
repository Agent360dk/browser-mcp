// Naar serverens instruktioner rent faktisk naar frem til agenten.
//
// MAALT 21/8 ved at laese initialize-svaret fra den koerende server: det indeholdt
// protocolVersion, capabilities og serverInfo - og INGEN instructions. Blokken paa
// 7.000 tegn i index.js var doed vaegt.
//
// Aarsagen: `instructions` blev givet som et TREDJE argument til Server-konstruktoeren.
// Den tager kun to (serverInfo, options), saa JavaScript smed objektet vaek i tavshed.
// Ingen fejl, ingen advarsel - bare en agent der aldrig fik at vide at den skal lukke
// sine faner, hvordan CAPTCHA loeses, eller hvornaar tekst-selektorer slaar CSS.
//
// Testen bygger konstruktoerkaldet af den RIGTIGE kilde og kalder den RIGTIGE SDK-klasse,
// saa den maaler leveringen - ikke bare at ordet "instructions" staar et sted i filen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');

// node_modules ligger i mcp-server/, ikke i roden, saa et bart pakkenavn ikke kan
// resolves herfra. Vi importerer den SAMME SDK som serveren selv bruger.
// MAALT 19/9: `await import(join(...))` giver paa Windows en sti som C:\\...\\tools.js,
// og dynamisk import kraever en file://-URL - "Only URLs with a scheme in: file, data,
// and node are supported". Windows-jobbet havde vaeret roedt saa laenge at det blokerede
// hver eneste PR. pathToFileURL loeser det og er en no-op paa mac og Linux.
const { Server } = await import(pathToFileURL(join(rod, 'mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js')).href);

// Klip 'new Server(...)'-kaldet ud med balancerede parenteser.
function konstruktoerKald() {
  const start = kilde.indexOf('new Server(');
  assert.ok(start > -1, 'fandt ikke new Server( i index.js');
  let dybde = 0, i = kilde.indexOf('(', start);
  for (; i < kilde.length; i++) {
    if (kilde[i] === '(') dybde++;
    else if (kilde[i] === ')' && --dybde === 0) break;
  }
  return kilde.slice(start, i + 1);
}

// Fable (efterproevning 11/9): svarene har faaet felterne landed, maaske_landet, afviger og uaendret, men instruktionerne
// naevnte ingen af dem (0 traeffere i index.js). Kun svarets note bar betydningen, og en agent der kun laeser ok, klikker igen.
test('instruktionerne forklarer de uvisse svar, saa agenten ikke gentager en handling blindt', () => {
  const start = kilde.indexOf('## When things fail');
  assert.ok(start > -1, 'afsnittet "When things fail" mangler');
  const afsnit = kilde.slice(start, kilde.indexOf('\n## ', start + 5));
  for (const felt of ['maybe_landed', 'landed', 'differs', 'unchanged']) {
    assert.match(afsnit, new RegExp(felt), `instruktionerne naevner ikke ${felt}`);
  }
  assert.match(afsnit, /maybe_landed[^\n]*(do not|don't|never)[^\n]*(again|repeat)/i, 'maybe_landed skal sige: gentag ikke blindt');
});

test('instructions leveres til klienten via SDK-serveren', () => {
  const src = konstruktoerKald();
  const INSTRUCTIONS = 'PROEVE-INSTRUKTIONER';
  const srv = new Function('Server', 'PKG_VERSION', 'INSTRUCTIONS', `return ${src};`)(
    Server, '0.0.0-test', INSTRUCTIONS,
  );
  // _instructions er det felt SDK'en laeser naar den bygger initialize-svaret.
  assert.equal(srv._instructions, INSTRUCTIONS,
    'instructions naaede ikke ind i serveren - ligger den i et tredje argument igen?');
});

test('instructions ligger i samme options-objekt som capabilities', () => {
  const src = konstruktoerKald();
  // Tael argumenter, ikke kommaer: en afsluttende komma foer ')' er lovlig JS og
  // maa ikke tælle som et ekstra argument.
  const argumenter = (() => {
    let dybde = 0, nu = '', ud = [];
    for (const c of src.slice(src.indexOf('(') + 1, src.length - 1)) {
      if ('({['.includes(c)) { dybde++; nu += c; }
      else if (')}]'.includes(c)) { dybde--; nu += c; }
      else if (c === ',' && dybde === 0) { ud.push(nu); nu = ''; }
      else nu += c;
    }
    ud.push(nu);
    return ud.map(x => x.trim()).filter(Boolean);
  })();
  assert.equal(argumenter.length, 2,
    `new Server() kaldes med ${argumenter.length} argumenter - konstruktoeren tager to, resten smides tavst vaek`);
  assert.match(src, /capabilities:[\s\S]*instructions:|instructions:[\s\S]*capabilities:/,
    'capabilities og instructions skal ligge i det SAMME objekt');
});

test('instruktionerne indeholder faktisk det agenten skal styres af', () => {
  const i = kilde.indexOf('const INSTRUCTIONS = `');
  const blok = kilde.slice(i, kilde.indexOf('`;', i));
  assert.ok(blok.length > 2000, `INSTRUCTIONS er kun ${blok.length} tegn - er blokken blevet toemt?`);
  for (const emne of ['browser_ask_user', 'browser_close_tab', 'browser_provide_feedback', 'browser_solve_captcha']) {
    assert.ok(blok.includes(emne), `INSTRUCTIONS naevner ikke ${emne}`);
  }
});

// MAALT 11/9 (Fable, bekraeftet i den udgivne 1.29.0-pakke): instruksen sagde til hver agent
// "The MCP server auto-pulls the latest code from git on every new session startup". Det
// blev fjernet 22/8; serveren opdateres via npm (@latest) og kopierer selv nye udvidelsesfiler.
// En agent der tror paa git-saetningen, forklarer brugeren noget der ikke sker.
// MAALT 11/9 i Chrome for Testing: Chrome leverer ikke mus og taster til en fane i baggrunden, og vaerktoejet
// svarer "CDP svarede ikke inden ... ms". En agent der ikke ved det, proever igen eller opgiver.
test('instruktionerne siger hvad agenten goer naar input ikke naar en fane i baggrunden', () => {
  const i = kilde.indexOf('const INSTRUCTIONS = `');
  const blok = kilde.slice(i, kilde.indexOf('`;', i));
  assert.match(blok, /CDP did not respond[^\n]*background[^\n]*browser_switch_tab/,
    'INSTRUCTIONS skal forbinde fristfejlen med en baggrundsfane og browser_switch_tab');
});

test('instruktionerne lover ikke at serveren henter kode fra git', () => {
  const i = kilde.indexOf('const INSTRUCTIONS = `');
  const blok = kilde.slice(i, kilde.indexOf('`;', i));
  assert.doesNotMatch(blok, /auto-pulls?|from git|git pull/i,
    'INSTRUCTIONS paastaar igen at serveren henter kode fra git');
  assert.match(blok, /## Extension updates[\s\S]*npm[\s\S]*chrome:\/\/extensions/,
    'afsnittet om opdateringer skal forklare den rigtige vej: npm-versionen og genindlaesning i chrome://extensions');
});

// ── Naar svaret aerligt er «det her sker ikke i en browser» ─────────────────
// Gustav 19/9: naar Browser MCP rammer en vaeg, skal brugeren kunne komme videre med et
// skrivebords-vaerktoej. Foerste forslag var en pop-up i udvidelsen. MAALT foerst: af de
// 26 vaegge vaerktoejerne svarer med, loeser et skrivebords-vaerktoej ÉN familie - filvaelgeren.
// Baggrundsfane, React-styret felt, CAPTCHA, CSP og arbejdsmappe-spaerren loeser vi selv.
// En pop-up paa enhver vaeg ville altsaa vaere usand i naesten alle de tilfaelde den fyrede i.
//
// Derfor staar henvisningen i instruktionen i stedet, betinget og med sin egen afgraensning:
// den gaelder KUN naar det oenskede slet ikke er i en webside. Agenten kan selv se om den har
// skrivebords-vaerktoejer, saa den behoever ikke spoerge - og der er ingen reklame i et svar.
test('instruktionen henviser til et skrivebords-vaerktoej - og kun hvor det er sandt', () => {
  const iStart = kilde.indexOf('## When things fail');
  const blok = kilde.slice(iStart, kilde.indexOf('`;', iStart));
  assert.match(blok, /not in a web page at all/,
    'der er ingen linje om det der slet ikke sker i en browser');
  assert.match(blok, /computer-mcp/, 'der peges ikke paa et konkret skrivebords-vaerktoej');
  // Afgraensningen er ikke pynt: uden den bliver henvisningen et svar paa enhver vaeg.
  const iLinje = blok.indexOf('not in a web page at all');
  const linje = blok.slice(iLinje, blok.indexOf('\n', iLinje));
  assert.match(linje, /background tab|React|CAPTCHA/,
    'linjen siger ikke hvad den IKKE gaelder - saa vil den blive brugt paa almindelige side-problemer');
  assert.match(linje, /If you also have|if you also have/,
    'henvisningen er ikke betinget af at agenten faktisk HAR skrivebords-vaerktoejer');
});

// R102 Opus (mutant M2): serverens «When things fail» skal give udgangen gennem brugeren, nu hvor browser_switch_tab ikke
// laengere tager Chrome frem (14/10, Gustav: «den bliver ved med at tage min computer»).
test('When things fail: spoerg brugeren foer bring_to_front, i begge input-punkter', () => {
  const start = kilde.indexOf('## When things fail');
  const afsnit = kilde.slice(start, kilde.indexOf('\n## ', start + 5));
  assert.match(afsnit, /If it still does not land, Chrome itself is probably not in front: browser_switch_tab no longer brings it forward, so ask the user \(browser_ask_user\) and only then call browser_switch_tab with bring_to_front: true/);
  assert.match(afsnit, /If it still fails, ask the user before browser_switch_tab with bring_to_front: true/);
});

// R154 (Opus): ogsaa «active app», «on top» og «verified/confirmed/tested/proven» som maaleord.
const FOKUS_ORD = /\b(?:(?:un)?focus(?:s?ed)?|foreground|frontmost|in front|on top|active app)\b/i;   // R155 (Opus): «unfocused», «focussed»
const MAALE_ORD = /measur|\bverif|\bconfirm|\bproven\b|\btested\b/i;
// R155 (Opus): en falsk saetning lige EFTER en godkendt saetning («… decides. Since 20 Oct that is settled by measurement: it does not.»)
// har intet fokusord og slap igennem. Fokusafsnittet fryses derfor ordret paa hver flade, inklusive starten af saetningen efter -
// ogsaa en indsat saetning midt i eller lige efter er dermed roed.
const FROSNE_FOKUS_AFSNIT = {
  'README.md': "Chrome delivers no mouse or keyboard input to a tab that is not the visible one in its window (measured). Whether it does to the active tab of a window without the operating system's focus is unmeasured in desktop Chrome, so the tools' `landed` answer decides. One observation on macOS (Chrome for Testing on GitHub's runner, 14 Oct 2026) saw a key press land in the active tab while another app (TextEdit) was in front; that is one platform and one input type, not a general measurement. Some of it cannot be solved at all:",
  'content/browsermcp-docs-troubleshooting.md': "Input - typing, hover, coordinate clicks - does not reach a tab that is not the visible one in its window (measured). Whether it reaches the active tab of a window without the operating system's focus is unmeasured in desktop Chrome, so the tools' `landed` answer decides. One observation on macOS (Chrome for Testing on GitHub's runner, 14 Oct 2026) saw a key press land in the active tab while another app (TextEdit) was in front; that is one platform and one input type, not a general measurement. When input does not land, the agent has to ask you, and you decide. **Fix status:",
};
FROSNE_FOKUS_AFSNIT['mcp-server/README.md'] = FROSNE_FOKUS_AFSNIT['README.md'];

const GODKENDTE_FOKUS_SAETNINGER = new Set([
  "Up to 1.30.1 the agent then called `browser_switch_tab`, which brought Chrome in front of you every time, and a screenshot of a covered window raised Chrome and left it there.",
  "Whether it does to the active tab of a window without the operating system's focus is unmeasured in desktop Chrome, so the tools' `landed` answer decides.",
  "Whether it reaches the active tab of a window without the operating system's focus is unmeasured in desktop Chrome, so the tools' `landed` answer decides.",
  "One observation on macOS (Chrome for Testing on GitHub's runner, 14 Oct 2026) saw a key press land in the active tab while another app (TextEdit) was in front; that is one platform and one input type, not a general measurement.",
  "When Chrome gives no picture in time, or the picture cannot be read back - usually because its window is covered by other windows or minimized - the answer is `window-covered`, and Chrome is not pulled in front; other errors are reported as they are.",
]);

// R103 (Astra + Opus): README og fejlfindingssiden kaldte et fokuskrav «measured», mens tools.js siger at input til den aktive
// fane i et ufokuseret vindue er umaalt. Ingen flade maa igen paastaa det som maalt.
test('ingen flade kalder et fokuskrav maalt: input til et ufokuseret vindue er umaalt', () => {
  for (const f of ['README.md', 'mcp-server/README.md', 'content/browsermcp-docs-troubleshooting.md']) {
    const t = readFileSync(join(rod, f), 'utf8').replace(/\s+/g, ' ');
    assert.doesNotMatch(t, /operating system's focus \(both measured/, `${f} kalder fokuskravet maalt`);
    assert.doesNotMatch(t, /needs the tab to be the visible one in a window that has the operating system's focus/, `${f} gør OS-fokus til et krav`);
    assert.match(t, /without the operating system's focus is unmeasured in desktop Chrome/, `${f} siger ikke at fokus-tilfaeldet er umaalt`);
    // R104 Opus forslag 1: vagten var bundet til ordlyden - en omskrivning som «… operating system's focus (measured)» slap igennem.
    assert.doesNotMatch(t, /operating system's focus[^.]{0,80}\(measured/, `${f} kalder fokuskravet maalt (omskrevet)`);
    // C11 (14/10-maalingen): én observation paa macOS naevnes - som én observation, ikke som en generel maaling
    // R152 (Astra + Opus): vagten var bundet til ordstumper - «did not see a key press land» og «was not in front» slap igennem.
    assert.match(t, /One observation on macOS \(Chrome for Testing on GitHub's runner, 14 Oct 2026\) saw a key press land in the active tab while another app \(TextEdit\) was in front; that is one platform and one input type, not a general measurement\./, `${f} naevner ikke 14/10-observationen ordret med sin graense`);
    // R153-R154 (Astra + Opus): regex-vagter mod «maalt»-formuleringer blev ved med at slippe nye omskrivninger igennem og gav
    // falsk roedt paa sande saetninger. Reglen er nu et GODKENDT SAET: enhver saetning, der naevner fokus eller forgrund, og som selv
    // eller i saetningen efter taler om maaling, skal vaere én af de reviewede saetninger herunder. En ny formulering - ogsaa en sand -
    // er roed med vilje: den skal reviewes og tilfoejes her, foer den maa staa paa en flade.
    // R155 (Astra): ogsaa maaleord i saetningen FOER taeller, og markdown-fremhaevning (**in** front) fjernes foer ordene soeges.
    assert.ok(t.includes(FROSNE_FOKUS_AFSNIT[f]), `${f}: fokusafsnittet er aendret - en reviewet tekst skal ind i FROSNE_FOKUS_AFSNIT, foer den maa staa paa fladen`);
    // R156 (Astra): ogsaa understregnings-fremhaevning (__in__ front) fjernes; en understregning MELLEM to ordtegn (browser_fill) bliver.
    const saetninger = t.replace(/\*+/g, '').replace(/(?<!\w)_+|_+(?!\w)/g, '').split(/(?<=[.!?])\s+/);
    const nye = saetninger.filter((x, i) => FOKUS_ORD.test(x)
      && (MAALE_ORD.test(x) || MAALE_ORD.test(saetninger[i + 1] || '') || MAALE_ORD.test(saetninger[i - 1] || '')))
      .filter((x) => !GODKENDTE_FOKUS_SAETNINGER.has(x));
    assert.deepEqual(nye, [], `${f} har en ureviewet saetning om fokus/forgrund og maaling - review den og tilfoej den til GODKENDTE_FOKUS_SAETNINGER`);
  }
});

// R153 (Opus): R152's afvisning (CHANGELOG generaliserede et maalt sl-icon til «an icon» paa «Shoelace 2.x») havde ingen proeve -
// teksten kunne falde tilbage, eller afsnittet forsvinde, uden at noget blev roedt.
test('CHANGELOG: klikbevisets bibliotekstilfaelde staar afgraenset til de maalte versioner', () => {
  const t = readFileSync(join(rod, 'CHANGELOG.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(t, /Measured in Shoelace 2\.20\.1 with its default styling: the custom `sl-icon` element in an `sl-button`'s prefix slot never gets the click itself/);
  assert.match(t, /Measured in Ionic 8\.8\.19: an `ion-segment-button`'s icon or label as the target answers `covered`/);
  assert.match(t, /Other versions of these libraries are unmeasured\./);
  assert.match(t, /inside an `sl-button` it is unmeasured in Chrome/);
  // R154 (Astra): maaleplaceringen og svarene skal ogsaa vaere bundet, ikke kun versionerne.
  assert.match(t, /never gets the click itself \(the library sets `pointer-events: none` there\), so clicking that `sl-icon` answers `maybe_landed` - target the button\./);
  assert.match(t, /A native `svg` or `i` icon is not a field: measured inside a native `button`, clicking it answered `landed: true` when the button got the click/);
  assert.doesNotMatch(t, /In Shoelace 2\.x, an icon/, 'CHANGELOG generaliserer igen et maalt sl-icon til ethvert ikon');
  // R155-R156 (Opus): «every icon», «each icon» - men ikke «all icons in colour» om noget andet.
  // R157 (Astra): sammenhaengen tjekkes i hele saetningen, begge sider af ordet.
  // R157 (Opus): «e.g.» midt i en saetning maa ikke dele den - der deles kun foran et stort bogstav.
  const ikonGeneraliseringer = t.split(/(?<=[.!?])\s+(?=[A-Z*`])/).filter((x) => /\b(?:any|every|all|each) icons?\b/i.test(x) && /\b(?:button|maybe_landed|landed|covered|click(?:s|ed|ing)?)\b/i.test(x));
  assert.deepEqual(ikonGeneraliseringer, [], 'CHANGELOG generaliserer til ethvert ikon');
  // R154 (Opus): feltreglen skal staa som koden har den (background.js maalFelt: input/select/textarea/button eller bindestreg).
  assert.match(t, /When the target itself is `input`, `select`, `textarea`, `button` or a custom element \(a tag name with a hyphen\), only a click that reaches that element counts as proof/);
});
