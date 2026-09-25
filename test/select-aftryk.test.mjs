/**
 * `browser_select_option`s native gren doemmer paa et AFTRYK af siden: antal muligheder
 * plus tekstens LAENGDE. To ting kan gaa galt med den slags bevis, og begge blev maalt.
 *
 * FUNDET 17/9 af Hronom (maintainer af Hronaut) i en kommentar paa issue #19. Han koerte
 * vores EGEN chrome-stub med en syntetisk side, fem tilfaelde i tre friske kontekster, og
 * udgav 15 observationer. To af dem er forkerte svar:
 *
 *   afvist valg + urelateret status 9 -> 10   ->  ok:true   (laengden skiftede: falsk JA)
 *   accepteret valg + label A -> B, samme laengde  ->  ok:false  (laengden ens: falsk NEJ)
 *
 * Rettelsen er to ting, og den anden er den vigtige:
 *   1. hash af teksten i stedet for dens laengde. Lukker det falske nej.
 *   2. et bedre aftryk lukker IKKE det falske ja - en urelateret aendring paa siden ser
 *      stadig ud som en reaktion. Den gren skal vaere det TREDJE udfald.
 *
 * ⛔ Svaret gaar gennem `uvisVurdering`, ikke ved siden af. Funktionen svarer kun naar
 * `landed === null`, saa det native resultat skal SAETTE det felt. Ellers faar
 * select_option en fjerde formulering af samme ting - praecis den drift Astra maalte 12/9.
 *
 * Proeven koerer de udtryk udvidelsen FAKTISK sender, mod en haandbygget side. Samme greb
 * som `klik-bevis` og som Hronom selv brugte. Ingen browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { lavSide as lavDomSide } from './hjaelp/side-model.mjs';

/** En side med en native <select> og en uafhaengig applikationstilstand. */
function lavSide({ accepterer, nulstiller, tekstFoer, tekstEfter }) {
  let vaerdi = 'a';
  let tekst = tekstFoer;
  const el = {
    get value() { return vaerdi; },
    set value(v) { vaerdi = v; },
    dispatchEvent() {
      // Siden reagerer: tager den imod, skifter teksten. Afviser den, ruller feltet tilbage.
      if (accepterer) { tekst = tekstEfter; if (nulstiller) vaerdi = 'a'; }
      else { vaerdi = 'a'; tekst = tekstEfter; }
      return true;
    },
  };
  return { ...lavDomSide({ element: el, bodyText: () => tekst }), feltet: () => vaerdi };
}

function sele(side) {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane], 'tabs.update': undefined, 'windows.update': undefined,
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode !== 'Runtime.evaluate') return {};
      // Her koeres det udtryk udvidelsen SENDER - ikke en model af hvad vi tror det goer.
      // ⛔ Parentesen om udtrykket er ikke pynt: udtrykkene starter med et linjeskift, og
      // `return` + linjeskift indsaetter et semikolon. Uden den svarer HVER evaluering undefined,
      // og proeven maaler den forkerte gren uden at sige fra.
      const v = new Function('document', 'Event', 'window', 'getComputedStyle', 'return (' + p.expression + ')')(
        side.document, side.Ev, side.window, side.getComputedStyle);
      return { result: { value: v } };
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.resolveElement = async () => ({ x: 10, y: 10, tag: 'SELECT', text: '' });
  u.ctx.chrome.scripting.executeScript = async () => [{ result: null }];
  return u;
}

const vaelg = (u) => u.hent('dispatch')(9876, 'select_option', { selector: '#s', option: 'b' });

// ── Hronoms fem tilfaelde ────────────────────────────────────────────────────

test('1. afvist valg, siden staar stille -> nej', async () => {
  const svar = await vaelg(sele(lavSide({ accepterer: false, nulstiller: false, tekstFoer: 'status 9', tekstEfter: 'status 9' })));
  assert.equal(svar.ok, false, 'et valg der blev afvist paa en stille side skal meldes som fejl');
});

test('2. afvist valg, men en URELATERET tekst voksede -> ikke et ja', async () => {
  // Hronoms falske ja. Aftrykket skiftede, men ikke af valget.
  const svar = await vaelg(sele(lavSide({ accepterer: false, nulstiller: false, tekstFoer: 'status 9', tekstEfter: 'status 10' })));
  assert.notEqual(svar.ok === true && svar.landed === undefined, true,
    'en urelateret aendring paa siden blev laest som "valget landede"');
  assert.equal(svar.maybe_landed, true,
    `siden aendrede sig, men ikke beviseligt af valget - det skal vaere unknown: ${JSON.stringify(svar)}`);
});

test('3. accepteret, feltet nulstiller, label vokser -> ja', async () => {
  const svar = await vaelg(sele(lavSide({ accepterer: true, nulstiller: true, tekstFoer: 'valgt: Alfa', tekstEfter: 'valgt: Beta ×' })));
  assert.equal(svar.ok, true, 'et accepteret valg blev meldt som fejl');
});

test('4. accepteret, feltet nulstiller, label skifter A -> B i SAMME laengde -> ikke et nej', async () => {
  // Hronoms falske nej. Laengden er ens, saa det gamle aftryk saa intet.
  const svar = await vaelg(sele(lavSide({ accepterer: true, nulstiller: true, tekstFoer: 'valgt: Alfa', tekstEfter: 'valgt: Beta' })));
  assert.notEqual(svar.ok, false,
    `valget blev taget imod, men meldt "rullet tilbage" fordi den nye label er lige saa lang: ${JSON.stringify(svar)}`);
});

test('5. accepteret, feltet beholder vaerdien -> ja', async () => {
  const svar = await vaelg(sele(lavSide({ accepterer: true, nulstiller: false, tekstFoer: 'valgt: Alfa', tekstEfter: 'valgt: Beta' })));
  assert.equal(svar.ok, true, 'det simpleste tilfaelde blev meldt som fejl');
  assert.equal(svar.value, 'b', 'svaret oplyser ikke den vaerdi feltet staar paa');
});
