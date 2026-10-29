// R184 (Opus, 29/10): fire modeksempler til den foerste #89-rettelse (e36a65d), alle MAALT roede dér: en ny chat paa en genbrugt
// port arvede den forrige chats nye faner (M1, M2), en adopteret session mistede sin egen popup (M3), og brugerens Cmd+T-fane paa
// agentens aktive fane blev «din nye fane» (M4, Chrome arver den aktive fane som aabner). Nye faner noegles nu paa sessionsobjektet,
// og chrome://newtab tælles aldrig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele() {
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => ({ id, url: `https://fane${id}.example`, title: `fane ${id}`, windowId: 1 }),
    'tabs.query': [], 'tabs.remove': undefined,
    'tabs.group': 1, 'tabGroups.update': {}, 'tabGroups.get': { id: 1 }, 'tabs.ungroup': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, nummer: 1, label: 'Claude 1', color: 'blue',
    pid: 111, gen: 'dokA-1', faneGen: new Map([[1, 'dokA-1']]) });
  return u;
}
const besked = (u, msg) => new Promise((ok) => {
  for (const fn of u.lyttere.get('runtime.onMessage') || []) {
    const r = fn(msg, {}, ok);
    if (r === undefined && msg.type !== 'mcp_command') ok(undefined);
  }
});
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

test('M1 portgenbrug: en NY chat paa samme port faar den forrige chats ikke-afhentede fane', async () => {
  const u = sele();
  u.hent('noterInput')(9876);                                       // chat A klikker
  await u.fyr('tabs.onCreated', { id: 10, url: 'https://fane10.example', windowId: 1, openerTabId: 1 });   // A's popup
  await besked(u, { type: 'session_disconnect', port: 9876, gen: 'dokA-1' });                               // A er vaek
  await vent(50);
  assert.equal(u.hent('sessions').has(9876), false, 'sessionen blev ikke frigivet - modeksemplet tester ikke det, det paastaar');
  // chat B (anden pid, anden forbindelse) faar porten og spoerger straks
  const r = await besked(u, { type: 'mcp_command', port: 9876, method: 'get_new_tab', params: { wait_ms: 0 }, pid: 222, gen: 'dokB-1' });
  assert.equal(r.error, 'no-new-tab-yet', `chat B fik chat A's fane: ${JSON.stringify(r)}`);
});

test('M2 portgenbrug: efter B\'s eget klik staar A\'s fane i earlier_new_tabs og kan tages med tab_id', async () => {
  const u = sele();
  u.hent('noterInput')(9876);
  await u.fyr('tabs.onCreated', { id: 10, url: 'https://fane10.example', windowId: 1, openerTabId: 1 });
  await besked(u, { type: 'session_disconnect', port: 9876, gen: 'dokA-1' });
  await vent(50);
  u.hent('noterInput')(9876);   // chat B's foerste klik
  const r = await besked(u, { type: 'mcp_command', port: 9876, method: 'get_new_tab', params: { wait_ms: 0 }, pid: 222, gen: 'dokB-1' });
  const ids = (r.earlier_new_tabs || []).map((t) => t.id);
  const r2 = await besked(u, { type: 'mcp_command', port: 9876, method: 'get_new_tab', params: { tab_id: 10 }, pid: 222, gen: 'dokB-1' });
  assert.ok(!ids.includes(10) && r2.id !== 10, `A's fane vises/tages af B: ${JSON.stringify(r)} / ${JSON.stringify(r2)} / B's faner ${[...u.hent('sessions').get(9876).tabIds]}`);
});

test('M3 adoption: samme chat paa ny port mister sin egen popup', async () => {
  const u = sele();
  u.hent('noterInput')(9876);
  await u.fyr('tabs.onCreated', { id: 10, url: 'https://fane10.example', windowId: 1, openerTabId: 1 });
  // chat A's server genstarter paa 9877 (samme pid), uden at udvidelsen saa lukningen
  const r = await besked(u, { type: 'mcp_command', port: 9877, method: 'get_new_tab', params: { wait_ms: 0 }, pid: 111, gen: 'dokA2-1' });
  assert.ok(u.hent('sessions').get(9877)?.tabIds.has(1), 'adoptionen skete ikke - modeksemplet tester ikke det, det paastaar');
  assert.equal(r.id, 10, `chatten fandt ikke sin egen popup efter adoption: ${JSON.stringify(r)}`);
});

test('M4 Cmd+T paa agentens aktive fane (Chrome arver aabneren, tab_strip_model.cc) bliver «din nye fane»', async () => {
  const u = sele();
  u.hent('noterInput')(9876);   // agenten klikkede; popuppen blev blokeret
  await u.fyr('tabs.onCreated', { id: 50, pendingUrl: 'chrome://newtab/', url: '', windowId: 1, openerTabId: 1 });
  const r = await u.hent('dispatch')(9876, 'get_new_tab', { wait_ms: 0 });
  assert.notEqual(r.id, 50, `brugerens Cmd+T-fane blev svaret som agentens nye fane og lagt i sessionen: ${JSON.stringify(r)}`);
});
