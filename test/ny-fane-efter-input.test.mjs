/**
 * #89 (1.34): browser_get_new_tab svarer med den fane, et klik eller tastetryk faktisk aabnede - eller siger aerligt, at den
 * ikke er kommet endnu.
 *
 * Foer 1.34 slog get_new_tab den SENESTE fane i hele Chrome op (`lastCreatedTabId`), uden forbindelse til agentens input:
 *   1. aabnede siden sin fane et oejeblik efter klikket, og var den forrige nye fane lukket, blev svaret «Tab no longer exists»;
 *   2. stod den forrige nye fane stadig, blev svaret DEN - med felter der ligner et ok - og agenten arbejdede i den forkerte fane;
 *   3. var den seneste fane brugerens, blev svaret not-ours med brugerens fane-id, selv om sessionen aldrig fik en ny fane.
 * Nu: kun faner aabnet fra sessionens egne faner SIDEN dens sidste input taeller. Er der ingen, venter kaldet op til wait_ms og
 * svarer no-new-tab-yet - med de tidligere nye faner fra sessionen, som agenten kan vaelge med tab_id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele() {
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => ({ id, url: `https://fane${id}.example`, title: `fane ${id}`, windowId: 1 }),
    'tabs.query': [],
    'tabs.group': 1, 'tabGroups.update': {}, 'tabGroups.get': { id: 1 }, 'tabs.ungroup': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 'vores', color: 'blue', windowId: 1 });
  u.hent('sessions').set(9877, { tabIds: new Set([7]), activeTabId: 7, groupId: 2, label: 'anden', color: 'red', windowId: 1 });
  return u;
}
const nyFane = (u, id, aabner) => u.fyr('tabs.onCreated', { id, url: `https://fane${id}.example`, windowId: 1, ...(aabner != null ? { openerTabId: aabner } : {}) });
const hent = (u, params = {}) => u.hent('dispatch')(9876, 'get_new_tab', { wait_ms: 0, ...params });

test('#89.2 en fane fra FOER det seneste input er ikke svaret - heller ikke naar den stadig staar', async () => {
  const u = sele();
  await nyFane(u, 10, 1);
  u.hent('noterInput')(9876);   // agenten klikker igen; den nye fane er ikke kommet endnu
  const r = await hent(u);
  assert.equal(r.error, 'no-new-tab-yet', `den gamle fane blev svaret som ny: ${JSON.stringify(r)}`);
  assert.ok(!u.hent('sessions').get(9876).tabIds.has(10), 'den gamle fane blev lagt i sessionen');
  assert.deepEqual(Array.from(r.earlier_new_tabs, (t) => t.id), [10], 'svaret naevner ikke den tidligere nye fane, agenten kan vaelge');
  await nyFane(u, 11, 1);
  const r2 = await hent(u);
  assert.equal(r2.id, 11, `fanen efter klikket blev ikke svaret: ${JSON.stringify(r2)}`);
});

test('#89.1 en fane der aabnes lidt EFTER kaldet, ventes der paa', async () => {
  const u = sele();
  u.hent('noterInput')(9876);
  const p = hent(u, { wait_ms: 2000 });
  await new Promise((r) => setTimeout(r, 250));
  await nyFane(u, 12, 1);
  const r = await p;
  assert.equal(r.id, 12, `kaldet ventede ikke paa fanen: ${JSON.stringify(r)}`);
  assert.ok(u.hent('sessions').get(9876).tabIds.has(12));
});

test('#89.1 en ny fane der er lukket igen, giver ikke «Tab no longer exists»', async () => {
  const u = sele();
  u.hent('noterInput')(9876);
  await nyFane(u, 13, 1);
  await u.fyr('tabs.onRemoved', 13, {});
  const r = await hent(u);
  assert.equal(r.error, 'no-new-tab-yet', `svar: ${JSON.stringify(r)}`);
  assert.equal(r.earlier_new_tabs.length, 0, 'en lukket fane er naevnt som en, agenten kan vaelge');
});

test('#89.3 uden en ny fane svares der aldrig not-ours, og intet fane-id peger paa en fremmed fane', async () => {
  const u = sele();
  await nyFane(u, 99);   // brugerens egen fane (ingen aabner)
  const r = await hent(u);
  assert.equal(r.error, 'no-new-tab-yet', `svar: ${JSON.stringify(r)}`);
  assert.equal(r.tab_id, undefined, 'svaret baerer et fane-id, som agenten kan tro er dens nye fane');
  assert.ok(!u.hent('sessions').get(9876).tabIds.has(99), 'brugerens fane blev lagt i sessionen');
});

test('en anden sessions nye fane er aldrig vores', async () => {
  const u = sele();
  await nyFane(u, 70, 7);
  const r = await hent(u);
  assert.equal(r.error, 'no-new-tab-yet', `svar: ${JSON.stringify(r)}`);
  assert.equal(r.earlier_new_tabs.length, 0);
});

test('tab_id vaelger en tidligere ny fane fra sessionen - men aldrig brugerens eller en anden sessions', async () => {
  const u = sele();
  await nyFane(u, 10, 1);
  await nyFane(u, 99);
  await nyFane(u, 70, 7);
  u.hent('noterInput')(9876);
  const fremmed = await hent(u, { tab_id: 99 });
  assert.equal(fremmed.error, 'not-a-new-tab-of-yours', `brugerens fane kunne vaelges: ${JSON.stringify(fremmed)}`);
  const anden = await hent(u, { tab_id: 70 });
  assert.equal(anden.error, 'not-a-new-tab-of-yours', `en anden sessions fane kunne vaelges: ${JSON.stringify(anden)}`);
  assert.ok(!u.hent('sessions').get(9876).tabIds.has(99) && !u.hent('sessions').get(9876).tabIds.has(70));
  const vores = await hent(u, { tab_id: 10 });
  assert.equal(vores.id, 10, `sessionens egen tidligere nye fane kunne ikke vaelges: ${JSON.stringify(vores)}`);
  assert.ok(u.hent('sessions').get(9876).tabIds.has(10));
  const igen = await hent(u);
  assert.equal(igen.earlier_new_tabs.length, 0, 'en fane der er givet til agenten, staar stadig som ny');
});

test('kun klik, taster, script og valg i en liste taeller som input - ikke at laese siden', async () => {
  const u = sele();
  await nyFane(u, 10, 1);
  for (const m of ['get_page_content', 'screenshot', 'list_tabs', 'hover', 'fill', 'get_new_tab']) assert.equal(u.hent('erInput')(m), false, m);
  for (const m of ['click', 'click_xy', 'double_click', 'press_key', 'execute_script', 'select_option']) assert.equal(u.hent('erInput')(m), true, m);
  const r = await hent(u);
  assert.equal(r.id, 10, 'en fane aabnet uden input siden (fx af siden selv efter navigate) blev ikke svaret');
});

test('dispatch noterer input for et klik, foer klikket koerer', async () => {
  const u = sele();
  await nyFane(u, 10, 1);
  try { await u.hent('dispatch')(9876, 'click', { selector: '#x' }); } catch { /* klikket selv er ligegyldigt her */ }
  const r = await hent(u);
  assert.equal(r.error, 'no-new-tab-yet', `et klik flyttede ikke graensen for «ny»: ${JSON.stringify(r)}`);
});
