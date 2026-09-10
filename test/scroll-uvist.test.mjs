/**
 * scroll ruller ikke igen naar den ikke ved hvor siden stod.
 *
 * MAALT 10/9 af Astra (anden runde), reproduceret: startpositionen kunne ikke laeses, hjulet timede
 * ud efter at have flyttet siden, og reserveloesningen lagde en RELATIV rulning oveni. Stod siden paa
 * 500 og blev der bedt om 600, endte den paa 1400. Flaget start_ukendt dokumenterede risikoen uden at
 * forhindre den. Uden kendt start findes ingen rulning der kan gentages uden at rulle dobbelt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele({ startKendt }) {
  const rulninger = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'tabs.update': undefined,
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Input.dispatchMouseEvent') throw new Error('CDP svarede ikke inden 1500 ms: Input.dispatchMouseEvent');
      if (metode === 'Runtime.evaluate') {
        const ex = String(p?.expression || '');
        if (/scrollTo|scrollBy/.test(ex)) { rulninger.push(ex); return { result: { value: { foer: { x: 0, y: 800 }, efter: { x: 0, y: 1100 } } } }; }
        if (!startKendt) throw new Error('laesningen fejlede');
        return { result: { value: { x: 0, y: 500 } } };
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, rulninger };
}

test('ukendt start + hjul der timede ud: der rulles IKKE igen, og svaret siger det', async () => {
  const { u, rulninger } = sele({ startKendt: false });
  const svar = await u.hent('dispatch')(9876, 'scroll', { y: 600 });
  assert.equal(rulninger.length, 0, `der blev rullet relativt oveni hjulet: ${rulninger[0]}`);
  assert.equal(svar.ok, false);
  assert.equal(svar.error, 'scroll-uvist');
  assert.equal(svar.start_ukendt, true);
});

test('kendt start: reserveloesningen ruller mod MAAL-positionen', async () => {
  // Positiv kontrol: ellers ville en scroll der aldrig falder tilbage bestaa testen ovenfor.
  const { u, rulninger } = sele({ startKendt: true });
  const svar = await u.hent('dispatch')(9876, 'scroll', { y: 600 });
  assert.equal(rulninger.length, 1);
  assert.match(rulninger[0], /scrollTo\(0 \+ 0, 500 \+ 600\)/, 'maalet er start + delta, ikke "600 til"');
  assert.equal(svar.ok, true);
});
