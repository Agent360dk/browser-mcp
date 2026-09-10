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
  const i = kilde.indexOf("case 'screenshot'");
  const blok = kilde.slice(i, kilde.indexOf("case 'execute_script'", i));
  assert.match(blok, /afvist\.laekageVagt = true/,
    'afvisningen skal kunne kendes fra en almindelig fejl');
  assert.match(blok, /if \(firstErr && firstErr\.laekageVagt\) throw firstErr;/,
    'den ydre catch skal kaste videre — ellers haever den vinduet for at omgaa vores egen vagt');
  const iHaev = blok.indexOf('chrome.windows.update(tab.windowId, { focused: true');
  const iVagt = blok.indexOf('firstErr.laekageVagt');
  assert.ok(iVagt > -1 && iVagt < iHaev, 'vagten skal komme FOER haevningen, ikke efter');
});

test('scroll-reserveloesningen ruller mod en maal-position, ikke en gang til', () => {
  const i = kilde.indexOf("case 'scroll'");
  const blok = kilde.slice(i, i + 4000);
  assert.doesNotMatch(blok, /window\.scrollBy\(\$\{dx\}, \$\{dy\}\)/,
    'scrollBy lægger sig oveni det hjulet allerede naaede — 900 px hvor der stod 600');
  assert.match(blok, /window\.scrollTo\(\$\{startX\} \+ \$\{dx\}, \$\{startY\} \+ \$\{dy\}\)/,
    'reserveloesningen skal vaere idempotent: samme maal uanset hvor meget hjulet naaede');
  assert.ok(blok.indexOf('const startX') < blok.indexOf('STEP_SIZE'),
    'startpositionen skal laeses FOER hjulet forsoeges');
});
