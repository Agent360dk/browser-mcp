/**
 * ask_user's wait lives in the background, so a navigation does not lose the question.
 *
 * MEASURED 2026-10-08: "Please log in, then click Done" - submitting the login form
 * navigated the page, the prompt (a Promise inside the page) vanished with the old document,
 * executeScript rejected, and the agent got an error for the step it had asked the user to
 * do. The page now only draws the prompt; the answer comes back as a message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

// R57: ask_user tegner ikke paa about:blank (Chrome naegter, maalt), saa standardfanen er en webside.
function browser({ drawFails = null, startUrl = 'https://app.example/side', startPending, ekstra = {} } = {}) {
  const tabs = new Map();
  let next = 100;
  let u;
  u = indlaesUdvidelse({ svar: {
    'tabs.create': ({ url }) => {
      const t = { id: next++, url: startUrl ?? url, pendingUrl: startPending, title: url, windowId: 1, active: false, status: 'complete' };
      tabs.set(t.id, t);
      setTimeout(() => u.fyr('tabs.onUpdated', t.id, { status: 'complete' }, t), 5);
      return t;
    },
    'tabs.get': (id) => { if (!tabs.has(id)) throw new Error('No tab with id: ' + id); return tabs.get(id); },
    'tabs.update': (id, p) => Object.assign(tabs.get(id), p),
    'tabs.query': () => [...tabs.values()],
    'tabs.group': () => 7,
    'scripting.executeScript': (o) => {
      if (drawFails && o.func?.name === 'renderAskPrompt') throw new Error(drawFails);
      return [{ result: undefined }];
    },
    'debugger.getTargets': [],
    ...ekstra,
  } });
  return u;
}

const scripts = (u) => u.optager.til('scripting.executeScript').map((k) => k.args[0]);
const draws = (u) => scripts(u).filter((o) => o.func?.name === 'renderAskPrompt');
const erases = (u) => scripts(u).filter((o) => o.func?.name !== 'renderAskPrompt');
// Objects made inside the VM have its own Object.prototype; deepStrictEqual compares that too.
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function ask(u, params = {}) {
  const before = draws(u).length;
  const pending = u.hent('dispatch')(9876, 'ask_user', { message: 'Please log in, then click Done', ...params });
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 50 && draws(u).length === before; i++) await tick(5);
  const draw = draws(u).at(-1);
  assert.ok(draws(u).length > before, 'the prompt was never drawn');
  return { pending, askId: draw.args[0].askId, tabId: draw.target.tabId, settled: () => settled };
}

// Chrome sets sender.url to the frame's address and sender.origin to its origin ('null' for a sandboxed page).
const fromPrompt = (u, tabId, origin, url = origin && origin !== 'null' ? origin + '/side' : undefined) =>
  ({ id: u.chrome.runtime.id, tab: { id: tabId }, origin, url });

test('the prompt is drawn in the isolated world and the answer comes back as a message', async () => {
  const u = browser();
  const a = await ask(u);
  const draw = draws(u)[0];
  assert.equal(draw.world, 'ISOLATED');
  assert.equal(draw.args[1], false, 'the first draw is not a replay');
  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: a.askId, action: 'done', values: {} }, fromPrompt(u, a.tabId));
  assert.deepEqual(plain(await a.pending), { acknowledged: true, action: 'done', values: {} });
  assert.equal(u.hent('pendingAsks').size, 0);
  assert.equal(u.optager.antal('notifications.clear'), 1, 'the OS notification stays up after the answer');
});

test('a navigation in the tab redraws the prompt instead of losing the question', async () => {
  const u = browser();
  const a = await ask(u);
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 0 });
  await tick();
  assert.equal(draws(u).length, 2, 'the prompt was not redrawn on the new document');
  assert.equal(draws(u)[1].args[0].askId, a.askId);
  assert.equal(draws(u)[1].args[1], true, 'a redraw is a replay - no second chime');
  assert.equal(a.settled(), false, 'the navigation answered the question');

  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 3 });
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId + 1, frameId: 0 });
  await tick();
  assert.equal(draws(u).length, 2, 'subframes and other tabs must not redraw it');

  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: a.askId, action: 'skip', values: {} }, fromPrompt(u, a.tabId));
  assert.deepEqual(plain(await a.pending), { acknowledged: true, action: 'skip', values: {} });
});

test('only the prompt in its own tab can answer it', async () => {
  const u = browser();
  const a = await ask(u);
  const answer = { type: 'ask_user_answer', askId: a.askId, action: 'done', values: {} };
  await u.fyr('runtime.onMessage', answer, fromPrompt(u, a.tabId + 1));
  await u.fyr('runtime.onMessage', answer, { id: 'another-extension', tab: { id: a.tabId } });
  await u.fyr('runtime.onMessage', { ...answer, askId: 'ask-guessed' }, fromPrompt(u, a.tabId));
  await tick();
  assert.equal(a.settled(), false, 'a message from outside the prompt answered it');
  await u.fyr('runtime.onMessage', answer, fromPrompt(u, a.tabId));
  assert.equal((await a.pending).action, 'done');
});

test('only declared fields come back, as strings', async () => {
  const u = browser({ startUrl: 'https://bank.example/login' });
  const a = await ask(u, { fields: [{ name: 'code', label: '2FA code' }] });
  assert.deepEqual(plain(draws(u)[0].args[0].fields), [{ name: 'code', label: '2FA code', type: 'text' }]);
  await u.fyr('runtime.onMessage',
    { type: 'ask_user_answer', askId: a.askId, action: 'done', values: { code: 123456, extra: 'x' } }, fromPrompt(u, a.tabId, 'https://bank.example'));
  assert.deepEqual(plain((await a.pending).values), { code: '123456' });
});

test('nobody answers: it gives up on time, says so and removes the prompt', async () => {
  const u = browser();
  const a = await ask(u, { timeout: 60 });
  assert.deepEqual(plain(await a.pending), { acknowledged: false, action: 'timeout', values: {} });
  assert.equal(erases(u).length, 1, 'the timed-out prompt was left on the page');
  assert.deepEqual(plain(erases(u)[0].args), [a.askId]);
  assert.equal(u.hent('pendingAsks').size, 0);
});

test('closing the tab ends the wait', async () => {
  const u = browser();
  const a = await ask(u);
  await u.fyr('tabs.onRemoved', a.tabId);
  assert.deepEqual(plain(await a.pending), { acknowledged: false, action: 'tab_closed', values: {} });
});

test('a newer question in the same tab releases the older caller', async () => {
  const u = browser();
  const first = await ask(u);
  const second = await ask(u, { message: 'Now the 2FA code' });
  assert.notEqual(first.askId, second.askId);
  assert.equal((await first.pending).action, 'replaced');
  assert.equal(second.settled(), false);
  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: second.askId, action: 'done', values: {} }, fromPrompt(u, second.tabId));
  assert.equal((await second.pending).action, 'done');
});

test('the card comes back where the user dragged it', async () => {
  const u = browser();
  const a = await ask(u);
  assert.equal(draws(u)[0].args[0].position, null);
  await u.fyr('runtime.onMessage', { type: 'ask_user_moved', askId: a.askId, left: 40, top: 300 }, fromPrompt(u, a.tabId));
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 0 });
  await tick();
  assert.deepEqual(plain(draws(u)[1].args[0].position), { left: 40, top: 300 });
  assert.equal(a.settled(), false, 'moving the card answered the question');
  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: a.askId, action: 'skip', values: {} }, fromPrompt(u, a.tabId));
  await a.pending;
});

test('a page that cannot take the prompt fails the call instead of hanging it', async () => {
  const u = browser({ drawFails: 'Cannot access a chrome:// URL' });
  await assert.rejects(u.hent('dispatch')(9876, 'ask_user', { message: 'x' }), /chrome:\/\//);
  assert.equal(u.hent('pendingAsks').size, 0);
});

// MEASURED 2026-10-08: the httpbin form posts to a JSON endpoint. Chrome's JSON viewer
// rebuilds <body> after DOMContentLoaded and the redrawn prompt went with it.
test('the prompt is drawn again when the page has finished loading', async () => {
  const u = browser();
  const a = await ask(u);
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 0 });
  await u.fyr('webNavigation.onCompleted', { tabId: a.tabId, frameId: 0 });
  await u.fyr('webNavigation.onCompleted', { tabId: a.tabId, frameId: 2 });
  await tick();
  assert.equal(draws(u).length, 3, 'onCompleted must redraw too, and only for the top frame');
  assert.ok(draws(u).slice(1).every((d) => d.args[1] === true));
  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: a.askId, action: 'done', values: {} }, fromPrompt(u, a.tabId));
  await a.pending;
  await u.fyr('webNavigation.onCompleted', { tabId: a.tabId, frameId: 0 });
  await tick();
  assert.equal(draws(u).length, 3, 'an answered prompt was drawn again');
});

// R48 (Opus, MAALT ende-til-ende i Chrome 154): en prompt med felter blev tegnet igen paa et fremmed origin efter en
// navigation, siden dér fik koden via sine capture-lyttere, og svaret blev godtaget. Den hoerer nu til sit origin.
test('a prompt with fields ends when the tab moves to another origin, and is redrawn on the same origin', async () => {
  const u = browser({ startUrl: 'https://bank.example/login' });
  const a = await ask(u, { fields: [{ name: 'code', label: '2FA code' }] });
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 0, url: 'https://bank.example/step2' });
  await tick();
  assert.equal(draws(u).length, 2, 'the same origin must redraw it');
  assert.equal(a.settled(), false);
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 0, url: 'https://evil.example/' });
  await tick();
  assert.equal(draws(u).length, 2, 'a prompt with fields was drawn on another origin');
  assert.deepEqual(plain(await a.pending), { acknowledged: false, action: 'navigated', values: {} });
});

test('an answer to a prompt with fields counts only from its own origin', async () => {
  const u = browser({ startUrl: 'https://bank.example/login' });
  const a = await ask(u, { fields: [{ name: 'code', label: '2FA code' }] });
  const svar = { type: 'ask_user_answer', askId: a.askId, action: 'done', values: { code: '482913' } };
  await u.fyr('runtime.onMessage', svar, fromPrompt(u, a.tabId, 'https://evil.example'));
  await u.fyr('runtime.onMessage', svar, fromPrompt(u, a.tabId, undefined));
  await tick();
  assert.equal(a.settled(), false, 'an answer from another origin was taken');
  await u.fyr('runtime.onMessage', svar, fromPrompt(u, a.tabId, 'https://bank.example'));
  assert.deepEqual(plain((await a.pending).values), { code: '482913' });
});

test('a prompt without fields follows the login to another origin (SSO)', async () => {
  const u = browser({ startUrl: 'https://app.example/' });
  const a = await ask(u);
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 0, url: 'https://login.idp.example/' });
  await tick();
  assert.equal(draws(u).length, 2, 'the card must follow an SSO login');
  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: a.askId, action: 'done', values: {} }, fromPrompt(u, a.tabId, 'https://login.idp.example'));
  assert.equal((await a.pending).action, 'done');
});

test('a page that keeps removing the prompt ends the wait with removed_by_page', async () => {
  const u = browser();
  const a = await ask(u);
  await u.fyr('runtime.onMessage', { type: 'ask_user_lost', askId: a.askId }, fromPrompt(u, a.tabId));
  assert.deepEqual(plain(await a.pending), { acknowledged: false, action: 'removed_by_page', values: {} });
});

test('the page gets the deadline, so an orphaned prompt removes itself', async () => {
  const u = browser();
  const foer = Date.now();
  const a = await ask(u, { timeout: 5000 });
  const d = draws(u)[0].args[0].deadline;
  assert.ok(d >= foer + 5000 && d <= Date.now() + 5000, `deadline ${d} is not now + timeout`);
  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: a.askId, action: 'skip', values: {} }, fromPrompt(u, a.tabId));
  await a.pending;
});

// Hvert udfald koden kan give, staar i beskrivelsen, og beskrivelsen lover ikke tastatur-isolation (R48).
test('the tool description names every action the code can return, and the keystroke limit', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const bg = readFileSync(join(ROD, 'extension/background.js'), 'utf8');
  const fra = bg.indexOf('const pendingAsks'), til = bg.indexOf('// ── OAuth Popup Interception');
  const caseStart = bg.indexOf("case 'ask_user': {");
  const kode = bg.slice(fra, til) + bg.slice(caseStart, bg.indexOf('return answered;', caseStart));
  const actions = new Set([...kode.matchAll(/action: '([a-z_]+)'/g)].map((m) => m[1]));
  actions.add('done'); actions.add('skip');
  const { TOOLS } = await import('../mcp-server/tools.js');
  const d = TOOLS.find((t) => t.name === 'browser_ask_user').description;
  for (const a of actions) if (a !== 'error') assert.match(d, new RegExp(`\\b${a}\\b`), `the description does not name action ${a}`);
  assert.ok(actions.size >= 7, `only ${actions.size} actions found - the measurement reads nothing`);
  assert.match(d, /can see the keystrokes/, 'the description must not promise keyboard isolation');
  // R55 (Opus): saetningen om lokale filer var ubundet.
  assert.match(d, /or, on a local file, to another file/, 'the description does not say a local file is bound to itself');
});

// One change, every surface: README (both copies), /docs/tools and the install pages say what the prompt is now.
test('every page that lists browser_ask_user describes the card, not a full-screen overlay', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const filer = ['README.md', 'mcp-server/README.md', 'content/browsermcp-docs-tools.md',
    ...['claude-code', 'codex', 'cursor', 'vscode', 'zcode'].map((f) => `content/browsermcp-docs-install-${f}.md`)];
  for (const f of filer) {
    const alle = readFileSync(join(ROD, f), 'utf8').split('\n').filter((l) => l.includes('`browser_ask_user`'));
    for (const l of alle) assert.doesNotMatch(l, /overlay/i, `${f}: still describes a full-screen overlay`);
    // The row that describes the tool: its own row in the tool tables, «Human-in-the-loop» on the install pages.
    const rk = alle.filter((l) => l.startsWith('| `browser_ask_user` |') || (f.includes('install-') && l.startsWith('| **Human-in-the-loop** |')));
    assert.equal(rk.length, 1, `${f}: expected one row describing browser_ask_user, found ${rk.length}`);
    assert.match(rk[0], /drag aside/, `${f}: does not say the card can be dragged aside`);
  }
  for (const f of ['README.md', 'mcp-server/README.md', 'content/browsermcp-docs-tools.md']) {
    const l = readFileSync(join(ROD, f), 'utf8').split('\n').find((x) => x.startsWith('| `browser_ask_user`'));
    assert.match(l, /can see (what you type|the keystrokes)/, `${f}: promises the page cannot see what is typed`);
  }
});

// R51 (Astra, MAALT): en tom tab.url gav origin null, og saa slog begge kontroller fra.
test('a prompt with fields is refused on a tab without a web origin', async () => {
  const u = browser({ startUrl: 'about:blank' });
  const foer = draws(u).length;
  await assert.rejects(u.hent('dispatch')(9876, 'ask_user', { message: 'code?', fields: [{ name: 'code', label: 'Code' }] }),
    /needs the tab to be on a web page/);
  assert.equal(draws(u).length, foer, 'the prompt was drawn without an origin to bind it to');
  assert.equal(u.hent('pendingAsks').size, 0);
});

test('the prompt is sent its origin, and an unknown address after a navigation ends a prompt with fields', async () => {
  const u = browser({ startUrl: 'https://bank.example/login' });
  const a = await ask(u, { fields: [{ name: 'code', label: '2FA code' }] });
  assert.equal(draws(u)[0].args[0].origin, 'https://bank.example', 'the renderer cannot check the origin it was not given');
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 0, url: '' });
  assert.equal((await a.pending).action, 'navigated', 'an unknown address let the prompt with fields be drawn again');
  const v = browser({ startUrl: 'https://app.example/' });
  await ask(v);
  assert.equal(draws(v)[0].args[0].origin, null, 'a prompt without fields is not bound');
});

// R51 (Opus, MAALT i Chrome): paa en side med CSP sandbox er sender.origin "null"; svaret blev tabt, og agenten fik
// timeout, selvom brugeren havde svaret. Bindingen gaelder adressen.
test('an answer from a sandboxed page on the right address counts', async () => {
  const u = browser({ startUrl: 'https://raw.example/notes.txt' });
  const a = await ask(u, { fields: [{ name: 'code', label: 'Code' }] });
  const svar = { type: 'ask_user_answer', askId: a.askId, action: 'done', values: { code: '482913' } };
  await u.fyr('runtime.onMessage', svar, fromPrompt(u, a.tabId, 'null', 'https://evil.example/x'));
  await tick();
  assert.equal(a.settled(), false, 'a sandboxed page on another address answered');
  await u.fyr('runtime.onMessage', svar, fromPrompt(u, a.tabId, 'null', 'https://raw.example/notes.txt'));
  assert.deepEqual(plain((await a.pending).values), { code: '482913' }, 'the answer from the sandboxed page was lost');
});

// R52 (Astra, MAALT): alle lokale filer delte bindingen "file://". En lokal fil binder nu til sin egen adresse.
test('a prompt with fields on a local file is bound to that file', async () => {
  const u = browser({ startUrl: 'file:///trusted/private-form.html' });
  const a = await ask(u, { fields: [{ name: 'code', label: 'Code' }] });
  assert.equal(draws(u)[0].args[0].origin, 'file:///trusted/private-form.html');
  const svar = { type: 'ask_user_answer', askId: a.askId, action: 'done', values: { code: 'LOCAL-CODE' } };
  await u.fyr('runtime.onMessage', svar, fromPrompt(u, a.tabId, 'file://', 'file:///Downloads/unrelated.html'));
  await tick();
  assert.equal(a.settled(), false, 'another local file answered the prompt');
  await u.fyr('webNavigation.onDOMContentLoaded', { tabId: a.tabId, frameId: 0, url: 'file:///Downloads/unrelated.html' });
  assert.equal((await a.pending).action, 'navigated', 'the prompt followed the tab to another local file');
});

// R52 (Opus): en fane, Chrome stadig rapporterer med url '' og en pendingUrl, maatte ogsaa faa en prompt med felter -
// bundet til den adresse, den er paa vej til. Ingen proeve daekkede det.
test('a tab that is still loading is bound to its pendingUrl', async () => {
  const u = browser({ startUrl: '', startPending: 'https://bank.example/login' });
  const a = await ask(u, { fields: [{ name: 'code', label: 'Code' }] });
  assert.equal(draws(u)[0].args[0].origin, 'https://bank.example');
  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: a.askId, action: 'skip', values: {} }, fromPrompt(u, a.tabId, 'https://bank.example'));
  assert.equal((await a.pending).action, 'skip');
});

// R57 (Opus, maalt i Chrome 9/10): paa en fejlside kastede kaldet Chromes raa tekst «Frame with ID 0 is showing error page»,
// efter at fanen var aktiveret og en notifikation oprettet, som aldrig blev ryddet. Det samme paa about:blank.
const vistForBrugeren = (u) => ({
  aktiveret: u.optager.til('tabs.update').filter((k) => k.args[1]?.active).length,
  notifikationer: u.optager.antal('notifications.create'),
  udraabstegn: u.optager.til('action.setBadgeText').filter((k) => k.args[0]?.text === '!').length,
  tegninger: draws(u).length,
});
const intet = { aktiveret: 0, notifikationer: 0, udraabstegn: 0, tegninger: 0 };

for (const felter of [[], [{ name: 'code', label: 'Code' }]]) {
  test(`Chrome's error page answers with a clear error and shows nothing (${felter.length ? 'with' : 'without'} fields)`, async () => {
    const u = browser({ startUrl: 'http://ukendt-vaert.invalid/side?token=hemmelig',
      ekstra: { 'webNavigation.getAllFrames': [{ frameId: 0, parentFrameId: -1, errorOccurred: true, url: 'http://ukendt-vaert.invalid/side' }] } });
    await assert.rejects(u.hent('dispatch')(9876, 'ask_user', { message: 'code?', fields: felter }), (e) => {
      assert.match(e.message, /^The tab shows Chrome's error page: http:\/\/ukendt-vaert\.invalid\/side did not load/);
      assert.match(e.message, /Nothing was shown to the user\.$/);
      assert.doesNotMatch(e.message, /hemmelig/, 'the query string is not repeated in the error');
      return true;
    });
    assert.deepEqual(vistForBrugeren(u), intet);
    assert.equal(u.hent('pendingAsks').size, 0);
  });
}

test('a page that loaded is not taken for an error page', async () => {
  const u = browser({ ekstra: { 'webNavigation.getAllFrames': [{ frameId: 0, errorOccurred: false }, { frameId: 3, errorOccurred: true }] } });
  const a = await ask(u);
  assert.equal(vistForBrugeren(u).notifikationer, 1);
  await u.fyr('runtime.onMessage', { type: 'ask_user_answer', askId: a.askId, action: 'done', values: {} }, fromPrompt(u, a.tabId, 'https://app.example'));
  assert.equal(plain(await a.pending).action, 'done');
});

for (const adresse of ['about:blank', 'chrome-extension://abc/side.html', '']) {
  test(`a question without fields on ${adresse || 'an empty tab'} is refused before anything is shown`, async () => {
    const u = browser({ startUrl: adresse });
    await assert.rejects(u.hent('dispatch')(9876, 'ask_user', { message: 'Done?' }), /where the extension cannot draw/);
    assert.deepEqual(vistForBrugeren(u), intet);
  });
}

test('the error page appearing while the prompt is drawn gives the same clear error, and the notification is cleared after it exists', async () => {
  let oprettet = false;
  let ryddetEfterOprettelse = null;
  const u = browser({ drawFails: 'Frame with ID 0 is showing error page', ekstra: {
    'notifications.create': () => new Promise((r) => setTimeout(() => { oprettet = true; r('id'); }, 40)),
    'notifications.clear': () => { ryddetEfterOprettelse = oprettet; return true; },
  } });
  await assert.rejects(u.hent('dispatch')(9876, 'ask_user', { message: 'Done?' }), (e) => {
    assert.match(e.message, /^The tab shows Chrome's error page/);
    // R61 (Astra): her var fanen allerede aktiveret og notifikationen oprettet, saa «Nothing was shown» ville vaere usandt.
    assert.doesNotMatch(e.message, /Nothing was shown/);
    assert.match(e.message, /had already been made active and a notification posted/);
    return true;
  });
  for (let i = 0; i < 20 && ryddetEfterOprettelse === null; i++) await tick(10);
  assert.equal(ryddetEfterOprettelse, true, 'the notification was cleared before it existed, so it stayed up');
});

// R57: teksterne lover det, koden ovenfor goer - og intet om at hente Chrome frem, for det goer koden ikke.
test('the texts say what ask_user does on an error page and with windows, on every surface', async () => {
  const { readFileSync } = await import('node:fs');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const { join } = await import('node:path');
  const flader = {
    'mcp-server/tools.js': /on Chrome\\'s error page or about:blank the call fails at once and shows nothing\. It makes the tab the active one in its window and restores a minimized window, but it does not bring Chrome in front of other apps\./,
    'README.md': /on Chrome's error page or about:blank it fails at once and shows nothing\. It makes the tab active and restores a minimized window, but does not bring Chrome in front of other apps\./,
    'mcp-server/README.md': /on Chrome's error page or about:blank it fails at once and shows nothing\. It makes the tab active and restores a minimized window, but does not bring Chrome in front of other apps\./,
    'content/browsermcp-docs-tools.md': /on Chrome's error page or about:blank it fails at once and shows nothing\./,
  };
  for (const [f, r] of Object.entries(flader)) assert.match(readFileSync(join(ROD, f), 'utf8'), r, f);
  const bg = readFileSync(join(ROD, 'extension/background.js'), 'utf8');
  const kode = (s) => s.replace(/\/\/.*$/gm, '');   // kommentarer naevner det, koden ikke maa goere
  const ask = kode(bg.slice(bg.indexOf("case 'ask_user': {"), bg.indexOf("case 'select_frame': {")));
  assert.doesNotMatch(ask, /focused:\s*true/, 'ask_user brings Chrome forward, so the texts are wrong');
  const aktiv = kode(bg.slice(bg.indexOf('async function getSessionTab'), bg.indexOf('// ── Chrome Debugger API Helpers')));
  assert.match(aktiv, /state === 'minimized'/);
  assert.doesNotMatch(aktiv, /focused:\s*true/);
});
