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
    'windows.create': ({ url }) => { const t = { id: next++, url, title: url, windowId: 2, active: true, status: 'complete' }; tabs.set(t.id, t); complete(t.id); return { id: 2, focused: false, left: 10, top: 20, tabs: [t] }; },
    'windows.get': (id) => ({ id, focused: false, left: 10, top: 20, state: 'normal' }),
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

test('the new_tab text names the placeholder exception', async () => {
  const { TOOLS } = await import('../mcp-server/tools.js');
  const d = TOOLS.find((t) => t.name === 'browser_navigate').inputSchema.properties.new_tab.description;
  assert.match(d, /empty about:blank placeholder, that tab is used instead of opening another/, 'new_tab promises a new tab also when the placeholder is reused');
});

// Gustav 9/10-2026, set i sin egen Chrome: «den aabner about:blank som det foerste hver gang». En ny sessions foerste
// navigate (uden new_tab) oprettede about:blank-pladsholderen og skiftede den saa til adressen. Fanen oprettes nu direkte
// med adressen; about:blank naevnes aldrig, og der skiftes ikke bagefter.
test('a fresh session\'s first navigate creates its tab with the URL, never an about:blank first', async () => {
  for (const params of [{ url: 'https://example.com/' }, { url: 'https://example.com/', new_tab: true }]) {
    const { u, tabs } = browser();
    const svar = await u.hent('dispatch')(9876, 'navigate', params);
    assert.equal(svar.url, 'https://example.com/', JSON.stringify(params));
    const oprettet = u.optager.til('tabs.create').map((k) => k.args[0].url);
    assert.deepEqual(oprettet, ['https://example.com/'], `${JSON.stringify(params)}: tabs.create med ${JSON.stringify(oprettet)}`);
    assert.equal(u.optager.til('tabs.update').filter((k) => k.args[1] && k.args[1].url).length, 0, 'fanen blev skiftet bagefter');
    assert.deepEqual([...tabs.values()].map((t) => t.url), ['https://example.com/']);
  }
});

// R73 (Astra, maalt i model): med new_tab og eget_vindue oprettede en ny session (og en med en lukket fane) stadig en tom
// about:blank, foer vinduet blev aabnet med adressen - to faner i sessionen.
test('a first navigate with its own window opens no about:blank tab', async () => {
  for (const doed of [false, true]) {
    const { u, tabs } = browser();
    if (doed) u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([77]), activeTabId: 77, groupId: 1, windowId: 1 });
    const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/', new_tab: true, eget_vindue: true });
    assert.equal(svar.ok, true, JSON.stringify(svar));
    assert.equal(u.optager.til('tabs.create').length, 0, `lukket fane: ${doed}`);
    assert.deepEqual([...tabs.values()].map((t) => t.url), ['https://example.com/'], `lukket fane: ${doed}`);
  }
});

// R73 (Astra, maalt i model): en adresse, der var faerdigindlaest, mens den nye fane blev lagt i sessionens gruppe, sendte sin
// eneste 'complete', foer navigate lyttede - og navigate ventede de fulde 15 sekunder.
function langsomBrowser({ eksisterende = null, hurtigOpdatering = false, omdiriger = null } = {}) {
  const tabs = new Map(eksisterende ? [[eksisterende.id, { windowId: 1, active: false, status: 'complete', ...eksisterende }]] : []);
  let u, next = 100;
  const tilstand = { brugteTimeout: false };
  const lad = (t, url, efter) => setTimeout(() => {
    Object.assign(t, { url, pendingUrl: undefined, status: 'complete' });
    u.fyr('tabs.onUpdated', t.id, { status: 'complete' }, { ...t });
  }, efter);
  u = indlaesUdvidelse({ svar: {
    'tabs.create': ({ url }) => {
      const t = { id: next++, url: '', pendingUrl: url, title: url, windowId: 1, status: 'loading', active: false };
      tabs.set(t.id, t); lad(t, url, 5);
      return { ...t };
    },
    // Som Chrome: den gamle side staar som 'complete' et oejeblik, foer navigationen begynder.
    'tabs.update': (id, p) => {
      const t = tabs.get(id);
      // hurtigOpdatering: siden er faerdig, foer navigate naar at lytte (en side fra cachen).
      if (hurtigOpdatering) {
        Object.assign(t, { url: (omdiriger && omdiriger[p.url]) || p.url, pendingUrl: undefined, status: 'complete' });
        u.fyr('tabs.onUpdated', t.id, { status: 'complete' }, { ...t });   // foer navigate har sat sin lytter
        return { ...t };
      }
      setTimeout(() => { t.status = 'loading'; }, 10); lad(t, p.url, 20);
      return { ...t };
    },
    'tabs.get': (id) => ({ ...tabs.get(id) }),
    'tabs.query': () => [...tabs.values()],
    'tabs.group': () => new Promise((resolve) => setTimeout(() => resolve(7), 30)),
    'scripting.executeScript': () => [{ result: { found: false, types: [] } }],
    'debugger.sendCommand': () => ({ result: { value: null } }),
    'debugger.getTargets': [],
  } });
  if (eksisterende) u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([eksisterende.id]), activeTabId: eksisterende.id, groupId: 1, windowId: 1 });
  // Kun ventetiden paa 15 s forkortes (til 80 ms), saa en ventet timeout ses uden at proeven tager 15 s.
  u.ctx.setTimeout = (fn, ms, ...a) => setTimeout(() => { if (ms === 15000) tilstand.brugteTimeout = true; fn(...a); }, ms === 15000 ? 80 : ms);
  return { u, tabs, tilstand };
}

