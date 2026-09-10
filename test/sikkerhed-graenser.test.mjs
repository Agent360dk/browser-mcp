/**
 * To graenser der kun holdt paa papiret. Begge fundet af Astra og sikkerhedsreviewet 10/9.
 *
 *   skaermbillede  tjek og optagelse var to separate kald. Skiftede brugeren fane imellem,
 *                  blev brugerens side fotograferet. Nu tjekkes der igen efter optagelsen.
 *   get_cookies    domaene-kravet alene lod en session laese cookies for ETHVERT domaene i
 *                  profilen — ogsaa et den aldrig havde aabnet. Nu kun sessionens egne.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

test('et skaermbillede kasseres hvis fanen skiftede under optagelsen', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://agent.example', active: true, windowId: 9 },   // aktiv ved tjekket
    'tabs.query': [{ id: 2, url: 'https://brugerens-bank.example', active: true, windowId: 9 }], // skiftet ved optagelsen
    'debugger.sendCommand': () => { throw new Error('CDP nede'); },
    'tabs.captureVisibleTab': 'data:image/png;base64,BRUGERENS_SIDE',
    'windows.getLastFocused': { id: 9 }, 'windows.update': undefined, 'tabs.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, 'der skal kastes');
  assert.doesNotMatch(JSON.stringify(svar), /BRUGERENS_SIDE/, 'brugerens side maa aldrig naa kalderen');
  assert.equal(u.optager.antal('windows.update'), 0, 'og kasseringen maa ikke udloese en vindues-haevning');
});

function cookieSele(faneUrl) {
  const kaldt = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'tabs.get': { id: 1, url: faneUrl, windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: faneUrl, windowId: 1, active: true }],
    'cookies.getAll': (f) => { kaldt.push(f); return [{ name: 's', value: 'v', domain: f.domain, path: '/' }]; },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, kaldt };
}

test('get_cookies naegter et domaene sessionen ikke har aabent', async () => {
  const { u, kaldt } = cookieSele('https://a.example/side');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'brugerens-netbank.example' });
  assert.equal(svar.error, 'domaene-ikke-i-sessionen');
  assert.equal(kaldt.length, 0, 'Chromes cookie-lager maa slet ikke spoerges');
});

test('get_cookies tillader sessionens eget domaene, dets underdomaener og dets overdomaene', async () => {
  for (const [fane, domaene] of [
    ['https://a.example/', 'a.example'],
    ['https://dashboard.stripe.com/', 'stripe.com'],
    ['https://stripe.com/', 'dashboard.stripe.com'],
    ['https://a.example/', '.a.example'],
  ]) {
    const { u, kaldt } = cookieSele(fane);
    const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: domaene });
    assert.equal(svar.error, undefined, `${domaene} fra ${fane} skulle vaere tilladt: ${JSON.stringify(svar)}`);
    assert.equal(kaldt.length, 1);
  }
});

test('get_cookies med et overdomaene som "com" giver ikke andre .com-siders cookies', async () => {
  // Chrome returnerer ALLE cookies under det domaene man spoerger paa. En fane paa a.example.com
  // maatte spoerge paa "com" (a.example.com ligger jo under com) — og fik brugerens bank med.
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'tabs.get': { id: 1, url: 'https://a.example.com/', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://a.example.com/', windowId: 1, active: true }],
    'cookies.getAll': () => [
      { name: 'egen', value: '1', domain: 'a.example.com', path: '/' },
      { name: 'foraelder', value: '2', domain: '.example.com', path: '/' },
      { name: 'bank', value: 'HEMMELIG', domain: '.brugerens-bank.com', path: '/' },
      { name: 'soeskende', value: '3', domain: 'b.example.com', path: '/' },
    ],
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'com' });
  const navne = (svar.cookies || []).map((c) => c.name);
  assert.ok(!navne.includes('bank'), `en anden sides cookie slap igennem: ${JSON.stringify(navne)}`);
  assert.ok(navne.includes('egen') && navne.includes('foraelder'), `sessionens egne cookies skal stadig med: ${JSON.stringify(navne)}`);
});
