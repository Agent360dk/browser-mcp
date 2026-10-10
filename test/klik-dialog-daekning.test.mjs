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
import { indlaesUdvidelse, medVagt } from './hjaelp/udvidelses-sele.mjs';
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
    'tabs.get': FANE, 'tabs.query': [FANE], 'debugger.sendCommand': medVagt(() => ({})),
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
    // R68: hover sender ingen tryk og intet slip - dens tekst siger musens bevaegelse.
    const hale = navn === 'hover' ? 'the rest of the mouse movement is stopped and the answer'
      : 'the rest of the presses and clicks are stopped \\(a release the page moves elsewhere is let through\\), and the answer';
    assert.match(d, new RegExp(`If the mouse would not reach the target at its center - another element lies in front of it \\(an overlay, a dialog\\\\'s backdrop\\),[^"]* - the answer is ok:false with error "covered" and covered_by\\. Found before the mouse is sent, nothing is sent; if it comes in front afterwards, ${hale} also has maybe_landed: true, because the page may already have reacted\\.(?! In the active tab the mouse)`), `browser_${navn}s beskrivelse`);
    // R66: kun click og double_click naevner en anden kontrol INDE i maalet; hover og right_click klikker den ikke.
    if (['click', 'double_click'].includes(navn)) assert.match(d, /or a different control inside it would get the click \(a delete button on a card; for a container that is not clickable itself, its own plain link with a real address \(a hash route with a path, such as #\/orders, counts; a fragment with no target on the page does not\) does not count, nor does a web component\\'s own button that covers it, nor a box with a checkbox, switch or radio role right next to a hidden field and the only one in the nearest label around it, a label of that field \(a box inside a closed shadow root cannot be seen and is not counted\), which counts as that field\)/, navn);
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
  // R69: select_option gaar kun videre efter et bevist udloeserklik; efterkontrollen svarer her, at det landede.
  const send = u.ctx.chrome.debugger.sendCommand;
  u.ctx.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Runtime.evaluate' && String(p?.expression).includes('const foerAftryk')
    ? Promise.resolve({ result: { value: { landed: true, fallbackFired: false } } }) : send(m, metode, p));
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
  assert.match(svar.note, /a different control inside it, so the mouse would click that, and a click on a control inside a label does not, or may not, activate the label's own field \(its own click handler can cancel it\)/);
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
  // R66: genmaalingerne ruller ikke igen (6. argument til klikMaal).
  const kald = u.optager.til('scripting.executeScript').map((k) => k.args[0].args[5]);
  assert.deepEqual(kald, [false, true, true], 'genmaalingen bad klikMaal rulle igen');
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
  assert.match(cl, /A target that had to be scrolled into view is measured again without scrolling, 100 ms apart, until two measurements agree \(at most three times; pushed out of view meanwhile, it is scrolled into view again\)/);
  assert.match(cl, /only that very event reaching the target counts as proof \(for a field clicked through its label, the field's own click, only when the label's click was not cancelled, and once; around the target, only its own control frame \(a button, link or summary, or an element with a button, link, menu item, option, tab, checkbox, radio or switch role\), not a container that listens for its children, and for a field, a button or any custom element \(a tag name with a hyphen, as every form-associated custom field has\) as the target, not even its own box: only an event that reaches the target itself, so a custom icon whose click only reaches the button around it is `maybe_landed`\); a click stopped on the way, a target the page replaces during the click, a dialog that holds the page while the click is read, or no event at all gives `maybe_landed`, not a yes\. A real mouse at the same point at the same time cannot be told apart from the tool's\./);
  assert.match(cl, /A label whose center lies on interactive content inside it \(as the HTML standard defines it: a link with an address, a button, a field\), or on anything else clickable in it \(a link without an address, an element with a button role or an `onclick`, whose own handler can cancel the click unseen\), counts as covered by that element/);
});

// ── R65 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('en liste med EN delegerende onclick godtager ikke naboraekken som maalets ramme', () => {
  const d = lavKlikDom();
  const liste = d.el('div', { id: 'liste', attrs: { onclick: 'vaelg(event)' }, rect: [0, 100, 600, 840] });
  d.el('div', { id: 'r6', tekst: 'Ordre 6', rect: [0, 450, 600, 70] }, liste);
  d.el('div', { id: 'rNY', tekst: 'Ordre NY', rect: [0, 450, 600, 70], lag: 1 }, liste);
  assert.equal(d.koer(KILDE, '#r6', null, null, false, false).svar.covered?.id, 'rNY');
});

