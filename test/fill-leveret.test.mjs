/**
 * `browser_fill` maa ikke svare ja paa et felt der staar tomt bagefter. Heller ikke
 * paa den ALMINDELIGE vej med en CSS-vaelger.
 *
 * FUNDET 13/9 af Astra, efter at de otte andre vaerktoejer var lukket. Tekst-vaelger-grenen
 * blev rettet samme dag; CSS-grenen stod stadig aaben, og den er den mest brugte af dem alle:
 *
 *     await debuggerFill(tab.id, parsed.selector, params.value);
 *     return { ok: true, method: 'debugger' };        // nul tilbagelaesninger
 *
 * `debuggerFill` laeser ganske vist feltet efter `Input.insertText` - men kun for at afgoere
 * om reserveloesningen skal koere. Naar den saa taster vaerdien tegn for tegn med
 * `Input.dispatchKeyEvent` (praecis den kommando der blev maalt i at lyve 13/9), laeser den
 * ALDRIG igen. Leveres tasterne heller ikke, kastes der intet, og kalderen faar ok:true paa
 * et tomt felt.
 *
 * Det er samme form som 8/9-fejlen ("test@example.dkanden@example.dk", begge kald ok:true)
 * og som scroll-fejlen 10/9: fejl-grenen laeser feltet tre gange, den lykkelige gren nul.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/** Rejser udvidelsen med et felt der ender med `slutVaerdi` - eller ikke kan laeses. */
function sele({ slutVaerdi, ulaeseligt = false }) {
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
      if (ulaeseligt) return { result: { value: null } };
      // readBackValue svarer en JSON-streng, ikke en raa vaerdi.
      if (udtryk.includes('el.value !== undefined')) return { result: { value: JSON.stringify({ value: slutVaerdi }) } };
      // Baade rydningen, "landede noget" og den nye tilbagelaesning gaar gennem value-udtryk.
      if (udtryk.includes("'value' in el") || udtryk.includes('"value" in a') || udtryk.includes("'value' in a")) {
        return { result: { value: slutVaerdi } };
      }
      return { result: { value: null } };
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async () => [{ result: null }];
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'INPUT', text: '' });
  return u;
}

test('fill med CSS-vaelger melder ikke succes paa et felt der staar tomt', async () => {
  const u = sele({ slutVaerdi: '' });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#navn', value: 'Gustav' });
  assert.equal(svar.ok, false,
    'fill svarede ja paa et tomt felt. Baade insertText og tegn-for-tegn-reserveloesningen ' +
    'blev kvitteret uden at blive leveret, og ingen saa paa feltet bagefter');
  assert.match(String(svar.error), /tomt/, 'svaret siger ikke hvad der var galt');
  assert.match(String(svar.note), /baggrund|switch_tab/i, 'svaret giver ikke brugeren remedien');
});

test('fill med CSS-vaelger melder succes naar vaerdien faktisk staar der', async () => {
  const u = sele({ slutVaerdi: 'Gustav' });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#navn', value: 'Gustav' });
  assert.equal(svar.ok, true, 'fill meldte fejl paa en vaerdi der landede');
  assert.equal(svar.vaerdi, 'Gustav', 'svaret oplyser ikke den laeste vaerdi');
});

test('fill med CSS-vaelger siger til naar siden formaterede vaerdien om', async () => {
  const u = sele({ slutVaerdi: '1.234,50 kr' });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#beloeb', value: '1234.5' });
  assert.equal(svar.ok, true, 'en side der formaterer paent er ikke en fejl');
  assert.equal(svar.afviger, true, 'svaret skjuler at feltet indeholder noget andet');
});

test('kan feltet ikke laeses, er svaret UVIST - aldrig et falskt ja eller nej', async () => {
  const u = sele({ slutVaerdi: '', ulaeseligt: true });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#navn', value: 'Gustav' });
  assert.equal(svar.ok, true, 'uvist er ikke det samme som mislykket');
  assert.equal(svar.uvist, true, 'svaret paastaar at vide noget det ikke ved');
});

// ── set_combobox: ok:true paa nul arbejde ────────────────────────────────────
// Fundet samme dag. Vagten i handleren er `if (!params.values && !params.value)`, og
// `![]` er falsk - saa en tom liste slipper igennem, loekken koerer nul gange, og
// `[].every(...)` er sandt. Vaerktoejet svarer succes uden at have roert siden.
test('set_combobox svarer ikke ja paa en tom liste af vaerdier', async () => {
  const u = sele({ slutVaerdi: '' });
  const svar = await u.hent('dispatch')(9876, 'set_combobox', { selector: '#x', values: [] });
  assert.equal(svar.ok, false,
    'set_combobox svarede ja uden at vaelge noget. En tom liste er ikke en udfoert handling');
  assert.match(String(svar.error), /value|vaerdi/i, 'svaret siger ikke hvad der manglede');
});