test('a first navigate whose page finished loading while the tab was being grouped does not wait for the timeout', async () => {
  for (const [params, eksisterende] of [[{ url: 'https://example.com/cache' }, null],
    [{ url: 'https://example.com/cache', new_tab: true }, { id: 5, url: 'https://foer.example/', title: 'foer' }]]) {
    const { u, tilstand } = langsomBrowser({ eksisterende });
    const svar = await u.hent('dispatch')(9876, 'navigate', params);
    assert.equal(svar.url, 'https://example.com/cache', JSON.stringify(params));
    assert.equal(tilstand.brugteTimeout, false, `${JSON.stringify(params)}: navigate ventede paa timeouten`);
  }
});

// R74 (Astra, maalt i model): about:blank i en ny session og en pladsholder, der genbruges uden new_tab, kunne stadig miste
// deres eneste 'complete' og vente til timeouten.
test('a first navigate to about:blank, and a reused placeholder without new_tab, do not wait for the timeout', async () => {
  for (const [params, eksisterende] of [[{ url: 'about:blank' }, null], [{ url: 'about:blank', new_tab: true }, null],
    [{ url: 'https://example.com/cache' }, { id: 5, url: 'about:blank', title: '' }]]) {
    const { u, tilstand } = langsomBrowser({ eksisterende, hurtigOpdatering: true });
    const svar = await u.hent('dispatch')(9876, 'navigate', params);
    assert.equal(svar.url, params.url, JSON.stringify(params));
    assert.equal(tilstand.brugteTimeout, false, `${JSON.stringify(params)}: navigate ventede paa timeouten`);
  }
});

// R75 (Astra, maalt i model): en eksisterende side, hvis navigation var faerdig, foer navigate lyttede - en ny adresse,
// about:blank, samme adresse eller et fragment - ventede de fulde 15 sekunder.
test('navigate in an existing tab whose page finished before navigate listened - also via a redirect - does not wait (R76)', async () => {
  {
    // En side fra cachen, der omdirigerer: den nye 'complete' har en anden adresse end den bedte, og den gamle side var faerdig.
    const { u, tilstand } = langsomBrowser({ eksisterende: { id: 5, url: 'https://foer.example/', title: 'foer' }, hurtigOpdatering: true,
      omdiriger: { 'https://example.com/kort': 'https://example.com/lang' } });
    const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/kort' });
    assert.equal(svar.url, 'https://example.com/lang');
    assert.equal(tilstand.brugteTimeout, false, 'omdirigering: navigate ventede paa timeouten');
  }
  for (const url of ['https://example.com/ny', 'about:blank', 'https://foer.example/', 'https://foer.example/#afsnit']) {
    const { u, tilstand } = langsomBrowser({ eksisterende: { id: 5, url: 'https://foer.example/', title: 'foer' }, hurtigOpdatering: true });
    const svar = await u.hent('dispatch')(9876, 'navigate', { url });
    assert.equal(svar.url, url, url);
    assert.equal(tilstand.brugteTimeout, false, `${url}: navigate ventede paa timeouten`);
  }
});

// R76 (Astra, maalt i model): en gammel sides 'complete' (en side, der stadig indlaeste, eller en gammel omdirigering) efter
// opdateringen blev taget som den nye side; svaret kom med den gamle adresse.
test('navigate in a tab whose old page was still loading does not take the old page\'s complete as the new one', async () => {
  const tabs = new Map([[5, { id: 5, url: 'https://foer.example/', title: 'foer', windowId: 1, status: 'loading', active: false }]]);
  let u;
  u = indlaesUdvidelse({ svar: {
    'tabs.update': (id, p) => {
      const t = tabs.get(id);
      setTimeout(() => { t.status = 'complete'; u.fyr('tabs.onUpdated', id, { status: 'complete' }, { ...t }); }, 5);   // den gamle side bliver faerdig
      setTimeout(() => { Object.assign(t, { url: p.url, status: 'loading' }); u.fyr('tabs.onUpdated', id, { status: 'loading' }, { ...t }); }, 20);
      setTimeout(() => { t.status = 'complete'; u.fyr('tabs.onUpdated', id, { status: 'complete' }, { ...t }); }, 40);
      return { ...t };
    },
    'tabs.get': (id) => ({ ...tabs.get(id) }),
    'tabs.query': () => [...tabs.values()],
    'scripting.executeScript': () => [{ result: { found: false, types: [] } }],
    'debugger.sendCommand': () => ({ result: { value: null } }),
    'debugger.getTargets': [],
  } });
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([5]), activeTabId: 5, groupId: 1, windowId: 1 });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/ny' });
  assert.equal(svar.url, 'https://example.com/ny');
});

test('a navigate in place does not take the old page\'s complete status as the new page having loaded', async () => {
  const { u, tilstand } = langsomBrowser({ eksisterende: { id: 5, url: 'https://foer.example/', title: 'foer' } });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/ny' });
  assert.equal(svar.url, 'https://example.com/ny');
  assert.equal(tilstand.brugteTimeout, false);
});

test('a session that already has a tab still navigates in place', async () => {
  const { u, tabs } = browser([{ id: 5, url: 'https://foer.example/', title: 'foer' }]);
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([5]), activeTabId: 5, groupId: 1, windowId: 1 });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://example.com/' });
  assert.equal(svar.url, 'https://example.com/');
  assert.equal(u.optager.til('tabs.create').length, 0);
  assert.deepEqual([...tabs.values()].map((t) => t.url), ['https://example.com/']);
});
