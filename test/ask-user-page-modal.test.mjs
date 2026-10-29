/**
 * ask_user's prompt against a page that has a modal open: runs the real renderAskPrompt from
 * background.js against the small DOM in hjaelp/prompt-dom.mjs.
 *
 * MEASURED 2026-10-22 in Chrome (login.yahoo.com app passwords, and temp/ask-user-repro): Done could
 * not be clicked and ask_user ran to its timeout when
 *  - a modal set element.inert = true on every <body> child that existed when it opened (Ariakit,
 *    the dialog Yahoo uses) - the prompt had been drawn first and was one of them;
 *  - the page had a native <dialog> open with showModal(), which leaves only the dialog alive;
 *  - a page element in the top layer (a popover) lay over the card - no z-index beats it.
 * Hit-testing and inertness are the browser's; this file proves what the prompt does about them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROD } from './hjaelp/udvidelses-sele.mjs';
import { lavDom, iDom, vent } from './hjaelp/prompt-dom.mjs';

const bg = readFileSync(join(ROD, 'extension/background.js'), 'utf8');

function funktion(navn) {
  const start = bg.indexOf(`function ${navn}(`);
  assert.ok(start >= 0, `${navn} not found`);
  let d = 0, i = bg.indexOf('{', start);
  for (; i < bg.length; i++) { if (bg[i] === '{') d++; else if (bg[i] === '}' && --d === 0) break; }
  return bg.slice(start, i + 1);
}
const RENDER = funktion('renderAskPrompt');

const spec = (over = {}) => ({ askId: 'ask-1', message: 'Please log in, then click Done', title: 'Agent360 - Action Required',
  fields: [], hasFields: false, sessionLabel: 'Claude 1', position: null, deadline: Date.now() + 60000, ...over });

// The host can be anywhere now (inside a page dialog), so look for it in the whole document.
function tegn(dom = lavDom(), s = spec()) {
  iDom(RENDER, 'renderAskPrompt', dom)(s, false);
  const vaert = dom.document.documentElement.alle().find((n) => n.id === 'a360-overlay' && n.dataset.askId === s.askId);
  const knap = (tekst) => vaert.alle().find((n) => n.tagName === 'BUTTON' && n.textContent.includes(tekst));
  return { dom, vaert, knap };
}

function sideDialog(dom) {
  const d = dom.document.createElement('dialog');
  dom.document.body.appendChild(d);
  return d;
}

test('a modal that makes the rest of the page inert does not disable the prompt (Yahoo, Ariakit)', async () => {
  const { dom, vaert, knap } = tegn();
  // What Ariakit does when its dialog opens: every <body> child it finds, the prompt included.
  for (const n of dom.document.body.children) n.inert = true;
  vaert.setAttribute('aria-hidden', 'true');   // its fallback where inert is missing
  await vent();
  assert.equal(vaert.inert, false, 'the prompt stayed inert, so a click on Done goes to the page behind it');
  assert.equal(vaert.hasAttribute('aria-hidden'), false, 'the prompt stayed aria-hidden');
  knap('Done').fyr('click');
  assert.deepEqual(dom.beskeder, [{ type: 'ask_user_answer', action: 'done', values: {}, askId: 'ask-1' }]);
});

test('the prompt is in the top layer, and comes back on top of a popover the page opens later', () => {
  const { dom, vaert } = tegn();
  assert.ok(dom.document.topLayer.includes(vaert), 'the prompt is not in the top layer, so any page popover or modal is drawn over it');
  const banner = dom.document.createElement('div');
  banner.popover = 'manual';
  dom.document.body.appendChild(banner);
  banner.showPopover();
  dom.fyrVindue('toggle', banner);
  assert.equal(dom.document.topLayer.at(-1), vaert, 'a popover the page opened after the prompt covers it');
});

test('the page\'s own ::backdrop style does not tint the page behind the prompt', () => {
  // Measured in Chrome: a page rule "::backdrop { background: red }" reached the prompt's popover.
  const { vaert } = tegn();
  const css = vaert.alle().filter((n) => n.tagName === 'STYLE').map((n) => n.textContent).join('\n');
  assert.match(css, /:host::backdrop\s*\{[^}]*background:\s*transparent\s*!important/, 'nothing in the prompt overrides a page\'s ::backdrop style');
});

test('a prompt drawn while the page has a modal <dialog> open goes inside it, on top', () => {
  const dom = lavDom();
  const dialog = sideDialog(dom);
  dialog.showModal();
  const { vaert } = tegn(dom);
  assert.equal(vaert.parentNode, dialog, 'the prompt is outside the open modal, where the browser makes everything inert');
  assert.equal(dom.document.topLayer.at(-1), vaert, 'the modal is drawn over the prompt');
});

test('a modal opened after the prompt takes the prompt in, and lets it out again when it closes', () => {
  const { dom, vaert } = tegn();
  const dialog = sideDialog(dom);
  dialog.showModal();
  assert.equal(vaert.parentNode, dialog, 'the prompt stayed outside a modal opened after it');
  assert.equal(dom.document.topLayer.at(-1), vaert, 'the modal opened later is drawn over the prompt');
  dialog.close();
  assert.equal(vaert.parentNode, dom.document.body, 'the prompt stayed inside a closed dialog, which is display:none');
  assert.ok(dom.document.topLayer.includes(vaert), 'the prompt left the top layer when the dialog closed');
});

test('a page that keeps making the prompt inert: at most 20 times, and the background is told', async () => {
  const { dom, vaert } = tegn();
  let gentaget = 0;
  const fjendtlig = new dom.MutationObserver(() => { if (vaert.isConnected && !vaert.inert) { gentaget++; vaert.inert = true; } });
  fjendtlig.observe(dom.document.documentElement, { attributes: true, subtree: true });
  vaert.inert = true;
  for (let i = 0; i < 100; i++) await vent();
  fjendtlig.disconnect();
  assert.ok(dom.leveringer() < dom.LOEBSK, 'the prompt and the page took inert on and off without end');
  assert.ok(gentaget <= 21, `the prompt took inert off ${gentaget} times`);
  assert.deepEqual(dom.beskeder, [{ type: 'ask_user_lost', askId: 'ask-1' }], 'the background was not told, so the agent waits for the timeout');
});
