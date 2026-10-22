/**
 * `text=` does not match the source of <script>, <style>, <noscript> or <template>: runs the real klikMaal against
 * test/hjaelp/klik-dom.mjs.
 *
 * MEASURED 2026-10-22 on demo/text-selector-script with main f42f8ea: a <script> whose source mentioned a label was
 * picked as the target, and click answered "Element found but not visible (0x0)", tag SCRIPT - for a label that was
 * not on the page at all. textContent includes the source of those elements; it is no text a user can see.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { lavKlikDom } from './hjaelp/klik-dom.mjs';

const KILDE = indlaesUdvidelse().hent('klikMaal').toString();
const elementFor = (d, tekst, tag = null) => d.koer(KILDE, null, tekst, tag, false, true).svar;
const navn = (el) => el && (el.tagName + (el.id ? '#' + el.id : ''));

test('a label that is only in a <script> is not found', () => {
  const d = lavKlikDom();
  d.el('p', { tekst: 'Account settings', rect: [20, 20, 200, 20] });
  d.el('script', { tekst: "window.i18n = { deleteAccount: 'Delete account' };" });
  const el = elementFor(d, 'Delete account');
  assert.equal(el, null, `text= matched the page's source: ${navn(el)}`);
});

test('a label that is only in a <style> or a <noscript> is not found', () => {
  const d = lavKlikDom();
  d.el('style', { tekst: '/* Export data button */ .export { color: red }' });
  d.el('noscript', { tekst: 'Enable JavaScript to Continue' });
  assert.equal(elementFor(d, 'Export data'), null, 'text= matched a <style>');
  assert.equal(elementFor(d, 'Continue'), null, 'text= matched a <noscript>');
});

test('a <script> inside a container does not make the container match', () => {
  // Without the script the container's text is "Account settings"; with it, textContent also has "Delete account".
  const d = lavKlikDom();
  const box = d.el('div', { id: 'box', rect: [0, 0, 600, 400] });
  d.el('p', { tekst: 'Account settings', rect: [20, 20, 200, 20] }, box);
  d.el('script', { tekst: "track('Delete account')" }, box);
  const el = elementFor(d, 'Delete account');
  assert.equal(el, null, `text= matched ${navn(el)} through the script inside it`);
});

test('a label on the page is still found when a <script> mentions it too', () => {
  const d = lavKlikDom();
  d.el('script', { tekst: "const label = 'Delete account';" });
  d.el('button', { id: 'del', tekst: 'Delete account', rect: [20, 20, 160, 30] });
  assert.equal(elementFor(d, 'Delete account')?.id, 'del');
});

test('a button with a <script> inside it is found by its visible text', () => {
  // The walk over text nodes keeps everything outside the script.
  const d = lavKlikDom();
  const knap = d.el('button', { id: 'save', tekst: 'Save', rect: [20, 20, 160, 30] });
  d.el('script', { tekst: "log('rendered')" }, knap);
  assert.equal(elementFor(d, 'Save')?.id, 'save', 'the script inside the button hid its own label');
});