// R74 (Opus, maalt i Chrome): et link uden href, en span med role=button eller med onclick afkrydser kun feltet, naar deres
// egen klikhaandtering ikke annullerer klikket - og det kan ikke ses foer klikket. Med annullering gav de ok:true med boksen
// tom. De er derfor ogsaa daekning (bevidst forsigtigt: uden annullering ville en mus have afkrydset).
test('en label: interaktivt indhold og enhver handling er en anden kontrol; et skjult felt er ikke (R65, R74)', () => {
  const lav = (tag, attrs) => {
    const d = lavKlikDom();
    const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 16, 16] });
    const l = d.label(boks, { id: 'l', tekst: 'Accepter ', rect: [20, 10, 500, 40] });
    d.el(tag, { id: 'i', tekst: 'vilkaar', attrs, rect: [170, 15, 200, 30] }, l);
    return d.koer(KILDE, '#l', null, null, false, false).svar.covered;
  };
  assert.equal(lav('a', {})?.id, 'i', 'et link uden href kan annullere klikket');
  assert.equal(lav('span', { role: 'button' })?.id, 'i');
  assert.equal(lav('span', { onclick: 'x()' })?.id, 'i');
  assert.equal(lav('span', {}), undefined, 'almindelig tekst i labelen er labelens egen');
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
  // R67: en fremmed ramme i punktet afgoer svaret, naar klikket ikke naaede maalet - ogsaa efter noget blev sendt.
  assert.match(settle, /if \(vagt && !iMaal && rammeIPunkt && !rammeIMaalet\) \{/);
  assert.match(settle, /return \{ landed: null, fallbackFired: false, fremmedRamme: \{ tag: p\.tagName, id: p\.id \|\| null, text: '' \}, trykNaaet \};/);
  assert.match(settle, /if \(vagt && vagt\.sendt === 0\) \{ ryd\(\); return \{ landed: null, fallbackFired: false, trykNaaet, \.\.\.\(rammeIPunkt \? \{ iRamme: true \} : \{ ingenHaendelse: true \}\) \}; \}/);
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
  assert.doesNotMatch(indlaesUdvidelse().hent('daekketSvar')('#kort', r).note, /shadow root/, 'en knap i light DOM faar ikke skygge-noten');
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

test('et felt, hvis egen label har en span role=button i punktet, er daekket af den (R66, vendt i R74)', () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  const l = d.label(boks, { id: 'l', tekst: 'Accepter ', rect: [0, 0, 400, 60] });
  d.el('span', { id: 'i', tekst: 'vilkaar', attrs: { role: 'button' }, rect: [20, 20, 20, 20], lag: 1 }, l);
  assert.equal(d.koer(KILDE, '#c', null, null, false, false).svar.covered?.id, 'i');
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

test('et klikbart kort (role=button) med et link i midten er daekket af linket; et passivt kort er ikke (R66)', () => {
  for (const [attrs, daekket] of [[{ role: 'button' }, true], [{}, false]]) {
    const d = lavKlikDom();
    const kort = d.el('div', { id: 'kort', attrs, tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('a', { id: 'lnk', tekst: 'Se ordren', attrs: { href: '/ordre/7' }, rect: [190, 60, 100, 40], lag: 1 }, kort);
    assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id === 'lnk', daekket, JSON.stringify(attrs));
  }
});

test('et passivt kort med <a role=button onclick> eller <a href role=button> i midten er daekket; et rigtigt link er kortets eget (R67)', () => {
  for (const [attrs, daekket] of [[{ role: 'button', onclick: 'slet()' }, true], [{ href: '#s', role: 'button' }, true], [{ href: '#s', onclick: 'slet()' }, true], [{ href: '/ordre/7' }, false]]) {
    const d = lavKlikDom();
    const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('a', { id: 'i', tekst: 'Slet', attrs, rect: [190, 60, 100, 40], lag: 1 }, kort);
    assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id === 'i', daekket, JSON.stringify(attrs));
  }
});

// ── R67 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('et passivt kort med en role=button uden om et ikon-link er daekket af knappen (R67)', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
  const knap = d.el('div', { id: 'slet', attrs: { role: 'button' }, rect: [190, 60, 100, 40], lag: 1 }, kort);
  d.el('a', { id: 'ikon', attrs: { href: '/ordre/7/slet' }, rect: [190, 60, 100, 40], lag: 2 }, knap);
  assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'slet');
});

test('en genmaaling, der finder maalet uden for vinduet, ruller det frem igen (R67)', async () => {
  let n = 0;
  const u = indlaesUdvidelse({ svar: { 'scripting.executeScript': () => [{ result: [
    { x: 60, y: 300, found: true, rullet: true },
    { x: 60, y: 900, found: true, covered: { outside: true } },
    { x: 60, y: 400, found: true },
    { x: 60, y: 400, found: true }][Math.min(n++, 3)] }] } });
  const r = await u.hent('resolveElement')(1, '#maal');
  assert.deepEqual([r.x, r.y, r.covered], [60, 400, undefined]);
  assert.deepEqual(u.optager.til('scripting.executeScript').map((k) => k.args[0].args[5]), [false, true, false, true]);
});

// ── R68 (Astra, maalt i model) ─────────────────────────────────────────────
test('et passivt kort: en knap flere linklag oppe er daekningen; et <a> uden adresse er en handling (R68)', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
  const knap = d.el('div', { id: 'slet', attrs: { role: 'button' }, rect: [190, 60, 100, 40], lag: 1 }, kort);
  const span = d.el('span', { id: 'sl', rect: [190, 60, 100, 40], lag: 2 }, knap);
  d.el('a', { id: 'a', attrs: { href: '/ordre/7' }, rect: [190, 60, 100, 40], lag: 3 }, span);
  assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'slet');
  // R69 (Opus): et element med link-rolle, der ikke er et <a>, har ingen adresse - det er selv en handling.
  span.attrs.role = 'link';
  assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'sl');
  const d2 = lavKlikDom();
  const kort2 = d2.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
  d2.el('a', { id: 'inert', tekst: 'Ordre 7', rect: [190, 60, 100, 40], lag: 1 }, kort2);
  // Opus (Chrome, r66-rollekort): et <a> uden adresse kan baere en lytter, der ikke kan ses - det er en handling.
  assert.equal(d2.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'inert', 'et <a> uden adresse er en handling');
});

test('et felt uden pointer-events i en div role=button er daekket af knappen - knappens klik er ikke feltets (R68)', () => {
  for (const tag of ['input', 'select', 'textarea']) {
    const d = lavKlikDom();
    const knap = d.el('div', { id: 'knap', attrs: { role: 'button' }, rect: [20, 20, 300, 60] });
    d.el(tag, { id: 'felt', rect: [40, 30, 200, 40], ingenPeg: true }, knap);
    assert.equal(d.koer(KILDE, '#felt', null, null, false, false).svar.covered?.id, 'knap', tag);
  }
});

// ── R68 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('et passivt kort: <a href="#">, javascript: og <a role="menuitem"> er handlinger, ikke kortets eget link (R68)', () => {
  for (const [attrs, daekket] of [[{ href: '#' }, true], [{ href: 'javascript:void(0)' }, true], [{ href: '#', role: 'menuitem' }, true],
    [{ href: '/ordre/7', role: 'menuitem' }, true], [{ href: '/ordre/7' }, false], [{ href: '#ordre-7' }, true]]) {
    const d = lavKlikDom();
    const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('a', { id: 'i', tekst: 'Slet', attrs, rect: [190, 60, 100, 40], lag: 1 }, kort);
    assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id === 'i', daekket, JSON.stringify(attrs));
  }
});

test('en tekst i et kort vaelger ikke kortets foerste klikbare barn (Slet), naar teksten ikke staar i det (R68)', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
  d.el('button', { id: 'slet', tekst: 'Slet', rect: [300, 60, 100, 40] }, kort);
  const r = d.koer(KILDE, null, 'Ordre 7', null, false, false).svar;
  assert.notEqual(r.tag, 'BUTTON', JSON.stringify(r));
  assert.equal(elementFor(d, 'Ordre 7').id, 'kort');
});

// ── R69 (Astra, maalt i model) ─────────────────────────────────────────────
test('et passivt kort: javascript: med linjeskift, tabulator eller styretegn er en handling, ikke kortets link (R69)', () => {
  for (const href of ['java\nscript:void(0)', 'java\tscript:void(0)', '\u0001 javascript:void(0)', 'JAVA\r\nSCRIPT:x', ' #\n']) {
    const d = lavKlikDom();
    const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('a', { id: 'i', tekst: 'Slet', attrs: { href }, rect: [190, 60, 100, 40], lag: 1 }, kort);
    assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'i', JSON.stringify(href));
  }
});

