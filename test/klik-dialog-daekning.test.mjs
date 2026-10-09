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
    assert.match(svar.note, /Another element \(DIV#overlay\) lies over text=Add at its center/);
    assert.match(svar.note, /Nothing was done/);
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
    assert.match(blok, /if \(el\.covered\) return daekketSvar\(params\.selector, el\);/, `${navn} afviser ikke et daekket maal`);
    const d = tools.slice(tools.indexOf(`name: 'browser_${navn}'`)).split('inputSchema')[0];
    assert.match(d, /nothing is done: the answer is ok:false with error "covered" and covered_by/, `browser_${navn}s beskrivelse`);
  }
  assert.match(tools, /A text selector looks inside an open modal dialog first \(a <dialog> opened with showModal, or a visible element with aria-modal="true"\), exact text before partial/);
  for (const f of ['README.md', 'mcp-server/README.md']) {
    const t = laes(f);
    assert.match(t, /\| `browser_click` \|[^\n]*looks in an open modal dialog first, and nothing is clicked \(`covered`\)/, f);
    for (const n of ['hover', 'double_click', 'right_click']) assert.match(t, new RegExp(`\\| \`browser_${n}\` \\|[^\\n]*nothing is done \\(\`covered\`\\)`), `${f}: ${n}`);
  }
  const docs = laes('content/browsermcp-docs-tools.md');
  assert.match(docs, /\| `browser_click` \|[^\n]*looks inside an open modal dialog first\. If something lies over the target/);
  for (const n of ['double_click', 'right_click', 'hover']) assert.match(docs, new RegExp(`\\| \`browser_${n}\` \\|[^\\n]*Nothing is done \\(\`covered\`\\)`), n);
});
