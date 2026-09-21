/**
 * `eget_vindue` blev bygget paa en hypotese der blev FALSIFICERET 19/9: et eget vindue uden
 * fokus leverer nul taster, praecis som en baggrundsfane. Det er om VINDUET har
 * operativsystemets fokus - ikke om fanen er den viste i det.
 * (test/aerlighed/RESULTAT-vindueshypotesen-2026-09-19.md)
 *
 * Men det gav funktionen et bedre formaal end det den blev bygget til, og det er det her
 * proeven vogter: paa en maskine med flere skaerme kan vinduet placeres paa en skaerm
 * mennesket ikke kigger paa OG faa fokus dér. Saa leverer Chrome input, uden at noget
 * daekker det brugeren arbejder i.
 *
 * ⛔ Gustav har sagt tre gange paa to dage at proeve-koersler ikke maa tage skaermen. Den
 * her vej er svaret paa det - men kun hvis parametrene FAKTISK naar Chrome. En beskrivelse
 * i tools.js der ikke daekkes af kode, er praecis den slags loefte resten af dagen handlede om.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele() {
  const set = [];
  const fane = { id: 7, url: 'about:blank', windowId: 3, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'tabs.get': fane, 'tabs.query': [fane], 'tabs.update': undefined,
    'tabs.create': fane, 'windows.update': undefined,
    'windows.create': (spec) => { set.push(spec); return { id: 99, tabs: [{ ...fane, id: 42 }] }; },
    'tabGroups.update': undefined, 'tabs.group': 5,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set(), activeTabId: null, groupId: 5, label: 't', color: 'blue' });
  return { u, set };
}

const naviger = (u, p) => u.hent('dispatch')(9876, 'navigate', { url: 'https://x.example', new_tab: true, ...p });

test('vindue_x og fokuser naar helt frem til chrome.windows.create', async () => {
  const { u, set } = sele();
  const svar = await naviger(u, { eget_vindue: true, fokuser: true, vindue_x: -3840, vindue_y: 27, vindue_bredde: 1200 });

  assert.equal(set.length, 1, 'der blev ikke oprettet et vindue');
  const spec = set[0];
  assert.equal(spec.left, -3840, 'vindue_x naaede ikke Chrome - saa kan vinduet ikke havne paa den anden skaerm');
  assert.equal(spec.top, 27);
  assert.equal(spec.width, 1200);
  assert.equal(spec.focused, true, 'uden fokus leverer Chrome intet input - maalt 19/9');
  assert.equal(svar.fokuseret, true);
  // Felt for felt frem for deepEqual: svaret gaar gennem en serialisering, saa objektets
  // prototype er ikke den samme - og deepStrictEqual falder paa netop det, ikke paa vaerdierne.
  assert.equal(svar.placeret.left, -3840);
  assert.equal(svar.placeret.top, 27);
});

test('uden fokuser er vinduet ufokuseret, og svaret siger hvad det betyder', async () => {
  const { u, set } = sele();
  const svar = await naviger(u, { eget_vindue: true });

  assert.equal(set[0].focused, false, 'standarden maa ikke stjaele fokus');
  assert.equal(svar.fokuseret, false);
  assert.match(svar.note, /delivers no mouse or keyboard input/i,
    'svaret skal sige at et ufokuseret vindue ikke modtager input - ellers gentager naeste laeser maalingen fra 19/9');
});

test('et tal der ikke er et tal sendes ikke videre som position', async () => {
  const { u, set } = sele();
  await naviger(u, { eget_vindue: true, vindue_x: 'venstre' });
  assert.equal('left' in set[0], false, 'en ugyldig position skal udelades, ikke sendes til Chrome');
});
