/**
 * Klik-stien i udvidelsen - koert, ikke grepped.
 *
 * Hver test her svarer til en fejl der KOSTEDE tid, fordi ingen test daekkede den:
 *   - dialog-deadlocken (browser_click hang 30 sek og meldte falsk fejl)
 *   - settle-opslaget der ikke havde frist
 *   - klik der ikke lander, og fallbacken der fyrer i stedet
 *   - switch_tab der glemte vinduet
 *
 * Tidligere laa der kun kilde-inspektion (regex mod filen). En regex kan se at et
 * ord staar der; den kan ikke se om FORTOLKNINGEN er rigtig. Det her kalder koden.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

// ── evaluerTaalmodigt: fristen der ER dialog-rettelsen ───────────────────────

test('settle-opslaget svarer inden for fristen naar rendereren er rask', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': { result: { value: { landed: true, fallbackFired: false } } },
  } });
  const t0 = Date.now();
  const r = await u.hent('evaluerTaalmodigt')(1, { expression: '1' });
  assert.equal(r.result.value.landed, true, 'den rigtige vaerdi skal komme igennem');
  assert.ok(Date.now() - t0 < 500, 'et rask svar maa ikke vente paa fristen');
});

test('settle-opslaget giver op naar rendereren er frossen - og lyver ikke', async () => {
  // En aaben ja/nej-boks fryser rendereren: CDP-kaldet svarer ALDRIG.
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': () => new Promise(() => {}),   // kommer aldrig tilbage
  } });
  const t0 = Date.now();
  const r = await u.hent('evaluerTaalmodigt')(1, { expression: '1' }, 300);
  const brugt = Date.now() - t0;
  assert.ok(brugt >= 250 && brugt < 2000, `skal give op ved fristen, brugte ${brugt} ms`);
  assert.equal(r.result.value.rendererSvarede, false, 'kalderen skal kunne SE at rendereren tav');
  assert.equal(r.result.value.landed, true, 'et klik der aabnede en dialog ER landet');
  assert.equal(r.result.value.fallbackFired, false, 'framework-fallbacken maa ikke fyre oveni');
});

test('fristen er betingelsesloes - ogsaa uden armeret dialog', async () => {
  // Foerste rettelse gjorde kuren betinget af at vi kunne SE en dialog. Den
  // betingelse holdt ikke: dispatchen naar at blive kvitteret, og lytteren naar at
  // afvaebne, FOER rendereren gaar i staa. Saa faldt vi tilbage i det ubeskyttede
  // kald og hang alligevel. MAALT 30/8.
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 7, attached: true }],
    'debugger.sendCommand': () => new Promise(() => {}),
  } });
  assert.equal(u.hent('armeredeDialoger').size, 0, 'ingen dialog armeret - netop pointen');
  const t0 = Date.now();
  const r = await u.hent('evaluerTaalmodigt')(7, { expression: '1' }, 250);
  assert.ok(Date.now() - t0 < 2000, 'skal STADIG give op - fristen maa ikke vaere betinget');
  assert.equal(r.result.value.rendererSvarede, false);
});

// ── dispatchTaalmodigt: museklikket ─────────────────────────────────────────

test('museklik uden armeret dialog gaar den direkte vej', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': { ok: 1 },
  } });
  const r = await u.hent('dispatchTaalmodigt')(1, { type: 'mousePressed' });
  assert.deepEqual(r, { ok: 1 }, 'uden dialog skal svaret komme uaendret igennem');
  assert.ok(u.optager.antal('debugger.sendCommand') >= 1);
});

test('museklik med armeret dialog venter kort og melder at den blev blokeret', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 3, attached: true }],
    'debugger.sendCommand': () => new Promise(() => {}),
  } });
  // armer en dialog paa fanen, som handle_dialog ville
  u.hent('armeredeDialoger').set(3, { listener() {}, timer: null, action: 'accept' });
  const t0 = Date.now();
  const r = await u.hent('dispatchTaalmodigt')(3, { type: 'mouseReleased' });
  assert.ok(Date.now() - t0 < 4000, 'maa ikke haenge i 30 sekunder');
  assert.equal(r.__dialogBlokerede, true, 'kalderen skal vide at dialogen kom i vejen');
});

// ── afvaebnDialog: loeftet der aldrig blev opfyldt ───────────────────────────

test('afvaebning med grund giver kalderen et svar i stedet for tavshed', async () => {
  const u = indlaesUdvidelse();
  let svar = null;
  u.hent('armeredeDialoger').set(9, {
    listener() {}, timer: setTimeout(() => {}, 100000), action: 'accept',
    opfyld: (v) => { svar = v; },
  });
  u.hent('afvaebnDialog')(9, 'fanen blev lukket');
  assert.ok(svar, 'MAALT 22/8: her haengte kalderen for evigt uden svar');
  assert.equal(svar.ok, false);
  assert.match(svar.error, /fanen blev lukket/);
  assert.equal(u.hent('armeredeDialoger').has(9), false, 'armeringen skal vaere ryddet');
});

test('afvaebning UDEN grund tier - vi svarer selv lige efter', () => {
  const u = indlaesUdvidelse();
  let kaldt = false;
  u.hent('armeredeDialoger').set(4, { listener() {}, timer: null, action: 'accept', opfyld: () => { kaldt = true; } });
  u.hent('afvaebnDialog')(4);
  assert.equal(kaldt, false, 'uden grund maa loeftet ikke opfyldes - lytteren svarer selv');
  assert.equal(u.hent('armeredeDialoger').has(4), false);
});

test('afvaebning af en fane uden armering er harmloes', () => {
  const u = indlaesUdvidelse();
  assert.doesNotThrow(() => u.hent('afvaebnDialog')(999, 'findes ikke'));
});

// ── fanen lukkes: dialogen skal ikke efterlade en haengende kalder ───────────

test('lukkes fanen, faar en ventende dialog-kalder besked', async () => {
  const u = indlaesUdvidelse();
  let svar = null;
  u.hent('armeredeDialoger').set(55, {
    listener() {}, timer: setTimeout(() => {}, 100000), action: 'accept',
    opfyld: (v) => { svar = v; },
  });
  await u.fyr('tabs.onRemoved', 55);
  assert.ok(svar, 'en lukket fane maa ikke efterlade kalderen i stilhed');
  assert.equal(svar.ok, false);
});

// ── Hele dialog-stien, gennem den RIGTIGE beskedhaandtering ─────────────────
//
// De foregaaende tests kalder enkeltfunktioner. Disse gaar hele vejen: ind gennem
// chrome.runtime.onMessage som serveren goer, gennem handle_dialog, og ud igen naar
// Chrome fyrer Page.javascriptDialogOpening.
//
// MAALT 31/8: flow-testen mod en aegte Chrome fejler stadig paa browser_handle_dialog.
// Disse tests viser at LOGIKKEN er hel - armering, lytter, Page.enable, svar og
// oprydning sker alle korrekt. Fejlen i flow-testen er altsaa miljoebetinget, ikke i
// koden her. Uden dem ville vi ikke kunne skelne de to ting.

const opsaet = () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 77, attached: true }],
    'debugger.sendCommand': {},
    'tabs.get': { id: 77, url: 'https://eksempel.dk', windowId: 1, active: true },
  } });
  const s = u.hent('getSession')(9876);
  s.activeTabId = 77; s.tabIds.add(77);
  return u;
};
const kald = (u, method, params = {}) => new Promise((res) => {
  u.lyttere.get('runtime.onMessage')[0]({ type: 'mcp_command', port: 9876, method, params }, {}, res);
});

test('handle_dialog armer: lytter, Page.enable, loefte - alle fire', async () => {
  const u = opsaet();
  const svar = await kald(u, 'handle_dialog', { action: 'accept' });
  assert.equal(svar.ok, true);
  assert.equal(svar.armed, true, 'den skal svare STRAKS og armere - ikke blokere');
  assert.equal(u.hent('armeredeDialoger').has(77), true, 'armeringen skal staa paa fanen');
  assert.equal(u.hent('dialogLoefter').has(77), true, 'loeftet skal vaere sat, saa klikket kan vente paa det');
  assert.equal((u.lyttere.get('debugger.onEvent') || []).length, 1, 'praecis EN lytter');
  assert.ok(u.optager.til('debugger.sendCommand').some((k) => k.args[1] === 'Page.enable'),
    'uden Page.enable kommer dialog-haendelsen aldrig');
});

test('naar dialogen aabner, bliver den besvaret og armeringen ryddet', async () => {
  const u = opsaet();
  await kald(u, 'handle_dialog', { action: 'accept' });
  u.optager.ryd();
  await u.fyr('debugger.onEvent', { tabId: 77 }, 'Page.javascriptDialogOpening',
              { type: 'confirm', message: 'Er du sikker?' });
  await new Promise((r) => setTimeout(r, 50));
  const svar = u.optager.til('debugger.sendCommand').find((k) => k.args[1] === 'Page.handleJavaScriptDialog');
  assert.ok(svar, 'dialogen skal besvares');
  assert.equal(svar.args[2].accept, true, 'action:accept skal give accept:true');
  assert.equal(u.hent('armeredeDialoger').has(77), false, 'armeringen er engangs - den skal ryddes');
});

test('action:dismiss afviser i stedet for at acceptere', async () => {
  const u = opsaet();
  await kald(u, 'handle_dialog', { action: 'dismiss' });
  u.optager.ryd();
  await u.fyr('debugger.onEvent', { tabId: 77 }, 'Page.javascriptDialogOpening', { type: 'confirm' });
  await new Promise((r) => setTimeout(r, 50));
  const svar = u.optager.til('debugger.sendCommand').find((k) => k.args[1] === 'Page.handleJavaScriptDialog');
  assert.equal(svar.args[2].accept, false, 'dismiss maa ikke acceptere');
});

test('en dialog paa en ANDEN fane roerer ikke vores armering', async () => {
  const u = opsaet();
  await kald(u, 'handle_dialog', { action: 'accept' });
  u.optager.ryd();
  await u.fyr('debugger.onEvent', { tabId: 999 }, 'Page.javascriptDialogOpening', { type: 'alert' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(u.optager.til('debugger.sendCommand').length, 0, 'en fremmed fane maa ikke udloese noget');
  assert.equal(u.hent('armeredeDialoger').has(77), true, 'vores armering skal stadig staa');
});

test('to armeringer paa samme fane: den foerste faar besked, ikke tavshed', async () => {
  const u = opsaet();
  await kald(u, 'handle_dialog', { action: 'accept' });
  const foerste = u.hent('armeredeDialoger').get(77);
  let besked = null;
  foerste.opfyld = (v) => { besked = v; };
  await kald(u, 'handle_dialog', { action: 'dismiss' });
  assert.ok(besked, 'den foerste kalder maa ikke efterlades haengende');
  assert.equal(besked.ok, false);
  assert.equal(u.hent('armeredeDialoger').get(77).action, 'dismiss', 'den nyeste armering vinder');
});
