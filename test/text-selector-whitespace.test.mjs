/**
 * `text=` and `tag:text()` against labels whose spaces are not plain spaces: runs the real klikMaal against
 * test/hjaelp/klik-dom.mjs.
 *
 * MEASURED 2026-10-22 on login.yahoo.com (English UI) and demo/text-selector-whitespace on main f42f8ea: Yahoo writes
 * its labels with a no-break space before the last word - "Create app password", "Generate password",
 * "Change password". `text=Create app password` and `button:text(Generate password)` answered
 * "Element not found" while the buttons were on screen. A label broken over two lines in the HTML source, or with a
 * tab in it, failed the same way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { lavKlikDom } from './hjaelp/klik-dom.mjs';

const KILDE = indlaesUdvidelse().hent('klikMaal').toString();
const elementFor = (d, tekst, tag = null) => d.koer(KILDE, null, tekst, tag, false, true).svar;

test('a label with a no-break space is found by text= written with a plain space (Yahoo)', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'change', tekst: 'Change password', rect: [20, 20, 160, 30] });
  d.el('button', { id: 'create', tekst: 'Create app password', rect: [20, 80, 180, 30] });
  const el = elementFor(d, 'Create app password');
  assert.ok(el, 'text=Create app password found nothing: the label has a no-break space');
  assert.equal(el.id, 'create');
});

test('button:text() finds a label with a no-break space in a dialog (Yahoo)', () => {
  const d = lavKlikDom();
  const dlg = d.el('div', { id: 'dlg', attrs: { role: 'dialog' }, rect: [400, 300, 400, 200], lag: 10 });
  d.el('span', { tekst: 'App name', rect: [420, 320, 100, 20] }, dlg);
  d.el('button', { id: 'generate', tekst: 'Generate password', rect: [420, 420, 360, 40] }, dlg);
  const el = elementFor(d, 'Generate password', 'button');
  assert.ok(el, 'button:text(Generate password) found nothing');
  assert.equal(el.id, 'generate');
});

test('any run of whitespace counts as one space, in the label and in the selector', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'save', tekst: 'Save\n            changes', rect: [20, 20, 160, 30] });
  d.el('button', { id: 'tab', tekst: 'Open\tfile', rect: [20, 80, 160, 30] });
  assert.equal(elementFor(d, 'Save changes')?.id, 'save', 'a label broken over two source lines was not found');
  assert.equal(elementFor(d, 'Open  file')?.id, 'tab', 'a double space in the selector did not match a tab in the label');
});

test('an exact label still beats a longer one that only contains it', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'all', tekst: 'Save all', rect: [20, 20, 160, 30] });
  d.el('button', { id: 'one', tekst: 'Save', rect: [20, 80, 160, 30] });
  assert.equal(elementFor(d, 'Save')?.id, 'one', 'text=Save took the partial match over the exact one');
  assert.equal(elementFor(d, 'Save all')?.id, 'all', 'text=Save all did not find "Save\\u00a0all"');
});

test('what is not whitespace is not touched: zero-width space, letter case', () => {
  // Kept as before on purpose (see the PR): U+200B is not whitespace in JavaScript, and case still matters.
  const d = lavKlikDom();
  d.el('button', { id: 'zw', tekst: 'Sign​in', rect: [20, 20, 160, 30] });
  d.el('button', { id: 'up', tekst: 'Submit', rect: [20, 80, 160, 30] });
  assert.equal(elementFor(d, 'Sign in'), null, 'a zero-width space was taken as a space');
  assert.equal(elementFor(d, 'submit'), null, 'text= became case-insensitive');
});
