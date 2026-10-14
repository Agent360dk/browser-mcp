/**
 * Agenten skal arbejde i en fane brugeren ikke kigger paa - uden at rive skaerm eller
 * mus til sig. Gustav 13/9: "det er vigtigt de koerer i baggrunden og ikke tager
 * skaerm / mus opmaerksomheden".
 *
 * ⛔ Den eksisterende vagt `test/baggrundsdrift.test.mjs` laeser `background.js` som
 * TEKST og taeller `getSessionTab(port, true)`. Den vogter ÉN formulering, ikke
 * egenskaben. Skriver nogen i stedet
 *
 *     await chrome.tabs.update(tab.id, { active: true });
 *     await chrome.windows.update(tab.windowId, { focused: true });
 *
 * direkte inde i et vaerktoej, er den proeve stadig groen - og brugerens fane ryger
 * alligevel. Fanen er netop hvor fejlen ville vaere billigst at begaa: hele
 * aerligheds-klassen vi lukkede i dag handler om at vaerktoejer svarer daarligere i
 * baggrunden, og den nemme "loesning" er at hente fanen frem.
 *
 * Denne proeve maaler i stedet HANDLINGEN: den koerer vaerktoejerne gennem selen og
 * ser paa hvad der faktisk blev sendt til Chrome.
 *
 * De to eneste vaerktoejer der MAA aktivere, staar nederst med deres begrundelse. Vinduet tages kun frem
 * med bring_to_front: true (14/10).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/** Rejser udvidelsen med en fane der IKKE er forrest, og svar nok til at naa igennem. */
function sele({ leverer = true } = {}) {
  let armeret = null;
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane,
    'tabs.query': [fane],
    'tabs.create': { id: 2, url: 'about:blank', windowId: 1, active: false },
    'tabs.update': undefined,
    'tabs.group': 1,
    'tabGroups.update': undefined,
    'windows.get': { id: 1, state: 'normal', focused: true },
    'windows.update': undefined,
    'windows.getLastFocused': { id: 1, state: 'normal' },
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Page.captureScreenshot') return { data: 'aGVq' };
      if (metode === 'Runtime.evaluate') {
        const udtryk = String(p?.expression || '');
        if (udtryk.includes('scrollX')) return { result: { value: { x: 0, y: 240 } } };
        if (udtryk.includes('activeElement')) return { result: { value: 'skrevet' } };
        if (udtryk.includes("tagName === 'SELECT'")) return { result: { value: false } };
        return { result: { value: null } };
      }
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'BUTTON', text: 'knap' });
  u.ctx.chrome.scripting.executeScript = async ({ func, args }) => {
    const kilde = String(func);
    if (kilde.includes('addEventListener')) { armeret = args?.[0]; return [{ frameId: 0, result: undefined }]; }
    if (kilde.includes('removeEventListener')) {
      if (armeret !== args?.[0]) return [{ result: { udskiftet: true } }];
      return [{ frameId: 0, result: { antal: leverer ? 1 : 0, traf: leverer } }];
    }
    return [{ result: { ok: true, method: 'exact', text: 'valgt' } }];
  };
  return u;
}

/** Alt i optageren der ville flytte brugerens fane eller vindue frem. */
function faneTyverier(optager) {
  const fund = [];
  for (const k of optager.kald) {
    if (k.sti === 'tabs.update' && k.args?.[1]?.active === true) fund.push('tabs.update({active:true})');
    if (k.sti === 'windows.update' && k.args?.[1]?.focused === true) fund.push('windows.update({focused:true})');
  }
  return fund;
}

// De vaerktoejer der roerer skaerm, mus eller tastatur. Praecis dem hvor "hent fanen
// frem" ville vaere den nemme genvej, og praecis dem Gustav bad om koerer i baggrunden.
const VAERKTOEJER = [
  ['click', { selector: '#x' }],
  ['click_xy', { x: 10, y: 10 }],
  ['double_click', { selector: '#x' }],
  ['right_click', { selector: '#x' }],
  ['hover', { selector: '#x' }],
  ['press_key', { key: 'Enter' }],
  ['fill', { selector: '#x', value: 'Gustav' }],
  ['fill', { selector: 'text=Navn', value: 'Gustav' }],
  ['scroll', { y: 240 }],
  ['screenshot', {}],
  ['select_option', { selector: '#x', option: 'a' }],
  ['set_combobox', { selector: '#x', value: 'abcd' }],
  ['get_page_content', {}],
];

for (const [vaerktoej, params] of VAERKTOEJER) {
  const navn = params.selector?.startsWith('text=') ? `${vaerktoej} (tekstvaelger)` : vaerktoej;
  test(`${navn} henter ikke brugerens fane frem`, async () => {
    const u = sele();
    await u.hent('dispatch')(9876, vaerktoej, params).catch(() => {});

    // ⛔ Uden den her gaar proeven groen paa et vaerktoej der kastede i doeren og
    // aldrig naaede nogen kode. Et instrument der svarer nul, maaler ingenting.
    assert.ok(u.optager.antal('tabs.get') > 0,
      `${navn} naaede aldrig frem til fanen - proeven maaler intet, og selen er for tynd`);

    const tyveri = faneTyverier(u.optager);
    assert.deepEqual(tyveri, [],
      `${navn} river brugerens fane eller vindue frem: ${tyveri.join(', ')}. ` +
      'Vaerktoejerne skal arbejde i baggrunden; fejler noget i en baggrundsfane, ' +
      'skal svaret sige det og lade agenten kalde browser_switch_tab.');
  });
}

