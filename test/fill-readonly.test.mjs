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
import vm from 'node:vm';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };

function side({ readOnly = false, disabled = false, value = '', landerTrodsReadonly = false } = {}) {
  const s = { value, input: [] };
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
        // R50: rydningen med setteren springer readonly/disabled over - modellen goer det samme som siden.
        if (x.includes("setter.call(el, '')")) { if (!readOnly && !disabled) s.value = ''; return svar(!readOnly && !disabled); }
        if (x.includes('readOnly')) return svar(disabled ? 'disabled' : readOnly ? 'readonly' : null);
        if (x.includes('_valueTracker')) return svar({ v: s.value, ramme: null });
        if (x.includes('activeElement')) return svar(s.value);
        return svar(null);
      }
      if (metode === 'Input.insertText' || metode === 'Input.dispatchKeyEvent') {
        s.input.push(metode);
        if (metode === 'Input.insertText' && ((!readOnly && !disabled) || landerTrodsReadonly)) s.value += p.text;
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, s };
}

// R50 (Opus, MAALT i Chrome): «types nothing» laaste netop regressionen fast - Ant Design 5's soegefelter og
// anti-autofill-felter er readonly, indtil de faar fokus, og blev afvist foer der blev skrevet. Nu: ingen Backspace,
// vaerdien bevaret, og field-is-readonly naar teksten ikke landede.
test('fill on a readonly field answers field-is-readonly, sends no Backspace and keeps the value', async () => {
  const { u, s } = side({ readOnly: true });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#search', value: 'Child' });
  assert.equal(svar.ok, false);
  assert.equal(svar.error, 'field-is-readonly', `wrong cause given: ${JSON.stringify(svar)}`);
  assert.doesNotMatch(String(svar.note), /switch_tab|background/, 'a readonly field is not a background tab');
  assert.ok(!s.input.includes('Input.dispatchKeyEvent'), `Backspace or keys were sent into a readonly field: ${s.input.join(',')}`);
  assert.equal(s.value, '');
  const fast = side({ readOnly: true, value: 'fixed' });
  const svar2 = await fast.u.hent('dispatch')(9876, 'fill', { selector: '#fixed', value: 'new' });
  assert.equal(svar2.error, 'field-is-readonly', JSON.stringify(svar2));
  assert.equal(fast.s.value, 'fixed', '875b160 deleted the value of a readonly field');
});

test('a field that is readonly until it gets focus (Ant Design 5, anti-autofill) still takes the text', async () => {
  const { u, s } = side({ readOnly: true, landerTrodsReadonly: true });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#search', value: 'your' });
  assert.equal(svar.ok, true, `a field that took the text was refused as read-only: ${JSON.stringify(svar)}`);
  assert.equal(s.value, 'your');
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
  assert.equal(s.value, '', 'the readonly field changed');
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

// R50 (Astra): stubben afgjorde svaret ud fra om udtrykket INDEHOLDT «readOnly», saa `if (false && el.readOnly)`
// overlevede. Her koeres det rigtige udtryk mod et felt.
test('the field probe is run, not read: readonly, disabled, fieldset-disabled and the focused element', () => {
  const u = indlaesUdvidelse();
  const koer = (maal, fokus, selector) => vm.runInNewContext(u.hent('fieldBlockedExpression')(selector),
    { document: { querySelector: () => maal, activeElement: fokus } });
  assert.equal(koer({ value: '', readOnly: true }, { value: '', disabled: true }, '#f'), 'readonly');
  assert.equal(koer({ value: '', readOnly: true }, { value: '', disabled: true }, null), 'disabled', 'without a selector it checks the focused element');
  assert.equal(koer({ value: '', readOnly: true, disabled: true }, null, '#f'), 'disabled');
  assert.equal(koer({ value: '', matches: (q) => q === ':disabled' }, null, '#f'), 'disabled', 'a field inside <fieldset disabled> is disabled (R50, Opus)');
  assert.equal(koer({ value: '' }, null, '#f'), null);
  assert.equal(koer(null, null, '#f'), null);
});

test('only the two exact blocked values stop the fill', async () => {
  const u = indlaesUdvidelse();
  for (const x of [null, undefined, false, true, '', 'normal', { blocked: true }]) {
    u.ctx.debuggerEval = async () => x;
    assert.equal(await u.hent('fieldBlocked')(1, '#f'), null, `${JSON.stringify(x)} counted as blocked`);
  }
  for (const x of ['readonly', 'disabled']) {
    u.ctx.debuggerEval = async () => x;
    assert.equal(await u.hent('fieldBlocked')(1, '#f'), x);
    assert.equal(u.hent('fieldBlockedAnswer')(x, 'debugger').error, 'field-is-' + x);
  }
});

// R50 (Astra, MAALT): faldt debuggeren ud foer proben, skrev reservevejen med setteren i et readonly-felt og
// svarede ok:true. Reservevejens rigtige funktion koeres mod et felt.
test('the fallback does not write into a readonly or disabled field', async () => {
  for (const [felt, fejl] of [[{ readOnly: true, disabled: false }, 'field-is-readonly'], [{ readOnly: false, disabled: true }, 'field-is-disabled']]) {
    const tab = { id: 1, url: 'https://example.test', windowId: 1 };
    const el = { value: 'OLD', tagName: 'INPUT', ...felt, scrollIntoView() {}, focus() {}, dispatchEvent() {} };
    class Input {}
    Object.defineProperty(Input.prototype, 'value', { set(v) { this.v = v; } });
    const sidens = vm.createContext({ document: { querySelector: () => el }, HTMLInputElement: Input, HTMLTextAreaElement: Input, Event: class {} });
    const u = indlaesUdvidelse({ svar: { 'tabs.get': tab, 'tabs.query': [tab] } });
    u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 7, label: 't', color: 'blue' });
    u.ctx.debuggerEval = async () => { throw new Error('Debugger attach failed'); };
    u.ctx.safeExecuteScript = async (_t, fn, args) => { sidens.args = args; return { result: vm.runInContext('(' + fn.toString() + ')(...args)', sidens) }; };
    const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'NEW' });
    assert.equal(svar.error, fejl, JSON.stringify(svar));
    assert.equal(el.value, 'OLD', 'the fallback wrote into the field');
  }
});
