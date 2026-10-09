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
    assert.match(svar.note, /At the center of text=Add lies DIV#overlay right now/);
    assert.match(svar.note, /move the mouse away with browser_hover on another element and try again/);
    assert.match(svar.note, /click it directly with its own selector/);
    assert.match(svar.note, /Nothing was done/);
    // R63: en afvisning flytter slet ikke musen (flytningen aabnede menuer, der blev staaende).
    assert.equal(mus(u).length, 0, `${vaerktoej} sendte musehaendelser til et daekket maal`);
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
    // R66: hover og right_click afviser ikke en kontrol INDE i maalet (de klikker den ikke), kun noget foran det.
    const regel = ['hover', 'right_click'].includes(navn) ? /if \(el\.covered && !el\.covered\.inside\) return daekketSvar\(params\.selector, el\);/
      : /if \(el\.covered\) return daekketSvar\(params\.selector, el\);/;
    assert.match(blok, regel, `${navn} afviser ikke et daekket maal`);
    const d = tools.slice(tools.indexOf(`name: 'browser_${navn}'`)).split('inputSchema')[0];
    assert.match(d, /If the mouse would not reach the target at its center - another element lies in front of it \(an overlay, a dialog\\'s backdrop\),[^"]* - the answer is ok:false with error "covered" and covered_by\. Found before the mouse is sent, nothing is sent; if it comes in front afterwards, the rest of the events are stopped and the answer also has maybe_landed: true, because the page may already have reacted\.(?! In the active tab the mouse)/, `browser_${navn}s beskrivelse`);
    // R66: kun click og double_click naevner en anden kontrol INDE i maalet; hover og right_click klikker den ikke.
    if (['click', 'double_click'].includes(navn)) assert.match(d, /or a different control inside it would get the click \(a delete button on a card\)/, navn);
    else assert.doesNotMatch(d, /a different control inside it/, navn);
  }
  assert.match(tools, /A text selector looks inside an open modal dialog first \(a <dialog> opened with showModal, or a visible element with aria-modal="true"\), exact text before partial/);
  for (const f of ['README.md', 'mcp-server/README.md']) {
    const t = laes(f);
    assert.match(t, /\| `browser_click` \|[^\n]*looks in an open modal dialog first, and it answers `covered` instead of clicking/, f);
    for (const n of ['hover', 'double_click', 'right_click']) assert.match(t, new RegExp(`\\| \`browser_${n}\` \\|[^\\n]*answers \`covered\` when the mouse would not reach it`), `${f}: ${n}`);
  }
  const docs = laes('content/browsermcp-docs-tools.md');
  assert.match(docs, /\| `browser_click` \|[^\n]*looks inside an open modal dialog first\. If the mouse would not reach the target at its center/);
  for (const n of ['double_click', 'right_click', 'hover']) assert.match(docs, new RegExp(`\\| \`browser_${n}\` \\|[^\\n]*Answers \`covered\` when the mouse would not reach it`), n);
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

test('en afvisning flytter ikke musen, og noten siger «Nothing was done»', async () => {
  const u = sele();
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#gem' });
  assert.equal(svar.error, 'covered');
  assert.equal(mus(u).length, 0, 'musen blev flyttet, og det kan aabne en hover-menu');
  assert.match(svar.note, /Nothing was done\./);
});

// R63 (Astra og Opus): undtagelsen fra R62 lod fill ramme et FREMMED felt. En label uden for= over et felt er igen en
// daekning; noten peger paa at klikke feltet direkte.
test('en label uden for= over et felt: feltet er en daekning, og det navngives', () => {
  const d = lavKlikDom();
  d.el('input', { id: 'by', rect: [20, 20, 200, 40] });
  d.el('label', { tekst: 'City', rect: [20, 20, 200, 40], lag: 1, ingenPeg: true });
  assert.equal(tekstKlik(d, 'City').covered?.id, 'by');
});

test('nyhedsbrevs-popup over formularen: fill text=E-mail rammer ikke popupens felt (Opus R63)', () => {
  const d = lavKlikDom();
  d.el('input', { id: 'formEmail', rect: [20, 300, 300, 40] });
  d.el('label', { tekst: 'E-mail', rect: [20, 300, 300, 40], lag: 1, ingenPeg: true });
  d.el('input', { id: 'nyhed', rect: [0, 250, 1200, 200], lag: 20 });
  assert.equal(tekstKlik(d, 'E-mail').covered?.id, 'nyhed');
});

test('tekst uden pointer-events i et kort: kortet er en daekning og navngives (R63 - undtagelsen ramte et deaktiveret link)', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort1', rect: [20, 20, 300, 100] });
  d.el('span', { id: 'abon', tekst: 'Abonner nu', rect: [30, 30, 120, 20], ingenPeg: true }, kort);
  assert.equal(tekstKlik(d, 'Abonner nu').covered?.id, 'kort1');
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
test('en pladsholder-tekst over et felt: feltet er en daekning og navngives (R63)', () => {
  const d = lavKlikDom();
  d.el('input', { id: 'selIn', rect: [20, 20, 250, 40] });
  d.el('span', { id: 'ph1', tekst: 'Vaelg en person', rect: [30, 28, 150, 24], lag: 1, ingenPeg: true });
  assert.equal(tekstKlik(d, 'Vaelg en person').covered?.id, 'selIn');
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

// ── R63 (Astra, maalt i model): undtagelserne maa ikke give et forkert klik med ok:true ────────────────────
test('en label uden for= over en fremmed knap (input type=button) er daekket af knappen', () => {
  const d = lavKlikDom();
  d.el('input', { id: 'deleteButton', attrs: { type: 'button' }, rect: [20, 20, 200, 40] });
  d.el('label', { tekst: 'City', rect: [20, 20, 200, 40], lag: 1, ingenPeg: true });
  assert.equal(tekstKlik(d, 'City').covered?.id, 'deleteButton');
});

test('en pladsholder over en fremmed knap er daekket af knappen', () => {
  const d = lavKlikDom();
  d.el('input', { id: 'deleteButton', attrs: { type: 'button' }, rect: [20, 20, 250, 40] });
  d.el('span', { tekst: 'Vaelg en person', rect: [30, 28, 150, 24], lag: 1, ingenPeg: true });
  assert.equal(tekstKlik(d, 'Vaelg en person').covered?.id, 'deleteButton');
});

test('en label uden for= der stikker ud over feltet, er ikke feltets', () => {
  const d = lavKlikDom();
  d.el('input', { id: 'by', rect: [20, 20, 100, 40] });
  d.el('label', { tekst: 'City', rect: [20, 20, 150, 40], lag: 1, ingenPeg: true });   // midtpunkt (95,40) over feltet, men bredere
  assert.equal(tekstKlik(d, 'City').covered?.id, 'by');
});

test('et skjult span (visibility:hidden) i et kort giver ikke kortet et klik', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort1', rect: [20, 20, 300, 100] });
  d.el('span', { id: 'skjult', tekst: 'Slet alt', rect: [30, 30, 120, 20], ingenPeg: true, skjult: true }, kort);
  assert.equal(d.koer(KILDE, '#skjult', null, null, false, false).svar.covered?.id, 'kort1');
});

test('to aria-modal-indpakninger med hoejde 0: den hvis panel ligger oeverst, vaelges', () => {
  const d = lavKlikDom();
  const oeverst = d.el('div', { id: 'oe', attrs: { 'aria-modal': 'true' }, rect: [0, 0, 0, 0], lag: 10 });
  const p1 = d.el('div', { rect: [100, 100, 400, 300], lag: 10 }, oeverst);
  d.el('button', { id: 'upperAdd', tekst: 'Add', rect: [120, 120, 80, 30], lag: 10 }, p1);
  const nederst = d.el('div', { id: 'ne', attrs: { 'aria-modal': 'true' }, rect: [0, 0, 0, 0], lag: 1 });
  const p2 = d.el('div', { rect: [350, 250, 400, 300], lag: 1 }, nederst);
  d.el('button', { id: 'lowerAdd', tekst: 'Add', rect: [650, 500, 80, 30], lag: 1 }, p2);
  assert.equal(elementFor(d, 'Add').id, 'upperAdd');
});



// ── R64 (Astra, maalt i model): rammen og labelen maa ikke godtage en ANDEN kontrol, og adskilte paneler ──────────
test('et input oven paa teksten i et role=button-kort er en daekning, ikke kortets egen ramme', () => {
  const d = lavKlikDom();
  // Kortets laengere beskrivelse (over 40 tegn mere end teksten) goer, at tekstselektoren beholder spanen som maal (Astras opstilling).
  const kort = d.el('div', { id: 'kort1', attrs: { role: 'button' }, tekst: 'Faa nyhedsbrevet hver uge med de bedste tilbud fra hele landet ', rect: [20, 20, 300, 100] });
  d.el('span', { id: 'mail', tekst: 'E-mail', rect: [30, 60, 120, 20] }, kort);
  d.el('input', { id: 'fremmed', rect: [30, 60, 120, 20], lag: 1 }, kort);
  assert.equal(tekstKlik(d, 'E-mail').covered?.id, 'fremmed');
});

test('et link inde i en afkrydsnings label, oven paa afkrydsningen, er en daekning (et klik paa linket afkrydser ikke)', () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'samtykke', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  const l = d.label(boks, { rect: [20, 20, 300, 20], lag: 1 });
  d.el('a', { id: 'vilkaar', tekst: 'vilkaarene', attrs: { href: '#v' }, rect: [20, 20, 100, 20], lag: 1 }, l);
  assert.equal(d.koer(KILDE, '#samtykke', null, null, false, false).svar.covered?.id, 'vilkaar');
  // Labelens egen tekst over afkrydsningen er stadig ikke en daekning.
  const d2 = lavKlikDom();
  const boks2 = d2.el('input', { id: 'samtykke', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  const l2 = d2.label(boks2, { rect: [20, 20, 300, 20], lag: 1 });
  d2.el('span', { tekst: 'Jeg accepterer', rect: [20, 20, 100, 20], lag: 1 }, l2);
  assert.equal(d2.koer(KILDE, '#samtykke', null, null, false, false).svar.covered, undefined);
});

test('to aria-modal-indpakninger med hoejde 0 og adskilte paneler: overlapningen maales i panelerne, ikke i hullet', () => {
  const d = lavKlikDom();
  const oe = d.el('div', { id: 'oe', attrs: { 'aria-modal': 'true' }, rect: [0, 0, 0, 0], lag: 10 });
  const venstre = d.el('div', { rect: [0, 100, 300, 200], lag: 10 }, oe);
  d.el('div', { rect: [700, 100, 300, 200], lag: 10 }, oe);
  d.el('button', { id: 'upperAdd', tekst: 'Add', rect: [20, 120, 80, 30], lag: 10 }, venstre);
  const ne = d.el('div', { id: 'ne', attrs: { 'aria-modal': 'true' }, rect: [0, 0, 0, 0], lag: 1 });
  const midt = d.el('div', { rect: [200, 150, 600, 100], lag: 1 }, ne);
  d.el('button', { id: 'lowerAdd', tekst: 'Add', rect: [450, 180, 80, 30], lag: 1 }, midt);
  assert.equal(elementFor(d, 'Add').id, 'upperAdd');
});

test('select_option: et daekket valg klikkes ikke; udloeseren er klikket, og svaret siger at listen kan staa aaben', async () => {
  const u = sele();
  u.ctx.resolveElement = async (_fane, s) => (s === 'text=Add' ? DAEKKET : { ...DAEKKET, covered: undefined });
  const svar = await u.hent('dispatch')(9876, 'select_option', { selector: 'text=Vaelg', value: 'Add' });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.equal(svar.trigger_clicked, true);
  assert.match(svar.note, /^The dropdown was opened, but its option is covered: At the center of text=Add lies DIV#overlay/);
  assert.match(svar.note, /The list may still be open\.$/);
  assert.equal(mus(u).filter((k) => k.args[2].type === 'mousePressed').length, 1, 'kun udloeseren maa vaere trykket');
});

// R64 (Astra, maalt i model): en mellemvej uden falske ja - er foerste linje daekket, klikkes den naeste linje, hvis
// midtpunkt rammer linket selv. Er begge daekket, afvises der som foer.
test('et ombrudt link, hvis foerste linje er daekket, klikkes paa anden linje; er begge daekket, afvises det', () => {
  const lav = (daek) => {
    const d = lavKlikDom();
    const p = d.el('p', { id: 'afsnit', rect: [20, 160, 300, 60] });
    d.el('a', { id: 'lang', tekst: 'betingelser for brug', attrs: { href: '#x' }, rect: [20, 170, 247, 40],
      linjer: [[150, 170, 117, 18], [20, 192, 103, 18]] }, p);
    if (daek >= 1) d.el('div', { id: 'over1', rect: [150, 170, 117, 18], lag: 20 });
    if (daek >= 2) d.el('input', { id: 'over2', rect: [20, 192, 103, 18], lag: 20 });
    // klik-dom kender ikke linjebokse i elementFromPoint: linket rammes kun i sine linjer, ellers afsnittet.
    const hit = d.document.elementFromPoint.bind(d.document);
    const a = d.document.querySelector('#lang');
    d.document.elementFromPoint = (x, y) => { const e = hit(x, y); if (e !== a) return e;
      return a.getClientRects().some((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom) ? a : p; };
    return tekstKlik(d, 'betingelser for brug');
  };
  assert.deepEqual([lav(0).x, lav(0).y, lav(0).covered], [208.5, 179, undefined]);
  const r1 = lav(1);
  assert.deepEqual([r1.x, r1.y, r1.covered], [71.5, 201, undefined], 'anden linje blev ikke valgt');
  assert.equal(lav(2).covered?.id, 'over1', 'to daekkede linjer skal afvises med den foerste linjes daekning');
});

test('select_option-teksterne siger, at ogsaa valget tjekkes (R64)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const laes = (f) => readFileSync(join(ROD, f), 'utf8');
  assert.match(laes('mcp-server/tools.js'), /So does the option once the list is open: if it is covered, it is not clicked, and the answer is ok:false with error "covered" and trigger_clicked: true - the list may still be open\./);
  for (const f of ['README.md', 'mcp-server/README.md']) assert.match(laes(f), /\| `browser_select_option` \|[^\n]*a custom trigger or option the mouse would not reach is not clicked \(`covered`\)/, f);
  assert.match(laes('content/browsermcp-docs-tools.md'), /\| `browser_select_option` \|[^\n]*A custom trigger or option the mouse would not reach is not clicked \(`covered`\)/);
  assert.match(laes('CHANGELOG.md'), /a custom dropdown's trigger or option in `browser_select_option` \(for the option with `trigger_clicked: true`/);
});

// ── R64 (Opus' egne sider, maalt i Chrome 9/10) ────────────────────────────
test('en label, hvis midtpunkt ligger paa et link inde i den, er daekket af linket; dens eget felt er ikke', () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'samtykke', attrs: { type: 'checkbox' }, rect: [40, 40, 16, 16] });
  const l = d.label(boks, { id: 'lsam', tekst: 'Jeg accepterer ', rect: [40, 36, 400, 24] });
  d.el('a', { id: 'vilk', tekst: 'vilkaarene og privatlivspolitikken', attrs: { href: '#v' }, rect: [160, 36, 280, 24] }, l);
  const r = tekstKlik(d, 'Jeg accepterer');
  assert.equal(r.covered?.id, 'vilk', JSON.stringify(r));
  assert.equal(r.covered?.inside, true);
  const svar = indlaesUdvidelse().hent('daekketSvar')('text=Jeg accepterer', r);
  assert.match(svar.note, /a different control inside it, so the mouse would click that, and a click on a control inside a label does not activate the label's own field/);
  // Labelens eget felt i midtpunktet er ikke en daekning.
  const d2 = lavKlikDom();
  const boks2 = d2.el('input', { id: 'nyt', attrs: { type: 'checkbox' }, rect: [40, 40, 400, 16], lag: 1 });
  const l2 = d2.label(boks2, { id: 'lnyt', tekst: 'Ja tak ', rect: [40, 36, 400, 24] });
  l2.children.push(boks2); boks2.parentNode = l2;
  assert.equal(tekstKlik(d2, 'Ja tak').covered, undefined);
});

test('et klik paa en iframe er uvist (det gik ind i rammen), og reserven klikker ikke igen', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const bg = readFileSync(join(ROD, 'extension/background.js'), 'utf8');
  const settle = bg.slice(bg.indexOf('const settle = await evaluerTaalmodigt'), bg.indexOf('const foerAftryk = aftryk();'));
  assert.match(settle, /if \(el && \/\^\(IFRAME\|FRAME\|OBJECT\|EMBED\)\$\/\.test\(el\.tagName \|\| ''\)\) \{ ryd\(\); return \{ landed: null, fallbackFired: false, iRamme: true \}; \}/);
  const u = indlaesUdvidelse();
  const v = u.hent('uvisVurdering')({ landed: null, iRamme: true });
  assert.equal(v.maybe_landed, true);
  assert.match(v.note, /The click went into a frame \(an iframe\), and the page around it cannot see what happened inside\. It may have landed: check the frame before clicking again/);
});

test('et maal, der blev rullet frem, maales igen efter at siden har sat sig (header der bliver fast)', async () => {
  let n = 0;
  const u = indlaesUdvidelse({ svar: {
    'scripting.executeScript': () => [{ result: ++n === 1 ? { x: 60, y: 300, found: true, rullet: true } : { x: 60, y: 160, found: true } }],
  } });
  const r = await u.hent('resolveElement')(1, '#b6');
  assert.equal(n, 3, 'maalet blev ikke maalt igen, til to maalinger var ens');
  assert.deepEqual([r.x, r.y], [60, 160]);
  n = 10;
  const u2 = indlaesUdvidelse({ svar: { 'scripting.executeScript': () => [{ result: { x: 1, y: 2, found: true } }] } });
  await u2.hent('resolveElement')(1, '#b6');
  assert.equal(u2.optager.antal('scripting.executeScript'), 1, 'et maal, der ikke blev rullet, maales kun én gang');
});

test('klikMaal melder rullet, naar maalet flyttede sig ved rulningen, og ellers ikke', () => {
  const d = lavKlikDom();
  const knap = d.el('button', { id: 'b6', tekst: 'Vaelg', rect: [20, 1200, 80, 30] });
  knap.scrollIntoView = () => { knap.rect = [20, 385, 80, 30]; };
  assert.equal(d.koer(KILDE, '#b6', null, null, false, false).svar.rullet, true);
  assert.equal(d.koer(KILDE, '#b6', null, null, false, false).svar.rullet, undefined, 'et maal der stod stille, meldes som rullet');
});

test('CHANGELOG 1.30.2 siger, hvad et klik paa en iframe svarer, og hvad 1.30.1 gjorde', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const cl = readFileSync(join(ROD, 'CHANGELOG.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(cl, /A press that lands in an iframe - the target itself, or one inside it such as a payment frame in a wrapper - goes into the frame, where the page around it cannot see it: the answer is `landed: null` with `maybe_landed: true` and a note to check the frame, and no synthetic click follows; a frame that came in front of the target is `covered`, also with `maybe_landed`\. 1\.30\.1 answered `ok: false` and sent a second, synthetic click/);
  assert.match(cl, /A target that had to be scrolled into view is measured again without scrolling, 100 ms apart, until two measurements agree \(at most three times\)/);
  assert.match(cl, /only that very event reaching the target counts as proof \(for a field clicked through its label, the field's own click\); a click stopped on the way, a target the page replaces during the click, or no event at all gives `maybe_landed`, not a yes\. A real mouse at the same point at the same time cannot be told apart from the tool's\./);
  assert.match(cl, /A label whose center lies on interactive content inside it \(as the HTML standard defines it: a link with an address, a button, a field\) counts as covered by that element/);
});

// ── R65 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('en liste med EN delegerende onclick godtager ikke naboraekken som maalets ramme', () => {
  const d = lavKlikDom();
  const liste = d.el('div', { id: 'liste', attrs: { onclick: 'vaelg(event)' }, rect: [0, 100, 600, 840] });
  d.el('div', { id: 'r6', tekst: 'Ordre 6', rect: [0, 450, 600, 70] }, liste);
  d.el('div', { id: 'rNY', tekst: 'Ordre NY', rect: [0, 450, 600, 70], lag: 1 }, liste);
  assert.equal(d.koer(KILDE, '#r6', null, null, false, false).svar.covered?.id, 'rNY');
});

test('en label: kun HTML-standardens interaktive indhold er en anden kontrol (et link uden href er ikke)', () => {
  const lav = (tag, attrs) => {
    const d = lavKlikDom();
    const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 16, 16] });
    const l = d.label(boks, { id: 'l', tekst: 'Accepter ', rect: [20, 10, 500, 40] });
    d.el(tag, { id: 'i', tekst: 'vilkaar', attrs, rect: [170, 15, 200, 30] }, l);
    return d.koer(KILDE, '#l', null, null, false, false).svar.covered;
  };
  assert.equal(lav('a', {}), undefined, 'et link uden href afkrydser feltet med en rigtig mus');
  assert.equal(lav('span', { role: 'button' }), undefined);
  assert.equal(lav('span', { onclick: 'x()' }), undefined);
  assert.equal(lav('a', { href: '#v' })?.id, 'i');
  assert.equal(lav('button', {})?.id, 'i');
  assert.equal(lav('input', { type: 'text' })?.id, 'i');
  assert.equal(lav('input', { type: 'hidden' }), undefined);
});

test('en armeret vagt, der ikke saa en eneste haendelse, giver ingen reserve - en ramme i punktet afgoer svaret', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const bg = readFileSync(join(ROD, 'extension/background.js'), 'utf8');
  const settle = bg.slice(bg.indexOf('const settle = await evaluerTaalmodigt'), bg.indexOf('const foerAftryk = aftryk();'));
  assert.match(settle, /if \(vagt && vagt\.sendt === 0\) \{/);
  assert.match(settle, /if \(ramme && !iMaalet\) return \{ landed: null, fallbackFired: false, fremmedRamme:/);
  assert.match(settle, /return \{ landed: null, fallbackFired: false, \.\.\.\(ramme \? \{ iRamme: true \} : \{ ingenHaendelse: true \}\) \};/);
  const u = indlaesUdvidelse();
  assert.match(u.hent('uvisVurdering')({ landed: null, ingenHaendelse: true }).note, /no mouse event reached the page around the target/);
  const svar = u.hent('vagtSvar')('#gem', { tag: 'BUTTON' }, { blokeret: { tag: 'IFRAME', id: 'annonce', text: '' }, iFremmedRamme: true });
  assert.equal(svar.error, 'covered');
  assert.equal(svar.maybe_landed, true);
  assert.match(svar.note, /^When the mouse pressed, IFRAME#annonce - a frame - lay in front of #gem, and the press went into it/);
});

test('et kort med en Slet-knap i midten er daekket af knappen; et felt i en combobox-beholder er ikke (R65)', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort', attrs: { role: 'button' }, tekst: 'Ordre 7 - aabn', rect: [40, 40, 400, 80] });
  d.el('button', { id: 'slet', tekst: 'Slet', rect: [190, 60, 100, 40], lag: 1 }, kort);
  const r = d.koer(KILDE, '#kort', null, null, false, false).svar;
  assert.equal(r.covered?.id, 'slet');
  assert.equal(r.covered?.inside, true);
  assert.match(indlaesUdvidelse().hent('daekketSvar')('#kort', r).note, /a different control inside it, so the mouse would click that instead and run its action/);
  const d2 = lavKlikDom();
  const cb = d2.el('div', { id: 'rs', tekst: 'Vaelg land', rect: [40, 40, 300, 40] });
  d2.el('input', { id: 'rsIn', attrs: { type: 'text', role: 'combobox' }, rect: [50, 45, 280, 30], lag: 1 }, cb);
  assert.equal(d2.koer(KILDE, '#rs', null, null, false, false).svar.covered, undefined);
});

// ── R66 (Astra, maalt i model) ─────────────────────────────────────────────
test('et kort med en Slet som span role=button eller span med onclick er daekket', () => {
  for (const attrs of [{ role: 'button' }, { onclick: 'slet()' }]) {
    const d = lavKlikDom();
    const kort = d.el('div', { id: 'kort', attrs: { role: 'button' }, tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('span', { id: 'slet', tekst: 'Slet', attrs, rect: [190, 60, 100, 40], lag: 1 }, kort);
    assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'slet', JSON.stringify(attrs));
  }
});

test('et felt, hvis egen label har en span role=button i punktet, er ikke daekket (HTML-standarden)', () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  const l = d.label(boks, { id: 'l', tekst: 'Accepter ', rect: [0, 0, 400, 60] });
  d.el('span', { id: 'i', tekst: 'vilkaar', attrs: { role: 'button' }, rect: [20, 20, 20, 20], lag: 1 }, l);
  assert.equal(d.koer(KILDE, '#c', null, null, false, false).svar.covered, undefined);
});

test('en genmaaling ruller ikke maalet igen (ellers er to maalinger ens per konstruktion) (R66)', () => {
  const d = lavKlikDom();
  const knap = d.el('button', { id: 'b6', tekst: 'Vaelg', rect: [20, 300, 80, 30] });
  let rullet = 0;
  knap.scrollIntoView = () => { rullet++; };
  d.koer(KILDE, '#b6', null, null, false, false, true);
  assert.equal(rullet, 0, 'genmaalingen rullede');
  d.koer(KILDE, '#b6', null, null, false, false);
  assert.equal(rullet, 1);
});
