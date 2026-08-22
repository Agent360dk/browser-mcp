// Tester at `click` fortæller sandheden om hvad der skete.
//
// Baggrund (målt 21/8): en hel nat gik med at diagnosticere et klik der "ikke virkede".
// To fejl i browser-mcp gjorde det umuligt at se hvad der foregik:
//
//   1. `click` svarede ok:true saa snart eventet var sendt — uanset om siden reagerede.
//      Svaret blev endda ALLEREDE beregnet inde i debuggerClick (`const landed = ...`)
//      og smidt vaek. Havde den ene vaerdi vaeret med, var paastanden "klikket virker
//      ikke" blevet modsagt tre gange paa stribe.
//
//   2. resolveElement returnerede elementets midtpunkt uden at tjekke synlighed. Et
//      skjult element har rect 0x0 ved (0,0), saa midtpunktet blev (0,0) — og
//      debuggerClick sendte et AEGTE museklik i sidens oeverste venstre hjoerne, paa
//      hvad der nu laa der. I en live annoncekonto. Og svarede ok:true.
//
// Testene laeser den rigtige kilde, saa de fanger det hvis nogen ruller fixet tilbage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'extension/background.js'), 'utf8');

// ── Fix A: `landed` skal afleveres, ikke smides vaek ────────────────────────

test('debuggerClick returnerer resultatet af settle-kaldet', () => {
  assert.match(
    kilde,
    /const settle = await cdpSend\(tabId, 'Runtime\.evaluate'/,
    'settle-kaldet skal fanges i en variabel — ellers er landed-vaerdien tabt',
  );
  assert.match(
    kilde,
    /return settle\?\.result\?\.value \?\? null;/,
    'debuggerClick skal returnere den maalte vaerdi til kaldestedet',
  );
});

test('settle-kaldet bruger returnByValue — ellers kommer vaerdien aldrig over CDP', () => {
  const i = kilde.indexOf("const settle = await cdpSend(tabId, 'Runtime.evaluate'");
  assert.ok(i > -1, 'settle-kaldet findes');
  const blok = kilde.slice(i, i + 200);
  assert.match(blok, /returnByValue: true/, 'uden returnByValue returnerer CDP kun en objekt-reference');
});

test('alle tre udgange fra settle-udtrykket rapporterer landed', () => {
  const i = kilde.indexOf("const settle = await cdpSend(tabId, 'Runtime.evaluate'");
  const blok = kilde.slice(i, kilde.indexOf('return settle?.result?.value', i));
  assert.match(blok, /return \{ landed: true, fallbackFired: false \}/, 'trusted klik landede');
  assert.match(blok, /return \{ landed: false, fallbackFired: false, detached: true \}/, 'element forsvandt');
  assert.match(blok, /return \{ landed: false, fallbackFired: true \}/, 'framework-fallback fyrede');
});

test('click videregiver debuggerClick-resultatet i sit svar', () => {
  const i = kilde.indexOf("case 'click': {");
  assert.ok(i > -1, "case 'click' findes");
  const blok = kilde.slice(i, i + 2000);
  assert.match(blok, /const clickResult = await debuggerClick\(/, 'resultatet skal fanges');
  assert.match(blok, /\.\.\.\(clickResult \|\| \{\}\)/, 'og spredes ud i svaret til kalderen');
});

// ── Fix B: skjulte elementer maa ALDRIG klikkes ─────────────────────────────

test('alle tre resolveElement-stier afviser elementer uden udstraekning', () => {
  const vagter = kilde.match(/if \(r\.width <= 0 \|\| r\.height <= 0\)/g) || [];
  assert.equal(
    vagter.length,
    3,
    `alle tre stier (css, csp-fallback, tekst) skal have vagten — fandt ${vagter.length}`,
  );
});

test('hver 0x0-vagt staar FOER koordinaterne beregnes', () => {
  // Ellers naar vi at returnere (0,0) inden vagten rammer.
  const linjer = kilde.split('\n');
  const vagt = [];
  const koord = [];
  linjer.forEach((l, n) => {
    if (/if \(r\.width <= 0 \|\| r\.height <= 0\)/.test(l)) vagt.push(n);
    if (/return \{ x: r\.x \+ r\.width/.test(l)) koord.push(n);
  });
  assert.equal(vagt.length, 3);
  assert.equal(koord.length, 3);
  for (let i = 0; i < 3; i++) {
    assert.ok(
      vagt[i] < koord[i],
      `vagt nr. ${i + 1} (linje ${vagt[i] + 1}) skal ligge foer koordinat-returneringen (linje ${koord[i] + 1})`,
    );
  }
});

test('click klikker ikke naar elementet er skjult — den svarer ok:false', () => {
  const i = kilde.indexOf("case 'click': {");
  const blok = kilde.slice(i, i + 2000);
  const vagt = blok.indexOf('if (el.hidden)');
  const klik = blok.indexOf('await debuggerClick(');
  assert.ok(vagt > -1, 'hidden-vagten findes i click');
  assert.ok(klik > -1, 'debuggerClick kaldes i click');
  assert.ok(vagt < klik, 'vagten SKAL ligge foer klikket — ellers er den uden virkning');
  assert.match(blok.slice(vagt, klik), /ok: false/, 'skjult element giver en aerlig fejl, ikke et klik');
});

// ── Adfaerds-simulering: den konkrete fejl fra 21/8 ─────────────────────────

test('simuleret: skjult 0x0-element giver ikke laengere et klik i (0,0)', () => {
  // Genskaber den praecise beregning resolveElement laver.
  const beregn = (rect) => {
    if (rect.width <= 0 || rect.height <= 0) return { found: false, hidden: true };
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, found: true };
  };

  // Den skjulte dialog fra 21/8: rect 0x0 ved (0,0).
  const skjult = beregn({ x: 0, y: 0, width: 0, height: 0 });
  assert.equal(skjult.hidden, true, 'skjult element skal flages');
  assert.equal(skjult.x, undefined, 'og maa IKKE give koordinater at klikke paa');

  // Den synlige knap: 165x36 ved (611, 434) — skal stadig virke praecis som foer.
  const synlig = beregn({ x: 611, y: 434, width: 165, height: 36 });
  assert.equal(synlig.found, true);
  assert.equal(synlig.x, 693.5);
  assert.equal(synlig.y, 452);
});
