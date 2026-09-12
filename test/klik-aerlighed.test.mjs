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

// MAALT 12/9 af Astra (efterproevning af 9598b9b): det tredje udfald (uvist) blev beregnet inde i settle-udtrykket og
// spredt ud i svaret - men INTET sted oversatte det til maaske_landet, og serverens instruks naevner ikke `uvist`.
// Agenten fik altsaa et bart ok:false, hvor 1.29.0 gav ok:true. Et bart ok:false er praecis dét der faar en agent til at
// klikke igen - og klik nummer to lukker menuen. Altsaa den dobbelte effekt, rettelsen skulle forhindre.
// Mine egne proever maalte kun settle-udtrykkets returvaerdi, aldrig dispatch-svaret. Derfor slap det igennem.
for (const vaerktoej of ['click', 'click_xy']) {
  test(`${vaerktoej}: et uvist klik siger at det KAN vaere landet - ikke bare nej`, async () => {
    const u = medSession(selePaaKlik({ landed: null, uvist: true, fallbackFired: true }));
    const p = vaerktoej === 'click' ? { selector: '#noget' } : { x: 10, y: 10 };
    const svar = await u.hent('dispatch')(9876, vaerktoej, p);
    assert.equal(svar.maaske_landet, true, `agenten faar et bart nej og klikker igen: ${JSON.stringify(svar)}`);
    assert.ok(svar.note, 'der er ingen note der forklarer hvorfor svaret er uvist');
  });
}

// Samme runde: select_option havde lige regnet ud at den IKKE ved det - og skrev saa en skarp benaegtelse.
test('select_option paastaar ikke at klikket blev afvist, naar den ikke ved det', async () => {
  // Den brugerdefinerede dropdown-sti: elementet er ikke et <select>, saa koden klikker paa udloeseren og derefter
  // paa muligheden. Det andet klik er det uvisse.
  const u = medSession(indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://example.com', windowId: 1 },
    'tabs.query': [{ id: 1, url: 'https://example.com', windowId: 1, active: true }],
    'debugger.sendCommand': (_maal, metode, p) => {
      if (metode !== 'Runtime.evaluate') return {};
      const udtryk = String(p?.expression || '');
      if (udtryk.includes("tagName === 'SELECT'")) return { result: { value: false } };   // ikke en native select
      return { result: { value: { landed: null, uvist: true, fallbackFired: true } } };
    },
    'scripting.executeScript': [{ result: { found: true, x: 10, y: 10, tag: 'DIV', text: 'Roed', method: 'debugger' } }],
  } }));
  const svar = await u.hent('dispatch')(9876, 'select_option', { selector: '#drop', value: 'Roed' });
  assert.equal(svar.type, 'custom_dropdown', `proeven naaede ikke dropdown-stien: ${JSON.stringify(svar)}`);
  assert.doesNotMatch(String(svar.error || ''), /ikke taget imod/,
    `koden ved ikke om klikket landede, men skriver en benaegtelse: ${JSON.stringify(svar)}`);
  assert.equal(svar.maaske_landet, true, JSON.stringify(svar));
});

// Serverens instruks forklarer maaske_landet, landed, afviger og uaendret. Naevner den ikke uvist, staar agenten med et
// felt den ikke kan tolke - og saa er aerligheden kun en tekst i koden.
test('serverens instruks forklarer ogsaa uvist', async () => {
  const { readFileSync } = await import('node:fs');
  const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');
  assert.match(srv, /uvist/, 'INSTRUCTIONS naevner ikke uvist, saa agenten kan ikke tolke feltet');
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