test('et passivt kort: en role=button-vaert uden om en span i sin aabne shadow root er daekningen (R69)', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
  const vaert = d.el('div', { id: 'slet', attrs: { role: 'button' }, rect: [190, 60, 100, 40], lag: 1 }, kort);
  d.el('span', { id: 'sp', tekst: 'Slet', rect: [190, 60, 100, 40], lag: 2 }, d.skygge(vaert));
  assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'slet');
});

test('et passivt kort: en knap over en label eller et felt i kaeden er stadig daekningen (R69)', () => {
  for (const mellem of ['label', 'input']) {
    const d = lavKlikDom();
    const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    const knap = d.el('div', { id: 'slet', attrs: { role: 'button' }, rect: [190, 60, 100, 40], lag: 1 }, kort);
    const m = d.el(mellem, { id: 'm', attrs: mellem === 'input' ? { type: 'text' } : {}, rect: [190, 60, 100, 40], lag: 2 }, knap);
    if (mellem === 'label') d.el('a', { id: 'a', attrs: { href: '/ordre/7' }, rect: [190, 60, 100, 40], lag: 3 }, m);
    assert.ok(d.koer(KILDE, '#kort', null, null, false, false).svar.covered, mellem);
  }
});

// ── R69 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('et passivt kort: <span role="link"> og et fragment uden maal paa siden, eller til linket selv eller kortet, er handlinger; et spring til et andet afsnit er kortets link (R69)', () => {
  for (const [tag, attrs, maal, daekket] of [
    ['span', { role: 'link' }, null, true], ['a', { href: '#!' }, null, true], ['a', { href: '#0' }, null, true],
    ['a', { href: '#slet' }, null, true], ['a', { href: '#i' }, null, true], ['a', { href: '#kort' }, null, true],
    ['a', { href: '#afsnit' }, 'id', false], ['a', { href: '#anker' }, 'name', false],
    ['a', { href: '#top' }, null, false], ['a', { href: '/ordre/7' }, null, false]]) {
    const d = lavKlikDom();
    if (maal === 'id') d.el('section', { id: 'afsnit', rect: [0, 600, 1200, 100] });
    if (maal === 'name') d.el('a', { attrs: { name: 'anker' }, rect: [0, 700, 10, 10] });
    const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el(tag, { id: 'i', tekst: 'Slet', attrs, rect: [190, 60, 100, 40], lag: 1 }, kort);
    assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id === 'i', daekket, `${tag} ${JSON.stringify(attrs)}`);
  }
});

// ── R70 (Astra, maalt i model) ─────────────────────────────────────────────
test('et passivt kort: en knap i en shadow root omkring en slot, der viser kortets span, er daekningen (R70)', () => {
  const d = lavKlikDom();
  const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
  const vaert = d.el('my-row', { id: 'vaert', rect: [190, 60, 100, 40], lag: 1 }, kort);
  const knap = d.el('div', { id: 'slet', attrs: { role: 'button' }, rect: [190, 60, 100, 40], lag: 1 }, d.skygge(vaert));
  const slot = d.el('slot', { rect: [190, 60, 100, 40], lag: 1 }, knap);
  const span = d.el('span', { id: 'sp', tekst: 'Slet', rect: [190, 60, 100, 40], lag: 2 }, vaert);
  span.assignedSlot = slot;
  assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'slet');
});

test('fragmentopslaget foelger HTML: som skrevet, saa afkodet, saa top - og et spring til linket selv er en handling (R70)', () => {
  for (const [href, andet, linketsId, daekket] of [
    ['#section%20one', 'section%20one', null, false], ['#section%20one', 'section one', 'section%20one', true],
    ['#top', null, 'top', true], ['#%74op', null, 'top', true], ['#x%E9', 'x�', null, false], ['#section%20one', 'section one', null, false]]) {
    const d = lavKlikDom();
    if (andet) d.el('section', { id: andet, rect: [0, 600, 1200, 100] });
    const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('a', { id: linketsId || 'i', tekst: 'Slet', attrs: { href }, rect: [190, 60, 100, 40], lag: 1 }, kort);
    const r = d.koer(KILDE, '#kort', null, null, false, false).svar;
    assert.equal(!!r.covered, daekket, `${href} (andet: ${andet}, linket: ${linketsId}): ${JSON.stringify(r.covered)}`);
  }
});

test('en label: et link i en shadow root omkring en slot, der viser labelens tekst, er daekningen (R70)', () => {
  const d = lavKlikDom();
  const felt = d.el('input', { id: 'cb', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  const l = d.label(felt, { id: 'l', rect: [60, 20, 300, 30] });
  const vaert = d.el('my-link', { rect: [60, 20, 300, 30], lag: 1 }, l);
  const a = d.el('a', { id: 'vilk', attrs: { href: '/vilkaar' }, rect: [60, 20, 300, 30], lag: 1 }, d.skygge(vaert));
  const slot = d.el('slot', { rect: [60, 20, 300, 30], lag: 1 }, a);
  const span = d.el('span', { tekst: 'vilkaarene', rect: [60, 20, 300, 30], lag: 2 }, vaert);
  span.assignedSlot = slot;
  assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered?.id, 'vilk');
});

// ── R70 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('et passivt kort: et link til samme dokument med pladsholder er en handling, ogsaa kun-fragment med <base> andetsteds; en rute og en genindlaesning er kortets link (R70, R71)', () => {
  for (const [href, base, daekket] of [
    ['/side#!', null, true], ['https://x.example/side#', null, true], ['#x', null, true], ['http://[ugyldig', null, true], ['#', null, true],
    ['/SIDE#!', null, false], ['#', 'https://andet.example/', true], ['#!', 'https://andet.example/', true], ['#/', null, true], ['#!/', null, true],
    ['side#x', 'https://andet.example/', false],
    ['/side', null, false], ['/side?q=1#!', null, false], ['#/ordre/7', null, false], ['#!/ordre/7', null, false],
    ['#x', 'https://andet.example/', true]]) {
    const d = lavKlikDom();
    if (base) d.document.baseURI = base;
    const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('a', { id: 'i', tekst: 'Slet', attrs: { href }, rect: [190, 60, 100, 40], lag: 1 }, kort);
    assert.equal(d.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id === 'i', daekket, `${href} (base ${base})`);
  }
});

