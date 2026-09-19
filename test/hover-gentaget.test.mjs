/**
 * `browser_hover` paa et element markoeren ALLEREDE staar paa maa ikke melde "ikke leveret".
 *
 * ANTAGET 13/9 af Fable, MAALT 18/9 i flow-spaerren: Blink fyrer `mouseover` KUN naar
 * elementet under markoeren skifter. Anden gang giver `mousemove`. Beviset lyttede kun paa
 * `mouseover`, saa en helt almindelig raekkefoelge - klik paa noget, hover saa det samme -
 * svarede `hover-not-delivered`.
 *
 * Han kunne ikke maale det selv (fejlfinderen spoegelses-fastgjorde sig i hans Chrome), saa
 * vi rettede IKKE paa antagelsen. I stedet blev maalingen lagt ind i flow-spaerren, og
 * foerste rigtige koersel gav ham ret.
 *
 * ⛔ Retningen er den farlige. Et falsk NEJ faar agenten til at kalde switch_tab og proeve
 * igen paa noget der virkede. Det er dyrere end det falske ja vi fjernede i 1.29.2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/** `fyrer` er de haendelsestyper siden FAKTISK udloeser naar musen bevaeger sig. */
function sele({ fyrer }) {
  let armeret = null, armeredeTyper = [];
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane], 'tabs.update': undefined, 'windows.update': undefined,
    'debugger.sendCommand': () => ({}),
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'BUTTON', text: 'knap' });
  u.ctx.chrome.scripting.executeScript = async ({ func, args }) => {
    const kilde = String(func);
    if (kilde.includes('addEventListener')) {
      armeret = args?.[0];
      armeredeTyper = [].concat(args?.[1] ?? []);
      return [{ frameId: 0, result: undefined }];
    }
    if (kilde.includes('removeEventListener')) {
      if (armeret !== args?.[0]) return [{ frameId: 0, result: { udskiftet: true } }];
      // Lytteren taeller kun de typer den faktisk blev armeret paa.
      const traf = armeredeTyper.some((t) => fyrer.includes(t));
      return [{ frameId: 0, result: { antal: traf ? 1 : 0 } }];
    }
    return [{ result: null }];
  };
  return u;
}

test('foerste hover: siden fyrer mouseover, og det meldes som landet', async () => {
  const u = sele({ fyrer: ['mouseover', 'mousemove'] });
  const svar = await u.hent('dispatch')(9876, 'hover', { selector: '#x' });
  assert.equal(svar.landed, true, 'et helt almindeligt hover blev ikke meldt som landet');
});

test('hover paa det element markoeren allerede staar paa: KUN mousemove fyrer', async () => {
  // Det er tilfaeldet flow-spaerren fangede 18/9.
  const u = sele({ fyrer: ['mousemove'] });
  const svar = await u.hent('dispatch')(9876, 'hover', { selector: '#x' });
  assert.notEqual(svar.ok, false,
    'anden hover paa samme element blev meldt "ikke leveret" - agenten skifter fane og proever ' +
    'igen paa noget der virkede');
  assert.equal(svar.landed, true,
    `musen naaede siden, den flyttede sig bare ikke til et NYT element: ${JSON.stringify(svar)}`);
});

test('en side der intet modtager meldes stadig aerligt som ikke-leveret', async () => {
  // Kalibrering: rettelsen maa ikke goere beviset blindt.
  const u = sele({ fyrer: [] });
  const svar = await u.hent('dispatch')(9876, 'hover', { selector: '#x' });
  assert.equal(svar.ok, false, 'et hover der aldrig naaede siden blev meldt som succes');
  assert.match(String(svar.note), /baggrunden|switch_tab/i, 'svaret giver ikke remedien');
});
