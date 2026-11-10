// #100 / B-03: svaret paa et klik, der aabnede en dialog, skal sige sandheden om
// boksens tilstand paa det tidspunkt svaret skrives.
//
// Hvorfor det her findes (Astra, runde 2): den foerste rettelse tjekkede kun at
// referencen til boksen fandtes - ikke om boksen stadig STOD. En dialog, der blev
// lukket eller besvaret midt i klikforloebet, fik derfor alligevel svaret "besvar
// den nu". Foelger agenten det raad, armerer den et nyt 30-sekunders vindue, der
// kan auto-besvare den NAESTE dialog paa fanen. Raadet var altsaa ikke bare
// upraecist - det kunne klikke noget vaek, ingen havde set.
//
// To domme, en pr. tilstand:
//   boksen staar   -> nutid, dialog_open med type+besked, raad om at besvare
//   boksen er vaek -> datid, INTET dialog_open, og INTET raad om at besvare
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const KOPIER = ['extension/background.js', 'mcp-server/extension/background.js'];

// Det klik-forloebet afleverer, naar en dialog blokerede det.
const aabenBoks = { landed: null, fallbackFired: false, unverified: true, dialog: true,
  dialogInfo: { type: 'confirm', message: 'Delete this order?' } };
const lukketBoks = { landed: null, fallbackFired: false, unverified: true, dialog: true,
  dialogLukket: true, dialogType: 'confirm' };

for (const kilde of KOPIER) {
  test(`${kilde}: en dialog der STAAR aaben navngives, saa agenten kan besvare den`, () => {
    const uvisVurdering = indlaesUdvidelse({ kilde }).hent('uvisVurdering');
    const svar = uvisVurdering(aabenBoks);

    assert.ok(svar, 'en blokeret klik-dom maa ikke vaere null');
    assert.equal(svar.maybe_landed, true);
    // Feltvis, ikke deepEqual: svaret bygges inde i VM'ens eget realm, saa dets
    // prototype er en ANDEN end testens - deepStrictEqual falder paa prototypen,
    // selv naar hver vaerdi er ens. Den faelde siger intet om koden.
    assert.ok(svar.dialog_open, 'agenten skal kunne se hvilken dialog der staar: ' + JSON.stringify(svar));
    assert.equal(svar.dialog_open.type, 'confirm', JSON.stringify(svar));
    assert.equal(svar.dialog_open.message, 'Delete this order?', JSON.stringify(svar));
    assert.match(svar.note, /waiting for an answer/,
      'en boks der staar beskrives i nutid: ' + svar.note);
    assert.match(svar.note, /browser_handle_dialog/,
      'og agenten faar at vide hvordan den besvares: ' + svar.note);
  });

  test(`${kilde}: en dialog der er VAEK beskrives i datid og uden raad om at besvare den`, () => {
    const uvisVurdering = indlaesUdvidelse({ kilde }).hent('uvisVurdering');
    const svar = uvisVurdering(lukketBoks);

    assert.ok(svar, 'en lukket boks skal stadig give en uvis dom');
    assert.equal(svar.maybe_landed, true);

    // 1) Ingen nutidspaastand om en boks der ikke findes.
    assert.equal(svar.dialog_open, undefined,
      'dialog_open paastaar at en dialog staar NU: ' + JSON.stringify(svar));
    assert.doesNotMatch(svar.note, /waiting for an answer/,
      'boksen er vaek, saa den venter ikke paa noget: ' + svar.note);

    // 2) Og frem for alt: intet raad der faar agenten til at arme et nyt vindue.
    assert.doesNotMatch(svar.note, /browser_handle_dialog/,
      'raadet armerer et nyt 30-sekunders vindue, der kan auto-besvare den NAESTE dialog: ' + svar.note);
    assert.doesNotMatch(svar.note, /Answer the dialog/,
      'samme fejl, anden formulering: ' + svar.note);

    // 3) Den skal stadig fortaelle at en dialog var inde over - ellers mister
    //    agenten forklaringen paa hvorfor klikket er uvist.
    assert.match(svar.note, /dialog/i, svar.note);
    assert.match(svar.note, /confirm/, 'typen baeres med: ' + svar.note);
  });
}

test('en dialog uden kendt type falder tilbage paa ordet dialog', () => {
  const uvisVurdering = indlaesUdvidelse({ kilde: KOPIER[0] }).hent('uvisVurdering');
  const svar = uvisVurdering({ landed: null, unverified: true, dialog: true, dialogLukket: true });
  assert.match(svar.note, /A dialog opened/, svar.note);
  assert.doesNotMatch(svar.note, /browser_handle_dialog/, svar.note);
});
