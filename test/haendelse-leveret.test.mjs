/**
 * Ingen af musevaerktoejerne maa svare ja, fordi Chrome KVITTEREDE. Kun fordi siden MODTOG.
 *
 * MAALT 13/9 af Astra (hul-audit efter at press_key blev fanget i at lyve): seks vaerktoejer
 * doemte paa kvitteringen i stedet for paa leveringen.
 *
 *   press_key                       loej - CDP kvitterer, tasten leveres ikke (rettet, egen fil)
 *   hover, double_click, right_click  ok:true UBETINGET
 *   fill(text=)                       ok:true uden at laese feltet
 *   scroll (den gode sti)             ok:true med de tal der blev BEDT om, ikke dem siden staar paa
 *
 * De fem sidste loej ikke i dag - men kun fordi musen HAENGER i en baggrundsfane, saa
 * 1500 ms-fristen reddede svaret. De var aerlige ved HELD, ikke ved design. Et element under
 * et overlay, en side der sluger haendelsen, eller et klik der ramte ved siden af giver samme
 * falske ja som press_key gav paa Enter - uden nogen frist til at fange det.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/** Rejser udvidelsen med en side der enten modtager haendelsen eller ikke goer. */
function sele({ leverer, feltVaerdi, rulPosition }) {
  let armeret = null;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    // MAALT 19/9: fanen var `active: false`, og scroll springer nu hjul-stien over for en
    // fane der ikke er aktiv i sit vindue - saa proeven maalte reserveloesningen i stedet for
    // det hjul den er skrevet for. Fanen skal vaere aktiv, ellers maaler den ikke sit emne.
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode !== 'Runtime.evaluate') return {};
      const udtryk = String(p?.expression || '');
      if (udtryk.includes('scrollX')) return { result: { value: rulPosition ?? { x: 0, y: 0 } } };
      if (udtryk.includes('activeElement')) return { result: { value: feltVaerdi ?? null } };
      return { result: { value: null } };
    },
    'tabs.update': undefined,
    'windows.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'BUTTON', text: 'knap' });
  u.ctx.chrome.scripting.executeScript = async ({ func, args }) => {
    const kilde = String(func);
    if (kilde.includes('addEventListener')) { armeret = args[0]; return [{ result: undefined }]; }
    if (kilde.includes('removeEventListener')) {
      if (armeret !== args[0]) return [{ result: { udskiftet: true } }];
      return [{ result: { antal: leverer ? 1 : 0 } }];
    }
    return [{ result: null }];
  };
  return u;
}

for (const [vaerktoej, felt] of [
  ['hover', null],
  ['double_click', 'double_clicked'],
  ['right_click', 'right_clicked'],
]) {
  test(`${vaerktoej} melder ikke succes paa en haendelse siden aldrig modtog`, async () => {
    const u = sele({ leverer: false });
    const svar = await u.hent('dispatch')(9876, vaerktoej, { selector: '#x' });
    assert.equal(svar.ok, false,
      `${vaerktoej} svarede ja fordi Chrome kvitterede. Ingen lytter i siden modtog haendelsen`);
    assert.equal(svar.landed, false, `${vaerktoej} oplyser ikke at haendelsen ikke landede`);
    assert.match(String(svar.note), /baggrunden|switch_tab/i, `${vaerktoej} giver ikke brugeren remedien`);
    if (felt) assert.notEqual(svar[felt], true, `${vaerktoej} paastaar stadig ${felt}:true`);
  });

  test(`${vaerktoej} melder succes naar siden FAKTISK modtog haendelsen`, async () => {
    const u = sele({ leverer: true });
    const svar = await u.hent('dispatch')(9876, vaerktoej, { selector: '#x' });
    assert.equal(svar.ok, true, `${vaerktoej} meldte fejl paa en haendelse der landede`);
    assert.equal(svar.landed, true, `${vaerktoej} oplyser ikke at haendelsen landede`);
    if (felt) assert.equal(svar[felt], true, `${vaerktoej} oplyser ikke ${felt}`);
  });
}

test('fill med tekstvaelger melder ikke succes paa et felt der stod tomt', async () => {
  const u = sele({ leverer: false, feltVaerdi: '' });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Navn', value: 'Gustav' });
  assert.equal(svar.ok, false, 'fill svarede ja paa et felt der stod tomt bagefter');
  assert.match(String(svar.error), /tomt/, 'svaret siger ikke hvad der var galt');
});

test('fill med tekstvaelger melder succes naar vaerdien faktisk staar i feltet', async () => {
  const u = sele({ leverer: true, feltVaerdi: 'Gustav' });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Navn', value: 'Gustav' });
  assert.equal(svar.ok, true, 'fill meldte fejl paa en vaerdi der landede');
  assert.equal(svar.vaerdi, 'Gustav', 'svaret oplyser ikke den laeste vaerdi');
});

test('fill med tekstvaelger siger til naar siden formaterede vaerdien om', async () => {
  const u = sele({ leverer: true, feltVaerdi: '1.234,50 kr' });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Beloeb', value: '1234.5' });
  assert.equal(svar.ok, true, 'en side der formaterer paent er ikke en fejl');
  assert.equal(svar.afviger, true, 'svaret skjuler at feltet indeholder noget andet');
});

