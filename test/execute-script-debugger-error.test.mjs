/**
 * Code that ran through the debugger and threw is answered with its own error - not under a pile of CSP refusals.
 *
 * MEASURED 2026-10-22 on login.yahoo.com and demo/execute-script-error (a page whose CSP has no 'unsafe-eval'):
 * `[...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Generate password').click()` found no
 * button (the label has a no-break space) and threw a TypeError. Both scripting worlds refuse `new Function` there, so
 * the code ran through the debugger - and the answer was the TypeError followed by "| scripting-diag: {...}" with
 * two long CSP 'unsafe-eval' messages, which read as the cause. In the scripting worlds the same case is answered
 * { ok: false, error, name, method, note }.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const CSP = "Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: script-src 'self' 'unsafe-inline'";
const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };

function side() {
  const kald = { cdp: 0 };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    // Both worlds: the code cannot be compiled, so it never ran there (as measured in Chrome).
    'scripting.executeScript': (o) => [{ result: { __kompilering: true, message: CSP, name: 'EvalError', world: o.world } }],
    'debugger.sendCommand': (_m, metode) => {
      if (metode === 'Runtime.evaluate') {
        kald.cdp++;
        return { exceptionDetails: { text: 'Uncaught', exception: {
          description: "TypeError: Cannot read properties of undefined (reading 'click')\n    at <anonymous>:1:113" } } };
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, kald };
}

test('the error of code that ran through the debugger is the answer, without the CSP diagnostics', async () => {
  const { u, kald } = side();
  const code = "(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Generate password'); b.click(); })()";
  let svar;
  try {
    svar = await u.hent('dispatch')(9876, 'execute_script', { code });
  } catch (e) {
    assert.fail(`execute_script threw instead of answering: ${String(e.message).slice(0, 200)}`);
  }
  assert.equal(svar.ok, false);
  assert.match(svar.error, /^TypeError: Cannot read properties of undefined \(reading 'click'\)/);
  assert.equal(svar.name, 'TypeError');
  assert.equal(svar.method, 'debugger');
  assert.doesNotMatch(JSON.stringify(svar), /unsafe-eval|scripting-diag/, 'the CSP refusals of paths that did not run the code are still in the answer');
  assert.equal(kald.cdp, 1, 'code that ran and threw was run again');
});
