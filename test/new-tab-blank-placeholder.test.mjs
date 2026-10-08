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
    'tabs.create': ({ url }) => { const t = { id: next++, url, title: url, windowId: 1, active: false, status: 'complete' }; tabs.set(t.id, t); complete(t.id); return t; },
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

// MEASURED 2026-10-05 against real Chrome with the fix above: one tab, as intended - but
// navigate answered url "about:blank". The placeholder was created a moment earlier, and its
// OWN load-complete event arrived after navigate started waiting, so the wait ended before the
// real URL had loaded. The same race exists on main for a plain navigate as a session's first
// call: getSessionTab() creates the placeholder and tabs.update() loads into it.
function browserWithSlowLoad({ placeholderEventUrl } = {}) {
  const tabs = new Map();
  let next = 100;
  let u;
  const fire = (id) => u.fyr('tabs.onUpdated', id, { status: 'complete' }, { ...tabs.get(id) });
  u = indlaesUdvidelse({ svar: {
    // The placeholder's own load completes 20 ms after create - after navigate is waiting.
    'tabs.create': ({ url }) => { const t = { id: next++, url, title: url, windowId: 1, active: false, status: 'loading' };
      tabs.set(t.id, t); setTimeout(() => { t.status = 'complete';
        u.fyr('tabs.onUpdated', t.id, { status: 'complete' }, { ...t, url: placeholderEventUrl ?? t.url }); }, 20); return { ...t }; },
    'tabs.get': (id) => { if (!tabs.has(id)) throw new Error('No tab with id: ' + id); return { ...tabs.get(id) }; },
    // A real URL takes 120 ms to load; until then the tab still shows its old url.
    'tabs.update': (id, p) => { const t = tabs.get(id);
      if (p.url) setTimeout(() => { t.url = p.url; t.title = p.url; t.status = 'complete'; fire(id); }, 120);
      return { ...t }; },
    'tabs.remove': (id) => { tabs.delete(id); },
    'tabs.query': () => [...tabs.values()],
    'tabs.group': () => 7,
    'scripting.executeScript': () => [{ result: { found: false, types: [] } }],
    'debugger.sendCommand': () => ({ result: { value: null } }),
    'debugger.getTargets': [],
  } });
  return { u, tabs };
}

// The event's tab snapshot cannot be trusted to say about:blank: real Chrome was still measured
// answering "about:blank" with the url check alone. Covered here with an empty url in the event.
for (const [new_tab, placeholderEventUrl] of [[true, undefined], [false, undefined], [true, '']]) {
  test(`a first navigate (new_tab: ${new_tab}, placeholder event url ${JSON.stringify(placeholderEventUrl ?? 'about:blank')}) waits for the real URL`, async () => {
    const { u } = browserWithSlowLoad({ placeholderEventUrl });
    const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/', new_tab });
    assert.equal(svar.url, 'https://example.com/', `navigate answered before the page loaded: ${JSON.stringify(svar)}`);
  });
}

test('new_tab still keeps a real page open', async () => {
  const { u, tabs } = browser([{ id: 1, url: 'https://keep.example/', title: 'keep' }]);
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 7, label: 'Claude 1', color: 'blue' });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/', new_tab: true });
  assert.notEqual(svar.tab_id, 1, 'the page that was open must not be navigated away');
  assert.deepEqual([...tabs.values()].map((t) => t.url).sort(), ['https://example.com/', 'https://keep.example/']);
});

// R50 (Opus, MAALT i Chrome): tabs.create('about:blank') svarer {url: '', pendingUrl: 'about:blank', status: 'loading'},
// saa rigtig Chrome tager ALTID pendingUrl-grenen - og den var ikke daekket. Og en 'complete'-haendelse, mens fanen
// selv stadig staar 'loading', maa ikke afslutte ventetiden (Astra).
function somChrome({ falskComplete = false } = {}) {
  const fane = { id: 1, url: '', pendingUrl: 'about:blank', windowId: 1, status: 'loading' };
  const faner = new Map([[1, fane]]);
  let naeste = 2, u, rigtigtFaerdig = false;
  const opdater = (id, p) => {
    const t = faner.get(id);
    if (p.url) {
      if (falskComplete) setTimeout(() => { t.url = p.url; t.status = 'loading'; u.fyr('tabs.onUpdated', id, { status: 'complete' }, { ...t, status: 'complete' }); }, 10);
      setTimeout(() => { t.url = p.url; t.pendingUrl = undefined; t.status = 'complete'; rigtigtFaerdig = true; u.fyr('tabs.onUpdated', id, { status: 'complete' }, { ...t }); }, 70);
    }
    return { ...t };
  };
  u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => ({ ...faner.get(id) }), 'tabs.query': () => [...faner.values()],
    'tabs.update': opdater,
    'tabs.create': (p) => { const t = { id: naeste++, url: '', pendingUrl: 'about:blank', windowId: 1, status: 'loading' }; faner.set(t.id, t); return opdater(t.id, p); },
    'tabs.group': 7, 'scripting.executeScript': [{ result: { found: false, types: [] } }],
    'debugger.sendCommand': { result: { value: null } }, 'debugger.getTargets': [],
  } });
  u.ctx.detectCaptcha = async () => ({ found: false, types: [] });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 7, label: 't', color: 'blue' });
  return { u, faner, faerdig: () => rigtigtFaerdig };
}

test('a placeholder that Chrome reports with url "" and pendingUrl about:blank is reused', async () => {
  const { u, faner } = somChrome();
  const r = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.test/', new_tab: true });
  assert.equal(r.tab_id, 1, 'a second tab was opened next to the placeholder');
  assert.equal(faner.size, 1);
});

test('a complete event while the tab itself is still loading does not end the wait', async () => {
  const { u, faerdig } = somChrome({ falskComplete: true });
  await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.test/', new_tab: true });
  assert.equal(faerdig(), true, 'navigate returned on a complete event the tab itself did not confirm');
});
