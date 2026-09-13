/**
 * `set_combobox` maa ikke bruge 8,5 sekunder paa at sige nej til en almindelig <select>.
 *
 * MAALT 9/9-2026: den klikkede feltet, forsoegte at tomme det med en input-vaerdisaetter,
 * skrev tekst ind, og pollede 30 gange efter en listbox der aldrig kan opstaa paa en
 * <select> - for saa at svare "no-options-rendered". Kapaciteten fandtes hele tiden i
 * browser_select_option, som klarer samme felt paa 9 ms.
 *
 * Det dyre er ikke sekunderne. Det er at svaret ikke fortalte agenten hvad den skulle
 * goere i stedet, saa den proever noget andet tilfaeldigt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

test('en almindelig <select> afvises straks, med navnet paa det rigtige vaerktoej', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    // Sidens svar paa "er det en SELECT?" er ja.
    'debugger.sendCommand': (_maal, metode) =>
      metode === 'Runtime.evaluate' ? { result: { value: true } } : {},
  } });
  const t0 = Date.now();
  const r = await u.hent('setCombobox')(1, '#s', ['Alfa']);
  const brugt = Date.now() - t0;
  assert.equal(r.ok, false, 'set_combobox kan ikke betjene en native select');
  assert.equal(r.error, 'native-select', 'fejlen skal kunne skelnes fra alle andre');
  assert.match(r.hint, /browser_select_option/, 'svaret skal navngive det vaerktoej der VIRKER');
  assert.ok(brugt < 1000, `maa ikke koste ventetid, brugte ${brugt} ms`);
});

test('et rigtigt div-dropdown gaar stadig den lange vej', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_maal, metode) =>
      metode === 'Runtime.evaluate' ? { result: { value: false } } : {},
    'scripting.executeScript': [{ result: null }],
  } });
  const r = await u.hent('setCombobox')(1, '#custom', ['Alfa'], { wait_ms: 100 });
  assert.notEqual(r.error, 'native-select', 'en div-dropdown maa ikke afvises som select');
});
