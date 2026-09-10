/**
 * upload_file med en helt almindelig selector maa ikke oedelaegge sit eget script.
 *
 * MAALT 10/9 af Astra (anden runde), reproduceret: selectoren blev sat raat ind i en JavaScript-
 * streng i enkelte anfoerselstegn. input[type='file'] - den mest almindelige selector til et filfelt
 * - lukkede strengen, og hele udtrykket var ugyldig JavaScript. Upload fejlede med en syntaksfejl.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

test("selectoren input[type='file'] giver gyldig JavaScript", async () => {
  const udtryk = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Runtime.evaluate') { udtryk.push(String(p?.expression || '')); return { result: { value: JSON.stringify({ found: false, error: 'x' }) } }; }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  await u.hent('dispatch')(9876, 'upload_file', { selector: "input[type='file']", files: ['a.txt'] }).catch(() => {});
  const filfelt = udtryk.find((x) => x.includes('File input not found'));
  assert.ok(filfelt, 'udtrykket der leder efter filfeltet blev aldrig sendt');
  assert.doesNotThrow(() => new Function(filfelt), 'udtrykket er ikke gyldig JavaScript');
});