test('kalibrering: opdageren ser en aktivering naar der ER en', async () => {
  // Kendt-sandt tilfaelde. `getSessionTab(port, true)` er den ene lovlige vej til at
  // aktivere, og den gaar gennem chrome.tabs.update. Ser opdageren ikke DEN, kan den
  // heller ikke se en ulovlig - og saa er alle proeverne ovenfor tomme.
  const u = sele();
  await u.hent('getSessionTab')(9876, true);
  assert.deepEqual(faneTyverier(u.optager), ['tabs.update({active:true})'],
    'opdageren fandt ikke den aktivering der beviseligt skete - den er blind');
});

test('kalibrering: opdageren ser ogsaa et vindue der tages i fokus', () => {
  const u = sele();
  u.chrome.windows.update(1, { focused: true });
  assert.deepEqual(faneTyverier(u.optager), ['windows.update({focused:true})'],
    'opdageren ser kun fane-skift, ikke at hele Chrome-vinduet rives frem');
});

test('switch_tab aktiverer fanen i sit eget vindue, naar brugeren sidder et andet sted - men tager ikke Chrome frem', async () => {
  // FUNDET 13/9 af Fable: her stod `assert.equal(typeof dispatch, 'function')`, som ikke kunne gaa roed. switch_tab er
  // agentens remedie naar en baggrundsfane ikke kan modtage mus og taster, saa den SKAL aktivere fanen i dens vindue.
  // 14/10 (Gustav: «den bliver ved med at tage min computer»): men vinduet tages ikke frem - 125 kald paa 8 minutter
  // hev Chrome foran ham hver gang.
  const u = sele();
  u.chrome.windows.get = async () => ({ id: 1, state: 'normal', focused: false });   // brugeren er i et andet program
  const svar = await u.hent('dispatch')(9876, 'switch_tab', { tab_id: 1 });
  assert.deepEqual(faneTyverier(u.optager), ['tabs.update({active:true})'],
    'switch_tab aktiverede ikke fanen - eller tog vinduet frem. Saa har agenten enten ingen vej ud af en baggrundsfane, ' +
    'eller den tager brugerens skaerm');
  assert.equal(svar.active, true);
  assert.equal(svar.windowFocused, null);
  // Uden den her saetning sender vaerktoejernes «call browser_switch_tab and try again» agenten i ring.
  assert.match(svar.note, /key presses, hover/);
  assert.match(svar.note, /browser_ask_user/);
});

test('switch_tab skifter ikke fanen i det vindue brugeren selv sidder i', async () => {
  const u = sele();   // windows.get svarer focused: true - brugeren arbejder i vinduet
  const svar = await u.hent('dispatch')(9876, 'switch_tab', { tab_id: 1 });
  assert.deepEqual(faneTyverier(u.optager), [], 'fanen blev skiftet under brugerens oejne');
  assert.equal(svar.active, false);
  assert.match(svar.note, /bring_to_front: true/);
  assert.match(svar.note, /browser_ask_user/);
  assert.equal(u.hent('sessions').get(9876).activeTabId, 1, 'de andre vaerktoejer skal stadig arbejde paa fanen');
});

test('switch_tab med bring_to_front: true tager fanen og vinduet frem', async () => {
  const u = sele();
  const svar = await u.hent('dispatch')(9876, 'switch_tab', { tab_id: 1, bring_to_front: true });
  assert.deepEqual(faneTyverier(u.optager), ['tabs.update({active:true})', 'windows.update({focused:true})']);
  assert.equal(svar.windowFocused, true);
});

test('switch_tab siger det, naar siden er skjult bag andre vinduer', async () => {
  const u = sele();
  u.chrome.windows.get = async () => ({ id: 1, state: 'normal', focused: false });
  u.ctx.chrome.scripting.executeScript = async () => [{ result: 'hidden' }];
  const svar = await u.hent('dispatch')(9876, 'switch_tab', { tab_id: 1 });
  assert.equal(svar.visibility, 'hidden');
  assert.match(svar.note, /browser_wait/);
  assert.match(svar.note, /bring_to_front: true/);
});

// FUNDET 13/9 af Fable: selen ovenfor lader hver haendelse LANDE. Den fristende genvej -
// "landed:false -> hent fanen frem -> proev igen" - ville netop blive skrevet i den gren
// proeverne aldrig koerte. Her koeres de samme vaerktoejer med en side der intet modtager.
for (const [vaerktoej, params] of VAERKTOEJER) {
  const navn = params.selector?.startsWith('text=') ? `${vaerktoej} (tekstvaelger)` : vaerktoej;
  test(`${navn} henter heller ikke fanen frem naar handlingen IKKE landede`, async () => {
    const u = sele({ leverer: false });
    await u.hent('dispatch')(9876, vaerktoej, params).catch(() => {});
    assert.ok(u.optager.antal('tabs.get') > 0, `${navn} naaede aldrig frem til fanen`);
    const tyveri = faneTyverier(u.optager);
    assert.deepEqual(tyveri, [],
      `${navn} river brugerens fane frem naar handlingen fejler: ${tyveri.join(', ')}. ` +
      'Det aerlige svar er remediet - ikke at tage skaermen.');
  });
}
