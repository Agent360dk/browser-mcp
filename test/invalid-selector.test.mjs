/**
 * A selector that is not valid CSS is answered as invalid-selector - not as "not found", and never as a bare null.
 *
 * MEASURED 2026-10-22 on login.yahoo.com and demo/invalid-selector on main f42f8ea: an agent wrote
 * `input[name="appName"], input[placeholder="App name"], text=App name`. text= is a text selector only as the whole
 * string, so this went to querySelector, which throws on it. In Chrome a page function that throws gives
 * executeScript an empty result, and CDP's DOM.querySelector fails. The answers were:
 *   fill  -> null              (the fallback's empty result was returned as the answer)
 *   click -> "Element not found: ..."
 *   wait  -> { found: false }, after the whole timeout
 * The stub below behaves like that page: every lookup with the invalid selector throws or comes back empty.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const UGYLDIG = 'input[name="appName"], input[placeholder="App name"], text=App name';
const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };

function side() {
  const kald = { gyldighed: 0 };
  const svar = (v) => ({ result: { value: v } });
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    // A page function that throws: Chrome resolves with no result (measured: fill answered null).
    'scripting.executeScript': () => [{ result: undefined }],
    'debugger.sendCommand': (_m, metode, p = {}) => {
      const x = String(p.expression || '');
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') {
        if (/text=/.test(p.selector)) throw new Error('DOM Error while querying');
        return { nodeId: 0 };
      }
      if (metode === 'Runtime.evaluate') {
        if (x.includes('window.__bmcpVagt = v')) return svar({ armet: true });
        if (x.includes('createDocumentFragment')) {
          kald.gyldighed++;
          return svar(/text=/.test(x) ? `Failed to execute 'querySelector' on 'DocumentFragment': '${UGYLDIG}' is not a valid selector.` : null);
        }
        if (/text=/.test(x) && x.includes('querySelector')) {
          return { exceptionDetails: { text: 'Uncaught', exception: { description: `SyntaxError: '${UGYLDIG}' is not a valid selector.` } } };
        }
        return svar(null);
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, kald, dispatch: (cmd, params) => u.hent('dispatch')(9876, cmd, params) };
}

function erUgyldig(svar) {
  assert.ok(svar, `the answer was ${JSON.stringify(svar)}`);
  assert.equal(svar.error, 'invalid-selector', `the cause was not named: ${JSON.stringify(svar)}`);
  assert.match(svar.note, /comma-separated list/, 'the note does not say text= cannot be one entry of a list');
  assert.match(String(svar.detail), /not a valid selector/);
}

test('fill with a selector list that includes text= answers invalid-selector, not a bare null', async () => {
  const { dispatch } = side();
  const svar = await dispatch('fill', { selector: UGYLDIG, value: 'Claude IMAP MCP' });
  erUgyldig(svar);
  assert.equal(svar.ok, false);
});

test('click with the same selector answers invalid-selector, not "Element not found"', async () => {
  const { dispatch } = side();
  erUgyldig(await dispatch('click', { selector: UGYLDIG }));
});

test('wait with the same selector answers at once, not after its timeout', async () => {
  const { dispatch } = side();
  const start = Date.now();
  const svar = await dispatch('wait', { selector: UGYLDIG, timeout: 3000 });
  const brugt = Date.now() - start;
  assert.equal(svar.found, false);
  erUgyldig(svar);
  assert.ok(brugt < 1500, `wait used ${brugt} ms of its 3000 ms timeout on a selector that can never match`);
});

test('set_date with the same selector answers invalid-selector, not a bare "Uncaught"', async () => {
  // Measured in Chrome after the first round of this fix: the date lookup threw before any "not found" answer.
  const { dispatch } = side();
  let svar;
  try {
    svar = await dispatch('set_date', { selector: 'input[type=date], text=Date', date: '2026-10-22' });
  } catch (e) {
    assert.fail(`set_date threw: ${e.message}`);
  }
  erUgyldig(svar);
});

test('a valid selector that matches nothing is still "Element not found", and only then is validity asked', async () => {
  const { dispatch, kald } = side();
  const svar = await dispatch('click', { selector: '#missing' });
  assert.equal(svar.error, 'Element not found: #missing', JSON.stringify(svar));
  assert.equal(kald.gyldighed, 1, 'the validity check ran more or less than once for an empty lookup');
});
