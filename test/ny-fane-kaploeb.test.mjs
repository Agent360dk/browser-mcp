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

// MAALT 11/9 af Astra (R5 F9), reproduceret: sessionen har fanerne 1 og 3. Fane 1 aabner
// popup 2 og lukkes derefter (typisk "log ind i nyt vindue"). get_new_tab slog aabneren op i
// sessionens faner NU, hvor 1 er vaek, og svarede not-ours. 1.29.0 adopterede popuppen.
function seleMedToFaner() {
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => ({ id, url: `https://fane${id}.example`, windowId: 1, ...(id === 2 ? { openerTabId: 1 } : id === 5 ? { openerTabId: 7 } : {}) }),
    'tabs.query': [],
    'tabs.group': 1, 'tabGroups.update': {}, 'tabGroups.get': { id: 1 }, 'tabs.ungroup': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1, 3]), activeTabId: 3, groupId: 1, label: 'vores', color: 'blue', windowId: 1 });
  u.hent('sessions').set(9877, { tabIds: new Set([7]), activeTabId: 7, groupId: 2, label: 'anden', color: 'red', windowId: 1 });
  return u;
}

test('en popup fra vores egen fane er stadig vores, efter at aabneren er lukket', async () => {
  const u = seleMedToFaner();
  await u.fyr('tabs.onCreated', { id: 2, url: 'https://fane2.example', windowId: 1, openerTabId: 1 });
  u.hent('sessions').get(9876).tabIds.delete(1);   // aabneren lukkes, sessionen lever videre i fane 3
  const svar = await u.hent('dispatch')(9876, 'get_new_tab', {});
  assert.equal(svar.error, undefined, `vores egen popup blev afvist: ${JSON.stringify(svar)}`);
  assert.equal(svar.id, 2);
});

test('en popup fra en ANDEN sessions lukkede fane bliver ikke vores', async () => {
  // Positiv kontrol mod en vagt der bare adopterer alt med en lukket aabner.
  const u = seleMedToFaner();
  await u.fyr('tabs.onCreated', { id: 5, url: 'https://fane5.example', windowId: 1, openerTabId: 7 });
  u.hent('sessions').get(9877).tabIds.delete(7);
  const svar = await u.hent('dispatch')(9876, 'get_new_tab', {});
  assert.equal(svar.error, 'not-ours', `en anden sessions popup blev adopteret: ${JSON.stringify(svar)}`);
});

test('aabneren huskes fra onCreated, ogsaa naar tabs.get ikke oplyser den', async () => {
  // Positiv kontrol: ellers ville en vagt der afviser ALT bestaa testen ovenfor.
  const { u } = sele();
  await u.fyr('tabs.onCreated', { id: 100, url: 'https://vores.example', windowId: 1, openerTabId: 1 });
  const svar = await u.hent('dispatch')(9876, 'get_new_tab', {});
  assert.equal(svar.error, undefined, `agentens egen nye fane blev afvist: ${JSON.stringify(svar)}`);
  assert.equal(svar.id, 100);
});
