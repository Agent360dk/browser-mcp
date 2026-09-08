/**
 * CDP-kald skal have en frist. Uden den er der ingen reserveløsning.
 *
 * MAALT 8/9-2026: `browser_scroll` med pixels ramte 30-sekunders-loftet HVER gang,
 * paa baade en kort og en lang side, 6 kald ud af 6. Det var hverken siden eller
 * den dobbelte udvidelse — `press_key` og `reattach_debugger` gik gennem SAMME
 * debugger paa SAMME fane paa 128 og 161 ms i samme session.
 *
 * Aarsagen: `cdpSend` afventede `chrome.debugger.sendCommand` uden frist.
 * `Input.dispatchMouseEvent` med mouseWheel indfrier aldrig sit loefte, og den
 * `window.scrollBy` der er skrevet til netop det tilfaelde ligger i et `catch` —
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

test('scroll med pixels falder tilbage til window.scrollBy naar hjulet tier', async () => {
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
    'hjul-afsendelsen skal afvises, ikke haenge — ellers naar scroll aldrig sin reserveloesning');
});
