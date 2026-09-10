/**
 * Et skaermbillede maa aldrig vaere af en ANDEN fane end agentens.
 *
 * MAALT 9/9-2026 (Astra, reproduceret): naar CDP-optagelsen fejlede, faldt koden tilbage paa
 * chrome.tabs.captureVisibleTab(windowId). Den fotograferer den SYNLIGE fane, ikke agentens -
 * og brugerens egen side (bank, mail) blev leveret uden at svaret afsloerede det.
 *
 * 10/9, anden runde: et tjek foer og et efter optagelsen blev omgaaet af A->B->A. Et tjek paa to
 * tidspunkter beviser ikke hvad der skete imellem. Reserveloesningen er derfor fjernet helt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele({ agentFaneAktiv, cdp } = {}) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://agent.example', active: agentFaneAktiv, windowId: 9 },
    'tabs.query': agentFaneAktiv
      ? [{ id: 1, url: 'https://agent.example', active: true, windowId: 9 }]
      : [{ id: 2, url: 'https://brugerens-bank.example', active: true, windowId: 9 }],
    // Laekken afhaenger ikke af HVORFOR CDP fejler, kun af AT den gjorde.
    'debugger.sendCommand': cdp ?? (() => { throw new Error('CDP nede'); }),
    'tabs.captureVisibleTab': 'data:image/png;base64,BRUGERENS_AKTIVE_FANE',
    'windows.getLastFocused': { id: 9 },
    'windows.update': undefined,
    'tabs.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('agentens fane er ikke synlig - der leveres INTET billede af en anden fane', async () => {
  const u = sele({ agentFaneAktiv: false });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, 'der skal kastes, ikke returneres et billede');
  assert.doesNotMatch(JSON.stringify(svar), /BRUGERENS_AKTIVE_FANE/, 'en anden fanes pixels maa aldrig naa kalderen');
  assert.equal(u.optager.antal('tabs.captureVisibleTab'), 0);
});

test('heller ikke naar agentens fane ER den synlige - et skift imellem kan ikke udelukkes', async () => {
  const u = sele({ agentFaneAktiv: true });
  await u.hent('dispatch')(9876, 'screenshot', {}).catch(() => {});
  assert.equal(u.optager.antal('tabs.captureVisibleTab'), 0,
    'captureVisibleTab maa ikke bruges: to tjek beviser ikke hvilken fane der var synlig ved optagelsen');
});

test('en frist paa optagelsen giver ET forsoeg - ingen ny runde, intet vindue haevet', async () => {
  let optagelser = 0;
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode) => {
    if (metode === 'Page.captureScreenshot') { optagelser++; throw new Error('CDP svarede ikke inden 20000 ms: Page.captureScreenshot'); }
    return {};
  } });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, `en frist er ingen succes: ${JSON.stringify(svar).slice(0, 120)}`);
  assert.equal(optagelser, 1, 'svarer kompositoren ikke inden 20 s, svarer den heller ikke paa et forsoeg mere');
  assert.equal(u.optager.antal('windows.update'), 0, 'og brugerens vindue maa ikke haeves for ingenting');
});

test('fristen rammer ikke kald der lovligt tager tid', async () => {
  const u = sele({ agentFaneAktiv: true });
  assert.equal(u.hent('cdpFrist')('Input.dispatchMouseEvent'), 1500, 'input-kald er dem der blev maalt til at haenge');
  assert.ok(u.hent('cdpFrist')('Page.captureScreenshot') >= 5000, 'et skaermbillede paa en tung side skal have lov at tage tid');
  assert.ok(u.hent('cdpFrist')('Runtime.evaluate') >= 5000, 'dialog-ventetider bruger 3.000 ms og maa ikke skaeres over');
});
