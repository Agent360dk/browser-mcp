/**
 * fill on a field that cannot take text says so - and types nothing.
 *
 * MEASURED 2026-10-04 (Ant Design TreeSelect, multiple, no showSearch): the search input is
 * readonly. fill typed into it, saw nothing land and answered field-is-empty with "the tab is
 * probably in the background ... call browser_switch_tab". The tab was in front; after
 * switch_tab the same call gave the same answer. The agent was sent after the wrong cause.
 * The text-selector branch also carried Danish in the same note ("er i baggrunden, hvor"),
 * which the oe/ae/aa guard in intet-dansk-i-svar cannot see.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };

function side({ readOnly = false, disabled = false } = {}) {
  const s = { value: '', input: [] };
  const svar = (v) => ({ result: { value: v } });
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    'scripting.executeScript': () => [{ result: { x: 10, y: 10, tag: 'INPUT', found: true } }],
    'debugger.sendCommand': (_m, metode, p = {}) => {
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      if (metode === 'Runtime.evaluate') {
        const x = p.expression || '';
        if (x.includes('getBoundingClientRect')) return svar({ x: 10, y: 10, tag: 'INPUT', found: true });
        if (x.includes('isContentEditable')) return svar(false);
        if (x.includes('readOnly')) return svar(disabled ? 'disabled' : readOnly ? 'readonly' : null);
        if (x.includes('_valueTracker')) return svar({ v: s.value, ramme: null });
        if (x.includes('activeElement')) return svar(s.value);
        return svar(null);
      }
      if (metode === 'Input.insertText' || metode === 'Input.dispatchKeyEvent') {
        s.input.push(metode);
        if (metode === 'Input.insertText' && !readOnly && !disabled) s.value += p.text;
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, s };
}

test('fill on a readonly field answers field-is-readonly and types nothing', async () => {
  const { u, s } = side({ readOnly: true });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#search', value: 'Child' });
  assert.equal(svar.ok, false);
  assert.equal(svar.error, 'field-is-readonly', `wrong cause given: ${JSON.stringify(svar)}`);
  assert.doesNotMatch(String(svar.note), /switch_tab|background/, 'a readonly field is not a background tab');
  assert.deepEqual(s.input, [], `keys were sent into a readonly field: ${s.input.join(',')}`);
});

test('fill on a disabled field answers field-is-disabled', async () => {
  const { u } = side({ disabled: true });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'x' });
  assert.equal(svar.error, 'field-is-disabled', JSON.stringify(svar));
});

test('fill on a normal field is unchanged', async () => {
  const { u, s } = side();
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'abc' });
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(s.value, 'abc');
});

test('the text-selector branch also names a readonly field, in English', async () => {
  const { u, s } = side({ readOnly: true });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Search', value: 'x' });
  assert.equal(svar.error, 'field-is-readonly', JSON.stringify(svar));
  assert.ok(!s.input.includes('Input.dispatchKeyEvent'), 'keys were sent into a readonly field');
});

test('the text-selector empty-field note is English', async () => {
  const { u } = side();
  // Keys are acknowledged but nothing lands (background tab): the generic empty-field note.
  u.chrome.debugger.sendCommand = async (_m, metode, p = {}) => {
    if (metode === 'Runtime.evaluate') {
      const x = p.expression || '';
      if (x.includes('getBoundingClientRect')) return { result: { value: { x: 10, y: 10, tag: 'INPUT', found: true } } };
      if (x.includes('readOnly')) return { result: { value: null } };
      if (x.includes('activeElement')) return { result: { value: '' } };
      return { result: { value: null } };
    }
    return {};
  };
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Search', value: 'x' });
  assert.equal(svar.error, 'field-is-empty', JSON.stringify(svar));
  assert.doesNotMatch(svar.note, /\ber i\b|baggrunden|hvor/, `Danish in the note: ${svar.note}`);
});
