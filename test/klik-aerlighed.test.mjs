/**
 * `ok` maa ikke sige ja naar `landed` siger nej. (issue #19)
 *
 * MAALT 9/9-2026 paa en div-baseret dropdown — den slags naesten alle rigtige sider bruger:
 *   browser_click -> { ok: true, fallbackFired: true, landed: false }   og menuen aabnede ikke.
 * En agent laeser `ok` og gaar videre. Kun én der laeser `landed` ved besked.
 *
 * Det er tredje gang samme fejlklasse: select_option havde den (rettet 22/8, se linje ~3279),
 * fill havde den. Derfor tester den her KONTRAKTEN, ikke bare det ene tilfaelde.
 *
 * Skellet der skal holdes:
 *   landed:false + detached:true  -> elementet forsvandt, altsaa skete der noget. ok = true.
 *   landed:false + fallbackFired  -> vi fyrede et syntetisk klik og saa ingen virkning. ok = FALSK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function selePaaKlik(settleVaerdi) {
  return indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://example.com', windowId: 1 },
    'tabs.query': [{ id: 1, url: 'https://example.com', windowId: 1, active: true }],
    'debugger.sendCommand': (_maal, metode) => {
      if (metode === 'Runtime.evaluate') return { result: { value: settleVaerdi } };
      return {};
    },
    // resolveElement gaar gennem chrome.scripting foerst; uden et svar her naar vi
    // aldrig frem til klikket, og testen maaler noget helt andet end den paastaar.
    'scripting.executeScript': [{ result: { found: true, x: 10, y: 10, tag: 'DIV', text: 'Vaelg', method: 'debugger' } }],
  } });
}

/** Giver selen en session paa porten, saa `dispatch` kan finde en fane at klikke i. */
function medSession(u, port = 9876) {
  const s = u.hent('sessions');
  s.set(port, { label: 'Claude 1', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1, pid: 'p1' });
  return u;
}

// Foerste udgave af de to her regnede `ok` ud INDE i testen og sammenlignede med sig selv.
// Mutationsbevist 9/9: da jeg satte `ok: true` haardkodet tilbage i koden, blev de ved med at
// vaere groenne. En test der ikke kan fange sin egen fejl er ikke et instrument.
// Nu kaldes den rigtige kommando-vej, `dispatch(port, 'click', ...)`, saa det er VAERKTOEJETS
// svar der proeves — ikke min egen aritmetik.

test('klik der hverken landede eller flyttede elementet svarer ok:false', async () => {
  const u = medSession(selePaaKlik({ landed: false, fallbackFired: true }));
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#noget' });
  assert.equal(svar.landed, false, 'selen skal levere landed:false igennem');
  assert.equal(svar.ok, false, 'ok skal vaere falsk naar intet blev observeret');
});

test('klik der fik elementet til at forsvinde tæller som landet', async () => {
  const u = medSession(selePaaKlik({ landed: false, fallbackFired: false, detached: true }));
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#noget' });
  assert.equal(svar.ok, true, 'et element der navigerede vaek ER en virkning');
});

test('reserveløsningen maaler om den selv virkede — den gaetter ikke', async () => {
  // Efter det syntetiske klik skal koden laese lytteren IGEN. Goer den ikke det,
  // er `landed:false` en antagelse, ikke en maaling — og saa er `ok` uden vaerdi.
  const kilde = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8'));
  const blok = kilde.slice(kilde.indexOf('const landed = window.__bmcpClicked === true;'));
  const efterFallback = blok.slice(blok.indexOf('fiberKey'));
  // 10/9: at laese lytteren igen VAR rettelsen om morgenen — og den var forkert. Lytteren
  // udloeses af vores egen dispatch. Nu skal der maales et aftryk af siden i stedet.
  // 12/9 (Fable): aftrykket blev maalt fra FOER mousedown, saa en ripple talte som klikkets virkning.
  // Nu maales der fra foerKlik - taget lige foer el.click() - og aendrede kun mousedown noget, siges der uvist.
  assert.match(efterFallback.slice(0, 2400), /efterAftryk !== foerKlik/,
    'efter reserveloesningen skal SIDENS reaktion paa KLIKKET maales, ikke vores egen dispatch');
});
