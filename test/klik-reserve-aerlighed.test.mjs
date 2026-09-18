/**
 * Naar fejlfinderen er BLOKERET, falder `browser_click` tilbage til et script-klik.
 * Den gren maa ikke melde tavs succes.
 *
 * MAALT 17/9 mod Stripe Dashboard (staar i `WISHLIST.md`): efter en time med
 * «Debugger attach failed ... ghost» svarede vaerktoejet
 *
 *     {"ok": true, "method": "scripting-fallback", "tag": "DIV"}
 *
 * paa «Create key». Knappen blev aldrig trykket, og siden stod uaendret. Kommentaren i
 * koden sagde "samme svar som 1.29.0" - altsaa et bevidst hul, arvet fra foer klassen
 * blev lukket.
 *
 * Nabogrenen otte linjer nede (baggrundsfane) kraever allerede bevis. Forskellen var
 * ikke begrundet i noget maalt; den var bare aldrig blevet rettet.
 *
 * ⛔ Rettelsen er IKKE `ok:false`. Astra maalte 12/9 at en menu der aabner paa mousedown
 * ellers meldes som mislykket, og saa klikker agenten igen og lukker menuen. Svaret er
 * det TREDJE udfald, som resten af klassen allerede bruger: klikket blev sendt, og det
 * er uvist om det virkede.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/** Rejser udvidelsen med en fejlfinder der naegter, og et script-klik med kendt udfald. */
function sele({ skriptKlik }) {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane,
    'tabs.query': [fane],
    'tabs.update': undefined,
    'windows.update': undefined,
    'debugger.sendCommand': () => ({ result: { value: null } }),
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'DIV', text: 'Create key' });
  // Praecis fejlen fra Stripe-maalingen - ikke en frist, men en naegtet fastgoerelse.
  u.ctx.debuggerClick = async () => {
    throw new Error('Debugger attach failed after 3 attempts (tab 1). Last: attach resolved but Chrome shows tab not attached');
  };
  u.ctx.scriptingClick = async () => skriptKlik;
  return u;
}

test('et script-klik uden bevis meldes ikke som tavs succes', async () => {
  const u = sele({ skriptKlik: { ok: true, tag: 'DIV', landed: false } });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#create-key' });
  assert.notEqual(JSON.stringify(svar), JSON.stringify({ ok: true, method: 'scripting-fallback', tag: 'DIV' }),
    'vaerktoejet svarede et bart ja paa et klik det ikke har set virke - det er Stripe-tilfaeldet ordret');
  assert.equal(svar.maaske_landet, true,
    `svaret siger ikke at virkningen er uvist: ${JSON.stringify(svar)}`);
  assert.ok(svar.note && /tjek|uvist|bekraeft/i.test(svar.note),
    'svaret giver ikke agenten en anvisning paa hvad den skal goere i stedet');
});

test('et script-klik der ER bevist, meldes stadig som succes', async () => {
  const u = sele({ skriptKlik: { ok: true, tag: 'DIV', landed: true } });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#create-key' });
  assert.equal(svar.ok, true, 'et bevist klik blev meldt som fejl');
  assert.equal(svar.landed, true, 'svaret oplyser ikke at klikket landede');
  assert.notEqual(svar.maaske_landet, true, 'et bevist klik maa ikke ogsaa kalde sig uvist');
});

test('uvist er ikke det samme som mislykket - agenten maa ikke klikke igen i blinde', async () => {
  // Kalibrering mod Astras maaling 12/9: en menu der aabner paa mousedown ser ud som
  // "ingen virkning". Svarer vi ok:false, klikker agenten igen og lukker menuen.
  const u = sele({ skriptKlik: { ok: true, tag: 'DIV', landed: null, uverificeret: true } });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#menu' });
  assert.notEqual(svar.ok, false,
    'et uvist klik blev meldt som mislykket - saa klikker agenten igen og lukker den menu den lige aabnede');
});
