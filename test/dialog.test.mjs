/**
 * Dialog-armeringen - lytteren koeres, ikke greppes.
 *
 * MAALT 22/8: fem mutationer af handle_dialog slap igennem hele suiten. To af dem er
 * aegte korrekthedsfejl:
 *   · `source.tabId !== tab.id`-gaten fjernet → ÉN CHAT TAGER EN ANDEN CHATS DIALOG.
 *     Alle sessioner deler den samme chrome.debugger.onEvent-stroem, saa uden gaten
 *     svarer den foerste armering paa enhver dialog i hele browseren.
 *   · `accept: action === 'accept'` → `accept: true`. Et `dismiss` ville saa ACCEPTERE
 *     dialogen. Paa en "vil du slette?"-bekraeftelse er det den forkerte vej.
 *
 * 1.30.3 (#69): handle_dialog har ikke laengere sin egen lytter. Én koordinator for hele
 * udvidelsen (dialogKoordinator) svarer paa armeringens vegne, og svaret til kalderen kommer
 * fra Chromes Page.javascriptDialogClosed - ikke fra kommandoens kvittering. Proeverne her
 * er derfor flyttet fra den udklippede lytter til koordinatoren; invarianterne er de samme.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/** Koordinatoren med en armering paa `tabId`, saadan som handle_dialog laegger den. */
function rejsKoordinator({ tabId = 42, action = 'accept', promptText = '' } = {}) {
  const u = indlaesUdvidelse({ svar: { 'debugger.sendCommand': {} } });
  const log = { opfyldt: [] };
  u.hent('armeredeDialoger').set(tabId, { timer: null, action, accept: action === 'accept', text: promptText,
    udloeb: Date.now() + 60000, opfyld: (r) => log.opfyldt.push(r) });
  const cdp = () => u.optager.til('debugger.sendCommand').map((k) => ({ id: k.args[0].tabId, metode: k.args[1], params: k.args[2] }));
  return { u, log, cdp };
}

const DIALOG = 'Page.javascriptDialogOpening';
const LUKKET = 'Page.javascriptDialogClosed';
const HAENDELSE = { type: 'confirm', message: 'Er du sikker?' };
const tik = () => new Promise((r) => setTimeout(r, 10));

// ── DEN VIGTIGE. Mutations-verificeret: tabId-gaten fjernet gav roed.
test('en armering roerer ALDRIG en anden fanes dialog', async () => {
  const { u, log, cdp } = rejsKoordinator({ tabId: 42 });
  await u.fyr('debugger.onEvent', { tabId: 99 }, DIALOG, HAENDELSE);          // en ANDEN chats fane
  await u.fyr('debugger.onEvent', { tabId: 99 }, LUKKET, { result: true });
  await tik();
  assert.equal(cdp().length, 0,
    'alle sessioner deler den samme debugger-haendelsesstroem. Uden tabId-gaten ' +
    'svarer den foerste armering paa enhver dialog i hele browseren - ogsaa dem der ' +
    'hoerer til en anden chats arbejde.');
  assert.equal(log.opfyldt.length, 0, 'og den maa slet ikke melde succes');
  assert.equal(u.hent('armeredeDialoger').has(42), true, 'vores armering staar endnu');
});

test('en anden slags debugger-haendelse ignoreres', async () => {
  const { u, cdp } = rejsKoordinator({ tabId: 42 });
  await u.fyr('debugger.onEvent', { tabId: 42 }, 'Page.loadEventFired', {});
  await tik();
  assert.equal(cdp().length, 0, 'kun javascriptDialogOpening maa udloese en handling');
});

test('den rigtige fanes dialog haandteres - og svaret kommer foerst, naar Chrome melder den lukket', async () => {
  const { u, log, cdp } = rejsKoordinator({ tabId: 42 });
  await u.fyr('debugger.onEvent', { tabId: 42 }, DIALOG, HAENDELSE);
  await tik();
  assert.equal(cdp().length, 1, 'dialogen skal faktisk besvares');
  assert.equal(cdp()[0].metode, 'Page.handleJavaScriptDialog');
  assert.equal(u.hent('armeredeDialoger').has(42), false, 'armeringen skal ryddes - én dialog pr. armering');
  assert.equal(log.opfyldt.length, 0, 'kommandoens kvittering er ikke dommen (#69, mutant M2)');
  await u.fyr('debugger.onEvent', { tabId: 42 }, LUKKET, { result: true });
  assert.equal(log.opfyldt[0].ok, true);
  assert.equal(log.opfyldt[0].message, 'Er du sikker?', 'beskeden skal med tilbage til agenten');
});

// ── Mutations-verificeret: `accept: action === 'accept'` -> `accept: true` gav roed.
test('dismiss AFVISER - den maa aldrig acceptere', async () => {
  const { u, log, cdp } = rejsKoordinator({ tabId: 42, action: 'dismiss' });
  await u.fyr('debugger.onEvent', { tabId: 42 }, DIALOG, HAENDELSE);
  await tik();
  assert.equal(cdp()[0].params.accept, false,
    'paa en "vil du slette?"-bekraeftelse er forskellen mellem accept og dismiss ' +
    'forskellen mellem at slette og at lade vaere');
  await u.fyr('debugger.onEvent', { tabId: 42 }, LUKKET, { result: false });
  assert.equal(log.opfyldt[0].action, 'dismiss', 'svaret skal oplyse hvad der faktisk skete');
});

test('accept ACCEPTERER, og prompt-teksten foelger med', async () => {
  const { u, cdp } = rejsKoordinator({ tabId: 42, action: 'accept', promptText: 'Gustav' });
  await u.fyr('debugger.onEvent', { tabId: 42 }, DIALOG, { type: 'prompt', message: 'Navn?' });
  await tik();
  assert.equal(cdp()[0].params.accept, true);
  assert.equal(cdp()[0].params.promptText, 'Gustav', 'ellers er prompt-vaerktoejet meningsloest');
});

test('handle_dialog laegger sin tekst i armeringen, som koordinatoren sender', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 7, attached: true }],
    'debugger.sendCommand': {}, 'tabs.get': { id: 7, url: 'https://x.example/', windowId: 1, active: true },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([7]), activeTabId: 7, groupId: 1, label: 't', color: 'blue' });
  await u.hent('dispatch')(9876, 'handle_dialog', { action: 'accept', text: 'Gustav' });
  u.optager.ryd();
  await u.fyr('debugger.onEvent', { tabId: 7 }, DIALOG, { type: 'prompt', message: 'Navn?' });
  await tik();
  const svar = u.optager.til('debugger.sendCommand').find((k) => k.args[1] === 'Page.handleJavaScriptDialog');
  assert.equal(svar.args[2].promptText, 'Gustav');
});
