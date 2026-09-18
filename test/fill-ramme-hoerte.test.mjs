/**
 * `browser_fill` maa ikke svare ja bare fordi DOM'en viser den rigtige tekst.
 *
 * Dette er den aabne halvdel af issue #19, og den er vores egen fejlklasse ét niveau op.
 * De ni vaerktoejer vi lukkede i 1.29.2 svarede ja fordi CHROME kvitterede. Her svarer vi
 * ja fordi DOM'EN kvitterer - og en React-styret formular opfoerer sig bagefter som om
 * feltet var tomt. Brugeren ser sin tekst staa i feltet. Appen gemmer den aldrig.
 *
 * Det mekaniske svar: React haenger en `_valueTracker` paa elementet og opdaterer den naar
 * den selv har behandlet aendringen. Stemmer trackeren med feltets vaerdi, HAR rammen hoert
 * det. Stemmer den ikke, har den beviseligt ikke. Ingen tracker = ikke et rammestyret felt,
 * og saa er DOM-vaerdien hele sandheden.
 *
 * Hvorfor trackeren og ikke et navne-tjek: et bibliotek kan omdoebes, og `window.React` kan
 * vaere vaek i en produktionsbundt. Men to vaerdier der er ude af trit, kan ikke skjules.
 * Samme laere som huset har skrevet ned: soeg paa mekanikken, ikke paa navnet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { readFileSync } from 'node:fs';

/**
 * Rejser udvidelsen med et felt der ender med `slutVaerdi`, og en ramme hvis tracker
 * enten er enig (`true`), uenig (`false`) eller ikke findes (`null`).
 */
function sele({ slutVaerdi, ramme }) {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane,
    'tabs.query': [fane],
    'tabs.update': undefined,
    'windows.update': undefined,
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      if (metode !== 'Runtime.evaluate') return {};
      const udtryk = String(p?.expression || '');
      if (udtryk.includes('isContentEditable')) return { result: { value: false } };
      // Den NYE tilbagelaesning kendes paa at den spoerger om trackeren.
      if (udtryk.includes('_valueTracker')) return { result: { value: { v: slutVaerdi, ramme } } };
      if (udtryk.includes('el.value !== undefined')) return { result: { value: JSON.stringify({ value: slutVaerdi }) } };
      if (udtryk.includes("'value' in el")) return { result: { value: slutVaerdi } };
      return { result: { value: null } };
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async () => [{ result: null }];
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'INPUT', text: '' });
  return u;
}

const fyld = (u) => u.hent('dispatch')(9876, 'fill', { selector: '#navn', value: 'Gustav' });

test('tilbagelaesningen spoerger overhovedet om rammen hoerte det', () => {
  // Kalibrering mod et kendt-sandt tilfaelde: spoerger udtrykket ikke om trackeren,
  // maaler resten af filen ingenting - og alle proever herunder ville staa groenne.
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.match(kilde, /_valueTracker/,
    'tilbagelaesningen spoerger ikke om rammens egen opfattelse - saa kan den kun se DOM\'en');
  assert.match(kilde, /getValue/, 'trackeren laeses ikke, den tjekkes kun for at findes');
});

test('rammen hoerte det: helt almindeligt ja', async () => {
  const svar = await fyld(sele({ slutVaerdi: 'Gustav', ramme: true }));
  assert.equal(svar.ok, true, 'et felt rammen HAR hoert er ikke en fejl');
  assert.ok(!svar.ramme_hoerte_ikke, 'advarer om en ramme der faktisk hoerte efter');
  assert.equal(svar.vaerdi, 'Gustav');
});

test('DOM viser teksten, men rammen hoerte det IKKE - det maa ikke vaere et bart ja', async () => {
  const svar = await fyld(sele({ slutVaerdi: 'Gustav', ramme: false }));
  assert.equal(svar.ramme_hoerte_ikke, true,
    'DOM-vaerdien var rigtig og trackeren stod paa den gamle - det er positivt bevis for at ' +
    'formularen ikke har hoert det, og svaret fortier det. Det er hele issue #19');
  assert.match(String(svar.note), /tracker|tilstand/i, 'svaret siger ikke HVORFOR');
  assert.match(String(svar.note), /browser_click|browser_press_key|kontroll/i,
    'svaret giver ingen remedie - en advarsel uden udvej er stoej');
});

test('intet rammestyret felt: DOM-vaerdien er hele sandheden', async () => {
  const svar = await fyld(sele({ slutVaerdi: 'Gustav', ramme: null }));
  assert.equal(svar.ok, true);
  assert.ok(!svar.ramme_hoerte_ikke,
    'et felt uden tracker er ikke rammestyret - at advare der ville vaere et falskt nej, ' +
    'og et falskt nej er dyrere: agenten gentager handlingen');
});

test('tomt felt slaar stadig igennem, uanset hvad trackeren siger', async () => {
  const svar = await fyld(sele({ slutVaerdi: '', ramme: true }));
  assert.equal(svar.ok, false, 'et tomt felt er en fejl, ogsaa naar trackeren er enig i tomheden');
});
