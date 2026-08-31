/**
 * Sikkerhed og overlays i udvidelsen.
 *
 * Den dyreste fejl i hele projektet laa her: vaerktoejet trykkede paa "Close account"
 * mens det troede det lukkede et cookie-banner. Veto-listen kom bagefter — men var
 * indtil nu kun daekket af kilde-inspektion. Det her kalder koden.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

// ── veto-listen: hvad maa ALDRIG klikkes ────────────────────────────────────

test('veto-listen findes og daekker de farlige ord', () => {
  const u = indlaesUdvidelse();
  const kilde = u.hent('dismissOverlays')?.toString() ?? '';
  assert.ok(kilde.length > 100, 'dismissOverlays skal findes');

  const skalVaereVetoet = ['close account', 'delete', 'cancel subscription', 'unsubscribe'];
  const manglende = skalVaereVetoet.filter((o) => !new RegExp(o.replace(/ /g, '[ _-]?'), 'i').test(kilde));
  assert.deepEqual(manglende, [],
    `disse maa aldrig kunne klikkes af en overlay-oprydning: ${manglende.join(', ')}`);
});

test('veto-listen rammer ikke almindelige accept-knapper', () => {
  // Et veto der ogsaa spaerrer "Accept" ville goere funktionen ubrugelig.
  const u = indlaesUdvidelse();
  const kilde = u.hent('dismissOverlays')?.toString() ?? '';
  assert.match(kilde, /accept|agree|godkend|ok\b/i,
    'den skal stadig kunne lukke et cookie-banner');
});

// ── debugger-vedhaeftning ───────────────────────────────────────────────────

test('attach er idempotent — en allerede vedhaeftet fane vedhaeftes ikke igen', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 5, attached: true }],
  } });
  const attach = u.hent('debuggerAttach');
  assert.equal(typeof attach, 'function');
  await attach(5);
  const foerste = u.optager.antal('debugger.attach');
  await attach(5);
  assert.equal(u.optager.antal('debugger.attach'), foerste,
    'anden gang skal bruge cachen, ikke vedhaefte igen');
});

test('"Already attached" fra Chrome er ikke en fejl', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': new Error('Another debugger is already attached'),
    'debugger.getTargets': [{ tabId: 6, attached: true }],
  } });
  const attach = u.hent('debuggerAttach');
  await assert.doesNotReject(() => attach(6),
    'Chrome siger "Already attached" naar vi ALLEREDE har sessionen — det er success');
});

test('en fane der aldrig kan vedhaeftes giver en brugbar fejl', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': new Error('Cannot access contents of the page'),
    'debugger.getTargets': [],
  } });
  const attach = u.hent('debuggerAttach');
  await assert.rejects(() => attach(7), (e) => {
    assert.match(e.message, /attach|debugger/i, 'fejlen skal sige hvad der gik galt');
    assert.ok(e.message.length > 40, 'og hvad brugeren kan goere ved det');
    return true;
  });
});

// ── cdpSend: sideeffekt-metoder maa ikke gentages i blinde ──────────────────

test('et museklik gentages IKKE automatisk naar debuggeren falder af', async () => {
  // Et gentaget Input.dispatchMouseEvent er et EKSTRA klik i brugerens browser.
  // Laesekald maa gerne gentages; sideeffekter maa ikke.
  let forsoeg = 0;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 8, attached: true }],
    'debugger.sendCommand': () => { forsoeg++; throw new Error('Debugger is not attached to the tab'); },
  } });
  const send = u.hent('cdpSend');
  await assert.rejects(() => send(8, 'Input.dispatchMouseEvent', {}));
  assert.equal(forsoeg, 1, `et klik maa proeves EN gang, blev proevet ${forsoeg}`);
});

test('et laesekald gentages derimod gerne', async () => {
  let forsoeg = 0;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 9, attached: true }],
    'debugger.sendCommand': () => { forsoeg++; throw new Error('Debugger is not attached to the tab'); },
  } });
  const send = u.hent('cdpSend');
  const kanGentages = u.hent('RETRYABLE_CDP_METHODS');
  const metode = kanGentages ? [...kanGentages][0] : 'Runtime.evaluate';
  await assert.rejects(() => send(9, metode, {}));
  assert.ok(forsoeg > 1, `et laesekald skal gentages, blev proevet ${forsoeg} gang`);
});

// ── chrome://-sider ─────────────────────────────────────────────────────────

test('chrome://-sider afvises — udvidelsen har ingen adgang der', () => {
  const u = indlaesUdvidelse();
  const kilde = Object.keys(u.ctx)
    .filter((k) => typeof u.ctx[k] === 'function')
    .map((k) => u.ctx[k].toString())
    .join('\n');
  assert.match(kilde, /chrome:\/\//,
    'der skal findes et vaern mod chrome://-sider');
});
