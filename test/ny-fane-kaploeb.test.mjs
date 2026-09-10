/**
 * get_new_tab maa ikke tage brugerens fane, heller ikke naar to faner aabnes naesten samtidig.
 *
 * MAALT 10/9 af Astra (anden runde), reproduceret: aabneren blev gemt i EN global variabel for
 * "den seneste nye fane". Aabnede brugeren fane 99 (ingen aabner), og agenten fik fane 100 fra sin
 * egen fane mens get_new_tab ventede paa tabs.get(99), blev 100's aabner brugt som 99's - og
 * brugerens fane kom ind i sessionen. Nu huskes aabneren pr. fane.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele() {
  const styr = { armeret: false, ventende: [] };
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => {
      const fane = id === 99 ? { id: 99, url: 'https://private.example', windowId: 1 }
                             : { id, url: 'https://vores.example', windowId: 1 };   // bevidst uden openerTabId
      if (styr.armeret && id === 99) { styr.armeret = false; return new Promise((r) => styr.ventende.push(() => r(fane))); }
      return fane;
    },
    'tabs.group': 1, 'tabGroups.update': {}, 'tabGroups.get': { id: 1 }, 'tabs.ungroup': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue', windowId: 1 });
  return { u, styr };
}

test('en agent-fane der aabnes MENS get_new_tab venter, giver ikke brugerens fane dens aabner', async () => {
  const { u, styr } = sele();
  await u.fyr('tabs.onCreated', { id: 99, url: 'https://private.example', windowId: 1 });
  styr.armeret = true;
  const p = u.hent('dispatch')(9876, 'get_new_tab', {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(styr.ventende.length, 1, 'testen naaede ikke ind i kaploebet - den tester ikke det den paastaar');
  await u.fyr('tabs.onCreated', { id: 100, url: 'https://vores.example', windowId: 1, openerTabId: 1 });
  styr.ventende.forEach((f) => f());
  const svar = await p;
  assert.equal(svar.error, 'not-ours', `brugerens fane blev adopteret: ${JSON.stringify(svar)}`);
  assert.ok(!u.hent('sessions').get(9876).tabIds.has(99));
});

test('aabneren huskes fra onCreated, ogsaa naar tabs.get ikke oplyser den', async () => {
  // Positiv kontrol: ellers ville en vagt der afviser ALT bestaa testen ovenfor.
  const { u } = sele();
  await u.fyr('tabs.onCreated', { id: 100, url: 'https://vores.example', windowId: 1, openerTabId: 1 });
  const svar = await u.hent('dispatch')(9876, 'get_new_tab', {});
  assert.equal(svar.error, undefined, `agentens egen nye fane blev afvist: ${JSON.stringify(svar)}`);
  assert.equal(svar.id, 100);
});
