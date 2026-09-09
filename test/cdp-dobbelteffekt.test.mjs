/**
 * Et CDP-kald der KAN mutere, maa aldrig gentages automatisk.
 *
 * MAALT 9/9-2026 (fundet af Astra i review, reproduceret foer rettelsen):
 *   cdpSend(1, 'Runtime.evaluate', { expression: 'window.tael++' })
 * koerte udtrykket FIRE gange naar debuggeren faldt af, fordi Runtime.evaluate stod paa
 * listen over metoder der er sikre at gentage.
 *
 * Den antagelse holder ikke: vi kan ikke se paa metodenavnet om udtrykket muterer, og
 * flere af vores egne goer det — settle-udtrykket FYRER reserveloesnings-klikket, scroll'ens
 * reserveloesning kalder window.scrollBy, og fill skriver i feltet.
 *
 * Fire klik paa en knap der bestiller noget, er vaerre end ét klik der fejler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function seleDerFalderAf(taeller) {
  return indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_maal, metode) => {
      taeller[metode] = (taeller[metode] || 0) + 1;
      throw new Error('Debugger detached');
    },
  } });
}

test('Runtime.evaluate koeres ÉN gang naar debuggeren falder af', async () => {
  const t = {};
  const u = seleDerFalderAf(t);
  await assert.rejects(() => u.hent('cdpSend')(1, 'Runtime.evaluate', { expression: 'window.tael++' }));
  assert.equal(t['Runtime.evaluate'], 1,
    `udtrykket blev koert ${t['Runtime.evaluate']} gange — et muterende udtryk maa aldrig gentages`);
});

test('et ægte laesekald gentages stadig — resiliensen er ikke smidt vaek', async () => {
  const t = {};
  const u = seleDerFalderAf(t);
  await assert.rejects(() => u.hent('cdpSend')(1, 'DOM.getDocument', {}));
  assert.ok(t['DOM.getDocument'] > 1,
    'DOM.getDocument er uden bivirkning og skal stadig proeves igen paa sider der detacher aggressivt');
});

test('et museklik gentages fortsat ALDRIG', async () => {
  const t = {};
  const u = seleDerFalderAf(t);
  await assert.rejects(() => u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mousePressed' }));
  assert.equal(t['Input.dispatchMouseEvent'], 1, 'et klik maa aldrig fyre to gange');
});
