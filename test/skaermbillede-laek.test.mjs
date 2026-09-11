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

test('en frist paa standardoptagelsen giver 1.29.0-reserven en chance - men ingen tredje runde og intet vindue haevet', async () => {
  // Sign-off 11/9 (Astra, R5 F8): HEAD sprang fromSurface:false over efter en frist. I 1.29.0 var det netop fristen
  // der sendte kaldet videre til den, og den leverede billedet. Reserven proeves; en ny runde med haevet vindue ikke.
  const kald = [];
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode === 'Page.captureScreenshot') {
      kald.push(p?.fromSurface === false ? 'reserve' : 'standard');
      throw new Error('CDP svarede ikke inden 20000 ms: Page.captureScreenshot');
    }
    return {};
  } });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, `en frist er ingen succes: ${JSON.stringify(svar).slice(0, 120)}`);
  assert.deepEqual(kald, ['standard', 'reserve'], 'efter en frist skal fromSurface:false proeves - og intet derudover');
  assert.equal(u.optager.antal('windows.update'), 0, 'og brugerens vindue maa ikke haeves for ingenting');
});

test('efter en frist haeves vinduet ikke, heller ikke naar reserven fejler hurtigt af en anden grund', async () => {
  // Uden markeringen ville en hurtig "readback failed" fra reserven ligne et tildaekket vindue og starte runden med
  // haevet vindue - oven paa en standardoptagelse der allerede havde brugt sin frist.
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode !== 'Page.captureScreenshot') return {};
    if (p?.fromSurface === false) throw new Error('Unable to capture screenshot: image readback failed');
    throw new Error('CDP svarede ikke inden 10000 ms: Page.captureScreenshot');
  } });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl);
  assert.equal(u.optager.antal('windows.update'), 0, 'brugerens vindue blev haevet efter en frist');
});

// MAALT 11/9 af Astra (efterproevning af f084d1b): standardoptagelsen lykkes efter 11 s, reserven fejler. Foer budgettet:
// standardbilledet efter 11 s. Med budgettet: fristen paa 10 s kasserede den, og svaret var "image readback failed".
// Standardoptagelsen maa loebe videre mens reserven proeves - den der lykkes foerst inden for budgettet, vinder.
test('en langsom standardoptagelse kasseres ikke ved fristen, naar reserven fejler', async () => {
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode !== 'Page.captureScreenshot') return {};
    if (p?.fromSurface === false) throw new Error('Unable to capture screenshot: image readback failed');
    return new Promise((ok) => setTimeout(() => ok({ data: 'STANDARD' }), 110));
  } });
  // Skaleret 1:100 - standardbilledet kommer efter 11 s, fristen er 10 s, budgettet 26 s.
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 100, samletMs: 260 });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.match(String(svar.image), /STANDARD/, `standardbilledet blev kasseret: ${JSON.stringify(svar).slice(0, 160)}`);
});

test('er budgettet naesten brugt, startes runden med haevet vindue ikke', async () => {
  // Begge optagelser fejler af en anden grund end en frist, men foerst naar tiden er ved at vaere gaaet.
  // En runde mere ville bringe kaeden over serverens 30 s.
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode) => {
    if (metode !== 'Page.captureScreenshot') return {};
    return new Promise((_, afvis) => setTimeout(() => afvis(new Error('Unable to capture screenshot: image readback failed')), 60));
  } });
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 100, samletMs: 260 });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl);
  assert.equal(u.optager.antal('windows.update'), 0, 'vinduet blev haevet uden tid tilbage til en optagelse');
});

// MAALT 11/9 af Astra (sign-off, skalerede timere): standardoptagelsen hang og koblede foerst fra efter 19 s. cdpSend
// gentog den (den staar som sikker at gentage), saa billedet kom efter ca. 38 s - serveren havde opgivet ved 30 s.
// 1.29.0: fristen paa 8 s sendte kaldet videre til fromSurface:false, som svarede paa et halvt sekund.
test('haenger standardoptagelsen og kobler foerst fra sent, naar reserven frem foer serverens 30 s', async () => {
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode !== 'Page.captureScreenshot') return {};
    if (p?.fromSurface === false) return { data: 'RESERVE' };
    return new Promise((_, afvis) => setTimeout(() => afvis(new Error('Debugger is detached')), 190));
  } });
  // Tiden skaleres 1:100 - 19 s bliver 190 ms, serverens 30 s bliver 300 ms.
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 100, samletMs: 260 });
  const t0 = Date.now();
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  const brugt = Date.now() - t0;
  assert.match(String(svar.image), /RESERVE/, `intet billede fra reserven: ${JSON.stringify(svar).slice(0, 160)}`);
  assert.ok(brugt < 300, `billedet kom efter ${brugt} ms (skaleret) - serveren opgiver ved 300`);
  assert.equal(u.optager.antal('windows.update'), 0);
});

test('fristen rammer ikke kald der lovligt tager tid', async () => {
  const u = sele({ agentFaneAktiv: true });
  assert.equal(u.hent('cdpFrist')('Input.dispatchMouseEvent'), 1500, 'input-kald er dem der blev maalt til at haenge');
  assert.ok(u.hent('cdpFrist')('Page.captureScreenshot') >= 5000, 'et skaermbillede paa en tung side skal have lov at tage tid');
  assert.ok(u.hent('cdpFrist')('Runtime.evaluate') >= 5000, 'dialog-ventetider bruger 3.000 ms og maa ikke skaeres over');
});