// ── R71 (Astra, maalt i model) ─────────────────────────────────────────────
test('fragmentopslaget bevarer et indledende U+FEFF i det afkodede id, som HTML (R71)', () => {
  for (const [linketsId, andetId, href, daekket] of [
    ['﻿section', 'section', '#%EF%BB%BFsection', true], [null, '﻿section', '#%EF%BB%BFsection', false], [null, null, '#%EF%BB%BFtop', true]]) {
    const d = lavKlikDom();
    if (andetId) d.el('section', { id: andetId, rect: [0, 600, 1200, 100] });
    const kort = d.el('div', { id: 'kort', tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('a', { id: linketsId || 'i', tekst: 'Slet', attrs: { href }, rect: [190, 60, 100, 40], lag: 1 }, kort);
    assert.equal(!!d.koer(KILDE, '#kort', null, null, false, false).svar.covered, daekket, `${href} (linket: ${JSON.stringify(linketsId)}, andet: ${JSON.stringify(andetId)})`);
  }
});

test('en knap i en shadow root er ikke daekket af sit eget slottede ikon (R71)', () => {
  const d = lavKlikDom();
  const vaert = d.el('my-button', { id: 'vaert', rect: [40, 40, 200, 40] });
  const knap = d.el('button', { id: 'gem', tekst: 'Save', rect: [40, 40, 200, 40] }, d.skygge(vaert));
  const slot = d.el('slot', { rect: [40, 40, 200, 40] }, knap);
  const ikon = d.el('span', { id: 'ikon', rect: [40, 40, 200, 40], lag: 1 }, vaert);
  ikon.assignedSlot = slot;
  assert.equal(d.koer(KILDE, '#gem', null, null, false, false).svar.covered, undefined);
});

// ── R71 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('en webkomponent-knap klikket paa sin vaert: vaertens egen knap er ikke daekning; en lille Slet i en kort-komponent er (R71)', () => {
  const d = lavKlikDom();
  const vaert = d.el('x-slet', { id: 'slet', rect: [40, 40, 120, 40] });
  const knap = d.el('button', { id: 'sb', rect: [40, 40, 120, 40] }, d.skygge(vaert));
  const slot = d.el('slot', { rect: [40, 40, 120, 40] }, knap);
  const span = d.el('span', { tekst: 'Slet', rect: [40, 40, 120, 40], lag: 1 }, vaert);
  span.assignedSlot = slot;
  assert.equal(d.koer(KILDE, '#slet', null, null, false, false).svar.covered, undefined, 'vaertens egen knap');
  const d2 = lavKlikDom();
  const komp = d2.el('x-kort', { id: 'kort', rect: [40, 40, 400, 80] });
  const rod = d2.skygge(komp);
  d2.el('div', { id: 'flade', rect: [40, 40, 400, 80] }, rod);
  d2.el('button', { id: 'lille', tekst: 'Slet', rect: [200, 60, 80, 40], lag: 1 }, rod);
  assert.equal(d2.koer(KILDE, '#kort', null, null, false, false).svar.covered?.id, 'lille', 'en lille Slet i komponenten');
});

// ── R72 (Astra, maalt i model) ─────────────────────────────────────────────
test('webkomponentens egen knap eller link kraever 90 % overlap, og en handling omkring den er stadig daekning (R72)', () => {
  const vaert = (d, id = 'vaert', rect = [40, 40, 200, 100]) => d.el('x-komp', { id, rect });
  // [beskrivelse, byg(d) -> skal svaret vaere covered?]
  const tilfaelde = [
    ['knap der fylder vaerten', (d) => { const v = vaert(d); d.el('button', { id: 'k', tekst: 'Gem', rect: [40, 40, 200, 100] }, d.skygge(v)); }, false],
    ['knap paa halvdelen', (d) => { const v = vaert(d); const r = d.skygge(v); d.el('div', { rect: [40, 40, 200, 100] }, r); d.el('button', { id: 'k', tekst: 'Slet', rect: [40, 65, 200, 50], lag: 1 }, r); }, true],
    ['lang smal knap (stort areal, lille overlap)', (d) => { const v = vaert(d); d.el('button', { id: 'k', tekst: 'Slet', rect: [0, 89, 10000, 2], lag: 1 }, d.skygge(v)); }, true],
    // R72 (Opus, maalt i Chrome): et link, der daekker komponenten (sl-button med href), er komponentens egen handling.
    ['stort skygge-link med #', (d) => { const v = vaert(d); d.el('a', { id: 'k', tekst: 'Slet', attrs: { href: '#' }, rect: [40, 40, 200, 100] }, d.skygge(v)); }, false],
    ['Slet omkring en stor indre knap', (d) => { const v = vaert(d); const r = d.skygge(v); const s = d.el('div', { id: 'slet', attrs: { role: 'button' }, rect: [90, 65, 100, 50] }, r); d.el('button', { id: 'k', rect: [40, 40, 200, 100] }, s); }, true],
    ['knap to skyggelag nede', (d) => { const v = vaert(d); const indre = d.el('x-indre', { rect: [40, 40, 200, 100] }, d.skygge(v)); d.el('button', { id: 'k', tekst: 'Gem', rect: [40, 40, 200, 100] }, d.skygge(indre)); }, false],
    ['vaert med role=button og egen knap', (d) => { const v = d.el('x-komp', { id: 'vaert', attrs: { role: 'button' }, rect: [40, 40, 200, 100] }); d.el('button', { id: 'k', tekst: 'Gem', rect: [40, 40, 200, 100] }, d.skygge(v)); }, false],
    // R73 (Astra 3): en handling omkring komponentens egen kontrol, der SELV daekker mindst 90 % af komponenten, er ogsaa
    // komponentens egen (bevidst valg - begge er det, en rigtig mus rammer paa komponentens flade). Kun en mindre er daekning.
    ['stor Slet (90 %) omkring en stor indre knap', (d) => { const v = vaert(d); const r = d.skygge(v); const s = d.el('div', { id: 'slet', attrs: { role: 'button' }, rect: [40, 45, 200, 90] }, r); d.el('button', { id: 'k', rect: [40, 40, 200, 100] }, s); }, false],
  ];
  for (const [navn, byg, daekket] of tilfaelde) {
    const d = lavKlikDom(); byg(d);
    assert.equal(!!d.koer(KILDE, '#vaert', null, null, false, false).svar.covered, daekket, navn);
  }
});

