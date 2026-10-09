/**
 * ⚠️ RETTET 9/10 (R57): 19/9-falsifikationen holder ikke - fanen blev flyttet tilbage i sessionens foerste vindue, og
 * svaret loej om det. Om et ufokuseret vindue faar input er UMAALT. Den sidste proeve i filen vogter at ingen flade
 * paastaar andet. Historikken herunder staar som den blev skrevet.
 *
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

// R57 (Opus, maalt i Chrome): chrome.tabs.group flytter en fane ind i gruppens vindue. Selen svarede foer et fast `fane` paa
// hvert tabs.get og lod tabs.group vaere et ekko, saa den kunne ikke se at det nye vindues fane blev flyttet tilbage i
// sessionens gruppe (vindue 3). Nu holder selen styr paa hver fanes vindue, som Chrome goer.
function sele(landet = null) {
  const set = [];
  const fane = { id: 7, url: 'about:blank', windowId: 3, active: false };
  const faner = new Map([[7, fane]]);
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'tabs.get': (id) => faner.get(id) ?? fane, 'tabs.query': () => [...faner.values()], 'tabs.update': undefined,
    'tabs.create': fane, 'windows.update': undefined,
    // ⛔ 21/9: selen svarede foer et bart { id, tabs } - og Chrome svarer med vinduets
    // FAKTISKE left/top/focused. Med den fattige sele kunne proeven ikke se at koden
    // rapporterede det den BAD om i stedet for det der skete. Selen svarer nu som Chrome,
    // og `landet` kan sættes af den enkelte proeve til noget andet end det der blev bedt om.
    'windows.create': (spec) => {
      set.push(spec);
      const ny = { ...fane, id: 42, windowId: 99, url: spec.url };
      faner.set(42, ny);
      return { id: 99, ...(landet ?? spec), tabs: [ny] };
    },
    // Vindue 3 (sessionens foerste) er ufokuseret ved (0,0); vindue 99 er det nye.
    'windows.get': (id) => (id === 3 ? { id: 3, left: 0, top: 0, focused: false } : { id: 99, ...(landet ?? set[set.length - 1] ?? {}) }),
    'tabGroups.update': undefined,
    // Som Chrome: en fane der grupperes, flyttes ind i gruppens vindue; en ny gruppe oprettes i det aktuelle vindue (3).
    'tabs.group': ({ tabIds, groupId }) => { for (const id of tabIds) if (faner.has(id)) faner.get(id).windowId = 3; return groupId ?? 5; },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set(), activeTabId: null, groupId: 5, label: 't', color: 'blue' });
  return { u, set, faner };
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
  // R57: 19/9-maalingen laeste et svar der loej om vinduet, saa «leverer intet input» er ikke maalt. Noten maa ikke love det.
  assert.match(svar.note, /unmeasured in desktop Chrome; read landed/i);
  assert.doesNotMatch(svar.note, /delivers no mouse|exactly like a background tab|Measured 19 Sept/i);
});

// R57 (Opus, maalt i Chrome 9/10): sessionen havde allerede en gruppe i vindue 3. chrome.tabs.group flyttede det nye
// vindues fane derhen, vinduet forsvandt, og svaret meldte alligevel windowId 99 og eget_vindue:true.
test('fanen bliver i sit eget vindue, og svaret melder fanens faktiske vindue', async () => {
  const { u, faner } = sele();
  const svar = await naviger(u, { eget_vindue: true });
  assert.equal(faner.get(42).windowId, 99, 'fanen blev flyttet ud af sit eget vindue og ind i sessionens gruppe');
  assert.equal(svar.windowId, 99);
  assert.equal(svar.eget_vindue, true);
  assert.ok(u.hent('sessions').get(9876).tabIds.has(42), 'fanen hoerer stadig til sessionen');
});

test('ender fanen alligevel i et andet vindue, siger svaret det i stedet for at melde det nye vindue', async () => {
  const { u, faner } = sele();
  const orig = u.chrome.windows.create;
  u.chrome.windows.create = async (spec) => { const v = await orig(spec); faner.get(42).windowId = 3; return v; };
  const svar = await naviger(u, { eget_vindue: true, fokuser: true, vindue_x: -3840, vindue_y: 27 });
  assert.equal(svar.eget_vindue, false);
  assert.equal(svar.windowId, 3);
  assert.match(String(svar.advarsel), /not in its own window: Chrome put it in window 3/);
  // R61 (Astra): fokus og position kom fra det nye vindue (99), mens fanen laa i vindue 3.
  assert.equal(svar.fokuseret, false, 'fokus blev laest fra et vindue fanen ikke er i');
  assert.deepEqual({ ...svar.placeret }, { left: 0, top: 0 }, 'positionen blev laest fra et vindue fanen ikke er i');
  assert.doesNotMatch(String(svar.note), /The window has focus/);
});

test('en position der ikke kan laeses som tal, afviser vinduet - intet aabnes paa brugerens skaerm', async () => {
  // ⛔ 26/9 (fuld review, maalt): foer blev en ugyldig position tavst udeladt, vinduet aabnede
  // MED fokus paa Chromes standardplads - brugerens skaerm - og svaret sagde at alt var fint.
  const { u, set } = sele();
  const svar = await naviger(u, { eget_vindue: true, fokuser: true, vindue_x: 'venstre' });
  assert.equal(set.length, 0, 'der blev aabnet et vindue trods en ulaeselig position');
  assert.equal(svar.ok, false);
  assert.match(String(svar.error), /vindue_x/, 'fejlen siger ikke hvilket felt der var galt');
});

test('en position skrevet som tekst ("-1920") naar Chrome som tal', async () => {
  const { u, set } = sele();
  await naviger(u, { eget_vindue: true, vindue_x: '-1920', vindue_y: ' 27 ' });
  assert.equal(set[0].left, -1920, 'en position skrevet som tekst blev tabt - klienter sender tit tal som tekst');
  assert.equal(set[0].top, 27);
});

test('fokus uden position advarer: vinduet lander hvor Chrome vaelger, typisk foran brugeren', async () => {
  const { u } = sele({ left: 0, top: 0, focused: true });
  const svar = await naviger(u, { eget_vindue: true, fokuser: true });
  assert.match(String(svar.advarsel), /no position/i,
    'fokus uden position giver ingen advarsel - saa tager koerslen skaermen uden at sige det');
});

test('prosaen lover ikke at intet daekkes - fokus er eksklusivt', async () => {
  const { u } = sele({ left: -3840, top: 27, focused: true });
  const svar = await naviger(u, { eget_vindue: true, fokuser: true, vindue_x: -3840, vindue_y: 27 });
  assert.doesNotMatch(String(svar.note), /does not cover anyone/,
    'noten lover at intet daekkes - men mens vinduet har fokus, lander det mennesket skriver i det');
  assert.match(String(svar.note), /exclusive/i, 'noten siger ikke at fokus er eksklusivt');
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

// R57: faar sessionen senere en ny gruppe (fx fordi den gamle er lukket), maa den ikke samle fanen fra det egne vindue op.
test('en ny gruppe samler kun faner fra samme vindue, saa det egne vindue beholder sin fane', async () => {
  const { u, faner } = sele();
  await naviger(u, { eget_vindue: true });
  const s = u.hent('sessions').get(9876);
  s.groupId = null;
  await u.hent('addTabToSession')(9876, 7);
  assert.equal(faner.get(42).windowId, 99, 'den nye gruppe flyttede fanen ud af sit eget vindue');
  const grupperet = u.optager.til('tabs.group').at(-1).args[0].tabIds;
  assert.ok(!grupperet.includes(42) && grupperet.includes(7), `grupperet: ${grupperet}`);
});

// R57: ingen flade maa paastaa, at et ufokuseret vindue er MAALT til ikke at faa input - maalingen testede en baggrundsfane.
test('ingen flade paastaar at et eget vindue uden fokus er maalt til ikke at faa input', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const flader = ['mcp-server/tools.js', 'extension/background.js', 'README.md', 'mcp-server/README.md',
    'content/browsermcp-usecase-codex-2fa.md', 'content/browsermcp-usecase-vscode-samtidige.md',
    'docs/use-cases/codex-2fa/index.html', 'docs/use-cases/vscode-concurrent-sessions/index.html'];
  const forbudt = /unfocused window delivers no keystrokes|own window would remove the problem: it does not|own window would fix that\. (?:<strong>|\*\*)It does not|exactly like a background tab: (?:Chrome delivers )?no mouse|window was on none of the machine/i;
  for (const f of flader) {
    const kode = readFileSync(join(ROD, f), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(kode, forbudt, f);
  }
  const tools = readFileSync(join(ROD, 'mcp-server/tools.js'), 'utf8');
  assert.match(tools, /Whether Chrome delivers mouse and keyboard input to a window without focus is unmeasured in desktop Chrome/);
});
