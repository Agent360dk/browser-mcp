/**
 * CDP-kald skal have en frist. Uden den er der ingen reserveløsning.
 *
 * MAALT 8/9-2026: `browser_scroll` med pixels ramte 30-sekunders-loftet HVER gang,
 * paa baade en kort og en lang side, 6 kald ud af 6. Det var hverken siden eller
 * den dobbelte udvidelse - `press_key` og `reattach_debugger` gik gennem SAMME
 * debugger paa SAMME fane paa 128 og 161 ms i samme session.
 *
 * Aarsagen: `cdpSend` afventede `chrome.debugger.sendCommand` uden frist.
 * `Input.dispatchMouseEvent` med mouseWheel indfrier aldrig sit loefte, og den
 * `window.scrollBy` der er skrevet til netop det tilfaelde ligger i et `catch` -
 * saa den kunne aldrig naas. En haenger er ikke en exception.
 *
 * Testen bruger et sendCommand der ALDRIG svarer. Det er praecis hvad Chrome gjorde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const aldrig = () => new Promise(() => {});

test('et CDP-kald der aldrig svarer, giver op i stedet for at haenge', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': aldrig,
  } });
  const t0 = Date.now();
  await assert.rejects(
    () => u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseWheel', deltaY: 300 }),
    /svarede ikke|timeout|frist/i,
    'kalderen skal faa en fejl, saa dens reserveloesning kan fyre',
  );
  const brugt = Date.now() - t0;
  assert.ok(brugt < 12000, `skal give op langt foer serverens 30 s-loft, brugte ${brugt} ms`);
});

test('et raskt CDP-kald venter ikke paa fristen', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': { ok: true },
  } });
  const t0 = Date.now();
  const r = await u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseWheel' });
  assert.deepEqual(r, { ok: true }, 'svaret skal komme uroert igennem');
  assert.ok(Date.now() - t0 < 500, 'et rask svar maa ikke koste ventetid');
});

// Det her er den vagt der faktisk daekker BRUGERENS oplevelse. De to ovenfor beviser at
// cdpSend afviser; kun den her beviser at scroll saa NAAR sin reserveloesning - og det var
// jo hele pointen. Maalt 9/9: 1.504 ms i stedet for 30.007, og window.scrollBy koert.
test('scroll ender med at rulle - reserveloesningen naas, og svaret siger hvorfor', async () => {
  const kald = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'debugger.sendCommand': (_m, metode, params) => {
      kald.push({ metode, expression: params?.expression });
      if (metode === 'Input.dispatchMouseEvent') return new Promise(() => {});   // hjulet tier
      // Siden skal svare som en RIGTIG side: hvor stod den foer, hvor staar den nu.
      // Foer 10/9 svarede selen `null`, og saa kunne testen ikke se forskel paa
      // "reserveloesningen rullede" og "reserveloesningen fejlede tavst".
      if (metode === 'Runtime.evaluate') {
        const udtryk = String(params?.expression || '');
        if (/scrollX/.test(udtryk) && !/scrollTo|scrollBy/.test(udtryk)) {
          return { result: { value: { x: 0, y: 0 } } };            // startpositionen
        }
        return { result: { value: { foer: { x: 0, y: 0 }, efter: { x: 0, y: 300 } } } };
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const t0 = Date.now();
  const svar = await u.hent('dispatch')(9876, 'scroll', { y: 300 });
  const brugt = Date.now() - t0;

  assert.equal(svar.ok, true, 'siden blev rullet - via reserveloesningen');
  assert.equal(svar.method, 'fallback', 'svaret skal sige AT det var reserveloesningen');
  assert.match(svar.fallback_reason || '', /svarede ikke/, 'og HVORFOR, saa fejlen kan foelges');
  assert.ok(brugt < 5000, `maa ikke koste 30 sekunder, brugte ${brugt} ms`);
  // 10/9: vagten kraevede scrollBy. Den blev udskiftet med scrollTo mod en beregnet
  // maal-position, fordi scrollBy lagde sig oveni det hjulet allerede havde naaet -
  // reproduceret: 900 px faktisk, 600 rapporteret. Vagten skal foelge mekanismen.
  assert.ok(kald.some((k) => /window\.scrollTo\(\d+ \+ 0, \d+ \+ 300\)/.test(k.expression || '')),
    'siden blev aldrig rullet - reserveloesningen skal ramme en beregnet maal-position');
});

test('cdpSend giver op naar hjulet tier, saa en reserveloesning KAN naas (selve scroll-reserveloesningen proeves i scroll-uvist)', async () => {
  // Det er HELE pointen: fristen findes for at reserveloesningen kan naas.
  const evalKald = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://example.com', windowId: 1 },
    'tabs.query': [{ id: 1, url: 'https://example.com', windowId: 1, active: true }],
    'debugger.sendCommand': (_maal, metode, params) => {
      if (metode === 'Input.dispatchMouseEvent') return new Promise(() => {});
      if (metode === 'Runtime.evaluate') {
        evalKald.push(params?.expression || '');
        return { result: { value: null } };
      }
      return {};
    },
  } });
  const svar = await u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseWheel', deltaY: 300 })
    .then(() => 'kom igennem', (e) => e.message);
  assert.match(String(svar), /svarede ikke|timeout|frist/i,
    'hjul-afsendelsen skal afvises, ikke haenge - ellers naar scroll aldrig sin reserveloesning');
});