// ── R72 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('en checkbox-komponent: et vilkaarslink midt i dens egen labeltekst er daekningen (R72)', () => {
  for (const href of ['/vilkaar', '#vilkaar']) {
    const d = lavKlikDom();
    const vaert = d.el('x-cb', { id: 'cb', rect: [40, 40, 300, 30] });
    const rod = d.skygge(vaert);
    const label = d.el('label', { rect: [40, 40, 300, 30] }, rod);
    const felt = d.el('input', { id: 'icb', attrs: { type: 'checkbox' }, rect: [40, 45, 20, 20] }, label);
    felt.labels.push(label); label.control = felt;
    const slot = d.el('slot', { rect: [70, 40, 270, 30] }, d.el('span', { rect: [70, 40, 270, 30] }, label));
    const link = d.el('a', { id: 'vilk', tekst: 'vilkaarene', attrs: { href }, rect: [70, 40, 270, 30], lag: 1 }, vaert);
    link.assignedSlot = slot;
    assert.equal(d.koer(KILDE, '#cb', null, null, false, false).svar.covered?.id, 'vilk', href);
  }
});

test('teksten i en checkbox-komponents label: labelens eget felt er ikke daekning, naar aktiveringsklikket kommer (R72)', () => {
  const d = lavKlikDom();
  const vaert = d.el('x-cb', { id: 'cb', rect: [40, 40, 300, 30] });
  const rod = d.skygge(vaert);
  const label = d.el('label', { rect: [40, 40, 300, 30] }, rod);
  const felt = d.el('input', { id: 'icb', attrs: { type: 'checkbox' }, rect: [40, 45, 20, 20] }, label);
  felt.labels.push(label); label.control = felt;
  const slot = d.el('slot', { rect: [70, 40, 270, 30] }, d.el('span', { rect: [70, 40, 270, 30] }, label));
  const tekst = d.el('span', { id: 'acc', tekst: 'Accepter', rect: [70, 40, 270, 30], lag: 1 }, vaert);
  tekst.assignedSlot = slot;
  const { svar, window } = d.koer(KILDE, '#acc', null, null, true, false);
  assert.equal(svar.covered, undefined);
  assert.equal(window.__bmcpMaalTjek(205, 55, felt), null, 'aktiveringsklikket paa labelens felt er ikke en daekning');
});

// ── R73 (Astra, maalt i model) ─────────────────────────────────────────────
// En checkbox-komponent med sin label i shadow root'en: alt interaktivt indhold mellem punktet og labelen er en daekning
// (HTML: et klik paa interaktivt indhold i en label aktiverer ikke feltet) - ogsaa et link i komponentens egen skygge, der
// selv daekker komponenten, og et felt, en select, en video eller et billedkort, som ikke er en «handling». Labelens eget
// felt er det ikke.
function checkboxKomp(d) {
  const vaert = d.el('x-cb', { id: 'cb', rect: [40, 40, 300, 30] });
  const rod = d.skygge(vaert);
  const label = d.el('label', { rect: [40, 40, 300, 30] }, rod);
  const felt = d.el('input', { id: 'icb', attrs: { type: 'checkbox' }, rect: [40, 45, 20, 20] }, label);
  felt.labels.push(label); label.control = felt;
  const slot = d.el('slot', { rect: [70, 40, 270, 30] }, d.el('span', { rect: [70, 40, 270, 30] }, label));
  return { vaert, rod, label, felt, slot };
}

test('en checkbox-komponents label: et skygge-link, der daekker komponenten, er daekning (R73)', () => {
  for (const rect of [[40, 40, 300, 30], [40, 40, 270, 30]]) {
    const d = lavKlikDom();
    const { label } = checkboxKomp(d);
    d.el('a', { id: 'vilk', tekst: 'vilkaarene', attrs: { href: '/vilkaar' }, rect, lag: 1 }, label);
    assert.equal(d.koer(KILDE, '#cb', null, null, false, false).svar.covered?.id, 'vilk', JSON.stringify(rect));
  }
});

test('en checkbox-komponents label: et felt, en select, en video, lyd eller et billedkort i labelteksten er daekning (R73)', () => {
  for (const [tag, attrs] of [['input', { type: 'text' }], ['select', {}], ['textarea', {}], ['video', { controls: '' }],
    ['audio', { controls: '' }], ['img', { usemap: '#kort' }]]) {
    const d = lavKlikDom();
    const { vaert, slot } = checkboxKomp(d);
    const ting = d.el(tag, { id: 'ting', attrs, rect: [70, 40, 270, 30], lag: 1 }, vaert);
    ting.assignedSlot = slot;
    assert.equal(d.koer(KILDE, '#cb', null, null, false, false).svar.covered?.id, 'ting', tag);
  }
  // Kontrol: et skjult felt er ikke interaktivt indhold, og labelens eget felt under punktet er ikke en daekning.
  const d = lavKlikDom();
  const { vaert, slot } = checkboxKomp(d);
  const skjult = d.el('input', { id: 'skjult', attrs: { type: 'hidden' }, rect: [70, 40, 270, 30], lag: 1 }, vaert);
  skjult.assignedSlot = slot;
  assert.equal(d.koer(KILDE, '#cb', null, null, false, false).svar.covered, undefined, 'skjult felt');
  const d2 = lavKlikDom();
  const k2 = checkboxKomp(d2);
  k2.felt.rect = [40, 40, 300, 30]; k2.felt.lag = 1;   // et usynligt felt udspaendt over komponenten (et almindeligt moenster)
  assert.equal(d2.koer(KILDE, '#cb', null, null, false, false).svar.covered, undefined, 'labelens eget felt');
});

test('teksten i en ramme i en shadow root: et ikon slottet ind i et ANDET link eller en anden knap i rammen er daekning (R73)', () => {
  for (const rammeTag of ['label', 'button']) for (const handlingTag of ['a', 'button']) {
    const d = lavKlikDom();
    const vaert = d.el('x-cb', { id: 'cb', rect: [40, 40, 300, 30] });
    const rod = d.skygge(vaert);
    const ramme = d.el(rammeTag, { rect: [40, 40, 300, 30] }, rod);
    const tekstSlot = d.el('slot', { rect: [40, 40, 300, 30] }, ramme);
    const tekst = d.el('span', { id: 'acc', tekst: 'Accepter', rect: [40, 40, 300, 30], lag: 1 }, vaert);
    tekst.assignedSlot = tekstSlot;
    const anden = d.el(handlingTag, { id: 'anden', attrs: handlingTag === 'a' ? { href: '/vilkaar' } : {}, rect: [40, 40, 300, 30] }, ramme);
    const ikonSlot = d.el('slot', { rect: [40, 40, 300, 30] }, anden);
    const ikon = d.el('span', { id: 'ikon', rect: [40, 40, 300, 30], lag: 2 }, vaert);
    ikon.assignedSlot = ikonSlot;
    if (rammeTag === 'label') { const felt = d.el('input', { id: 'icb', attrs: { type: 'checkbox' }, rect: [40, 45, 20, 20] }, ramme); felt.labels.push(ramme); ramme.control = felt; }
    assert.equal(d.koer(KILDE, '#acc', null, null, false, false).svar.covered?.id, 'ikon', `${handlingTag} i ${rammeTag}`);
  }
});

