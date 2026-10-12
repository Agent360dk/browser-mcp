/**
 * fill must not press Backspace in an EMPTY field.
 *
 * MEASURED 2026-10-04 (Ant Design TreeSelect, multiple mode): the search input of a
 * multi-select is empty while its chips sit next to it. Backspace in that empty input
 * deletes the last chip - the same behaviour setCombobox already guards against
 * ("Backspace on empty multi-select deletes the previous chip"). fill cleared with
 * Cmd/Ctrl+A + Backspace unconditionally, twice in the worst case:
 *   - searchable input: fill answered ok:true with the typed text, and the chip was gone
 *   - readonly input:   insertText did not land, the retry cleared again, fill answered
 *                       field-is-empty - and the chip was gone anyway
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };

// A multi-select search input with chips next to it. Backspace in the empty input
// removes the last chip, like Ant Design / react-select / MUI Autocomplete.
function side({ value = '', readOnly = false, chips = ['my leaf'] } = {}) {
  const s = { value, readOnly, chips: [...chips], allSelected: false, backspaces: 0 };
  const svar = (v) => ({ result: { value: v } });
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    'debugger.sendCommand': (_m, metode, p = {}) => {
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      if (metode === 'Runtime.evaluate') {
        const x = p.expression || '';
        if (x.includes('isContentEditable')) return svar(false);
        if (x.includes('_valueTracker')) return svar({ v: s.value, ramme: null });
        if (x.includes('setter')) { s.value = ''; return svar(true); }
        if (x.includes('activeElement')) return svar(s.value);
        return svar(null);
      }
      if (metode === 'Input.insertText') { if (!s.readOnly) s.value += p.text; return {}; }
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyDown') {
        if (p.key === 'a' && p.modifiers) { s.allSelected = s.value !== ''; return {}; }
        if (p.key === 'Backspace') {
          s.backspaces++;
          if (s.value === '') s.chips.pop();
          else if (s.allSelected) s.value = '';
          else s.value = s.value.slice(0, -1);
          s.allSelected = false;
          return {};
        }
        if (p.text && !s.readOnly) s.value += p.text;
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, s };
}

test('fill in an empty searchable multi-select keeps the existing chip', async () => {
  const { u, s } = side();
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#search', value: 'your' });
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(s.value, 'your');
  assert.deepEqual(s.chips, ['my leaf'], `fill deleted a chip (${s.backspaces} Backspace on an empty field)`);
});

test('fill in an empty readonly multi-select keeps the existing chip', async () => {
  const { u, s } = side({ readOnly: true, chips: ['Child 1-1'] });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#search', value: 'Child' });
  assert.equal(svar.ok, false, 'nothing landed, so this is still a failure');
  assert.deepEqual(s.chips, ['Child 1-1'], `fill deleted a chip (${s.backspaces} Backspace on an empty field)`);
});

test('fill still replaces old text in a field that has some', async () => {
  const { u, s } = side({ value: 'old', chips: [] });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'new' });
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(s.value, 'new', 'the old text has to be cleared before writing');
});

// R50 (Astra): kun en vaerdi der er KENDT tom springer rydningen over; en ulaeselig vaerdi ryddes som foer.
test('only a field known to be empty skips the clearing; unreadable and filled fields are cleared', async () => {
  const u = indlaesUdvidelse();
  let ryddet = 0;
  u.ctx.clearFieldAttached = async () => { ryddet++; };
  for (const v of ['', null, 'old']) {
    u.ctx.evalAttached = async () => v;
    await u.hent('clearFieldIfFilledAttached')(1);
  }
  assert.equal(ryddet, 2, "'' must skip, null and 'old' must clear");
  u.ctx.evalAttached = async () => { throw new Error('unreadable'); };
  await u.hent('clearFieldIfFilledAttached')(1);
  assert.equal(ryddet, 3, 'an unreadable field must be cleared as before');
});
