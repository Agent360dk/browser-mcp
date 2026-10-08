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

function browser({ drawFails = null, startUrl = null } = {}) {
  const tabs = new Map();
  let next = 100;
  let u;
  u = indlaesUdvidelse({ svar: {
    'tabs.create': ({ url }) => {
      const t = { id: next++, url: startUrl || url, title: url, windowId: 1, active: false, status: 'complete' };
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

const fromPrompt = (u, tabId, origin) => ({ id: u.chrome.runtime.id, tab: { id: tabId }, origin });

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
