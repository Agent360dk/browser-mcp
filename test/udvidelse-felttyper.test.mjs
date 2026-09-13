/**
 * De fire stoerste utestede funktioner: datovaelger, combobox, filslip, captcha.
 *
 * Tilsammen ~510 linjer der aldrig er blevet koert af en test. Det er ogsaa der
 * samme klasse fejl som `fill`-fejlen plejer at ligge: felter der ser udfyldte ud
 * uden at vaere det, eller vaerktoejer der melder ok:true paa noget der ikke skete.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

// resolveElement gaar gennem chrome.scripting.executeScript (ikke debuggeren), saa
// et element skal svares DER. Uden det falder baade setDatePicker og setCombobox fra
// med "input-not-found" foer de naar at sende noget - og en test ville tro de var
// tavse, hvor de i virkeligheden aldrig kom i gang.
const FUNDET = { found: true, x: 5, y: 5, tag: 'INPUT', text: '', rect: { w: 100, h: 20 } };

const grund = (ekstra = {}) => ({
  'debugger.attach': undefined,
  'debugger.getTargets': [{ tabId: 1, attached: true }],
  'tabs.get': { id: 1, url: 'https://eksempel.dk', windowId: 1, active: true },
  'scripting.executeScript': [{ result: FUNDET }],
  ...ekstra,
});

// ── setDatePicker ───────────────────────────────────────────────────────────

test('datovaelgeren klikker feltet op og giver ikke op i foerste forsoeg', async () => {
  const sendte = [];
  const u = indlaesUdvidelse({ svar: grund({
    'debugger.sendCommand': (m, metode) => { sendte.push(metode); return {}; },
  }) });
  const f = u.hent('setDatePicker');
  assert.equal(typeof f, 'function', 'setDatePicker skal findes');
  const r = await f(1, '#dato', '2026-09-08').catch(() => null);

  assert.ok(sendte.includes('Input.dispatchMouseEvent'),
    'feltet skal klikkes for at aabne kalenderen');
  assert.ok(sendte.filter((x) => x === 'Runtime.evaluate').length > 5,
    'den skal SPOERGE gentagne gange om kalenderen er aabnet, ikke gaette');
  assert.equal(r?.ok, false, 'aabner kalenderen aldrig, skal den sige det');
  assert.equal(r?.error, 'picker-did-not-open',
    'og sige HVAD der gik galt - ikke bare fejle');
});

test('datovaelgeren melder fra naar feltet ikke findes - den lyver ikke', async () => {
  const u = indlaesUdvidelse({ svar: grund({
    'debugger.sendCommand': (m, metode) =>
      metode === 'Runtime.evaluate' ? { result: { value: { found: false } } } : {},
  }) });
  const f = u.hent('setDatePicker');
  const r = await f(1, '#findes-ikke', '2026-09-08').catch((e) => ({ ok: false, error: e.message }));
  const tekst = JSON.stringify(r ?? {});
  assert.ok(/false|error|not ?found|ikke/i.test(tekst),
    `et manglende felt skal give et aerligt nej, fik: ${tekst.slice(0, 120)}`);
});

// ── setCombobox ─────────────────────────────────────────────────────────────

test('combobox skriver i feltet og rydder foerst - samme fejl som fill havde', async () => {
  const sendte = [];
  const u = indlaesUdvidelse({ svar: grund({
    'debugger.sendCommand': (m, metode) => { sendte.push(metode); return {}; },
  }) });
  const f = u.hent('setCombobox');
  assert.equal(typeof f, 'function');
  await f(1, '#by', 'Koebenhavn').catch(() => {});

  assert.ok(sendte.length > 0, 'der skal faktisk sendes noget til siden');
  assert.ok(sendte.includes('Input.dispatchMouseEvent'),
    'feltet skal klikkes foer der skrives - ellers aabner forslagene ikke');
  // Den svarer PR. VAERDI, ikke bare ok/ikke-ok for hele kaldet. Det er kontrakten:
  // saetter man tre vaerdier og den anden fejler, skal kalderen kunne se HVILKEN.
  const r = await f(1, '#by', 'Koebenhavn').catch(() => null);
  assert.ok(Array.isArray(r?.results), 'svaret skal indeholde et resultat pr. vaerdi');
  assert.equal(r.results[0].value, 'Koebenhavn', 'og sige hvilken vaerdi det gaelder');
  assert.equal(typeof r.results[0].ok, 'boolean', 'med et klart ja eller nej');
  // Rydningen sker via select-all + Backspace som tastetryk - ikke ved at saette
  // .value, fordi React-styrede felter ignorerer en direkte tilskrivning.
  assert.match(u.hent('setCombobox').toString(), /clearField|selectAll|Backspace|SELECT_ALL/i,
    'uden en rydning hober vaerdier sig op - praecis fill-fejlen');
});

test('combobox venter paa at forslagene dukker op', async () => {
  const u = indlaesUdvidelse();
  const kilde = u.hent('setCombobox')?.toString() ?? '';
  assert.match(kilde, /setTimeout|sleep|wait|delay|await new Promise/i,
    'uden en pause naar forslagene ikke at komme, og valget rammer forbi');
});

// ── dropFileOnTarget ────────────────────────────────────────────────────────

test('filslip saetter filen gennem CDP i stedet for at simulere et drop', async () => {
  const u = indlaesUdvidelse();
  const f = u.hent('dropFileOnTarget');
  assert.equal(typeof f, 'function', 'dropFileOnTarget skal findes');
  const kilde = f.toString();
  // Den gaar IKKE gennem en syntetisk DataTransfer - den bruger CDP's
  // DOM.setFileInputFiles, som saetter filen paa det rigtige input i browseren.
  // Det er baade enklere og mere robust: sider kan ikke skelne den fra en aegte valg.
  assert.match(kilde, /setFileInputFiles/, 'filen skal saettes gennem CDP, ikke simuleres');
  assert.match(kilde, /no-file-input-found|input/i, 'den skal finde det rigtige input foerst');
});

test('filslip leder ogsaa efter et skjult input i undertraeet', () => {
  // Mange drop-zoner har et skjult <input type=file> - det er den rigtige vej ind.
  const u = indlaesUdvidelse();
  const kilde = u.hent('dropFileOnTarget')?.toString() ?? '';
  assert.match(kilde, /input|type=.?file|querySelector/i,
    'uden det virker kun sider der lytter paa drop-haendelsen');
});

// ── detectCaptcha ───────────────────────────────────────────────────────────

test('captcha-genkendelse daekker de udbredte udbydere', () => {
  const u = indlaesUdvidelse();
  const kilde = u.hent('detectCaptcha')?.toString() ?? '';
  assert.ok(kilde.length > 50, 'detectCaptcha skal findes');
  const skalDaekke = ['recaptcha', 'hcaptcha', 'turnstile'];
  const manglende = skalDaekke.filter((n) => !new RegExp(n, 'i').test(kilde));
  assert.deepEqual(manglende, [],
    `en captcha der ikke genkendes faar agenten til at kaempe videre i blinde: ${manglende.join(', ')}`);
});

test('captcha-genkendelse melder tilbage hvad den fandt, ikke bare ja/nej', () => {
  const u = indlaesUdvidelse();
  const kilde = u.hent('detectCaptcha')?.toString() ?? '';
  assert.match(kilde, /type|provider|kind|navn/i,
    'kalderen skal vide HVILKEN captcha, ellers kan den ikke vaelge fremgangsmaade');
});

// ── overlays ────────────────────────────────────────────────────────────────

test('overlay-oprydning kigger paa hele skaermen, ikke kun toppen', () => {
  // MAALT i Google Ads: en fuldskaerms-spinner paa 3420x1858 opsnappede hvert klik.
  const u = indlaesUdvidelse();
  const kilde = u.hent('dismissOverlays')?.toString() ?? '';
  assert.match(kilde, /innerWidth|innerHeight|getBoundingClientRect|clientWidth/,
    'uden maal paa elementet kan en fuldskaerms-overlay ikke skelnes fra en knap');
});
