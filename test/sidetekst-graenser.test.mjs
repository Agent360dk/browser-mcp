/**
 * `browser_get_page_content` skal kunne hente en DEL af siden, og skal sige fra naar den
 * skaerer.
 *
 * MAALT 17/9 mod Stripe Dashboard: `format: "html"` svarede 1.042.782 tegn. Det spraenger
 * agentens kontekst-loft paa ét kald, og der er ingen maade at bede om mindre. Det gjorde
 * vaerktoejet ubrugeligt praecis paa de store, indloggede apps hvor det er mest vaerd.
 *
 * To ting mangler, og den anden er den vigtige:
 *   1. en `selector`, saa man kan hente den del af siden man er ude efter
 *   2. en oevre graense der SIGER at den skar - en tavs afkortning er samme fejlklasse
 *      som resten af ugen: et svar der ser helt ud, men ikke er det
 *
 * Proeven koerer den funktion udvidelsen FAKTISK sender, mod en haandbygget side.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele({ tekst = 'hele siden', delTekst = 'kun delen', findes = true } = {}) {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false, title: 'T' };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane], 'tabs.update': undefined, 'windows.update': undefined,
    'debugger.sendCommand': () => ({ result: { value: tekst } }),
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const del = findes ? { innerText: delTekst, outerHTML: `<div>${delTekst}</div>` } : null;
  const doc = {
    querySelector: () => del,
    body: { innerText: tekst },
    documentElement: { outerHTML: `<html>${tekst}</html>` },
  };
  u.ctx.chrome.scripting.executeScript = async ({ func, args }) => {
    // ⛔ Parentes om funktionen: uden den indsaetter JavaScript et semikolon efter `return`
    // naar kilden begynder paa en ny linje, og hver koersel svarer undefined.
    const f = new Function('document', 'return (' + String(func) + ')')(doc);
    return [{ result: f(...(args || [])) }];
  };
  return u;
}

const hent = (u, p = {}) => u.hent('dispatch')(9876, 'get_page_content', p);

test('uden selector hentes hele siden, som foer', async () => {
  const svar = await hent(sele({ tekst: 'hele siden' }));
  assert.equal(svar.content, 'hele siden', 'den gamle adfaerd maa ikke aendre sig');
});

test('med selector hentes kun den del', async () => {
  const svar = await hent(sele({ tekst: 'hele siden', delTekst: 'kun delen' }), { selector: '#main' });
  assert.equal(svar.content, 'kun delen',
    'selectoren blev ignoreret - saa er der stadig ingen vej til en stor side');
});

test('en selector der ikke findes siger det, i stedet for at give hele siden', async () => {
  const svar = await hent(sele({ findes: false }), { selector: '#findes-ikke' });
  assert.notEqual(svar.content, 'hele siden',
    'en forkert selector gav hele siden - agenten tror den laeser det den bad om');
  assert.equal(svar.ok, false, 'svaret meldte ikke fejl');
});

test('en side over graensen skaeres, og svaret SIGER at den blev skaaret', async () => {
  const kaempe = 'x'.repeat(60000);
  const svar = await hent(sele({ tekst: kaempe }));
  assert.ok(svar.content.length < kaempe.length, 'en side paa 60.000 tegn blev leveret hel');
  assert.equal(svar.afkortet, true, 'svaret skjuler at det blev skaaret');
  assert.equal(svar.tegn_i_alt, 60000, 'svaret oplyser ikke hvor stor siden faktisk er');
  assert.match(String(svar.note), /selector|max_chars/,
    'svaret siger ikke hvordan man faar den del man er ude efter');
});

test('en side under graensen faar ingen afkortnings-maerkater paa', async () => {
  const svar = await hent(sele({ tekst: 'kort' }));
  assert.notEqual(svar.afkortet, true, 'en kort side blev meldt afkortet');
});