test('scroll melder den position siden STAAR paa, ikke den der blev bedt om', async () => {
  const u = sele({ leverer: true, rulPosition: { x: 0, y: 0 } });
  const svar = await u.hent('dispatch')(9876, 'scroll', { y: 600 });
  assert.notDeepEqual(svar.scrolled, { x: 0, y: 600 },
    'scroll svarede med det tal der blev bedt om i stedet for det siden endte paa');
  assert.equal(svar.uvist, true,
    'siden stod samme sted bagefter, og det blev ikke sagt - en rulning der ikke flyttede noget meldes som succes');
});

// ── Delvise ramme-svar: UVIST, ikke nej ─────────────────────────────────────
//
// FUNDET 13/9 af Astra. Armeringen kastede sit eget resultat vaek, saa antallet af
// armerede rammer kunne aldrig sammenlignes med antallet der svarede. Svarede
// hovedrammen ikke, mens én iframe sagde "ingen haendelse", blev dommen `landed:false`.
//
// Retningen er det farlige. Et falsk NEJ faar agenten til at GENTAGE handlingen - og et
// klik der allerede landede, bliver til to. Det er dyrere end det falske ja vi fjernede.
test('svarer faerre rammer end der blev armeret, er dommen uvist - ikke nej', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: false },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: false }],
    'debugger.sendCommand': () => ({ result: { value: null } }),
    'tabs.update': undefined, 'windows.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'BUTTON', text: 'knap' });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => {
    const kilde = String(func);
    // To rammer armeres (hovedramme + iframe) ...
    if (kilde.includes('addEventListener')) return [{ result: undefined }, { result: undefined }];
    // ... men kun den ene kan laeses bagefter, og den saa ingen haendelse.
    if (kilde.includes('removeEventListener')) return [{ result: { antal: 0 } }];
    return [{ result: null }];
  };
  const svar = await u.hent('dispatch')(9876, 'hover', { selector: '#x' });
  assert.equal(svar.landed, null,
    'to rammer blev armeret, én svarede. Det kan ikke skelnes fra "den ramme der fik den, kunne ikke laeses" - ' +
    'og et falsk nej faar agenten til at gentage handlingen');
  assert.equal(svar.ok, true, 'uvist er ikke det samme som mislykket');
});

// ── En ny iframe maa ikke kunne lyve beviset groent ─────────────────────────
//
// FUNDET 13/9 af Fable, bevist mod den aegte kode. `udskiftet` betyder "maerket er vaek",
// og det blev laest som "siden navigerede, saa haendelsen landede". Men en ramme der aldrig
// HAVDE maerket svarer praecis det samme - og der kommer rammer til hele tiden: annoncer,
// GTM, reCAPTCHA, YouTube-indlejringer. hover holder i 500 ms, rigeligt.
//
// Resultatet var et falsk JA i selve bevis-apparatet: hovedrammen saa ingen haendelse, en
// tilkommen annonce-ramme sagde "udskiftet", og fire vaerktoejer svarede landed:true.
// Det er den loegn 1.29.2 bliver udgivet for at fjerne.
for (const [vaerktoej, params] of [
  ['hover', { selector: '#x' }],
  ['double_click', { selector: '#x' }],
  ['right_click', { selector: '#x' }],
  ['press_key', { key: 'Enter' }],
]) {
  test(`${vaerktoej} lader sig ikke narre af en iframe der kom til undervejs`, async () => {
    const u = indlaesUdvidelse({ svar: {
      'debugger.attach': undefined, 'debugger.detach': undefined,
      'debugger.getTargets': [{ tabId: 1, attached: true }],
      'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: false },
      'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: false }],
      'debugger.sendCommand': () => ({ result: { value: null } }),
      'tabs.update': undefined, 'windows.update': undefined,
    } });
    u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
    u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'BUTTON', text: 'knap' });
    u.ctx.chrome.scripting.executeScript = async ({ func }) => {
      const k = String(func);
      if (k.includes('addEventListener')) return [{ frameId: 0, result: undefined }];
      if (k.includes('removeEventListener')) return [
        { frameId: 0, result: { antal: 0, traf: false } },   // hovedrammen fik intet
        { frameId: 7, result: { udskiftet: true } },         // annonce-ramme, aldrig armeret
      ];
      return [{ result: null }];
    };
    const svar = await u.hent('dispatch')(9876, vaerktoej, params);
    assert.notEqual(svar.landed, true,
      `${vaerktoej} svarede landed:true fordi en fremmed ramme manglede maerket. ` +
      'Hovedrammen sagde udtrykkeligt at den intet modtog');
    assert.doesNotMatch(String(svar.note || ''), /navigerede/,
      `${vaerktoej} paastaar at siden navigerede, fordi en annonce-iframe kom til`);
  });
}

test('kalibrering: hovedrammens EGEN udskiftning betyder stadig at siden navigerede', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: false },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: false }],
    'debugger.sendCommand': () => ({ result: { value: null } }),
    'tabs.update': undefined, 'windows.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'BUTTON', text: 'knap' });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => {
    const k = String(func);
    if (k.includes('addEventListener')) return [{ frameId: 0, result: undefined }];
    if (k.includes('removeEventListener')) return [{ frameId: 0, result: { udskiftet: true } }];
    return [{ result: null }];
  };
  const svar = await u.hent('dispatch')(9876, 'double_click', { selector: '#x' });
  assert.equal(svar.landed, true,
    'hovedrammen mistede maerket, og det sker kun ved en navigation - den dom maa ikke gaa tabt');
});