// ── R73 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('en knap i en komponents egen skygge under 90 %: noten advarer om, at dens id kan ramme en anden komponent (R73)', () => {
  // Material Webs md-filled-button tegner sin indre <button id="button"> paa 18-31 % af vaerten. Agenten klikkede `#button`
  // efter noten og ramte sidens foerste Material-knap.
  const d = lavKlikDom();
  const vaert = d.el('md-filled-button', { id: 'gem', rect: [40, 40, 200, 60] });
  d.el('button', { id: 'button', tekst: 'Gem', rect: [90, 55, 100, 30], lag: 1 }, d.skygge(vaert));
  const r = d.koer(KILDE, '#gem', null, null, false, false).svar;
  assert.equal(r.covered?.id, 'button');
  assert.equal(r.covered?.skygge, true);
  assert.match(indlaesUdvidelse().hent('daekketSvar')('#gem', r).note, /own shadow root, so a selector for it \(such as its id\) can match the same part of another component/);
});

// ── R74 (Astra, maalt i model) ─────────────────────────────────────────────
test('en label i en checkbox-komponents egen label (ugyldig HTML) er daekning, ogsaa naar den fylder komponenten (R74)', () => {
  for (const rect of [[40, 40, 270, 30], [40, 40, 300, 30]]) {
    const d = lavKlikDom();
    const { rod, label } = checkboxKomp(d);
    const andet = d.el('input', { id: 'andet', attrs: { type: 'checkbox' }, rect: [400, 45, 20, 20] }, rod);
    const indre = d.el('label', { id: 'indre', tekst: 'Nyhedsbrev', attrs: { for: 'andet' }, rect, lag: 1 }, label);
    andet.labels.push(indre); indre.control = andet;
    assert.equal(d.koer(KILDE, '#cb', null, null, false, false).svar.covered?.id, 'indre', JSON.stringify(rect));
  }
});

test('reserveteksten i et <object> i en label er almindelig tekst, ikke interaktivt indhold (R74)', () => {
  const d = lavKlikDom();
  const felt = d.el('input', { id: 'f', attrs: { type: 'checkbox' }, rect: [40, 45, 20, 20] });
  const label = d.label(felt, { id: 'l', tekst: 'Accepter', rect: [40, 40, 300, 30] });
  d.el('object', { id: 'o', tekst: 'vilkaarene', rect: [70, 40, 270, 30], lag: 1 }, label);
  assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered, undefined);
});

test('tekst i en label-ramme med en Slet med rolle over sig er daekket, i light DOM og i en komponents skygge (R74)', () => {
  for (const skygge of [false, true]) {
    const d = lavKlikDom();
    const vaert = d.el('x-cb', { id: 'cb', rect: [40, 40, 300, 30] });
    const rod = skygge ? d.skygge(vaert) : vaert;
    const ramme = d.el('label', { rect: [40, 40, 300, 30] }, rod);
    const felt = d.el('input', { id: 'icb', attrs: { type: 'checkbox' }, rect: [40, 45, 20, 20] }, ramme);
    felt.labels.push(ramme); ramme.control = felt;
    let tekst;
    if (skygge) {
      const s = d.el('slot', { rect: [70, 40, 270, 30] }, ramme);
      tekst = d.el('span', { id: 't', tekst: 'Accepter', rect: [70, 40, 270, 30], lag: 1 }, vaert); tekst.assignedSlot = s;
    } else tekst = d.el('span', { id: 't', tekst: 'Accepter', rect: [70, 40, 270, 30], lag: 1 }, ramme);
    d.el('span', { id: 'slet', attrs: { role: 'button' }, rect: [70, 40, 270, 30], lag: 2 }, skygge ? rod : ramme);
    assert.equal(d.koer(KILDE, '#t', null, null, false, false).svar.covered?.id, 'slet', skygge ? 'skygge' : 'light DOM');
  }
});

// ── R75 (Astra, maalt i model) ─────────────────────────────────────────────
test('en stor rolle-span, onclick eller et link uden adresse i en checkbox-komponents egen label er daekning (R75)', () => {
  for (const [tag, attrs] of [['span', { role: 'button' }], ['span', { onclick: 'x()' }], ['a', {}]]) for (const rect of [[40, 40, 270, 30], [40, 40, 300, 30]]) {
    const d = lavKlikDom();
    const { label } = checkboxKomp(d);
    d.el(tag, { id: 'h', tekst: 'vilkaar', attrs, rect, lag: 1 }, label);
    assert.equal(d.koer(KILDE, '#cb', null, null, false, false).svar.covered?.id, 'h', `${tag} ${JSON.stringify(attrs)} ${JSON.stringify(rect)}`);
  }
});

test('labelens eget custom-felt: dets egen role=checkbox-boks i skyggen er feltet, ikke en anden kontrol (R75)', () => {
  const d = lavKlikDom();
  const felt = d.el('x-felt', { id: 'xf', rect: [40, 40, 300, 30] });
  const label = d.label(felt, { id: 'l', tekst: 'Accepter', rect: [40, 40, 300, 30] });
  label.children.push(felt); felt.parentNode.children.splice(felt.parentNode.children.indexOf(felt), 1); felt.parentNode = label;
  d.el('div', { id: 'boks', attrs: { role: 'checkbox' }, rect: [40, 40, 300, 30], lag: 1 }, d.skygge(felt));
  assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered, undefined);
});

