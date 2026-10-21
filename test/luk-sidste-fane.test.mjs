/**
 * close_tab lukker ikke Chrome (1.33, privat rapport 3.1).
 *
 * MAALT paa 1.30.1 (7/10): browser_close_tab paa den sidste fane i et vindue lukkede vinduet; var det profilens sidste
 * vindue, lukkede Chrome (Windows), og naeste kald fik «extension not connected». close_tab fjernede fanen uden at se paa
 * vinduet. Nu bliver en tom fane staaende, naar fanen er den sidste i Chromes sidste vindue - og kun da.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

// vinduer: { vinduesId: [faneId, ...] }
function chrome(vinduer, fejl = {}) {
  const log = [];
  const fanensVindue = (id) => Number(Object.keys(vinduer).find((w) => vinduer[w].includes(id)));
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => { const w = fanensVindue(id); if (!w) throw new Error('No tab with id: ' + id); return { id, windowId: w, url: 'https://x.example/' }; },
    // Som Chrome: svaret er vinduet, som det var, da opslaget blev stillet - det kommer lidt senere.
    'tabs.query': async (q) => {
      if (fejl.query) throw new Error('query afvist');
      const nu = (vinduer[q.windowId] || []).map((id) => ({ id, windowId: q.windowId }));
      await new Promise((r) => setTimeout(r, 5));
      return nu;
    },
    'windows.getAll': () => Object.keys(vinduer).map((w) => ({ id: Number(w), type: 'normal' })),
    'tabs.create': (o) => { if (fejl.create) throw new Error('create afvist'); log.push(['create', o.windowId, o.url, o.active]); const id = 900 + log.length; vinduer[o.windowId].push(id); return { id, windowId: o.windowId, url: o.url }; },
    'tabs.remove': (id) => { log.push(['remove', id]); const w = fanensVindue(id); vinduer[w] = vinduer[w].filter((x) => x !== id); },
  } });
  return { u, log, luk: (id, faner) => {
    u.hent('sessions').set(9876, { tabIds: new Set(faner), activeTabId: faner[0], groupId: 1, label: 'Claude 1', color: 'blue' });
    return u.hent('dispatch')(9876, 'close_tab', { tab_id: id });
  } };
}

test('3.1: den sidste fane i Chromes sidste vindue - en tom fane bliver staaende, og svaret siger det', async () => {
  const c = chrome({ 1: [11] });
  const r = await c.luk(11, [11]);
  assert.deepEqual(c.log, [['create', 1, 'about:blank', false], ['remove', 11]], 'den tomme fane skal laves FOER lukningen - og i baggrunden');
  assert.equal(r.ok, true);
  assert.equal(r.kept_window_open, true);
  assert.match(r.note, /closed Chrome/);
});

test('3.1: flere faner i vinduet - ingen ekstra fane', async () => {
  const c = chrome({ 1: [11, 12] });
  const r = await c.luk(11, [11]);
  assert.deepEqual(c.log, [['remove', 11]]);
  assert.equal(r.kept_window_open, undefined);
});

test('3.1: sidste fane i et vindue, men Chrome har et andet vindue - vinduet maa lukke, ingen ekstra fane', async () => {
  const c = chrome({ 1: [11], 2: [21] });
  const r = await c.luk(11, [11]);
  assert.deepEqual(c.log, [['remove', 11]]);
  assert.equal(r.kept_window_open, undefined);
});

test('3.1: en fane uden for sessionen lukkes stadig ikke', async () => {
  const c = chrome({ 1: [11, 12] });
  await assert.rejects(c.luk(12, [11]), /does not belong to this session/);
  assert.deepEqual(c.log, []);
});

// R173 (Astra, MAALT): fejl blev slugt, og samtidige lukninger saa hinandens faner.
test('R173: afvises opslaget eller oprettelsen, lukkes intet', async () => {
  for (const f of ['query', 'create']) {
    const c = chrome({ 1: [11] }, { [f]: true });
    await assert.rejects(c.luk(11, [11]), new RegExp(`${f} afvist`));
    assert.deepEqual(c.log.filter((x) => x[0] === 'remove'), [], `${f} afvist: fanen blev lukket alligevel`);
  }
});

test('R173: to samtidige lukninger i det sidste vindue efterlader en tom fane - ogsaa fra to sessioner', async () => {
  // To sessioner med hver sin fane i samme (sidste) vindue: deres kald koerer ikke i samme koe.
  const vinduer = { 1: [11, 12] };
  const c = chrome(vinduer);
  c.u.hent('sessions').set(9876, { tabIds: new Set([11]), activeTabId: 11, groupId: 1, label: 'Claude 1', color: 'blue' });
  c.u.hent('sessions').set(9877, { tabIds: new Set([12]), activeTabId: 12, groupId: 2, label: 'Claude 2', color: 'red' });
  const d = c.u.hent('dispatch');
  const [a, b] = await Promise.all([d(9876, 'close_tab', { tab_id: 11 }), d(9877, 'close_tab', { tab_id: 12 })]);
  assert.equal(vinduer[1].length, 1, `vinduet skal have én tom fane tilbage: ${JSON.stringify(vinduer)}`);
  assert.equal([a, b].filter((r) => r.kept_window_open).length, 1);
});
