/**
 * CDP-kald skal have en frist. Uden den er der ingen reserveløsning.
 *
 * MAALT 8/9-2026: `browser_scroll` med pixels ramte 30-sekunders-loftet HVER gang,
 * paa baade en kort og en lang side, 6 kald ud af 6. Det var hverken siden eller
 * den dobbelte udvidelse - `press_key` og `reattach_debugger` gik gennem SAMME
 * debugger paa SAMME fane paa 128 og 161 ms i samme session.
 *
 * Aarsagen: `cdpSend` afventede `chrome.debugger.sendCommand` uden frist.
 * `Input.dispatchMouseEvent` med mouseWheel indfrier aldrig sit loefte, og den
 * `window.scrollBy` der er skrevet til netop det tilfaelde ligger i et `catch` -
 * saa den kunne aldrig naas. En haenger er ikke en exception.
 *
 * Testen bruger et sendCommand der ALDRIG svarer. Det er praecis hvad Chrome gjorde.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const aldrig = () => new Promise(() => {});

test('et CDP-kald der aldrig svarer, giver op i stedet for at haenge', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': aldrig,
  } });
  const t0 = Date.now();
  await assert.rejects(
    () => u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseWheel', deltaY: 300 }),
    /did not respond|timeout|frist/i,
    'kalderen skal faa en fejl, saa dens reserveloesning kan fyre',
  );
  const brugt = Date.now() - t0;
  assert.ok(brugt < 12000, `skal give op langt foer serverens 30 s-loft, brugte ${brugt} ms`);
});

test('et raskt CDP-kald venter ikke paa fristen', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': { ok: true },
  } });
  const t0 = Date.now();
  const r = await u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseWheel' });
  assert.deepEqual(r, { ok: true }, 'svaret skal komme uroert igennem');
  assert.ok(Date.now() - t0 < 500, 'et rask svar maa ikke koste ventetid');
});

// Det her er den vagt der faktisk daekker BRUGERENS oplevelse. De to ovenfor beviser at
// cdpSend afviser; kun den her beviser at scroll saa NAAR sin reserveloesning - og det var
// jo hele pointen. Maalt 9/9: 1.504 ms i stedet for 30.007, og window.scrollBy koert.
test('scroll ender med at rulle - reserveloesningen naas, og svaret siger hvorfor', async () => {
  const kald = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'debugger.sendCommand': (_m, metode, params) => {
      kald.push({ metode, expression: params?.expression });
      if (metode === 'Input.dispatchMouseEvent') return new Promise(() => {});   // hjulet tier
      // Siden skal svare som en RIGTIG side: hvor stod den foer, hvor staar den nu.
      // Foer 10/9 svarede selen `null`, og saa kunne testen ikke se forskel paa
      // "reserveloesningen rullede" og "reserveloesningen fejlede tavst".
      if (metode === 'Runtime.evaluate') {
        const udtryk = String(params?.expression || '');
        if (/scrollX/.test(udtryk) && !/scrollTo|scrollBy/.test(udtryk)) {
          return { result: { value: { x: 0, y: 0 } } };            // startpositionen
        }
        return { result: { value: { foer: { x: 0, y: 0 }, efter: { x: 0, y: 300 } } } };
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const t0 = Date.now();
  const svar = await u.hent('dispatch')(9876, 'scroll', { y: 300 });
  const brugt = Date.now() - t0;

  assert.equal(svar.ok, true, 'siden blev rullet - via reserveloesningen');
  assert.equal(svar.method, 'fallback', 'svaret skal sige AT det var reserveloesningen');
  assert.match(svar.fallback_reason || '', /did not respond/, 'og HVORFOR, saa fejlen kan foelges');
  assert.ok(brugt < 5000, `maa ikke koste 30 sekunder, brugte ${brugt} ms`);
  // 10/9: vagten kraevede scrollBy. Den blev udskiftet med scrollTo mod en beregnet
  // maal-position, fordi scrollBy lagde sig oveni det hjulet allerede havde naaet -
  // reproduceret: 900 px faktisk, 600 rapporteret. Vagten skal foelge mekanismen.
  assert.ok(kald.some((k) => /window\.scrollTo\(\d+ \+ 0, \d+ \+ 300\)/.test(k.expression || '')),
    'siden blev aldrig rullet - reserveloesningen skal ramme en beregnet maal-position');
});

test('cdpSend giver op naar hjulet tier, saa en reserveloesning KAN naas (selve scroll-reserveloesningen proeves i scroll-uvist)', async () => {
  // Det er HELE pointen: fristen findes for at reserveloesningen kan naas.
  const evalKald = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://example.com', windowId: 1 },
    'tabs.query': [{ id: 1, url: 'https://example.com', windowId: 1, active: true }],
    'debugger.sendCommand': (_maal, metode, params) => {
      if (metode === 'Input.dispatchMouseEvent') return new Promise(() => {});
      if (metode === 'Runtime.evaluate') {
        evalKald.push(params?.expression || '');
        return { result: { value: null } };
      }
      return {};
    },
  } });
  const svar = await u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseWheel', deltaY: 300 })
    .then(() => 'kom igennem', (e) => e.message);
  assert.match(String(svar), /did not respond|timeout|frist/i,
    'hjul-afsendelsen skal afvises, ikke haenge - ellers naar scroll aldrig sin reserveloesning');
});

// ── Fristen maa ikke haenge paa en dansk saetning ───────────────────────────
// FUNDET 19/9 af Astra: fire steder afgjorde «er det her en frist?» ved at regex-matche
// den danske tekst «svarede ikke inden» i fejlbeskeden - og dermed om svaret baerer
// `maaske_landet` og advarslen mod blind gentagelse. Astra oversatte teksten i hukommelsen
// og koerte samme press_key-forloeb: `maaske_landet` forsvandt. En ren tekstrettelse kunne
// altsaa tavst slaa den aerlighed fra som hele 1.29.2 handlede om.
//
// Samme lare som huset skrev ned 7/9: et ord kan ikke baere en regel. Fristen baerer nu et
// flag, og proeven her holder den til det - med en fejl hvis tekst er helt engelsk.
test('en frist genkendes paa sit flag, ikke paa sine ord', () => {
  const u = indlaesUdvidelse({ svar: { 'debugger.getTargets': [] } });
  const lav = u.hent('cdpFristFejl');
  const er = u.hent('erCdpFrist');

  const paaEngelsk = lav('CDP did not respond within 1500 ms: Input.dispatchKeyEvent');
  assert.equal(er(paaEngelsk), true,
    'en frist med engelsk tekst blev ikke genkendt - saa ville en oversaettelse fjerne maaske_landet');

  assert.equal(er(new Error('noget helt andet gik galt')), false,
    'alt muligt bliver regnet som en frist');

  // Bagstopperen: en fejl der er rejst et andet sted fra, uden flag, men med den gamle tekst.
  assert.equal(er(new Error('CDP svarede ikke inden 1500 ms: Input.dispatchKeyEvent')), true,
    'bagstopperen for gamle fejl er vaek');
});

test('ingen af fristens forbrugere afgoer sagen paa prosaen alene', async () => {
  const { readFileSync } = await import('node:fs');
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  // Vagten udtrykkes som det den vogter: UDEN FOR erCdpFrist maa ingen afgoere sagen paa
  // prosaen. En optaelling gik i stykker da teksten skiftede sprog - og en vagt der braekker
  // af sit eget formaal, maaler ikke laengere det den blev skrevet til.
  const iHjaelper = kilde.indexOf('function erCdpFrist');
  const hjaelper = kilde.slice(iHjaelper, kilde.indexOf('\n}', iHjaelper));
  assert.match(hjaelper, /did not respond within\|svarede ikke inden/,
    'bagstopperen kender ikke begge ordlyde - en gammel fejl ville miste sit maaske_landet');
  const udenHjaelper = kilde.slice(0, iHjaelper) + kilde.slice(kilde.indexOf('\n}', iHjaelper));
  const prosaMatch = [...udenHjaelper.matchAll(/\/[^/\n]*(did not respond within|svarede ikke inden)[^/\n]*\//g)]
    .filter((m) => !/^\s*\/\//.test(udenHjaelper.slice(udenHjaelper.lastIndexOf('\n', m.index), m.index)));
  assert.equal(prosaMatch.length, 0,
    `${prosaMatch.length} steder uden for erCdpFrist matcher fristens tekst: ${prosaMatch.map((m) => m[0]).join(', ')}`);
});