test('komponentens eget input med rolle under 90 % er dens felt, naar komponentens label daekker den (R75)', () => {
  for (const attrs of [{ type: 'checkbox', role: 'checkbox' }, { type: 'checkbox', onclick: 'x()' }]) {
    const d = lavKlikDom();
    const { label, felt } = checkboxKomp(d);
    for (const [k, v] of Object.entries(attrs)) felt.attrs[k] = v;
    felt.rect = [115, 40, 150, 30]; felt.lag = 1;   // 50 % af komponenten, over dens midtpunkt
    assert.equal(d.koer(KILDE, '#cb', null, null, false, false).svar.covered, undefined, JSON.stringify(attrs));
    assert.ok(label);
  }
});

// ── R76 ────────────────────────────────────────────────────────────────────
test('en boks med feltrolle om labelens felt er feltets egen; en handling om feltet er daekning (R76, R77)', () => {
  // R76 Opus (maalt i Chrome): en div med onclick om feltet koerte sin egen handling to gange med landed:true.
  for (const [attrs, daekket] of [[{ role: 'checkbox' }, false], [{ onclick: 'aabn()' }, true], [{ role: 'button' }, true], [{}, false]]) {
    const d = lavKlikDom();
    const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
    const om = d.el('span', { id: 'om', attrs, rect: [20, 20, 300, 30], lag: 1 }, l);
    const felt = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 25, 20, 20] }, om);
    felt.labels.push(l); l.control = felt;
    assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered?.id === 'om', daekket, JSON.stringify(attrs));
  }
});

test('et form-associeret felts eget indre input (md-switch i en label) er feltet, ikke en anden kontrol (R75 Opus)', () => {
  const d = lavKlikDom();
  const l = d.el('label', { id: 'l', tekst: 'Wi-Fi', rect: [20, 20, 300, 30] });
  const vaert = d.el('x-switch', { id: 'm', rect: [20, 20, 300, 30] }, l);
  l.control = vaert;
  d.el('input', { id: 'switch', attrs: { type: 'checkbox', role: 'switch' }, rect: [20, 20, 300, 30], lag: 1 }, d.skygge(vaert));
  assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered, undefined);
});

// ── R76 (Astra, maalt i model) ─────────────────────────────────────────────
test('en rolle-boks i en label: ved et synligt felt en anden kontrol; ved et skjult felt kun feltets, naar den er dets nabo (R76, R77)', () => {
  // R77 Opus (maalt i Chrome, rigtig Base UI): en nyhedsbrevs-switch laengere inde i labelen fik klikket ved et skjult felt.
  for (const [skjult, nabo, daekket] of [[false, true, true], [true, true, false], [true, false, true]]) {
    const d = lavKlikDom();
    const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
    const felt = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: skjult ? [20, 20, 1, 1] : [20, 25, 20, 20] }, l);
    felt.labels.push(l); l.control = felt;
    if (!nabo) d.el('span', { id: 'tekst', tekst: 'Opret konto', rect: [25, 20, 30, 30] }, l);
    d.el('span', { id: 'anden', attrs: { role: 'switch', tabindex: '0', onclick: 'andet()' }, rect: [60, 20, 260, 30], lag: 1 }, l);
    assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered?.id === 'anden', daekket, `skjult=${skjult} nabo=${nabo}`);
  }
});

// ── R77 (Astra, maalt i model) ─────────────────────────────────────────────
test('en onclick-handling uden om feltets egen rolle-boks i en label er daekning (soegningen standser ikke ved boksen) (R77)', () => {
  for (const rolle of ['checkbox', 'switch', 'radio']) for (const maal of ['#l', '#c']) {
    const d = lavKlikDom();
    const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
    const ydre = d.el('span', { id: 'ydre', attrs: { onclick: 'aabnDetaljer()' }, rect: [20, 20, 200, 30] }, l);   // over labelens midtpunkt
    const boks = d.el('span', { id: 'boks', attrs: { role: rolle }, rect: [20, 20, 200, 30] }, ydre);
    // Feltet ligger under teksten (et udspaendt, gennemsigtigt input), saa ogsaa feltet som maal rammer teksten i boksen.
    const felt = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 200, 30] }, boks);
    felt.labels.push(l); l.control = felt;
    d.el('span', { id: 't', tekst: 'Accepter', rect: [20, 20, 200, 30], lag: 1 }, boks);
    const svar = d.koer(KILDE, maal, null, null, false, false).svar;
    assert.ok(svar.covered, `${rolle} ${maal}: ${JSON.stringify(svar)}`);
  }
});

// ── R78 (maalt i Chrome med rigtig Base UI 1.9.0) ──────────────────────────
test('ved et skjult felt med to rolle-bokse som naboer (Base UI-boks foer, en anden switch efter) er ingen af dem feltets egen (R78)', () => {
  const d = lavKlikDom();
  const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
  d.el('span', { id: 'boks', attrs: { role: 'checkbox' }, rect: [20, 20, 20, 30] }, l);
  const felt = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [40, 20, 1, 1] }, l);
  felt.labels.push(l); l.control = felt;
  d.el('span', { id: 'nyt', attrs: { role: 'switch', onclick: 'nyt()' }, rect: [60, 20, 260, 30], lag: 1 }, l);
  assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered?.id, 'nyt');
});

// ── R78 (Astra, maalt i model) ─────────────────────────────────────────────
test('flere labels for samme skjulte felt: rolle-boksene taelles i den label, boksen ligger i (R78)', () => {
  for (const [ekstraFoerst, ekstraRolle, daekket] of [[true, true, true], [false, true, true], [true, false, false], [false, false, false]]) {
    const d = lavKlikDom();
    const ekstra = () => { const e = d.el('label', { id: 'ekstra', rect: [20, 100, 300, 30] }); d.el('span', { attrs: ekstraRolle ? { role: 'checkbox' } : {}, tekst: 'Ekstra', rect: [20, 100, 100, 30] }, e); return e; };
    const e1 = ekstraFoerst ? ekstra() : null;
    const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
    d.el('span', { id: 'boks', attrs: { role: 'checkbox' }, rect: [20, 20, 20, 30] }, l);
    const felt = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [40, 20, 1, 1] }, l);
    if (ekstraRolle) d.el('span', { id: 'nyt', attrs: { role: 'switch', onclick: 'nyt()' }, rect: [60, 20, 260, 30], lag: 1 }, l);
    else d.el('span', { id: 'tekst', tekst: 'Accepter', rect: [60, 20, 260, 30], lag: 1 }, l);
    const e2 = ekstraFoerst ? null : ekstra();
    felt.labels.push(...(ekstraFoerst ? [e1, l] : [l, e2])); l.control = felt; (e1 || e2).control = felt;
    // Med en anden rolle-boks i den klikkede label er intet feltets egen; med kun stedfortraederen er den det.
    const svar = d.koer(KILDE, '#l', null, null, false, false).svar;
    assert.equal(!!svar.covered, daekket, `ekstraFoerst=${ekstraFoerst} andenBoks=${ekstraRolle}: ${JSON.stringify(svar)}`);
  }
});

