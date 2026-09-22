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

function sele(landet = null) {
  const set = [];
  const fane = { id: 7, url: 'about:blank', windowId: 3, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'tabs.get': fane, 'tabs.query': [fane], 'tabs.update': undefined,
    'tabs.create': fane, 'windows.update': undefined,
    // ⛔ 21/9: selen svarede foer et bart { id, tabs } - og Chrome svarer med vinduets
    // FAKTISKE left/top/focused. Med den fattige sele kunne proeven ikke se at koden
    // rapporterede det den BAD om i stedet for det der skete. Selen svarer nu som Chrome,
    // og `landet` kan sættes af den enkelte proeve til noget andet end det der blev bedt om.
    'windows.create': (spec) => { set.push(spec); return { id: 99, ...(landet ?? spec), tabs: [{ ...fane, id: 42 }] }; },
    'windows.get': () => ({ id: 99, ...(landet ?? set[set.length - 1] ?? {}) }),
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
  // ⛔ Svaret skal komme fra Chrome, ikke fra parameteret vi sendte. Her landede vinduet
  // som bedt, saa de er ens - proeven nedenfor viser forskellen naar de ikke er.
  assert.equal(svar.fokuseret, true);
  assert.equal(svar.placeret_som_bedt, true);
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

/**
 * ⛔ MAALT 21/9 mod rigtig Chrome: vaerktoejet svarede `fokuseret: true` fordi det ekkoede
 * parameteret - og Chrome havde IKKE givet vinduet fokus. Det svarede ogsaa
 * `placeret: {left:-3840}` fordi det ekkoede det vi bad om.
 *
 * Det er praecis den fejlklasse /learn/tools-that-lie handler om - «rapporterede de tal den
 * blev SPURGT om» - og den ramte den ene funktion der findes for at holde koersler vaek fra
 * menneskets skaerm. En koersel kunne tro den laa paa en anden skaerm og i virkeligheden
 * ligge hvor som helst.
 *
 * De to proever herunder er de eneste der kan skelne et ekko fra en maaling.
 */
test('svaret kommer fra Chrome, ikke fra parameteret - fokus der blev naegtet meldes som naegtet', async () => {
  const { u } = sele({ left: -3840, top: 27, focused: false });
  const svar = await naviger(u, { eget_vindue: true, fokuser: true, vindue_x: -3840, vindue_y: 27 });
  assert.equal(svar.fokuseret, false,
    'vi bad om fokus, Chrome gav det ikke - og vaerktoejet sagde ja. Det er et ekko, ikke en maaling');
});

test('landede vinduet et andet sted end der blev bedt om, siges det - med en advarsel', async () => {
  const { u } = sele({ left: 0, top: 0, focused: true });
  const svar = await naviger(u, { eget_vindue: true, fokuser: true, vindue_x: -3840, vindue_y: 27 });
  assert.equal(svar.placeret.left, 0, 'svaret viser ikke hvor vinduet FAKTISK landede');
  assert.equal(svar.bedt_om.left, -3840, 'svaret viser ikke hvad der blev bedt om, saa forskellen kan ses');
  assert.equal(svar.placeret_som_bedt, false);
  assert.match(String(svar.advarsel), /Do not assume the run is off the user's screen/,
    'et vindue der landede et andet sted skal advare - ellers koerer spaerren blindt paa menneskets skaerm');
});

/**
 * ⛔ Modstander-review 21/9: foerste rettelse gjorde `fokuseret` aerlig, men lod `note` staa
 * paa `params.fokuser`. Svaret sagde derfor «fokuseret: false» og «The window has focus» i
 * SAMME nyttelast - og prosaen er den der bliver laest. En halv rettelse, hvor den halve
 * halvdel var den vigtigste.
 */
test('naegtes fokus, siger PROSAEN det ogsaa - ikke kun booleanen', async () => {
  const { u } = sele({ left: -3840, top: 27, focused: false });
  const svar = await naviger(u, { eget_vindue: true, fokuser: true, vindue_x: -3840, vindue_y: 27 });
  assert.equal(svar.fokuseret, false);
  assert.doesNotMatch(String(svar.note), /The window has focus/,
    'noten siger at vinduet har fokus, mens fokuseret er false - de to modsiger hinanden i samme svar');
  assert.match(String(svar.note), /did not give it/,
    'noten skal sige at fokus blev naegtet, saa en agent der laeser prosaen faar det samme at vide som booleanen');
  assert.match(String(svar.advarsel), /Focus was refused/,
    'der er ingen advarsel naar KUN fokus naegtes - kun den ene boolean, som er let at overse');
});

test('gives fokus, staar prosaen ved det', async () => {
  const { u } = sele({ left: -3840, top: 27, focused: true });
  const svar = await naviger(u, { eget_vindue: true, fokuser: true, vindue_x: -3840, vindue_y: 27 });
  assert.match(String(svar.note), /The window has focus/);
  assert.equal(svar.advarsel, undefined, 'der advares om noget der gik godt');
});
