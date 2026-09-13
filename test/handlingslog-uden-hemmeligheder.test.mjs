/**
 * Handlingshistorikken maa aldrig gemme hvad agenten skrev.
 *
 * MAALT 11/9 (Astra, efterproevet i koden): logAction gemte `JSON.stringify(params).slice(0, 200)`
 * i chrome.storage.local for HVERT kald - ogsaa vaerdien til browser_fill (adgangskoder),
 * cookie-vaerdier til set_cookies og adresser med login-tokens. Det laa i klartekst paa
 * brugerens maskine, i strid med privatlivssiden. Popuppen viser kun tid, vaerktoej og
 * session, saa parametrene tjente intet.
 *
 * Testene kalder den rigtige kode i selen og laeser det der faktisk sendes til lageret.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

// Chrome svarer baade via callback og via Promise. Stubben goer begge dele, saa testen
// maaler koden og ikke hvilken kaldeform den tilfaeldigvis bruger.
function lager(indhold) {
  return (arg, cb) => {
    const svar = { ...(arg && typeof arg === 'object' && !Array.isArray(arg) ? arg : {}), ...indhold };
    if (typeof cb === 'function') cb(svar);
    return svar;
  };
}

function gemteLogge(u) {
  return u.optager.til('storage.local.set')
    .map((k) => k.args[0])
    .filter((obj) => obj && Array.isArray(obj.actionLog));
}

async function logOgLaes(metode, params) {
  const u = indlaesUdvidelse({ svar: { 'storage.local.get': lager({ actionLog: [] }) } });
  await u.hent('logAction')(9876, metode, params);
  await new Promise((r) => setImmediate(r));
  const skrevet = gemteLogge(u);
  assert.equal(skrevet.length, 1, 'logAction skal skrive handlingen til lageret én gang');
  return skrevet[0].actionLog;
}

// MAALT 11/9 af Astra (e2e-review af 1f52333): onInstalled renser loggen, men et samtidigt logAction havde laest den gamle
// log FOER oprydningen skrev - og skrev saa den gamle adgangskode tilbage sammen med sin egen post. CHANGELOG lover at
// gamle poster renses. Hver skrivning skal derfor selv rense, ikke kun oprydningen.
test('en handling logget mens gamle poster renses, skriver ikke adgangskoden tilbage', async () => {
  let lagret = { actionLog: [{ time: 1, method: 'fill', params: '{"value":"gammel-hemmelighed"}', category: 'safe', session: 'Claude 1', color: 'blue' }] };
  const u = indlaesUdvidelse({ svar: {
    // Begge kald laeser den gamle log, foer nogen af dem skriver - som naar onInstalled og en kommando kommer samtidig.
    'storage.local.get': async (arg) => {
      const kopi = JSON.parse(JSON.stringify(lagret));
      await new Promise((r) => setTimeout(r, 10));
      return { ...(arg && typeof arg === 'object' ? arg : {}), ...kopi };
    },
    'storage.local.set': (obj) => { lagret = { ...lagret, ...JSON.parse(JSON.stringify(obj)) }; },
  } });
  await Promise.all([u.hent('rensHandlingslog')(), u.hent('logAction')(9876, 'navigate')]);
  assert.doesNotMatch(JSON.stringify(lagret), /gammel-hemmelighed/, `adgangskoden blev skrevet tilbage: ${JSON.stringify(lagret)}`);
});

test('fill: den skrevne vaerdi gemmes ikke', async () => {
  const log = await logOgLaes('fill', { selector: '#password', value: 'hemmelig-kode-123' });
  assert.equal(log[0].method, 'fill');
  assert.ok(!JSON.stringify(log).includes('hemmelig-kode-123'), 'adgangskoden ligger i historikken');
});

test('set_cookies: cookie-vaerdien gemmes ikke', async () => {
  const log = await logOgLaes('set_cookies', { cookies: [{ name: 'sid', value: 'cookie-hemmelighed-9' }] });
  assert.equal(log[0].method, 'set_cookies');
  assert.ok(!JSON.stringify(log).includes('cookie-hemmelighed-9'), 'cookie-vaerdien ligger i historikken');
});

test('navigate: et login-token i adressen gemmes ikke', async () => {
  const log = await logOgLaes('navigate', { url: 'https://example.com/callback?token=abc-hemmeligt-token' });
  assert.ok(!JSON.stringify(log).includes('abc-hemmeligt-token'), 'tokenet ligger i historikken');
});

test('posten har stadig det popuppen viser: tid, vaerktoej, kategori og session', async () => {
  const log = await logOgLaes('get_cookies', { domain: 'example.com' });
  const [post] = log;
  assert.equal(typeof post.time, 'number');
  assert.equal(post.method, 'get_cookies');
  assert.equal(post.category, 'sensitive');
  assert.equal(typeof post.session, 'string');
});

test('ved opdatering renses gamle poster for de parametre de allerede gemte', async () => {
  const gammel = [
    { time: 1, method: 'fill', params: '{"selector":"#pw","value":"gammel-hemmelighed"}', category: 'safe', session: 'Claude 1', color: 'blue' },
    { time: 2, method: 'navigate', params: '{"url":"https://x.dk/?token=gammelt-token"}', category: 'safe', session: 'Claude 1', color: 'blue' },
  ];
  const u = indlaesUdvidelse({ svar: { 'storage.local.get': lager({ actionLog: gammel }) } });
  await u.fyr('runtime.onInstalled', { reason: 'update' });
  await new Promise((r) => setImmediate(r));

  const skrevet = gemteLogge(u);
  assert.ok(skrevet.length >= 1, 'historikken blev ikke renset ved opdatering');
  const renset = skrevet.at(-1).actionLog;
  const tekst = JSON.stringify(renset);
  assert.ok(!tekst.includes('gammel-hemmelighed'), 'en gammel adgangskode overlevede opdateringen');
  assert.ok(!tekst.includes('gammelt-token'), 'et gammelt token overlevede opdateringen');
  assert.deepEqual(renset.map((p) => p.method), ['fill', 'navigate'], 'rensningen maa ikke slette selve posterne');
});
