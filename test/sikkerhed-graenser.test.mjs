/**
 * Graenser der kun holdt paa papiret. Fundet af Astra og sikkerhedsreviewet 10/9, to runder.
 *
 *   skaermbillede  captureVisibleTab fotograferer den SYNLIGE fane, ikke agentens. Et tjek foer
 *                  og et efter kan ikke udelukke A->B->A imens, saa reserveloesningen er fjernet.
 *   get_cookies    kun cookies Chrome selv ville SENDE til sessionens egne http(s)-sider. At
 *                  gaette domaeneslaegtskab blev omgaaet af et public suffix (https://com/), en
 *                  file:-fane og et tomt vaertsnavn.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

test('et skaermbillede tages aldrig med captureVisibleTab - heller ikke ved A->B->A', async () => {
  let q = 0;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://agent.example', active: true, windowId: 9 },
    // Agentens fane A aktiv, saa brugerens B ved optagelsen, saa A igen ved efter-tjekket
    'tabs.query': () => [[{ id: 1, active: true, windowId: 9 }], [{ id: 2, active: true, windowId: 9 }],
                         [{ id: 1, active: true, windowId: 9 }]][Math.min(q++, 2)],
    'debugger.sendCommand': () => { throw new Error('CDP nede'); },
    'tabs.captureVisibleTab': 'data:image/png;base64,BRUGERENS_SIDE',
    'windows.getLastFocused': { id: 9 }, 'windows.update': undefined, 'tabs.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, 'uden CDP er der intet billede');
  assert.doesNotMatch(JSON.stringify(svar), /BRUGERENS_SIDE/, 'brugerens side maa aldrig naa kalderen');
  assert.equal(u.optager.antal('tabs.captureVisibleTab'), 0, 'den synlige fane maa slet ikke fotograferes');
});

// Chromes egne filtre, forenklet efter cookies_helpers.cc: {domain} giver cookies paa domaenet og
// under det; {url} giver de cookies der SENDES til den vaert.
const KRUKKE = [
  { name: 'egen', value: '1', domain: 'a.example.com', path: '/' },
  { name: 'foraelder', value: '2', domain: '.example.com', path: '/' },
  { name: 'soeskende', value: '3', domain: 'b.example.com', path: '/' },
  { name: 'stripe', value: '4', domain: '.stripe.com', path: '/' },
  { name: 'dash', value: '5', domain: 'dashboard.stripe.com', path: '/' },
  { name: 'bank', value: 'HEMMELIG', domain: '.bank.com', path: '/' },
  { name: 'bankx', value: 'HEMMELIG_FILE', domain: '.bank.example', path: '/' },
  { name: 'punktum', value: 'HEMMELIG_PUNKTUM', domain: 'bank.example.', path: '/' },
  { name: 'api', value: '6', domain: 'a.example.com', path: '/api' },
  { name: 'bog', value: '7', domain: 'xn--bcher-kva.example', path: '/' },
  { name: 'c', value: '8', domain: 'a.example.com', path: '/a|b' },
  { name: 'b|c', value: '9', domain: 'a.example.com', path: '/a' },
  { name: 'sid-uden', value: '10', domain: 'x.example', path: '/' },
  { name: 'sid-punktum', value: '11', domain: 'x.example.', path: '/' },
];
const tilVaert = (h, cd) => h === cd || h.endsWith('.' + cd);
function cookieSele(faneUrl, { lagre } = {}) {
  const kaldt = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'tabs.get': { id: 1, url: faneUrl, windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: faneUrl, windowId: 1, active: true }],
    'cookies.getAllCookieStores': lagre ?? [{ id: '0', tabIds: [1] }],
    'cookies.getAll': (f) => {
      kaldt.push(f);
      return KRUKKE.filter((c) => {
        const cd = c.domain.replace(/^\./, '');
        // {url} giver kun cookies hvis sti passer paa adressen - som i Chrome.
        if (f.url) { const u = new URL(f.url); return tilVaert(u.hostname, cd) && decodeURIComponent(u.pathname).startsWith(c.path); }
        if (f.domain !== undefined) { const fd = String(f.domain).replace(/^\./, ''); return cd === fd || cd.endsWith('.' + fd); }
        return true;
      });
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, kaldt };
}
const navne = (svar) => (svar.cookies || []).map((c) => c.name);

test('get_cookies naegter et domaene sessionen ikke har aabent', async () => {
  const { u, kaldt } = cookieSele('https://a.example.com/side');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'brugerens-netbank.example' });
  assert.equal(svar.error, 'domaene-ikke-i-sessionen');
  assert.equal(kaldt.length, 0, 'Chromes cookie-lager maa slet ikke spoerges');
});

test('get_cookies giver sessionens egne cookies - eget domaene, overdomaene og underdomaene', async () => {
  for (const [fane, domaene, skalHave] of [
    ['https://a.example.com/', 'a.example.com', ['egen', 'foraelder']],
    ['https://dashboard.stripe.com/', 'stripe.com', ['stripe', 'dash']],
    ['https://stripe.com/', 'dashboard.stripe.com', ['stripe']],
    ['https://a.example.com/', '.a.example.com', ['egen']],
  ]) {
    const { u } = cookieSele(fane);
    const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: domaene });
    assert.equal(svar.error, undefined, `${domaene} fra ${fane} skulle vaere tilladt: ${JSON.stringify(svar)}`);
    for (const n of skalHave) assert.ok(navne(svar).includes(n), `${n} mangler for ${domaene} fra ${fane}: ${navne(svar)}`);
    assert.ok(!navne(svar).some((n) => n.startsWith('bank')), 'aldrig bankens');
  }
});

test('get_cookies med "com" fra a.example.com giver ikke andre .com-siders cookies', async () => {
  const { u } = cookieSele('https://a.example.com/');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'com' });
  assert.ok(!navne(svar).includes('bank'), `en anden sides cookie slap igennem: ${navne(svar)}`);
  assert.ok(!navne(svar).includes('soeskende'), 'et soeskende-underdomaene sendes ikke til siden');
  assert.ok(navne(svar).includes('egen') && navne(svar).includes('foraelder'), `sessionens egne skal med: ${navne(svar)}`);
});

test('en fane paa selve public suffixet (https://com/) aabner ikke hele .com', async () => {
  const { u } = cookieSele('https://com/');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'com' });
  assert.ok(!navne(svar).includes('bank'), `bankens cookie slap igennem: ${JSON.stringify(svar)}`);
});

test('en file:-fane autoriserer ingen http-cookies', async () => {
  const { u } = cookieSele('file://bank.example/sti');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'bank.example' });
  assert.doesNotMatch(JSON.stringify(svar), /HEMMELIG_FILE/, 'en file:-fane er ingen side paa bank.example');
  assert.equal(svar.error, 'domaene-ikke-i-sessionen');
});

test('et tomt vaertsnavn (about:blank) lukker ikke "bank.example." ind', async () => {
  const { u } = cookieSele('about:blank');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'bank.example.' });
  assert.doesNotMatch(JSON.stringify(svar), /HEMMELIG_PUNKTUM/);
  assert.equal(svar.error, 'domaene-ikke-i-sessionen');
});

// ── Tredje runde (Astra) ────────────────────────────────────────────────────
test('sidens egne cookies paa andre stier (Path=/api) kommer med', async () => {
  const { u } = cookieSele('https://a.example.com/');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'a.example.com' });
  assert.ok(navne(svar).includes('api'), `cookien paa /api manglede: ${navne(svar)}`);
});

test('en inkognito-fane laeses fra sit EGET cookie-lager', async () => {
  const { u, kaldt } = cookieSele('https://a.example.com/', { lagre: [{ id: '0', tabIds: [] }, { id: '1', tabIds: [1] }] });
  await u.hent('dispatch')(9876, 'get_cookies', { domain: 'a.example.com' });
  assert.ok(kaldt.length > 0);
  assert.ok(kaldt.every((f) => f.storeId === '1'), `laest fra forkert lager: ${JSON.stringify(kaldt)}`);
});

test('et domaene med ikke-ASCII-tegn matcher fanens punycode', async () => {
  const { u } = cookieSele('https://xn--bcher-kva.example/');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'bücher.example' });
  assert.equal(svar.error, undefined, `afvist: ${JSON.stringify(svar)}`);
  assert.ok(navne(svar).includes('bog'));
});

test('en fane-adresse med afsluttende punktum faar sin EGEN vaerts cookies - ikke den uden punktum', async () => {
  // Fjerde runde (Astra): Chromium behandler x.example og x.example. som to cookie-vaerter. Tredje rundes
  // normalisering fjernede punktummet og gav fanen den ANDEN vaerts cookie. Stubben fjernede det ogsaa -
  // og modellerede dermed Chromium forkert.
  const { u } = cookieSele('https://x.example./');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'x.example.' });
  assert.equal(svar.error, undefined, `afvist: ${JSON.stringify(svar)}`);
  assert.ok(navne(svar).includes('sid-punktum'), `fanens egen cookie manglede: ${navne(svar)}`);
  assert.ok(!navne(svar).includes('sid-uden'), `en anden vaerts cookie slap med: ${navne(svar)}`);
});

test('to cookies med "|" i sti og navn slaas ikke sammen', async () => {
  const { u } = cookieSele('https://a.example.com/');
  const svar = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'a.example.com' });
  assert.ok(navne(svar).includes('c') && navne(svar).includes('b|c'), `en af dem forsvandt: ${navne(svar)}`);
});
