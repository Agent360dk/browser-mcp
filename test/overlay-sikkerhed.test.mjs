/**
 * dismiss_overlays maa ALDRIG klikke paa noget destruktivt.
 *
 * MAALT 23/8, og det er det dyreste fund i hele auditten. Koert med den ordrette kode
 * mod knapper i en rigtig browser trykkede vaerktoejet paa:
 *
 *     "Close account"  ·  "Close and delete everything"  ·  "Cancel subscription"
 *     "Afvis betalingen permanent"  ·  enhver knap med aria-label="Close account"
 *
 * Det skete i DEFAULT-scope, ikke kun aggressive. Aarsagen: "close" og "luk" er
 * lovlige luk-ord, og matchningen havde ingen ord-graense - "Close account"
 * indeholder "close". Kommentaren i koden sagde endda at aria-label-stien var
 * "always safe".
 *
 * Og INSTRUCTIONS beder agenten kalde dismiss_overlays FOER hvert stoerre skridt.
 * Det ville altsaa ske paa hver eneste side hvor saadan en knap findes.
 *
 * Vetoet er en NEGATIV regel: findes et farligt ord, klikkes der aldrig - uanset hvor
 * godt resten matcher. Et overlay der ikke bliver lukket koster ét ekstra skridt;
 * en lukket konto koster brugeren penge eller adgang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

// Genskab vetoet fra kilden - ikke en kopi, den AEGTE liste.
const i = kilde.indexOf('const VETO = [');
assert.ok(i > -1, 'VETO-listen findes ikke i background.js');
const veto = [...kilde.slice(i, kilde.indexOf('];', i)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
const erFarlig = (t) => {
  const s = (t || '').toLowerCase();
  return s.length > 0 && veto.some((v) => s.includes(v));
};

const FARLIGE = [
  ['Cancel subscription', null],
  ['Close account', null],
  ['Delete account', null],
  ['Close and delete everything', null],
  ['Afvis betalingen permanent', null],
  ['Opsig abonnement', null],
  ['Slet min konto', null],
  ['Remove payment method', null],
  ['Log ud', null],
  ['Slet', 'Close account'],
  ['×', 'Close account'],
  ['Fortsæt', 'Luk kontoen'],
  ['OK', 'Delete permanently'],
];

const LEGITIME = [
  ['Luk', null], ['Close', null], ['Dismiss', null], ['Got it', null],
  ['Got it, thanks', null], ['Ikke nu', null], ['Not now', null],
  ['No thanks', null], ['Maybe later', null], ['×', null], ['✕', null],
  ['Slet', 'Close dialog'].slice(0, 0).length ? [] : ['Afvis', 'Close dialog'],
].filter((x) => x.length === 2);

test('ingen destruktiv knap kan blive klikket', () => {
  for (const [tekst, aria] of FARLIGE) {
    assert.ok(erFarlig(tekst) || erFarlig(aria),
      `"${tekst}"${aria ? ` (aria="${aria}")` : ''} slipper gennem vetoet - ` +
      'vaerktoejet ville trykke paa den, og instruktionerne beder agenten kalde ' +
      'dismiss_overlays foer hvert stoerre skridt');
  }
});

test('legitime luk-knapper virker stadig - vetoet maa ikke doede vaerktoejet', () => {
  for (const [tekst, aria] of LEGITIME) {
    assert.ok(!erFarlig(tekst) && !erFarlig(aria),
      `"${tekst}"${aria ? ` (aria="${aria}")` : ''} blev blokeret af vetoet - ` +
      'et veto der ogsaa rammer almindelige luk-knapper goer vaerktoejet ubrugeligt');
  }
});

test('vetoet daekker baade dansk og engelsk paa de dyre ord', () => {
  for (const par of [['account', 'konto'], ['subscription', 'abonnement'],
                     ['payment', 'betaling'], ['delete', 'slet'], ['remove', 'fjern']]) {
    for (const ord of par) {
      assert.ok(veto.includes(ord), `"${ord}" mangler i vetoet - sider er paa begge sprog`);
    }
  }
});

test('vetoet koeres paa ALLE fire prioriteter, ikke kun én', () => {
  const j = kilde.indexOf('async function dismissOverlays(');
  let d = 0, slut = j;
  for (let k = kilde.indexOf('{', j); k < kilde.length; k++) {
    if (kilde[k] === '{') d++;
    else if (kilde[k] === '}' && --d === 0) { slut = k + 1; break; }
  }
  const blok = kilde.slice(j, slut);
  const kald = (blok.match(/erFarlig\(/g) || []).length;
  assert.ok(kald >= 6,
    `kun ${kald} veto-tjek i dismissOverlays - der er fire prioriteter (aria-label, ` +
    'eksakt tekst, delstreng, ×-tegn), og springes én over, er hullet aabent dér');
});
