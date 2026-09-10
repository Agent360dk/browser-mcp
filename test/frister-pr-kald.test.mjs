/**
 * Fristen skal kende KALDET, ikke kun metoden — og reserveløsninger maa ikke lægge sig
 * oveni noget der allerede virkede.
 *
 * MAALT 9/9 af reviewet, efter at jeg havde sat ét loft paa alle CDP-kald:
 *   · et skaermbillede paa en tung side: to kald à 8 s, saa kastede laekage-vagten, saa
 *     haevede den ydre catch vinduet — 32.413 ms i alt, over serverens 30 s-loft. Og den
 *     haevning er praecis den fane-aktivering EKSPERIMENT 21/8 bevidst fjernede.
 *   · `execute_script` med awaitPromise venter paa BRUGERENS kode. Serveren giver 30 s;
 *     min frist skar den til 8, og fejlteksten matchede ikke retry-regexet, saa den endte
 *     som "failed on all paths" i stedet for "det tog for lang tid".
 *   · scroll: Promise.race afbryder ikke. Foerste hjultrin flyttede 300 px uden at kvittere,
 *     og fallbacken lagde 600 oveni. Faktisk 900, rapporteret 600.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const sele = () => indlaesUdvidelse({ svar: {
  'debugger.attach': undefined,
  'debugger.getTargets': [{ tabId: 1, attached: true }],
} });

test('brugerens egen kode maa vente — awaitPromise faar den lange frist', () => {
  const f = sele().hent('cdpFrist');
  assert.ok(f('Runtime.evaluate', { awaitPromise: true }) >= 15000,
    'execute_script venter paa brugerens loefte; 8 s draeber ethvert fetch eller poll');
  assert.equal(f('Runtime.evaluate', { returnByValue: true }), 8000,
    'en almindelig laesning skal stadig have den korte frist');
});

test('et skaermbillede paa en tung side maa tage tid', () => {
  const f = sele().hent('cdpFrist');
  assert.ok(f('Page.captureScreenshot', { format: 'png' }) >= 15000,
    'to kald à 8 s plus en haevning overskred serverens 30 s-loft');
  assert.ok(f('Network.getResponseBody', {}) >= 15000, 'en stor body kan lovligt tage tid');
});

test('input-kald beholder den korte frist — det var dem der haengte', () => {
  const f = sele().hent('cdpFrist');
  assert.equal(f('Input.dispatchMouseEvent', { type: 'mouseWheel' }), 1500);
  assert.equal(f('Input.dispatchKeyEvent', { type: 'keyDown' }), 1500);
});

test('laekage-vagten starter ikke en ny runde med haevet vindue', () => {
  // 10/9, anden runde: reserveloesningen og dens laekage-vagt er fjernet helt, fordi A->B->A ikke
  // kunne udelukkes. Der er derfor intet at afvise - og ingen vej hvor en afvisning kan ende i et
  // haevet vindue. Adfaerden (intet billede, ingen captureVisibleTab, ET forsoeg ved frist)
  // proeves i skaermbillede-laek.test.mjs og sikkerhed-graenser.test.mjs.
  const i = kilde.indexOf("case 'screenshot'");
  const blok = kilde.slice(i, kilde.indexOf("case 'execute_script'", i));
  assert.doesNotMatch(blok, /laekageVagt/, 'den gamle vagt maa ikke komme tilbage uden reserveloesningen');
  assert.doesNotMatch(blok, /chrome\.tabs\.captureVisibleTab\(/, 'og reserveloesningen heller ikke');
});

test('scroll-reserveloesningen ruller mod en maal-position, ikke en gang til', () => {
  const i = kilde.indexOf("case 'scroll'");
  const blok = kilde.slice(i, i + 4000);
  // scrollBy er ikke forbudt — den er den RIGTIGE gren naar startpositionen ikke kunne
  // laeses. Det forbudte er en UBETINGET scrollBy, som lagde sig oveni hjulets arbejde.
  assert.doesNotMatch(blok, /\n\s*window\.scrollBy\(\$\{dx\}, \$\{dy\}\);\n/,
    'en ubetinget scrollBy lægger sig oveni det hjulet naaede — 900 px hvor der stod 600');
  // 10/9: rulningen er nu betinget — er startpositionen kendt, rammer vi et absolut maal
  // (idempotent). Kunne den ikke laeses, ruller vi relativt og MARKERER det, i stedet for
  // at opdigte et nulpunkt der kunne sende siden opad.
  assert.match(blok, /window\.scrollTo\(\$\{startX\} \+ \$\{dx\}, \$\{startY\} \+ \$\{dy\}\)/,
    'med kendt start skal reserveloesningen ramme et absolut maal — idempotent');
  assert.match(blok, /startKendt \?/, 'og vaelge relativ rulning kun naar starten er ukendt');
  assert.ok(blok.indexOf('const startX') < blok.indexOf('STEP_SIZE'),
    'startpositionen skal laeses FOER hjulet forsoeges');
});

// MAALT 10/9 af Astra, i MIN egen rettelse fra samme dag: scroll-reserveloesningen havde
// `.catch(() => null)` og returnerede derefter `ok: true` ubetinget. Fejlede ogsaa
// reserveloesningen, svarede vaerktoejet succes med NUL rullede pixels — reproduceret som
// "0 pixels faktisk, 600 rapporteret". Femte gang samme fejlklasse paa én dag.
test('scroll lyver ikke naar ogsaa reserveloesningen fejler', () => {
  const i = kilde.indexOf("case 'scroll'");
  const blok = kilde.slice(i, i + 5000);
  assert.doesNotMatch(blok, /\.catch\(\(\) => null\);\s*\n\s*return \{\s*\n?\s*ok: true/,
    'en slugt fejl efterfulgt af ok:true er praecis den loegn resten af dagen gik med at fjerne');
  assert.match(blok, /if \(!landede \|\| landede\.fejl\)/, 'fallbackens fejl skal laeses');
  assert.match(blok, /ok: false, method: 'fallback', error: 'scroll-mislykkedes'/,
    'fejler begge veje, skal svaret sige det');
  assert.match(blok, /ok: flyttede \|\| alleredeFremme/,
    'ok skal komme af om siden FLYTTEDE sig, ikke af at vi kaldte noget');
});

test('scroll opdigter ikke et nulpunkt naar startpositionen ikke kan laeses', () => {
  const i = kilde.indexOf("case 'scroll'");
  const blok = kilde.slice(i, i + 5000);
  assert.doesNotMatch(blok, /\.catch\(\(\) => \(\{ x: 0, y: 0 \}\)\)/,
    'stod siden paa 500 og laesningen fejlede, ville et opdigtet nulpunkt rulle OP');
  assert.match(blok, /const startKendt = !!start/, 'det skal kunne skelnes om starten er kendt');
  assert.match(blok, /start_ukendt: true/,
    'er starten ukendt, er rulningen relativ — kalderen skal kunne se det, ikke gaette');
});

// MAALT 10/9 af Astra: to captureScreenshot à 20 s koeres SEKVENTIELT = 40.040 ms, mens
// serverens loft er 30 s pr. vaerktoej. "20 er under 30" var regnet pr. kald, ikke pr. kald-kaede.
test('skaermbilledet proever ikke to gange paa en frist der allerede loeb ud', () => {
  // Adfaerden proeves i skaermbillede-laek.test.mjs (ET forsoeg, intet vindue haevet). Her holdes
  // markeringen fast, saa ingen fjerner den uden at se hvorfor den er der.
  const i = kilde.indexOf("case 'screenshot'");
  const blok = kilde.slice(i, kilde.indexOf("case 'execute_script'", i));
  assert.match(blok, /e\.ingenNyRunde = true/, 'en frist skal markeres');
  assert.match(blok, /if \(firstErr\?\.ingenNyRunde\) throw firstErr;/, 'og den ydre runde skal respektere markeringen');
  assert.doesNotMatch(blok, /chrome\.tabs\.captureVisibleTab\(/, 'reserveloesningen fotograferer den synlige fane, ikke agentens');
});
