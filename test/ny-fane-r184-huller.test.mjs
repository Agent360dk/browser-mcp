// R184 (Opus, 29/10): to huller i prøverne til #89 - intet loft paa wait_ms og «den aeldste i stedet for den nyeste» overlevede
// som mutanter. Disse to dræber dem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele(ur = null) {
  const u = indlaesUdvidelse({ ur, svar: {
    'tabs.get': (id) => ({ id, url: `https://fane${id}.example`, title: `fane ${id}`, windowId: 1 }),
    'tabs.query': [], 'tabs.group': 1, 'tabGroups.update': {}, 'tabGroups.get': { id: 1 }, 'tabs.ungroup': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 'vores', color: 'blue', windowId: 1 });
  return u;
}

test('wait_ms er loftet til 10 s', async () => {
  let t = 1_000_000;
  const u = sele(() => (t += 500));   // virtuelt ur: hvert opslag er 0,5 s senere
  const r = await u.hent('dispatch')(9876, 'get_new_tab', { wait_ms: 60000 });
  assert.equal(r.error, 'no-new-tab-yet');
  assert.equal(r.waited_ms, 10000, `loftet holdt ikke: ${JSON.stringify(r.waited_ms)}`);
});

test('to faner efter samme input: den nyeste foerst, saa den anden', async () => {
  const u = sele();
  u.hent('noterInput')(9876);
  await u.fyr('tabs.onCreated', { id: 11, url: 'https://fane11.example', windowId: 1, openerTabId: 1 });
  await u.fyr('tabs.onCreated', { id: 12, url: 'https://fane12.example', windowId: 1, openerTabId: 1 });
  const a = await u.hent('dispatch')(9876, 'get_new_tab', { wait_ms: 0 });
  const b = await u.hent('dispatch')(9876, 'get_new_tab', { wait_ms: 0 });
  assert.deepEqual([a.id, b.id], [12, 11]);
});

test('tab_id paa en fane der er lukket, siger tab-closed - ikke «no tab has opened»', async () => {
  // fanen er lukket mellem onCreated og afhentningen: tabs.get kaster, som Chrome goer for et forsvundet id
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => { if (id === 20) throw new Error('No tab with id: 20'); return { id, url: `https://fane${id}.example`, windowId: 1 }; },
    'tabs.query': [], 'tabs.group': 1, 'tabGroups.update': {}, 'tabGroups.get': { id: 1 }, 'tabs.ungroup': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 'vores', color: 'blue', windowId: 1 });
  u.hent('noterInput')(9876);
  await u.fyr('tabs.onCreated', { id: 20, url: 'https://fane20.example', windowId: 1, openerTabId: 1 });
  const r = await u.hent('dispatch')(9876, 'get_new_tab', { tab_id: 20 });
  assert.equal(r.error, 'tab-closed', `svar: ${JSON.stringify(r)}`);
  assert.equal(r.tab_id, 20);
  assert.ok(!u.hent('sessions').get(9876).tabIds.has(20), 'en lukket fane blev lagt i sessionen');
});
