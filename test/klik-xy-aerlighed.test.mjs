/**
 * click_xy maa ikke svare ok naar klikket ikke landede.
 *
 * MAALT 10/9: `click` fik rettet sin aerlighed (klik-aerlighed.test.mjs), men click_xy kalder
 * den SAMME debuggerClick, smed dens svar vaek og returnerede `ok: true` hardkodet. Fundet ved
 * at soege hele filen efter mønstret - ikke kun det ene sted issue #19 pegede paa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele(settle) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://example.com', windowId: 1 },
    'tabs.query': [{ id: 1, url: 'https://example.com', windowId: 1, active: true }],
    'debugger.sendCommand': (_m, metode) => metode === 'Runtime.evaluate' ? { result: { value: settle } } : {},
  } });
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1 });
  return u;
}

test('click_xy der ikke landede svarer ok:false og viser landed', async () => {
  const svar = await sele({ landed: false, fallbackFired: true }).hent('dispatch')(9876, 'click_xy', { x: 5, y: 5 });
  assert.equal(svar.landed, false, 'kalderen skal kunne se hvad debuggerClick maalte');
  assert.equal(svar.ok, false);
});

test('click_xy der fik elementet til at forsvinde tæller som landet', async () => {
  const svar = await sele({ landed: false, fallbackFired: false, detached: true }).hent('dispatch')(9876, 'click_xy', { x: 5, y: 5 });
  assert.equal(svar.ok, true);
  // Svaret er skabt inde i udvidelsens sandkasse; deepEqual paa tvaers af den fejler altid.
  assert.equal(svar.clicked_at.x, 5); assert.equal(svar.clicked_at.y, 5);
});

test('click_xy der landede svarer ok', async () => {
  const svar = await sele({ landed: true, fallbackFired: false }).hent('dispatch')(9876, 'click_xy', { x: 5, y: 5 });
  assert.equal(svar.ok, true);
});
