/**
 * Tekst-klik i dialoger og daekkede maal (1.30.2 skive 8, R57).
 *
 * MAALT 9/10 af Opus i headless Chrome, fem varianter af en side med «Add» baade paa siden og i en dialog:
 *   - `click text=Add` valgte den foerste «Add» i DOM-raekkefoelgen, uanset dialogen;
 *   - svaret var ok:true, tag BUTTON, text "Add" i alle fem - ogsaa naar klikket ramte overlayet eller dialogens
 *     backdrop, og ingen knap blev trykket;
 *   - script-reserven (baggrundsfane) havde sin egen soegning og klikkede sidens knap gennem overlayet.
 * Nu finder klikMaal maalet eet sted: en aaben modal dialog soeges foerst, og ligger noget over maalets midtpunkt,
 * klikker musevaerktoejerne ikke, men siger hvad der ligger der.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { lavKlikDom } from './hjaelp/klik-dom.mjs';

const KILDE = indlaesUdvidelse().hent('klikMaal').toString();
const tekstKlik = (d, tekst, tag = null) => d.koer(KILDE, null, tekst, tag, false, false).svar;
const elementFor = (d, tekst) => d.koer(KILDE, null, tekst, null, false, true).svar;

// Opus' side: sidens «Add» oeverst til venstre, dialogen midt paa siden med sin egen «Add».
function side({ dialog = 'aria', overlay = true, dialogFoerst = false } = {}) {
  const d = lavKlikDom();
  const sideAdd = () => d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  if (!dialogFoerst) sideAdd();
  if (overlay) d.el('div', { id: 'overlay', rect: [0, 0, 1200, 800], lag: 5 });
  const attrs = dialog === 'aria' ? { role: 'dialog', 'aria-modal': 'true' } : dialog === 'open' ? { open: '' } : {};
  const dlg = d.el(dialog === 'aria' ? 'div' : 'dialog', { id: 'dlg', attrs, rect: [400, 300, 400, 200], lag: 10, modal: dialog === 'modal' });
  d.el('button', { id: 'dlgAdd', tekst: 'Add', rect: [600, 400, 80, 30] }, dlg);
  if (dialogFoerst) sideAdd();
  return d;
}

test('A: aria-modal med overlay - dialogens Add vaelges, ikke den foerste i DOM', () => {
  const r = tekstKlik(side(), 'Add');
  assert.equal(r.x, 640, `klikket gaar ikke til dialogens knap: ${JSON.stringify(r)}`);
  assert.equal(r.covered, undefined);
});

test('B: aria-modal uden overlay - dialogens Add vaelges stadig', () => {
  assert.equal(elementFor(side({ overlay: false }), 'Add').id, 'dlgAdd');
});

test('C: dialogen foerst i DOM - dialogens Add', () => {
  assert.equal(elementFor(side({ dialogFoerst: true }), 'Add').id, 'dlgAdd');
});

test('E: <dialog> aabnet med showModal - dialogens Add', () => {
  assert.equal(elementFor(side({ dialog: 'modal', overlay: false }), 'Add').id, 'dlgAdd');
});

test('D: en ikke-modal <dialog open> foretraekkes ikke - foerste match i DOM, som foer', () => {
  assert.equal(elementFor(side({ dialog: 'open', overlay: false }), 'Add').id, 'sideAdd');
});

test('en skjult aria-modal-dialog (display:none) er ikke aaben', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  const dlg = d.el('div', { attrs: { 'aria-modal': 'true' }, rect: [400, 300, 400, 200], ingen: true });
  d.el('button', { id: 'dlgAdd', tekst: 'Add', rect: [600, 400, 80, 30] }, dlg);
  assert.equal(elementFor(d, 'Add').id, 'sideAdd');
});

test('raekkefoelgen: dialogens eksakte, saa sidens eksakte, foer dialogens delvise', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  const dlg = d.el('div', { attrs: { 'aria-modal': 'true' }, rect: [400, 300, 400, 200], lag: 10 });
  d.el('button', { id: 'dlgAddItem', tekst: 'Add item', rect: [600, 400, 80, 30] }, dlg);
  assert.equal(elementFor(d, 'Add').id, 'sideAdd', 'en delvis tekst i dialogen slog en eksakt tekst paa siden');
  assert.equal(elementFor(d, 'Add item').id, 'dlgAddItem');
});

test('sidens Add bag et overlay meldes daekket, med hvad der ligger over', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  d.el('div', { id: 'overlay', rect: [0, 0, 1200, 800], lag: 5 });
  const r = tekstKlik(d, 'Add');
  assert.deepEqual({ ...r.covered }, { tag: 'DIV', id: 'overlay', text: '' });
});

test('sidens Add bag en modal dialogs backdrop meldes daekket af dialogen', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  const dlg = d.el('dialog', { id: 'dlg', rect: [400, 300, 400, 200], modal: true });
  d.el('button', { tekst: 'Cancel', rect: [600, 400, 80, 30] }, dlg);
  assert.equal(tekstKlik(d, 'Add').covered?.tag, 'DIALOG');
});

test('css-selektorer daekkes ogsaa: et overlay over #sideAdd', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  d.el('div', { id: 'overlay', rect: [0, 0, 1200, 800], lag: 5 });
  assert.equal(d.koer(KILDE, '#sideAdd', null, null, false, false).svar.covered?.id, 'overlay');
});

// Det der IKKE er en daekning: ellers afvises almindelige formularer.
test('en svaevende label over sit felt, et ikon i knappen og et overlay uden pointer-events er ikke daekning', () => {
  const d = lavKlikDom();
  const felt = d.el('input', { id: 'navn', rect: [20, 20, 200, 40] });
  d.label(felt, { tekst: 'Navn', rect: [20, 20, 200, 40], lag: 1 });
  const knap = d.el('button', { id: 'gem', rect: [20, 100, 80, 30] });
  d.el('span', { tekst: 'Gem', rect: [20, 100, 80, 30] }, knap);
  d.el('div', { id: 'glas', rect: [0, 0, 1200, 800], lag: 9, ingenPeg: true });
  assert.equal(d.koer(KILDE, '#navn', null, null, false, false).svar.covered, undefined, 'feltets egen label blev kaldt daekning');
  assert.equal(tekstKlik(d, 'Gem').covered, undefined, 'knappens egen tekst blev kaldt daekning');
});

test('et element uden pointer-events inde i sin klikbare forfader er ikke daekket - klikket bobler gennem den', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort', attrs: { onclick: '' }, rect: [20, 20, 300, 100] });
  d.el('span', { id: 'titel', tekst: 'Aaben', rect: [30, 30, 100, 20], ingenPeg: true }, kort);
  assert.equal(d.koer(KILDE, '#titel', null, null, false, false).svar.covered, undefined);
});

// R61 (Astra, maalt i model): `text=Name` paa en svaevende label med pointer-events:none over sit eget felt blev kaldt
// daekket af feltet. Musen rammer feltet, og det er netop hvad et klik paa labelen goer.
test('en svaevende label uden pointer-events over sit eget felt er ikke daekket af feltet', () => {
  const d = lavKlikDom();
  const felt = d.el('input', { id: 'name', rect: [20, 20, 200, 40] });
  d.label(felt, { tekst: 'Name', rect: [20, 20, 200, 40], lag: 1, ingenPeg: true });
  const r = tekstKlik(d, 'Name');
  assert.equal(r.tag, 'LABEL');
  assert.equal(r.covered, undefined, `labelens eget felt blev kaldt daekning: ${JSON.stringify(r.covered)}`);
});

test('et andet felt under en label uden pointer-events er stadig en daekning', () => {
  const d = lavKlikDom();
  const eget = d.el('input', { id: 'eget', rect: [400, 400, 100, 30] });
  d.label(eget, { tekst: 'Name', rect: [20, 20, 200, 40], lag: 1, ingenPeg: true });
  d.el('input', { id: 'fremmed', rect: [20, 20, 200, 40] });
  assert.equal(tekstKlik(d, 'Name').covered?.id, 'fremmed');
});

// R61 (Astra): en modal i en aaben shadow root blev ikke fundet, saa sidens Add blev valgt.
test('en modal dialog i en aaben shadow root soeges foerst', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  const vaert = d.el('my-modal', { rect: [400, 300, 400, 200], lag: 10 });
  const rod = d.skygge(vaert);
  const dlg = d.el('div', { id: 'dlg', attrs: { 'aria-modal': 'true' }, rect: [400, 300, 400, 200], lag: 10 }, rod);
  d.el('button', { id: 'dlgAdd', tekst: 'Add', rect: [600, 400, 80, 30], lag: 10 }, dlg);
  assert.equal(elementFor(d, 'Add').id, 'dlgAdd');
});

test('en afkrydsning der er stylet med et span i sin label er ikke daekket', () => {
  const d = lavKlikDom();
  const ramme = d.el('label', { rect: [20, 20, 200, 30] });
  d.el('input', { id: 'ok', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] }, ramme);
  d.el('span', { rect: [20, 20, 20, 20], lag: 1 }, ramme);
  assert.equal(d.koer(KILDE, '#ok', null, null, false, false).svar.covered, undefined);
});

test('gem laegger maalet paa window, saa script-klikket rammer samme element', () => {
  const d = side();
  const { svar, window } = d.koer(KILDE, null, 'Add', null, true, false);
  assert.equal(window.__bmcpMaal?.id, 'dlgAdd');
  assert.equal(svar.x, 640);
});

// ── vaerktoejerne ──────────────────────────────────────────────────────────

const FANE = { id: 1, url: 'https://x.example', windowId: 1, active: true };
const DAEKKET = { x: 60, y: 35, tag: 'BUTTON', text: 'Add', found: true, covered: { tag: 'DIV', id: 'overlay', text: '' } };
function sele({ resolve = DAEKKET, skript = null } = {}) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': FANE, 'tabs.query': [FANE], 'debugger.sendCommand': () => ({}),
    'scripting.executeScript': skript ?? [{ result: resolve }],
  } });
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1 });
  u.ctx.resolveElement = async () => resolve;
  return u;
}
const mus = (u) => u.optager.til('debugger.sendCommand').filter((k) => k.args[1] === 'Input.dispatchMouseEvent');

for (const vaerktoej of ['click', 'double_click', 'right_click', 'hover']) {
  test(`${vaerktoej} paa et daekket maal: ok:false, hvad der daekker, og musen roeres ikke`, async () => {
    const u = sele();
    const svar = await u.hent('dispatch')(9876, vaerktoej, { selector: 'text=Add' });
    assert.equal(svar.ok, false);
    assert.equal(svar.error, 'covered');
    assert.equal(svar.covered_by.id, 'overlay');
    assert.match(svar.note, /At the center of text=Add the mouse reaches DIV#overlay instead/);
    assert.match(svar.note, /Nothing was done/);
    // R61: musen flyttes én gang hen til maalet, foer daekningen maales igen (et tooltip kan skjules af det). Intet tryk.
    const typer = mus(u).map((k) => k.args[2].type);
    assert.ok(typer.length <= 1 && typer.every((x) => x === 'mouseMoved'), `${vaerktoej} sendte ${typer.join(',')} til et daekket maal`);
  });
}

test('script-reserven klikker ikke et daekket maal, og svaret siger det', async () => {
  const kald = [];
  const u = sele({ skript: (o) => { kald.push(o); return [{ result: DAEKKET }]; } });
  const r = await u.hent('scriptingClick')(1, 'text=Add');
  assert.equal(r.reason, 'covered');
  assert.equal(kald.length, 1, 'klikket blev sendt efter at maalet var meldt daekket');
  assert.equal(kald[0].func.name, 'klikMaal');
  assert.deepEqual([...kald[0].args], [null, 'Add', null, true, false]);
});

test('script-reserven klikker det element klikMaal fandt, ikke et den selv leder efter', async () => {
  const kald = [];
  const u = sele({ skript: (o) => { kald.push(o); return [{ result: kald.length === 1 ? { ...DAEKKET, covered: undefined } : { ok: true, tag: 'BUTTON', landed: true } }]; } });
  const r = await u.hent('scriptingClick')(1, '#dlgAdd');
  assert.equal(r.ok, true);
  assert.deepEqual([...kald[0].args], ['#dlgAdd', null, null, true, false]);
  assert.match(String(kald[1].func), /window\.__bmcpMaal/, 'klikket laeser ikke det gemte maal');
  assert.doesNotMatch(String(kald[1].func), /querySelector\(/, 'klikket leder selv efter et element igen');
});

// Teksterne lover det koden goer: alle fire musevaerktoejer afviser et daekket maal, og click soeger i dialogen foerst.
test('teksterne paa alle flader siger det samme som koden', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const laes = (f) => readFileSync(join(ROD, f), 'utf8');
  const bg = laes('extension/background.js');
  const tools = laes('mcp-server/tools.js');
  for (const navn of ['click', 'double_click', 'right_click', 'hover']) {
    const start = bg.indexOf(`    case '${navn}': {`);
    const blok = bg.slice(start, bg.indexOf('\n    case ', start + 10));
    assert.match(blok, /if \(el\.covered\) return daekketSvar\(params\.selector, el\);/, `${navn} afviser ikke et daekket maal`);
    const d = tools.slice(tools.indexOf(`name: 'browser_${navn}'`)).split('inputSchema')[0];
    assert.match(d, /If the mouse would not reach the target at its center - another element lies in front of it \(an overlay, a dialog\\'s backdrop\), or the target does not take clicks there \(pointer-events, visibility, clipping\) - the target gets nothing: the answer is ok:false with error "covered" and covered_by\. In the active tab the mouse may first be moved to the target and back/, `browser_${navn}s beskrivelse`);
  }
  assert.match(tools, /A text selector looks inside an open modal dialog first \(a <dialog> opened with showModal, or a visible element with aria-modal="true"\), exact text before partial/);
  for (const f of ['README.md', 'mcp-server/README.md']) {
    const t = laes(f);
    assert.match(t, /\| `browser_click` \|[^\n]*looks in an open modal dialog first, and nothing is clicked \(`covered`\)/, f);
    for (const n of ['hover', 'double_click', 'right_click']) assert.match(t, new RegExp(`\\| \`browser_${n}\` \\|[^\\n]*the target gets nothing \\(\`covered\`\\)`), `${f}: ${n}`);
  }
  const docs = laes('content/browsermcp-docs-tools.md');
  assert.match(docs, /\| `browser_click` \|[^\n]*looks inside an open modal dialog first\. If the mouse would not reach the target at its center/);
  for (const n of ['double_click', 'right_click', 'hover']) assert.match(docs, new RegExp(`\\| \`browser_${n}\` \\|[^\\n]*The target gets nothing \\(\`covered\`\\)`), n);
});

// ── R61 (Opus, maalt i Chrome): forfaedre, skuffer, stablede dialoger og maal uden for vinduet ─────────────

test('en forfader under midtpunktet er en daekning: deaktiveret link, usynlig knap og skjult afkrydsning', () => {
  const d = lavKlikDom();
  const raekke = d.el('div', { id: 'raekke', rect: [0, 0, 1200, 200] });
  d.el('a', { id: 'betal', tekst: 'Betal', rect: [20, 20, 80, 30], ingenPeg: true, attrs: { href: '#betalt' } }, raekke);
  d.el('button', { id: 'usynlig', tekst: 'Gem', rect: [200, 20, 80, 30], skjult: true }, raekke);
  const lbl = d.el('label', { id: 'lbl', tekst: 'Enig', rect: [430, 20, 60, 30] }, raekke);
  d.el('input', { id: 'enig', attrs: { type: 'checkbox' }, rect: [400, 30, 1, 1], ingenPeg: true }, raekke);
  for (const sel of ['#betal', '#usynlig', '#enig']) {
    assert.equal(d.koer(KILDE, sel, null, null, false, false).svar.covered?.id, 'raekke', `${sel} blev kaldt klikbar, men klikket gaar til raekken`);
  }
  assert.equal(lbl.tagName, 'LABEL');
});

test('en lukket skuffe med aria-modal uden for billedet er ikke en aaben dialog', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  const skuffe = d.el('div', { attrs: { 'aria-modal': 'true' }, rect: [1300, 0, 400, 800] });
  d.el('button', { id: 'skuffeAdd', tekst: 'Add', rect: [1400, 100, 80, 30] }, skuffe);
  assert.equal(elementFor(d, 'Add').id, 'sideAdd');
});

test('af to stablede modale dialoger vaelges den der ligger oeverst, ikke den foerste i DOM', () => {
  const d = lavKlikDom();
  const a = d.el('div', { id: 'A', attrs: { 'aria-modal': 'true' }, rect: [300, 200, 600, 400], lag: 20 });
  d.el('button', { id: 'aOk', tekst: 'OK', rect: [500, 400, 80, 30], lag: 20 }, a);
  const b = d.el('div', { id: 'B', attrs: { 'aria-modal': 'true' }, rect: [200, 100, 800, 600], lag: 10 });
  d.el('button', { id: 'bOk', tekst: 'OK', rect: [250, 150, 80, 30], lag: 10 }, b);
  assert.equal(elementFor(d, 'OK').id, 'aOk');
});

// R62 (Astra): to forskudte, delvist overlappende dialoger ligger begge oeverst ved deres eget midtpunkt.
test('af to forskudte, overlappende modale dialoger vaelges den der ligger oeverst, hvor de overlapper', () => {
  const d = lavKlikDom();
  const oeverst = d.el('div', { id: 'oeverst', attrs: { 'aria-modal': 'true' }, rect: [100, 100, 400, 300], lag: 10 });
  d.el('button', { id: 'upperAdd', tekst: 'Add', rect: [120, 120, 80, 30], lag: 10 }, oeverst);
  const nederst = d.el('div', { id: 'nederst', attrs: { 'aria-modal': 'true' }, rect: [350, 250, 400, 300], lag: 1 });
  d.el('button', { id: 'lowerAdd', tekst: 'Add', rect: [650, 500, 80, 30], lag: 1 }, nederst);
  assert.equal(elementFor(d, 'Add').id, 'upperAdd', 'den nederste dialog blev valgt, fordi den staar sidst i DOM');
});

// Mutant (R62-koersel): en dialog med visibility:hidden har stadig et rektangel, men er ikke aaben.
test('en aria-modal med visibility:hidden er ikke en aaben dialog', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  const dlg = d.el('div', { attrs: { 'aria-modal': 'true' }, rect: [400, 300, 400, 200], skjult: true });
  d.el('button', { id: 'dlgAdd', tekst: 'Add', rect: [600, 400, 80, 30] }, dlg);
  assert.equal(elementFor(d, 'Add').id, 'sideAdd');
});

test('et maal uden for vinduet meldes som uden for, med en forklaring', async () => {
  const d = lavKlikDom();
  d.el('button', { id: 'langtVaek', tekst: 'Langt', rect: [1500, 900, 80, 30] });
  const r = d.koer(KILDE, '#langtVaek', null, null, false, false).svar;
  assert.equal(r.covered?.outside, true);
  const svar = indlaesUdvidelse().hent('daekketSvar')('#langtVaek', r);
  assert.match(svar.note, /The center of #langtVaek is outside the visible part of the page/);
});

// Vaerktoejets eget hover kan have aabnet et tooltip over naboknappen. En rigtig mus skjuler det, naar den flyttes.
test('click flytter musen hen til et daekket maal og maaler igen, foer den afviser', async () => {
  let kald = 0;
  const u = sele();
  await u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });   // et tidligere hover
  u.optager.ryd();
  u.ctx.resolveElement = async () => (++kald === 1 ? DAEKKET : { ...DAEKKET, covered: undefined });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#gem' });
  assert.equal(kald, 2, 'daekningen blev ikke maalt igen efter flytningen');
  const m = mus(u).map((k) => k.args[2].type);
  assert.equal(m[0], 'mouseMoved', 'musen blev ikke flyttet foer der blev maalt igen');
  assert.ok(m.includes('mousePressed'), 'klikket blev ikke sendt, da maalet ikke laengere var daekket');
  assert.notEqual(svar.error, 'covered');
});

test('i en baggrundsfane flyttes musen ikke - Chrome leverer den ikke dér', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { ...FANE, active: false }, 'tabs.query': [FANE], 'debugger.sendCommand': () => ({}),
  } });
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1 });
  u.ctx.resolveElement = async () => DAEKKET;
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#gem' });
  assert.equal(svar.error, 'covered');
  assert.equal(mus(u).length, 0);
});

test('fill med tekst-selektor og select_option klikker ikke et daekket maal', async () => {
  for (const [vaerktoej, p] of [['fill', { selector: 'text=Navn', value: 'x' }], ['select_option', { selector: 'text=Vaelg', value: 'Add' }]]) {
    const u = sele();
    const svar = await u.hent('dispatch')(9876, vaerktoej, p);
    assert.equal(svar.error, 'covered', `${vaerktoej}: ${JSON.stringify(svar)}`);
    assert.equal(mus(u).filter((k) => k.args[2].type === 'mousePressed').length, 0, `${vaerktoej} trykkede paa overlayet`);
  }
});

// ── R62 (Opus, maalt i Chrome) ─────────────────────────────────────────────

test('uden en tidligere musehandling i fanen flyttes musen ikke - daekningen kan ikke vaere vores egen', async () => {
  const u = sele();
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#gem' });
  assert.equal(svar.error, 'covered');
  assert.equal(mus(u).length, 0, 'musen blev flyttet, og det kan aabne en hover-menu');
  assert.match(svar.note, /Nothing was done\./);
});

test('bestaar daekningen efter flytningen, laegges musen tilbage, og svaret siger det', async () => {
  const u = sele();
  await u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  u.optager.ryd();
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#gem' });
  assert.equal(svar.error, 'covered');
  const flyt = mus(u).map((k) => [k.args[2].type, k.args[2].x, k.args[2].y]);
  assert.deepEqual(flyt, [['mouseMoved', 60, 35], ['mouseMoved', 5, 5]], `musen blev ikke lagt tilbage: ${JSON.stringify(flyt)}`);
  assert.match(svar.note, /Nothing was clicked: the mouse was moved to the target and back once/);
});

test('daekningen maales igen i op til 600 ms - et tooltip med skjule-forsinkelse naar at forsvinde', async () => {
  let kald = 0;
  const u = sele();
  await u.hent('cdpSend')(1, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  u.ctx.resolveElement = async () => (++kald <= 3 ? DAEKKET : { ...DAEKKET, covered: undefined });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#gem' });
  assert.equal(kald, 4, `maalt ${kald} gange`);
  assert.notEqual(svar.error, 'covered');
});

test('en label uden for= og uden pointer-events over sit felt: feltet er ikke en daekning (fill text=City)', () => {
  const d = lavKlikDom();
  d.el('input', { id: 'by', rect: [20, 20, 200, 40] });
  d.el('label', { tekst: 'City', rect: [20, 20, 200, 40], lag: 1, ingenPeg: true });
  assert.equal(tekstKlik(d, 'City').covered, undefined);
});

test('tekst uden pointer-events i et kort uden role eller onclick: kortet faar klikket, som siden er bygget til', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort1', rect: [20, 20, 300, 100] });
  d.el('span', { id: 'abon', tekst: 'Abonner nu', rect: [30, 30, 120, 20], ingenPeg: true }, kort);
  assert.equal(tekstKlik(d, 'Abonner nu').covered, undefined);
  // Et deaktiveret link er interaktivt og afvises stadig.
  const d2 = lavKlikDom();
  const raekke = d2.el('div', { id: 'w1', rect: [0, 0, 1200, 200] });
  d2.el('a', { id: 'betal', tekst: 'Betal', rect: [20, 20, 80, 30], ingenPeg: true }, raekke);
  assert.equal(d2.koer(KILDE, '#betal', null, null, false, false).svar.covered?.id, 'w1');
});

test('en aria-modal-indpakning med hoejde 0 og et synligt fast barn er en aaben dialog (Tailwind/Headless UI)', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'sideAdd', tekst: 'Add', rect: [20, 20, 80, 30] });
  const ind = d.el('div', { attrs: { 'aria-modal': 'true' }, rect: [0, 0, 0, 0], lag: 10 });
  const panel = d.el('div', { rect: [400, 300, 400, 200], lag: 10 }, ind);
  d.el('button', { id: 'panelAdd', tekst: 'Add', rect: [600, 400, 80, 30], lag: 10 }, panel);
  assert.equal(elementFor(d, 'Add').id, 'panelAdd');
});

// MAALT i Chrome 9/10 (opus-r62/r63-p14-ny-aktiv.log): to falske afvisninger, hvor en rigtig mus lykkes.
test('en pladsholder-tekst uden pointer-events over et felt: feltet er ikke en daekning (React Select)', () => {
  const d = lavKlikDom();
  d.el('input', { id: 'selIn', rect: [20, 20, 250, 40] });
  d.el('span', { id: 'ph1', tekst: 'Vaelg en person', rect: [30, 28, 150, 24], lag: 1, ingenPeg: true });
  assert.equal(tekstKlik(d, 'Vaelg en person').covered, undefined);
});

test('et link brudt over to linjer klikkes midt i den foerste linjeboks, ikke i hullet imellem', () => {
  const d = lavKlikDom();
  const p = d.el('p', { id: 'afsnit', rect: [20, 160, 300, 60] });
  d.el('a', { id: 'lang', tekst: 'betingelser for brug', attrs: { href: '#x' }, rect: [20, 170, 247, 40],
    linjer: [[150, 170, 117, 18], [20, 192, 103, 18]] }, p);
  const r = tekstKlik(d, 'betingelser for brug');
  assert.deepEqual([r.x, r.y], [208.5, 179]);
  assert.equal(r.covered, undefined, `hullet mellem linjerne blev kaldt en daekning: ${JSON.stringify(r.covered)}`);
});