// ── R78 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('feltet som maal med en handling om feltet i dets label (div role=button eller onclick) er daekket af handlingen (R78)', () => {
  for (const attrs of [{ role: 'button' }, { onclick: 'aabn()' }]) {
    const d = lavKlikDom();
    const l = d.el('label', { id: 'l', rect: [20, 20, 600, 40] });
    const raekke = d.el('div', { id: 'raekke', attrs, rect: [20, 20, 600, 40] }, l);
    const felt = d.el('input', { id: 'cb', attrs: { type: 'checkbox' }, rect: [20, 20, 600, 40] }, raekke);   // udspaendt, gennemsigtigt
    felt.labels.push(l); l.control = felt;
    d.el('span', { id: 'tekst', tekst: 'Ordre 7', rect: [20, 20, 600, 40], lag: 1 }, raekke);
    assert.equal(d.koer(KILDE, '#cb', null, null, false, false).svar.covered?.id === 'tekst' || d.koer(KILDE, '#cb', null, null, false, false).svar.covered?.id === 'raekke', true, JSON.stringify(attrs));
  }
});

// ── R79 (Astra, maalt i model) ─────────────────────────────────────────────
test('rolle-bokse taelles ogsaa i aabne shadow roots i labelen; et custom-felt uden labels findes via label.control (R79)', () => {
  // 1) Den rigtige stedfortraeder ligger i en komponents skygge; en anden switch lige efter det skjulte felt.
  {
    const d = lavKlikDom();
    const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
    const xboks = d.el('x-box', { rect: [20, 20, 20, 30] }, l);
    d.el('span', { attrs: { role: 'checkbox' }, rect: [20, 20, 20, 30] }, d.skygge(xboks));
    const felt = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [40, 20, 1, 1] }, l);
    felt.labels.push(l); l.control = felt;
    d.el('span', { id: 'nyt', attrs: { role: 'switch', onclick: 'nyt()' }, rect: [60, 20, 260, 30], lag: 1 }, l);
    assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered?.id, 'nyt', 'boks i skygge');
  }
  // 2) Et form-associeret custom-felt uden offentlig labels-egenskab mellem to rolle-bokse.
  for (const [toBokse, daekket] of [[true, true], [false, false]]) {
    const d = lavKlikDom();
    const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
    if (toBokse) d.el('span', { attrs: { role: 'checkbox' }, rect: [20, 20, 20, 30] }, l);
    const felt = d.el('x-felt', { id: 'xf', rect: [40, 20, 1, 1] }, l);
    delete felt.labels; l.control = felt;
    d.el('span', { id: 'nyt', attrs: { role: 'switch', onclick: 'nyt()' }, rect: [60, 20, 260, 30], lag: 1 }, l);
    assert.equal(!!d.koer(KILDE, '#l', null, null, false, false).svar.covered, daekket, `custom-felt, to bokse=${toBokse}`);
  }
});


// ── R80 (Astra, maalt i model) ─────────────────────────────────────────────
test('en tom offentlig labels-liste og indlejrede labels: boksene taelles i den naermeste label om boksen (R80)', () => {
  // 1) Custom-felt med en tom labels-liste mellem to rolle-bokse: labelen findes via label.control, og to bokse er ikke entydige.
  {
    const d = lavKlikDom();
    const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
    d.el('span', { attrs: { role: 'checkbox' }, rect: [20, 20, 20, 30] }, l);
    const felt = d.el('x-felt', { id: 'xf', rect: [40, 20, 1, 1] }, l);
    felt.labels = []; l.control = felt;
    d.el('span', { id: 'nyt', attrs: { role: 'switch', onclick: 'nyt()' }, rect: [60, 20, 260, 30], lag: 1 }, l);
    assert.equal(d.koer(KILDE, '#l', null, null, false, false).svar.covered?.id, 'nyt', 'tom labels-liste');
  }
  // 2) Indlejrede labels for samme felt: den inderste har kun stedfortraederen; den yderste har en boks mere.
  for (const [indreFor, daekket] of [['cb', false], ['andet', true]]) {
    const d = lavKlikDom();
    const ydre = d.el('label', { id: 'ydre', rect: [20, 20, 400, 70] });
    d.el('span', { attrs: { role: 'checkbox' }, rect: [20, 20, 20, 20] }, ydre);
    const indre = d.el('label', { id: 'indre', rect: [20, 50, 300, 30] }, ydre);
    const felt = d.el('input', { id: 'cb', attrs: { type: 'checkbox' }, rect: [20, 50, 1, 1] }, indre);
    d.el('span', { id: 'boks', attrs: { role: 'checkbox' }, rect: [20, 50, 300, 30], lag: 1 }, indre);
    const andet = d.el('input', { id: 'andet', attrs: { type: 'checkbox' }, rect: [500, 20, 20, 20] });
    ydre.control = felt; felt.labels.push(ydre);
    if (indreFor === 'cb') { indre.control = felt; felt.labels.push(indre); } else { indre.control = andet; andet.labels.push(indre); }
    assert.equal(!!d.koer(KILDE, '#indre', null, null, false, false).svar.covered, daekket, `indre label for ${indreFor}`);
  }
  // 3) Boksen ligger i en anden felts label (den naermeste label om den): den er ikke feltets, selv om den er nabo til det.
  {
    const d = lavKlikDom();
    const ydre = d.el('label', { id: 'ydre', rect: [20, 20, 400, 70] });
    const indre = d.el('label', { id: 'indre', rect: [20, 20, 400, 70] }, ydre);
    const felt = d.el('input', { id: 'cb', attrs: { type: 'checkbox' }, rect: [20, 20, 1, 1] }, indre);
    d.el('span', { id: 'boks', attrs: { role: 'checkbox' }, rect: [20, 20, 400, 70], lag: 1 }, indre);
    const andet = d.el('input', { id: 'andet', attrs: { type: 'checkbox' }, rect: [500, 20, 20, 20] });
    ydre.control = felt; felt.labels.push(ydre); indre.control = andet; andet.labels.push(indre);
    assert.equal(d.koer(KILDE, '#ydre', null, null, false, false).svar.covered?.id, 'boks', 'boks i en anden felts label');
  }
});
