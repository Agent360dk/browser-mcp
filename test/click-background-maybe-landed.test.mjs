/**
 * A script click in a background tab whose effect cannot be seen at once is "maybe landed" - not a failure that asks
 * to be repeated.
 *
 * MEASURED 2026-10-22 on developer.apple.com (contact form, expedite review) and demo/click-background-submit with
 * main f42f8ea: the tab was in the background, CDP's mouse event timed out before the press, and the script fallback
 * clicked Send. The form showed its spinner a moment later and the request went through - but the fallback measures the
 * page in the same instant as the click, saw no change, and click answered
 *   { ok: false, landed: false, maybe_landed: true, error: "CDP did not respond ... call browser_switch_tab and try again" }
 * Clicking again, as an agent does on ok:false, sent the form a second time.
 *
 * The neighbouring branch (debugger blocked) answers the same unproven case { ok: true, landed: null, maybe_landed: true }
 * on purpose (klik-reserve-aerlighed.test.mjs: "uvist er ikke det samme som mislykket").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele({ skriptKlik }) {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane,
    'tabs.query': [fane],
    'tabs.update': undefined,
    'windows.update': undefined,
    'debugger.sendCommand': () => ({ result: { value: null } }),
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'INPUT', text: '' });
  // Exactly the error from the Apple measurement: the mouse move timed out before the press was sent.
  u.ctx.debuggerClick = async () => {
    const e = new Error('CDP did not respond within 1500 ms: Input.dispatchMouseEvent (the tab is probably in the background - ' +
      'Chrome does not deliver mouse or keyboard input to a tab that is not active; call browser_switch_tab and try again.)');
    e.cdpFrist = true;
    throw e;
  };
  u.ctx.scriptingClick = async () => skriptKlik;
  return u;
}

test('background tab: a script click with no visible effect yet is not answered ok:false', async () => {
  const u = sele({ skriptKlik: { ok: true, tag: 'INPUT', landed: false, detached: false } });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#contactForm_saveButton' });
  assert.notEqual(svar.ok, false, `an unproven click was answered as a failure - the agent clicks again and submits twice: ${JSON.stringify(svar)}`);
  assert.equal(svar.maybe_landed, true, 'the answer does not say the click may have landed');
  assert.equal(svar.landed, null, 'no change at the moment of the click is no proof that nothing happened');
});

test('background tab: the answer does not tell the agent to try again', async () => {
  const u = sele({ skriptKlik: { ok: true, tag: 'INPUT', landed: false, detached: false } });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#contactForm_saveButton' });
  assert.equal(svar.error, undefined, `the answer still carries an error: ${svar.error}`);
  assert.match(svar.note, /check the page before clicking again/i);
  assert.match(svar.note, /submit twice/i, 'the note does not name the risk of a second click');
});

test('background tab: a script click with a visible effect is still plain success', async () => {
  const u = sele({ skriptKlik: { ok: true, tag: 'INPUT', landed: true, detached: false } });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#contactForm_saveButton' });
  assert.equal(svar.ok, true);
  assert.equal(svar.landed, true);
  assert.notEqual(svar.maybe_landed, true);
});