// ── set_combobox: "no-options-rendered" var en rigtig fejl med forkert forklaring ──
//
// FUNDET 13/9 af Astra. Vejen til en dropdown er: klik feltet -> skriv soegetekst med
// `Input.insertText` -> vent paa at listen kommer. Baade klikket og skrivningen er
// CDP-kommandoer der KVITTERER uden at love levering. Lander ingen af dem, kommer listen
// aldrig - og vaerktoejet svarede `no-options-rendered`, som peger paa siden.
//
// Vi kan ikke maale om klikket blev leveret uden at bygge et bevis til. Men vi KAN laese
// feltet: staar soegeteksten der ikke, naaede den aldrig frem, og saa er det ikke siden
// der mangler muligheder. Svaret skal sige det vi maalte, ikke det vi gaetter.
test('set_combobox siger at soegeteksten aldrig naaede feltet - ikke at siden manglede muligheder', async () => {
  const u = sele({ slutVaerdi: '' });          // feltet staar tomt efter skrivningen
  const svar = await u.hent('dispatch')(9876, 'set_combobox', { selector: '#by', value: 'Koebenhavn', wait_ms: 200 });
  const f = svar.results?.[0] || svar;
  assert.notEqual(f.error, 'no-options-rendered',
    'svaret giver siden skylden for en soegetekst der aldrig kom frem til feltet');
  assert.match(String(f.error), /ikke-leveret|tom/,
    `svaret siger ikke hvad der faktisk blev maalt: ${JSON.stringify(f)}`);
});

test('set_combobox giver stadig siden skylden naar teksten FAKTISK stod i feltet', async () => {
  const u = sele({ slutVaerdi: 'Koeb' });      // soegeteksten naaede frem, listen kom bare ikke
  const svar = await u.hent('dispatch')(9876, 'set_combobox', { selector: '#by', value: 'Koebenhavn', wait_ms: 200 });
  const f = svar.results?.[0] || svar;
  assert.equal(f.error, 'no-options-rendered',
    'teksten stod i feltet, saa det ER siden der ikke viste nogen muligheder - den diagnose skal bevares');
});

// ── Aabningsklikket i set_combobox kastede sin egen maaling vaek ────────────
//
// FUNDET 13/9 af BAADE Astra og Fable, uafhaengigt. Vejen til en dropdown starter med et
// klik der aabner den, og `debuggerClick` svarer allerede om det landede - samme maaling
// som click, click_xy og select_option deler via `klikLandede()`. set_combobox var det ene
// sted der smed svaret vaek. Landede klikket ikke (et overlay, et cookie-banner), gik
// soegeteksten i det felt der HAVDE fokus, og vi ventede 3 sekunder for saa at sige
// "no-options-rendered" - en bivirkning i et fremmed felt, meldt som sidens skyld.
test('set_combobox siger til naar klikket der skulle aabne listen ikke landede', async () => {
  const u = sele({ slutVaerdi: 'noget' });
  u.ctx.debuggerClick = async () => ({ landed: false, fallbackFired: false });
  const svar = await u.hent('dispatch')(9876, 'set_combobox', { selector: '#by', value: 'Koebenhavn', wait_ms: 200 });
  const f = svar.results?.[0] || svar;
  assert.notEqual(f.error, 'no-options-rendered',
    'svaret giver siden skylden, men klikket der skulle aabne listen naaede aldrig frem');
  assert.match(String(f.error), /klik/i, `svaret siger ikke at det var klikket: ${JSON.stringify(f)}`);
});

test('et UVIST klik stopper ikke set_combobox - vi ved ikke at det gik galt', async () => {
  const u = sele({ slutVaerdi: 'Koeb' });
  u.ctx.debuggerClick = async () => ({ landed: null, uverificeret: true });
  const svar = await u.hent('dispatch')(9876, 'set_combobox', { selector: '#by', value: 'Koebenhavn', wait_ms: 200 });
  const f = svar.results?.[0] || svar;
  assert.equal(f.error, 'no-options-rendered',
    'et uvist klik er ikke et mislykket klik - saa skal den gaa hele vejen som foer');
});
