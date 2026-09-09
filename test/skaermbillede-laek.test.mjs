/**
 * Et skaermbillede maa aldrig vaere af en ANDEN fane end agentens.
 *
 * MAALT 9/9-2026 (fundet af Astra, reproduceret her): naar CDP-optagelsen fejlede, faldt
 * koden tilbage paa chrome.tabs.captureVisibleTab(windowId). Den fotograferer den fane der
 * er SYNLIG i vinduet — ikke agentens. Siden aktiveringen bevidst blev fjernet 21/8 (for
 * ikke at rive brugerens fane vaek), er agentens fane normalt netop IKKE den synlige.
 *
 * Resultatet var et billede af brugerens egen aabne side — bank, mail, hvad som helst —
 * leveret til agenten, uden at noget i svaret afsloerede det. Det er en laek, ikke en
 * unoejagtighed, og derfor skal den fejle haardt frem for at gaette.
 *
 * Reproduktionen: to CDP-timeouts, agentens fane inaktiv, en anden fane aktiv i samme vindue.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele(agentFaneAktiv) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://agent.example', active: agentFaneAktiv, windowId: 9 },
    'tabs.query': [{ id: 2, url: 'https://brugerens-bank.example', active: true, windowId: 9 }],
    // Laekken afhaenger ikke af HVORFOR CDP fejler, kun af AT den gjorde. En oejeblikkelig
    // fejl rammer samme sti som en haenger, og koster ikke 48 sek. i hver suite-koersel.
    'debugger.sendCommand': () => { throw new Error('CDP nede'); },
    'tabs.captureVisibleTab': 'data:image/png;base64,BRUGERENS_AKTIVE_FANE',
    'windows.getLastFocused': { id: 9 },
    'windows.update': undefined,
    'tabs.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('agentens fane er ikke synlig — der leveres INTET billede', async () => {
  const u = sele(false);
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, 'der skal kastes, ikke returneres et billede');
  assert.match(svar.fejl, /ikke den synlige|brugerens egen fane/i,
    'fejlen skal sige HVORFOR, saa ingen genindfoerer faldbagsen ved et uheld');
  assert.doesNotMatch(JSON.stringify(svar), /BRUGERENS_AKTIVE_FANE/,
    'en anden fanes pixels maa aldrig naa kalderen');
});

test('er agentens fane den synlige, maa reserveloesningen gerne bruges', async () => {
  const u = sele(true);
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.equal(svar.fejl, undefined, `skulle lykkes, men: ${svar.fejl}`);
  assert.match(svar.image || '', /^data:image\/png/, 'billedet skal komme igennem');
});

test('fristen rammer ikke kald der lovligt tager tid', async () => {
  // Dialog-ventetider bruger 3.000 ms. En frist paa 1.500 ms paa ALT skar dem over.
  const u = sele(true);
  assert.equal(u.hent('cdpFrist')('Input.dispatchMouseEvent'), 1500,
    'input-kald er dem der blev maalt til at haenge');
  assert.ok(u.hent('cdpFrist')('Page.captureScreenshot') >= 5000,
    'et skaermbillede paa en tung side skal have lov at tage tid');
  assert.ok(u.hent('cdpFrist')('Runtime.evaluate') >= 5000,
    'dialog-ventetider bruger 3.000 ms og maa ikke skaeres over');
});
