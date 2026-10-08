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

function browser({ drawFails = null } = {}) {
  const tabs = new Map();
  let next = 100;
  let u;
  u = indlaesUdvidelse({ svar: {
    'tabs.create': ({ url }) => {
      const t = { id: next++, url, title: url, windowId: 1, active: false, status: 'complete' };
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

const fromPrompt = (u, tabId) => ({ id: u.chrome.runtime.id, tab: { id: tabId } });

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
  const u = browser();
  const a = await ask(u, { fields: [{ name: 'code', label: '2FA code' }] });
  assert.deepEqual(plain(draws(u)[0].args[0].fields), [{ name: 'code', label: '2FA code', type: 'text' }]);
  await u.fyr('runtime.onMessage',
    { type: 'ask_user_answer', askId: a.askId, action: 'done', values: { code: 123456, extra: 'x' } }, fromPrompt(u, a.tabId));
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
