/**
 * Et STYRET <select> - den ene sag hvor aerligheds-maalingen 19/9 viste at vi tabte.
 *
 * | Vaerktoej        | Styret select |
 * |------------------|---------------|
 * | Browser MCP (os) | SAND-NEJ      |
 * | Playwright MCP   | SAND-JA       |
 *
 * Vi svarede aerligt nej. Men nej er stadig nej, og det stod offentligt paa
 * /learn/tools-that-lie/ som vores eget tab.
 *
 * ⛔ RETTET 21/9: «React og aerligheds-fixturen begge» var FALSK. React laegger ingen
 * value-saetter og ingen tracker paa et <select> - kun paa input og textarea - og laeser
 * vaerdien paa den native change-haendelse. Maalt mod aegte React 18.3.1 i jsdom: den naive
 * `sel.value = x` plus change LANDER, og onChange fyrer. 19/9-tabet fandtes kun mod vores
 * EGEN fixtur, og det blev udgivet som et tab mod Playwright foer det blev trukket tilbage.
 *
 * Proeven herunder er stadig gyldig, men den maaler en HYPOTETISK komponent der laegger en
 * value-saetter paa elementet - ikke React. Prototypens saetter haandterer den slags, og
 * koster intet. Skriv aldrig et resultat herfra som «React virker ikke».
 *
 * ⛔ Og det bider: FEM andre steder i background.js satte allerede vaerdier praecis saadan
 * (fill, clear, dato, combobox). select_option var det eneste sted uden grebet. Vi vidste
 * det, vi havde skrevet det fem gange, og det ene sted der manglede var det ene sted en
 * ekstern maaling fandt os.
 *
 * Proeven koerer det udtryk udvidelsen FAKTISK sender, mod et haandbygget styret select.
 * Ingen browser. Mutationsbevis: saet linjen tilbage til `sel.value = opt.value`, og
 * "valget lander" bliver roed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { lavSide } from './hjaelp/side-model.mjs';

/**
 * Et styret select, bygget som en rigtig komponent er bygget:
 *   - prototypen baerer den AEGTE value-saetter
 *   - instansen baerer en saetter der ruller tilbage til komponentens tilstand
 *   - tilstanden opdateres KUN paa en change-haendelse
 */
function lavStyretSelect() {
  let dom = 'a';        // hvad feltet viser
  let tilstand = 'a';   // hvad komponenten VED - det eneste der taeller
  let tekst = 'Valgt: Alfa';

  const proto = {};
  Object.defineProperty(proto, 'value', {
    get() { return dom; },
    set(v) { dom = v; },              // prototypens saetter virker
    configurable: true,
  });

  const el = Object.create(proto);
  Object.defineProperty(el, 'value', {
    get() { return dom; },
    set() { dom = tilstand; },        // instansens saetter RULLER TILBAGE
    configurable: true,
  });

  Object.assign(el, {
    dispatchEvent(e) {
      if (e && e.type === 'change') { tilstand = dom; tekst = 'Valgt: ' + (dom === 'b' ? 'Beta' : 'Alfa'); }
      return true;
    },
  });
  return { ...lavSide({ element: el, bodyText: () => tekst }), komponentensTilstand: () => tilstand };
}

function sele(side) {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane], 'tabs.update': undefined, 'windows.update': undefined,
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode !== 'Runtime.evaluate') return {};
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

test('valget lander i en STYRET select - komponentens egen tilstand skifter', async () => {
  const side = lavStyretSelect();
  const svar = await sele(side).hent('dispatch')(9876, 'select_option', { selector: '#s', option: 'b' });

  // Det eneste der taeller: hvad komponenten VED. Ikke hvad DOM'en viser.
  assert.equal(side.komponentensTilstand(), 'b',
    'komponenten hoerte aldrig valget - det er praecis det tab aerligheds-maalingen fandt 19/9');
  assert.equal(svar.ok, true, 'vaerktoejet skal svare ja naar valget FAKTISK landede');
  assert.equal(svar.value, 'b');
});

test('udtrykket henter saetteren fra prototypen, ikke fra et globalt navn', () => {
  // Et globalt HTMLSelectElement findes ikke i enhver evalueringskontekst. Gjorde udtrykket
  // det, ville det kaste i stedet for at falde tilbage - og en fejl her ville se ud som en
  // side der afviste valget.
  const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const i = bg.indexOf("case 'select_option'");
  const blok = bg.slice(i, i + bg.slice(i).search(/\n {4}\}/));
  assert.match(blok, /Object\.getPrototypeOf\(sel\)/,
    'saetteren skal hentes fra elementets egen prototype');
  assert.ok(!/HTMLSelectElement\.prototype/.test(blok),
    'et globalt HTMLSelectElement ville kaste i kontekster hvor det ikke findes');
});
