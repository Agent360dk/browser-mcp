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

// ── Runde 1b: dommen er TREVEJS, ikke tovejs ──────────────────────────────
// Panelet maalte, at «besvaretAf uden lukket» og «debugger-detached» blev kaldt
// «vaek». Begge betyder i virkeligheden: dialogen kan stadig staa paa skaermen,
// og vores vaerktoejer kan ikke naa den. At sige «den er vaek, svar den ikke
// igen» om en dialog, der holder fanen, lukker agentens eneste udvej.
test('en dialog, hvis svar Chrome ikke har bekraeftet, meldes UAFGJORT - ikke vaek', () => {
  const uvisVurdering = indlaesUdvidelse({ kilde: KOPIER[0] }).hent('uvisVurdering');
  const svar = uvisVurdering({ landed: null, unverified: true, dialog: true,
    dialogUafgjort: true, dialogType: 'confirm' });

  assert.equal(svar.maybe_landed, true);
  assert.equal(svar.dialog_open, undefined, 'vi ved ikke at den staar: ' + JSON.stringify(svar));
  assert.doesNotMatch(svar.note, /It is gone/,
    'den kan stadig staa paa skaermen: ' + svar.note);
  assert.match(svar.note, /browser_ask_user/,
    'brugeren er den eneste, der kan naa den: ' + svar.note);
  assert.match(svar.note, /confirm/, svar.note);
});

test('en dialog vi ikke kan identificere, maa ikke faa agenten til at arme blindt', () => {
  const uvisVurdering = indlaesUdvidelse({ kilde: KOPIER[0] }).hent('uvisVurdering');
  const svar = uvisVurdering({ landed: null, unverified: true, dialog: true, dialogUkendt: true });

  assert.equal(svar.maybe_landed, true);
  assert.match(svar.note, /NEXT dialog/,
    'agenten skal vide, at et blindt kald armerer den naeste: ' + svar.note);
  assert.match(svar.note, /browser_ask_user/, svar.note);
  assert.doesNotMatch(svar.note, /It is gone/, svar.note);
});

// ── Runde 1b, det hul ingen proeve kunne se ───────────────────────────────
// Dialogopdagelsen virker kun, naar Page-domaenet er slaaet til paa fanens CDP-session.
// Det laa foer i et Set, der kun blev ryddet i chrome.debugger.onDetach - og Chrome sender
// INTET onDetach, naar vi selv kobler fra (R108). Efter browser_reattach_debugger sagde
// cachen derfor «slaaet til», mens den nye session havde domaenet slaaet fra: #100 var
// tilbage, usynligt, i netop det vaerktoej man griber efter, naar en fane virker laast.
// Prøven maaler kommandoen, ikke en intern variabel - saa den kan se hullet udefra.
test('Page-domaenet slaas til ved HVER tilkobling - ogsaa efter en genkobling', async () => {
  const u = indlaesUdvidelse({ kilde: KOPIER[0], svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
  } });
  const sendt = [];
  const send = u.ctx.chrome.debugger.sendCommand;
  u.ctx.chrome.debugger.sendCommand = (m, metode, p) => { sendt.push(metode); return send(m, metode, p); };
  const attach = u.hent('debuggerAttach');
  const taelPage = () => sendt.filter((k) => k === 'Page.enable').length;

  await attach(1);
  assert.equal(taelPage(), 1, 'Page.enable skal sendes ved tilkoblingen: ' + sendt.join(','));

  await attach(1);
  assert.equal(taelPage(), 1, 'en fane der allerede er tilkoblet skal ikke faa en til');

  // Praecis det reattach_debugger goer: kobl fra i haanden, glem fanen, kobl til igen.
  u.hent('debuggerAttached').delete(1);
  await attach(1);
  assert.equal(taelPage(), 2,
    'efter en genkobling er Page slaaet FRA paa den nye session - domaenet skal slaas til igen, '
    + 'ellers er dialogopdagelsen blind: ' + sendt.join(','));
});

// Regressionsvagt (panelets sonde, efterproevet): en boks, koordinatoren stadig kender,
// maa ALDRIG stoppe Page.enable ved en ny tilkobling.
//
// Her stod foer en kortslutning, der sprang enable over, naar en ubesvaret boks stod.
// Men en session, der frigives uden at fanen kan lukkes (#13), kobler fejlfinderen fra
// UDEN at Chrome sender onDetach - og boksen bliver staaende uden at blive markeret
// `mistet`. Saa sprang kortslutningen enable over for ALTID: den nye CDP-session havde
// Page slaaet fra, javascriptDialogOpening fyrede aldrig, og #100 var tilbage.
// Kortslutningen er fjernet. Haenger enable bag en boks, venter ingen paa den - kaldet
// afventes ikke - og naar boksen besvares, slaas domaenet til.
test('en boks, koordinatoren kender, stopper IKKE Page.enable ved en ny tilkobling', async () => {
  const u = indlaesUdvidelse({ kilde: KOPIER[0], svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
  } });
  const sendt = [];
  const send = u.ctx.chrome.debugger.sendCommand;
  u.ctx.chrome.debugger.sendCommand = (m, metode, p) => { sendt.push(metode); return send(m, metode, p); };

  // En boks staar og holder fanen, foer vi overhovedet kobler til.
  u.hent('dialogFaner').set(1, { boks: { type: 'confirm', message: 'Delete this order?' } });
  await u.hent('debuggerAttach')(1);

  assert.equal(sendt.filter((k) => k === 'Page.enable').length, 1,
    'en staaende boks maa ikke blokere domaenet - saa ville en fane, hvis fejlfinder faldt af '
    + 'med boksen stadig registreret, vaere blind for dialoger for altid: ' + sendt.join(','));
});

test('er boksen besvaret, sendes Page.enable igen', async () => {
  const u = indlaesUdvidelse({ kilde: KOPIER[0], svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
  } });
  const sendt = [];
  const send = u.ctx.chrome.debugger.sendCommand;
  u.ctx.chrome.debugger.sendCommand = (m, metode, p) => { sendt.push(metode); return send(m, metode, p); };

  // Samme boks, men lukket: den holder ikke siden laengere.
  u.hent('dialogFaner').set(1, { boks: { type: 'confirm', message: 'x', lukket: { result: true } } });
  await u.hent('debuggerAttach')(1);

  assert.equal(sendt.filter((k) => k === 'Page.enable').length, 1,
    'en lukket boks maa ikke blokere domaenet for altid: ' + sendt.join(','));
});
