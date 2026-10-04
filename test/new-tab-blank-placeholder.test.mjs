/**
 * navigate(new_tab) as a session's first call must not leave an empty about:blank behind.
 *
 * MEASURED 2026-10-04, three times in a row: a fresh session's first call was
 * navigate({ url, new_tab: true }). getSessionTab() found no tab and created its about:blank
 * placeholder, then the new_tab branch opened a SECOND tab for the URL. Every session's
 * group carried an empty about:blank for its whole life, list_tabs showed it, and the agent
 * had to close it by hand. new_tab means "keep the current page" - an empty placeholder is
 * not a page anyone is keeping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function browser(startTabs = []) {
  const tabs = new Map(startTabs.map((t) => [t.id, { windowId: 1, active: false, status: 'complete', ...t }]));
  let next = 100;
  let u;
  const complete = (id) => setTimeout(() => u.fyr('tabs.onUpdated', id, { status: 'complete' }, tabs.get(id)), 5);
  u = indlaesUdvidelse({ svar: {
    'tabs.create': ({ url }) => { const t = { id: next++, url, title: url, windowId: 1, active: false }; tabs.set(t.id, t); complete(t.id); return t; },
    'tabs.get': (id) => { if (!tabs.has(id)) throw new Error('No tab with id: ' + id); return tabs.get(id); },
    'tabs.update': (id, p) => { Object.assign(tabs.get(id), p, p.url ? { title: p.url } : {}); complete(id); return tabs.get(id); },
    'tabs.remove': (id) => { tabs.delete(id); },
    'tabs.query': () => [...tabs.values()],
    'tabs.group': () => 7,
    'scripting.executeScript': () => [{ result: { found: false, types: [] } }],
    'debugger.sendCommand': () => ({ result: { value: null } }),
    'debugger.getTargets': [],
  } });
  return { u, tabs };
}

test('a fresh session navigating with new_tab ends up with one tab, not an extra about:blank', async () => {
  const { u, tabs } = browser();
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/', new_tab: true });
  assert.equal(svar.url, 'https://example.com/');
  const urls = [...tabs.values()].map((t) => t.url);
  assert.deepEqual(urls, ['https://example.com/'], `tabs left open: ${JSON.stringify(urls)}`);
  assert.deepEqual([...u.hent('sessions').get(9876).tabIds], [svar.tab_id]);
});

test('new_tab still keeps a real page open', async () => {
  const { u, tabs } = browser([{ id: 1, url: 'https://keep.example/', title: 'keep' }]);
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 7, label: 'Claude 1', color: 'blue' });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/', new_tab: true });
  assert.notEqual(svar.tab_id, 1, 'the page that was open must not be navigated away');
  assert.deepEqual([...tabs.values()].map((t) => t.url).sort(), ['https://example.com/', 'https://keep.example/']);
});
