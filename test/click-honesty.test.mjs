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

// 30/8: mønstrene her laaste kaldets NAVN (`cdpSend`) i stedet for egenskaben. Da
// settle-kaldet fik en frist paa sig og skiftede navn til `evaluerTaalmodigt`, faldt
// tre tests — uden at adfaerden havde aendret sig. De matcher nu paa at vaerdien
// FANGES og AFLEVERES, uanset hvad kaldet hedder.
test('debuggerClick returnerer resultatet af settle-kaldet', () => {
  assert.match(
    kilde,
    /const settle = await \w+\(tabId,/,
    'settle-kaldet skal fanges i en variabel — ellers er landed-vaerdien tabt',
  );
  assert.match(
    kilde,
    /const vaerdi = settle\?\.result\?\.value \?\? null;[\s\S]{0,1200}\n    return vaerdi \?\? tolkManglendeSettle\(settle\);/,
    'debuggerClick skal returnere den maalte vaerdi til kaldestedet',
  );
});

test('settle-kaldet bruger returnByValue — ellers kommer vaerdien aldrig over CDP', () => {
  const i = kilde.search(/const settle = await \w+\(tabId,/);
  assert.ok(i > -1, 'settle-kaldet findes');
  const blok = kilde.slice(i, i + 200);
  assert.match(blok, /returnByValue: true/, 'uden returnByValue returnerer CDP kun en objekt-reference');
});

test('alle tre udgange fra settle-udtrykket rapporterer landed', () => {
  const i = kilde.search(/const settle = await \w+\(tabId,/);
  const blok = kilde.slice(i, kilde.indexOf('const vaerdi = settle?.result?.value', i));
  assert.match(blok, /return \{ landed: true, fallbackFired: false \}/, 'trusted klik landede');
  assert.match(blok, /return \{ landed: false, fallbackFired: false, detached: true \}/, 'element forsvandt');
  // 9/9 om morgenen: den tredje udgang sagde `landed: false` HAARDKODET — et gaet.
  // 9/9 om aftenen: jeg "rettede" det ved at laese lytteren igen. Det var VAERRE: lytteren
  // udloeses af enhver dispatch paa maalet, og reserveloesningen dispatcher netop paa maalet.
  // Reproduceret i en rigtig browser mod et <div> uden handler: foer=false, efter=true.
  // 10/9: nu maales sidens REAKTION med et aftryk, samme greb som select_option bruger.
  assert.doesNotMatch(blok, /const efter = window\.__bmcpClicked === true;/,
    'lytteren maa IKKE bruges efter reserveloesningen — den er sand fordi vi selv dispatcher');
  assert.match(blok, /const foerAftryk = aftryk\(\)/, 'der skal tages et aftryk FOER fallbacken');
  assert.match(blok, /const reagerede = efterAftryk !== foerAftryk/,
    'landed skal komme af at noget aendrede sig, ikke af at vi sendte noget');
  assert.match(blok, /return \{ landed: reagerede, fallbackFired: true/, 'framework-fallback fyrede');
});

test('click videregiver debuggerClick-resultatet i sit svar', () => {
  // 9/9-2026: her stod `kilde.slice(i, i + 2000)`. To tilfoejede kommentarlinjer skubbede
  // spredningen ud over de 2000 tegn, og testen blev roed uden at koden var forkert.
  // En magisk tegn-afstand er ikke en blok — nu klippes ved case'ens EGNE graenser.
  const i = kilde.indexOf("case 'click': {");
  assert.ok(i > -1, "case 'click' findes");
  const naeste = kilde.indexOf("case 'fill': {", i);
  const blok = kilde.slice(i, naeste > -1 ? naeste : i + 6000);
  assert.match(blok, /const clickResult = await debuggerClick\(/, 'resultatet skal fanges');
  assert.match(blok, /\.\.\.\(clickResult \|\| \{\}\)/, 'og spredes ud i svaret til kalderen');
  // Og selve kontrakten: `ok` maa ikke vaere en konstant. Adfaerden proeves i klik-aerlighed.
  assert.doesNotMatch(blok, /^\s*ok: true,\s*$/m,
    'ok maa ikke staa haardkodet — den skal udledes af om klikket landede (issue #19)');
});

// MAALT 10/9 i en rigtig browser: reserveloesningen fyrede BEGGE — dispatchEvent('click')
// og el.click(). To klik-haendelser. Paa alt der skifter tilstand aabner den foerste og den
// anden lukker igen, saa resultatet er intet. Det VAR aarsagen til at issue #19's dropdown
// "aldrig aabnede".  ét klik: 11|53|…|0 -> 11|69|…|1   ·   to klik: 11|53|…|0 -> 11|53|…|0
test('reserveloesningen fyrer ÉT klik, ikke to', () => {
  const i = kilde.search(/const settle = await \w+\(tabId,/);
  const blok = kilde.slice(i, kilde.indexOf('const vaerdi = settle?.result?.value', i));
  const klikLinjer = (blok.match(/el\.dispatchEvent\(new MouseEvent\('click'/g) || []).length;
  const elClick = (blok.match(/el\.click\(\)/g) || []).length;
  assert.ok(!(klikLinjer > 0 && elClick > 0 && !/else el\.dispatchEvent\(new MouseEvent\('click'/.test(blok)),
    'baade dispatchEvent(click) og el.click() fyrer ubetinget — det er to klik, og en toggle ender hvor den startede');
  assert.match(blok, /if \(typeof el\.click === 'function'\) el\.click\(\);\s*\n\s*else el\.dispatchEvent/,
    'de to klik-veje skal vaere hinandens alternativer, ikke begge');
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

// ── Fix D (30/8): settle-kaldet skal have en frist ──────────────────────────
//
// MAALT: en aaben ja/nej-boks fryser rendereren, og settle-opslaget lige efter
// museklikket kom ALDRIG tilbage — browser_click haengte 30 sekunder og meldte
// falsk fejl, selvom klikket var landet. Fristen er hele rettelsen; forsvinder den,
// er hænget tilbage uden at noget andet siger fra.
test('settle-kaldet er tidsbegraenset — et frossent renderer-kald maa ikke haenge', () => {
  assert.match(
    kilde,
    /const settle = await evaluerTaalmodigt\(tabId,/,
    'settle skal gaa gennem den tidsbegraensede hjaelper, ikke raa cdpSend',
  );
  const i = kilde.indexOf('async function evaluerTaalmodigt');
  assert.ok(i > -1, 'evaluerTaalmodigt findes');
  const krop = kilde.slice(i, i + 900);
  assert.match(krop, /Promise\.race\(/, 'uden et kapløb er der ingen frist');
  assert.match(krop, /setTimeout\(/, 'fristen skal have et ur');
  assert.match(krop, /rendererSvarede: false/, 'kalderen skal kunne se at rendereren ikke svarede');
});
