/**
 * `press_key` maa ikke svare ja paa en tast der aldrig blev leveret.
 *
 * MAALT 13/9, live i Gustavs Chrome og kalibreret mod et kendt-sandt tilfaelde. Samme fane,
 * samme side med en keydown-lytter, to tilstande:
 *
 *   forgrund (visible):  ok:true  ->  Enter landede
 *   baggrund (hidden):   ok:true  ->  NUL taster landede
 *
 * Forskellen paa mus og tast er hele forklaringen: i en baggrundsfane HAENGER musen, saa
 * 1500 ms-fristen goer svaret aerligt af sig selv. Tasten KVITTERER - Chrome siger ok til
 * `Input.dispatchKeyEvent` og leverer den bare ikke. Intet fangede det, fordi press_key
 * doemte paa kvitteringen i stedet for paa leveringen.
 *
 * Den fejlklasse er praecis den 1.29.1 blev udgivet for at fjerne, og den sad i vaerktoejet
 * selv. Sessionens faner foedes i baggrunden (`active:false`), saa det var standardtilstanden.
 *
 * ⛔ Den gamle daekning var blind. `test/baggrundsdrift.test.mjs` laeser `background.js` som
 * TEKST og tjekker at blokken indeholder `getSessionTab(port, false)`. Astra muterede cdpSend
 * til aldrig at levere: 7/7 groenne, foer som efter. En proeve der ikke kan gaa roed er
 * dokumentation, ikke en vagt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/** Rejser udvidelsen med en side der enten modtager tasten eller ikke goer. */
function sele({ leverer, injektionFejler = false, laesningFejler = false }) {
  let armeret = null;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: false },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: false }],
    'debugger.sendCommand': () => ({}),
    'tabs.update': undefined,
    'windows.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async ({ func, args }) => {
    const kilde = String(func);
    if (kilde.includes('addEventListener')) {                 // armering
      if (injektionFejler) throw new Error('kunne ikke injicere');
      armeret = args[0];
      return [{ result: undefined }];
    }
    if (kilde.includes('removeEventListener')) {              // laesning
      if (laesningFejler) throw new Error('kunne ikke laese');
      const [minId, vent] = args;
      if (armeret !== minId) return [{ result: { udskiftet: true } }];
      return [{ result: leverer ? { antal: 1, traf: true } : { antal: 0, traf: false } }];
    }
    return [{ result: null }];
  };
  return u;
}

test('en tast der IKKE blev leveret meldes ikke som succes', async () => {
  const u = sele({ leverer: false });
  const svar = await u.hent('dispatch')(9876, 'press_key', { key: 'Enter' });
  assert.equal(svar.ok, false,
    'press_key svarede ja paa en tast ingen lytter modtog. Det er den loegn 1.29.1 blev udgivet for at fjerne');
  assert.equal(svar.landed, false, 'svaret siger ikke at tasten ikke landede');
  assert.match(String(svar.note), /baggrunden|switch_tab/i, 'svaret giver ikke brugeren remedien');
});

test('en tast der BLEV leveret meldes som succes', async () => {
  const u = sele({ leverer: true });
  const svar = await u.hent('dispatch')(9876, 'press_key', { key: 'Enter' });
  assert.equal(svar.ok, true, 'en tast der landede blev meldt som fejl');
  assert.equal(svar.landed, true, 'svaret oplyser ikke at tasten landede');
});

test('kan leveringen ikke laeses, er svaret UVIST - aldrig et falskt ja eller nej', async () => {
  for (const [navn, opsaetning] of [
    ['injektionen fejlede', { leverer: false, injektionFejler: true }],
    ['laesningen fejlede', { leverer: false, laesningFejler: true }],
  ]) {
    const u = sele(opsaetning);
    const svar = await u.hent('dispatch')(9876, 'press_key', { key: 'Tab' });
    assert.equal(svar.landed, null, `${navn}: svaret paastaar at vide noget det ikke ved`);
    assert.equal(svar.maaske_landet, true, `${navn}: svaret advarer ikke om at det er uvist`);
    assert.equal(svar.ok, true, `${navn}: uvist er ikke det samme som mislykket - en tast kan sagtens vaere landet`);
  }
});

test('beviset armeres FOER trykket - ellers maaler det sin egen fortid', async () => {
  const raekke = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: false },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: false }],
    // MAALT 13/9: foerste udgave af denne proeve optog kun de to injektioner, ikke selve
    // trykket. En mutation der armerede EFTER trykket gik derfor groen - proeven kunne se
    // raekkefoelgen mellem armering og laesning, men ikke om tasten laa imellem dem.
    'debugger.sendCommand': (_m, metode) => { if (metode === 'Input.dispatchKeyEvent') raekke.push('tast'); return {}; },
    'tabs.update': undefined,
    'windows.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => {
    const kilde = String(func);
    if (kilde.includes('addEventListener')) { raekke.push('armer'); return [{ result: undefined }]; }
    if (kilde.includes('removeEventListener')) { raekke.push('laes'); return [{ result: { antal: 1, traf: true } }]; }
    return [{ result: null }];
  };
  await u.hent('dispatch')(9876, 'press_key', { key: 'Enter' }).catch(() => {});
  assert.equal(raekke[0], 'armer',
    `beviset blev ikke armeret FOER trykket - saa maaler det sin egen fortid: ${raekke.join(' -> ')}`);
  assert.equal(raekke[raekke.length - 1], 'laes',
    `beviset blev ikke laest EFTER trykket: ${raekke.join(' -> ')}`);
  assert.ok(raekke.includes('tast'), `tasten blev aldrig sendt: ${raekke.join(' -> ')}`);
});
