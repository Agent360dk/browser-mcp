/**
 * Issue #67-#70 (arasmileska, 12/10-2026), hver rettet i 1.30.2 og gengivet i headless Chrome med den rigtige udvidelse
 * FOER rettelsen (main de053cf) og efter. Proeverne her vogter rettelserne; gengivelsen ligger uden for repoet
 * (~/.claude/plans/browsermcp-1302-2026-10-07/proeve-67-70/, logs main-de053cf-*.log og fix1-*.log).
 *
 *   #67 drop_file: et filfelt et andet sted paa siden fik filen med ok:true (sidste udvej «ethvert filfelt»), og en side,
 *       der laeste filen og ryddede feltet, gav file-not-attached.
 *   #68 press_key: ctrl/meta+a sendte teksten «a» uden tastkode - paa Windows et «a» i feltet, paa macOS ingenting - og
 *       svaret var landed:true.
 *   #69 navigate: «Leave site?» blev aldrig besvaret; svaret var den gamle adresse uden fejl efter 15 s, og fanen svarede
 *       ikke paa noget bagefter. handle_dialog gav Chromes noegne Page.enable-frist.
 *   #70 skaermbilledets sti afvist paa store/smaa bogstaver; text= stoppede ved en skjult foerste knap; fill paa en
 *       contenteditable meldte differs, fordi linjeskiftene forsvandt i textContent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { lavKlikDom } from './hjaelp/klik-dom.mjs';

// ── #68 press_key ─────────────────────────────────────────────────────────────
function tastSele() {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'debugger.sendCommand': () => ({}),
    'tabs.update': undefined,
    'windows.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => {
    const kilde = String(func);
    if (kilde.includes('addEventListener')) return [{ result: undefined }];
    if (kilde.includes('removeEventListener')) return [{ result: { antal: 1, traf: true } }];
    return [{ result: null }];
  };
  const ned = () => u.optager.til('debugger.sendCommand').map((k) => k.args[2]).filter((p) => p && p.type === 'keyDown');
  return { u, ned };
}

test('#68: ctrl+a sender ingen tekst, men tastkoden og Chromes selectAll - og svaret navngiver genvejen', async () => {
  for (const mod of ['ctrl', 'meta']) {
    const { u, ned } = tastSele();
    const svar = await u.hent('dispatch')(9876, 'press_key', { key: 'a', [mod]: true });
    const [n] = ned();
    assert.equal(n.text, '', `${mod}+a skrev et tegn - paa Windows lander det som «a» i feltet: ${JSON.stringify(n)}`);
    assert.equal(n.windowsVirtualKeyCode, 65, `${mod}+a uden tastkode - Chromes genvejstabel slaar op paa tastkoden: ${JSON.stringify(n)}`);
    assert.equal(n.code, 'KeyA');
    assert.deepEqual([...(n.commands || [])], ['selectAll'], `${mod}+a uden selectAll - maalt: paa macOS markerer intet andet: ${JSON.stringify(n)}`);
    assert.equal(svar.shortcut, 'selectAll');
  }
});

test('#68: c, x, v, z, y og shift+z bliver copy, cut, paste, undo, redo og redo', async () => {
  for (const [p, kommando] of [[{ key: 'c', ctrl: true }, 'copy'], [{ key: 'x', meta: true }, 'cut'], [{ key: 'v', ctrl: true }, 'paste'],
    [{ key: 'z', ctrl: true }, 'undo'], [{ key: 'y', ctrl: true }, 'redo'], [{ key: 'z', meta: true, shift: true }, 'redo']]) {
    const { u, ned } = tastSele();
    await u.hent('dispatch')(9876, 'press_key', p);
    assert.deepEqual([...(ned()[0].commands || [])], [kommando], `${JSON.stringify(p)}: ${JSON.stringify(ned()[0])}`);
  }
});

test('#68: med Shift faar kun z en kommando (redo) - Ctrl+Shift+V er Chromes egen «indsaet uden formatering» (R93)', async () => {
  const t1 = tastSele();
  await t1.u.hent('dispatch')(9876, 'press_key', { key: 'v', ctrl: true, shift: true });
  assert.equal(t1.ned()[0].commands, undefined, `ctrl+shift+v blev sendt som almindelig paste: ${JSON.stringify(t1.ned()[0])}`);
  assert.equal(t1.ned()[0].text, '');
  assert.equal(t1.ned()[0].windowsVirtualKeyCode, 86, 'uden tastkoden kan Chromes egen binding ikke finde genvejen');
  const t2 = tastSele();
  await t2.u.hent('dispatch')(9876, 'press_key', { key: 'a', meta: true, shift: true });
  assert.equal(t2.ned()[0].commands, undefined);
});

test('#68 positiv kontrol: et almindeligt a skriver stadig «a», og alt+a er en genvej uden kommando', async () => {
  const { u, ned } = tastSele();
  await u.hent('dispatch')(9876, 'press_key', { key: 'a' });
  const [n] = ned();
  assert.equal(n.text, 'a', 'et almindeligt bogstav skrev ikke laengere');
  assert.equal(n.commands, undefined, 'et almindeligt bogstav fik en redigeringskommando');
  assert.equal(n.windowsVirtualKeyCode, 65);
  const t2 = tastSele();
  await t2.u.hent('dispatch')(9876, 'press_key', { key: 'a', alt: true });
  assert.equal(t2.ned()[0].text, '', 'alt+a skrev et tegn');
  assert.equal(t2.ned()[0].commands, undefined, 'alt+a fik en redigeringskommando');
  const t3 = tastSele();
  await t3.u.hent('dispatch')(9876, 'press_key', { key: 'Enter' });
  assert.equal(t3.ned()[0].windowsVirtualKeyCode, 13, 'Enter mistede sin tastkode');
  assert.equal(t3.ned()[0].code, 'Enter');
});

// ── #70 contenteditable: teksten som linjer ──────────────────────────────────
const BLOKKE = new Set(['DIV', 'P', 'LI', 'UL', 'H1']);
function dom(spec, foraelder = null) {
  // spec: streng = tekstknude; [tag, {display, ws}, ...boern]
  if (typeof spec === 'string') return { nodeType: 3, data: spec, parentNode: foraelder };
  const [tag, o, ...boern] = spec;
  const n = { nodeType: 1, tagName: tag, o: o || {}, parentNode: foraelder, childNodes: [] };
  n.childNodes = boern.map((b) => dom(b, n));
  n.childNodes.forEach((b, i) => { b.nextSibling = n.childNodes[i + 1] || null; });
  return n;
}
const stil = (n) => ({ display: n.o.display || (BLOKKE.has(n.tagName) ? 'block' : 'inline'), whiteSpace: n.o.ws || 'normal' });
const laes = (spec) => {
  const kilde = indlaesUdvidelse().hent('redigerbarTekst').toString();
  return new Function('getComputedStyle', 'return (' + kilde + ')')(stil)(dom(['DIV', {}, ...spec]));
};

test('#70: contenteditable laeses som linjer, ikke som textContent eller innerText', () => {
  // De fire foerste former er Chromes egne, maalt 13/10 efter fill med vaerdierne.
  assert.equal(laes(['line1', ['DIV', {}, 'line2']]), 'line1\nline2');
  assert.equal(laes(['a', ['DIV', {}, ['BR']], ['DIV', {}, 'b']]), 'a\n\nb', 'innerText giver her «a\\n\\n\\nb»');
  assert.equal(laes(['line1', ['DIV', {}, ['BR']]]), 'line1\n');
  assert.equal(laes(['en linje']), 'en linje');
  // Editorer med afsnit (Quill, ProseMirror, LinkedIn) og <br> midt i teksten.
  assert.equal(laes([['P', {}, 'a'], ['P', {}, ['BR']], ['P', {}, 'b']]), 'a\n\nb');
  assert.equal(laes([['DIV', {}, 'a'], ['DIV', {}, 'b']]), 'a\nb');
  assert.equal(laes(['a', ['BR'], 'b']), 'a\nb');
  assert.equal(laes(['a', ['SPAN', {}, 'b', ['BR']], 'c']), 'ab\nc', 'en <br> foer mere tekst i blokken er et linjeskift');
  assert.equal(laes(['\n  ', ['P', {}, 'x'], '\n']), 'x', 'formaterings-mellemrum mellem blokke er ikke tekst');
  assert.equal(laes([['DIV', { ws: 'pre-wrap' }, 'a  b']]), 'a  b', 'pre-wrap beholder sine mellemrum');
  assert.equal(laes([['SPAN', { display: 'none' }, 'skjult'], 'vist']), 'vist');
  // R93 (Astra, maalt i model): mellemrum foldes som i CSS - ogsaa mellem elementer.
  assert.equal(laes([['SPAN', {}, 'hello'], ' ', ['SPAN', {}, 'world']]), 'hello world', 'mellemrummet mellem to span forsvandt');
  assert.equal(laes([['SPAN', {}, 'hello '], ['SPAN', {}, ' world']]), 'hello world', 'to mellemrum over en elementgraense blev ikke foldet');
  assert.equal(laes([['DIV', { ws: 'pre-line' }, 'a  b\nc']]), 'a b\nc', 'pre-line foldede ikke mellemrum eller mistede linjeskiftet');
  // R94 (Astra, maalt i model): et bogstaveligt U+0001 i teksten blev til et mellemrum.
  assert.equal(laes(['a\u0001b']), 'a\u0001b', 'et tegn i sidens tekst blev forvekslet med markoeren for mellemrum');
  assert.equal(laes([['DIV', { ws: 'pre-wrap' }, 'a\u0001 b']]), 'a\u0001 b');
  // R95 (Astra, maalt i model): én stor tekstknude gav «Maximum call stack size exceeded» (push med 200.000 argumenter).
  const stor = 'a '.repeat(100000) + 'z';
  assert.equal(laes([stor]), stor, 'en stor tekstknude kunne ikke laeses');
  assert.equal(laes([' a ', ['DIV', {}, ' b ']]), 'a\nb', 'mellemrum i linjens kanter er ikke tekst');
  assert.equal(laes(['a\u00a0\u00a0b']), 'a\u00a0\u00a0b', 'haarde mellemrum foldes ikke');
});

test('#70: fill paa en contenteditable doemmer med linjerne', () => {
  const fyld = indlaesUdvidelse().hent('fyldSvar');
  assert.equal(fyld(laes(['line1', ['DIV', {}, 'line2']]), 'line1\nline2', { method: 'debugger' }, null).differs, undefined,
    'en udfyldning der landede, blev meldt som en anden tekst');
  assert.equal(fyld(laes(['line1', ['DIV', {}, 'linje2']]), 'line1\nline2', { method: 'debugger' }, null).differs, true,
    'positiv kontrol: en anden tekst skal stadig meldes');
});

test('#70: fill bruger linje-laesningen - ikke textContent - paa en contenteditable', async () => {
  // Selve kaldet: debuggerFill skal sende redigerbarTekst til siden, ellers hjaelper funktionen ingen.
  const udtryk = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode !== 'Runtime.evaluate') return {};
      udtryk.push(String(p.expression));
      if (udtryk.length === 1) return { result: { value: true } };   // isContentEditable
      return { result: { value: 'line1\nline2' } };
    },
  } });
  const svar = await u.hent('debuggerFill')(1, '#ce', 'line1\nline2');
  assert.equal(svar.value, 'line1\nline2');
  assert.ok(udtryk.some((x) => x.includes('linjer.push') && x.includes('pladsholder')),
    'tilbagelaesningen bruger ikke redigerbarTekst');
  assert.ok(!udtryk.at(-1).includes('textContent ??'), 'tilbagelaesningen er stadig textContent');
});

// ── #70 text=: synlig foer skjult ────────────────────────────────────────────
const KLIK = indlaesUdvidelse().hent('klikMaal').toString();
test('#70: text= vaelger den synlige knap, naar en skjult kopi staar foerst', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'skjult', tekst: 'Request indexing', ingen: true });
  d.el('button', { id: 'synlig', tekst: 'Request indexing', rect: [100, 100, 120, 30] });
  const r = d.koer(KLIK, null, 'Request indexing', null, false, false).svar;
  assert.equal(r.x, 160, `klikket gaar til den skjulte kopi: ${JSON.stringify(r)}`);
  const el = d.koer(KLIK, null, 'Request indexing', null, false, true).svar;
  assert.equal(el.id, 'synlig');
});

test('#70: en synlig IKKE-klikbar tekst slaar ikke en skjult knap - svaret bliver «not visible» som foer (R93)', () => {
  const d = lavKlikDom();
  d.el('h2', { id: 'overskrift', tekst: 'Settings', rect: [10, 10, 200, 30] });
  d.el('button', { id: 'skjult', tekst: 'Settings', ingen: true });
  assert.equal(d.koer(KLIK, null, 'Settings', null, false, true).svar.id, 'skjult', 'klikket gik til overskriften');
});

test('#70: ogsaa en skjult EKSAKT kopi taber til en synlig delvis', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'skjult', tekst: 'Send', skjult: true, rect: [0, 0, 50, 20] });
  d.el('button', { id: 'synlig', tekst: 'Send now', rect: [200, 200, 80, 30] });
  assert.equal(d.koer(KLIK, null, 'Send', null, false, true).svar.id, 'synlig');
});

test('#70 positiv kontrol: findes kun den skjulte, vaelges den stadig (og svaret siger «not visible»)', () => {
  const d = lavKlikDom();
  d.el('button', { id: 'skjult', tekst: 'Request indexing', ingen: true });
  assert.equal(d.koer(KLIK, null, 'Request indexing', null, false, true).svar.id, 'skjult');
});

// ── #67 drop_file og upload_file ─────────────────────────────────────────────
test('#67: feltet sad med filen ved change og er tomt nu - svaret siger det, ikke file-not-attached og ikke «modtaget»', () => {
  const fyld = indlaesUdvidelse().hent('fildSvar');
  const svar = fyld({ antal: 0, navne: [] }, ['/x/a.png'], { method: 'hidden-input' }, { antal: 1, navne: ['a.png'] });
  assert.equal(svar.ok, true, `et felt siden saa filen i, blev meldt som fejl: ${JSON.stringify(svar)}`);
  assert.equal(svar.cleared_by_page, true);
  assert.deepEqual([...svar.seen_in_field], ['a.png']);
  assert.equal(svar.attached, undefined, 'svaret paastaar en vedhaeftning, feltet ikke har');
  // R93 (Astra): en side, der afviser filen og rydder feltet, ser ens ud - svaret maa ikke sige «modtaget» eller «attach ikke igen».
  assert.doesNotMatch(svar.note, /received|do not attach/i, `svaret paastaar mere end det saa: ${svar.note}`);
  assert.match(svar.note, /check the page/i);
  // R93 (Astra): antallet sammenlignes stadig.
  const delvis = fyld({ antal: 0, navne: [] }, ['/x/a.png', '/x/b.png'], {}, { antal: 1, navne: ['a.png'] });
  assert.equal(delvis.differs, true, `1 af 2 filer blev ikke meldt: ${JSON.stringify(delvis)}`);
  // Positive kontroller: intet change, eller et change uden filer, er stadig et nej.
  const nej = fyld({ antal: 0, navne: [] }, ['/x/a.png'], {}, null);
  assert.equal(nej.error, 'file-not-attached');
  assert.doesNotMatch(nej.note, /NOT uploaded/, 'et tomt felt uden et set change beviser ikke, at siden aldrig fik filen (R93)');
  assert.equal(fyld({ antal: 0, navne: [] }, ['/x/a.png'], {}, { antal: 0, navne: [] }).error, 'file-not-attached');
});

test('#67: change-lytteren ser feltet FOER sidens egen lytter rydder det', () => {
  const u = indlaesUdvidelse();
  const armer = u.hent('armerFilSkiftISiden').toString();
  const laesSkift = u.hent('laesFilSkiftISiden').toString();
  const lyttere = [];
  const fjern = (hvem) => (t, f) => { const i = lyttere.findIndex((l) => l.f === f && l.hvem === hvem); if (i >= 0) lyttere.splice(i, 1); };
  const window = { addEventListener: (t, f, c) => lyttere.push({ hvem: 'window', f, c }), removeEventListener: fjern('window') };
  const el = { isConnected: true, files: [{ name: 'a.png' }],
    addEventListener: (t, f, c) => lyttere.push({ hvem: 'el', f, c }), removeEventListener: fjern('el') };
  const koer = (kilde, ...a) => new Function('window', 'return (' + kilde + ')')(window)(...a);
  koer(armer, el, 'k1');
  assert.ok(lyttere.some((l) => l.hvem === 'window' && l.c === true), 'ingen fangst-lytter paa window - sidens egne lyttere kommer saa foer');
  for (const l of lyttere.filter((x) => x.hvem === 'window')) l.f({ target: el });   // fangst paa window kommer foerst
  el.files = [];                                                                     // sidens onchange rydder feltet
  const skift = JSON.parse(koer(laesSkift, 'k1'));
  assert.deepEqual(skift, { antal: 1, navne: ['a.png'] }, 'lytteren saa feltet efter at siden havde ryddet det');
  assert.equal(lyttere.length, 0, 'lytterne blev ikke fjernet igen');
});

test('#67: intet filfelt ved maalet - et felt andetsteds paa siden faar IKKE filen', async () => {
  // Strategi 1's udtryk koeres mod en side, hvor knappen ikke har noget felt i naerheden, men siden har et andet felt.
  let udtryk = null;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Runtime.evaluate' && String(p.expression).includes('candidates')) { udtryk = p.expression; return { result: { value: JSON.stringify({ found: false }) } }; }
      if (metode === 'Runtime.evaluate') return { result: { value: '[]' } };
      if (metode === 'Page.setInterceptFileChooserDialog' || metode === 'Page.enable' || metode === 'DOM.enable') throw new Error('ingen filvaelger her');
      return {};
    },
  } });
  const svar = await u.hent('dropFileOnTarget')(1, '#add', ['/x/a.png']);
  assert.equal(svar.error, 'no-file-input-found');
  const andet = { tagName: 'INPUT', id: 'other', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const tom = { querySelectorAll: () => [] };
  const knap = { ...tom, parentElement: { ...tom, parentElement: { ...tom } } };
  const document = { querySelector: () => knap, querySelectorAll: (s) => (s === 'input[type="file"]' ? [andet] : []) };
  const svar1 = JSON.parse(new Function('document', 'CSS', 'return ' + udtryk)(document, { escape: (x) => x }));
  assert.equal(svar1.found, false, `strategi 1 valgte et filfelt et andet sted paa siden: ${JSON.stringify(svar1)}`);
  assert.equal(andet.attrs['data-bmcp-drop-tag'], undefined, 'det fremmede felt blev maerket som maal');
  // Positiv kontrol: ligger feltet i maalet, findes det stadig og navngives.
  const eget = { ...andet, id: 'f', attrs: {}, accept: '', multiple: false };
  const zone = { querySelectorAll: () => [eget], parentElement: null };
  const svar2 = JSON.parse(new Function('document', 'CSS', 'return ' + udtryk)({ querySelector: () => zone, querySelectorAll: () => [eget] }, { escape: (x) => x }));
  assert.equal(svar2.found, true);
  assert.equal(svar2.input.selector, '#f', 'svaret navngiver ikke feltet, der fik filen');
  // R93 (Astra): et filfelt valgt direkte vinder over et soeskende.
  const valgt = { ...eget, id: 'target', attrs: {}, matches: (q) => q === 'input[type="file"]', querySelectorAll: () => [] };
  const soeskende = { ...eget, id: 'other', attrs: {} };
  valgt.parentElement = { querySelectorAll: () => [soeskende, valgt], parentElement: null };
  const svar3 = JSON.parse(new Function('document', 'CSS', 'return ' + udtryk)({ querySelector: () => valgt, querySelectorAll: (q) => (q === '#target' ? [valgt] : [soeskende, valgt]) }, { escape: (x) => x }));
  assert.equal(svar3.input.selector, '#target', `et valgt filfelt tabte til sit soeskende: ${JSON.stringify(svar3)}`);
  // R93 (Astra): et niveau op, der er <body>, eller som rummer flere filfelter, giver ikke filen til et af dem.
  const body = { querySelectorAll: () => [andet], parentElement: null };
  const knapIBody = { matches: () => false, querySelectorAll: () => [], parentElement: { querySelectorAll: () => [], parentElement: body } };
  const svar4 = JSON.parse(new Function('document', 'CSS', 'return ' + udtryk)({ body, querySelector: () => knapIBody, querySelectorAll: () => [andet] }, { escape: (x) => x }));
  assert.equal(svar4.found, false, `<body> blev soegt som «i naerheden»: ${JSON.stringify(svar4)}`);
  const to = { querySelectorAll: () => [andet, eget], parentElement: null };
  const svar5 = JSON.parse(new Function('document', 'CSS', 'return ' + udtryk)({ querySelector: () => ({ matches: () => false, querySelectorAll: () => [], parentElement: to }), querySelectorAll: () => [andet, eget] }, { escape: (x) => x }));
  assert.equal(svar5.found, false, `et niveau med to filfelter gav filen til det foerste: ${JSON.stringify(svar5)}`);
});

test('#67: filFeltNavn giver en selector, der rammer netop feltet - ogsaa uden id og name (R93)', () => {
  const kilde = indlaesUdvidelse().hent('filFeltNavn').toString();
  const wrap = { nodeType: 1, tagName: 'DIV', id: 'wrap', parentElement: null, previousElementSibling: null };
  const felt = (o) => ({ nodeType: 1, tagName: 'INPUT', id: '', name: '', parentElement: wrap, previousElementSibling: null, ...o });
  const a = felt({}), b = felt({ id: 'up' }), c = felt({ name: 'pic' }), d = felt({ name: 'x' }), e = felt({ name: 'x' });
  b.previousElementSibling = a; c.previousElementSibling = b; d.previousElementSibling = c; e.previousElementSibling = d;
  const alle = [a, b, c, d, e];
  const sider = { 'input[type="file"]': alle, '#up': [b], 'input[type="file"][name="pic"]': [c], 'input[type="file"][name="x"]': [d, e],
    '#wrap > input:nth-of-type(1)': [a], '#wrap > input:nth-of-type(5)': [e] };
  const document = { querySelectorAll: (q) => sider[q] || [] };
  const navn = (f, doc = document) => new Function('document', 'CSS', 'return (' + kilde + ')')(doc, { escape: (x) => x })(f);
  assert.equal(navn(a).selector, '#wrap > input:nth-of-type(1)', 'et felt uden id og name fik ingen brugbar selector');
  assert.match(navn(a).description, /file input 1 of 5/);
  assert.equal(navn(b).selector, '#up');
  assert.equal(navn(c).selector, 'input[type="file"][name="pic"]');
  assert.equal(navn(e).selector, '#wrap > input:nth-of-type(5)', 'et navn, to felter deler, blev brugt som selector');
  assert.equal(navn(b, { querySelectorAll: () => [] }).selector, null, 'et felt uden for dokumentet kan ikke naas med en selector');
  // R94 (Opus K): et forfader-id, der ikke er entydigt, giver en sti der rammer to felter - saa bruges hele stien fra <html>.
  const html = { nodeType: 1, tagName: 'HTML', id: '', parentElement: null, previousElementSibling: null };
  const dup = { nodeType: 1, tagName: 'DIV', id: 'dup', parentElement: html, previousElementSibling: null };
  const f = felt({ parentElement: dup });
  const andet = felt({});
  const doc2 = { querySelectorAll: (q) => ({ 'input[type="file"]': [f, andet], '#dup > input:nth-of-type(1)': [f, andet],
    'html:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)': [f] })[q] || [] };
  assert.equal(navn(f, doc2).selector, 'html:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)', 'et dublet-id gav ingen selector');
});

// ── #69 navigate og «Leave site?» ────────────────────────────────────────────
function navSele({ forladt, forsinkelse = 5 }) {
  const tilstand = { url: 'https://kladde.example/', status: 'complete' };
  const svarDialog = [];
  let u;
  u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': () => ({ id: 1, url: tilstand.url, status: tilstand.status, windowId: 1, active: true }),
    'tabs.query': [{ id: 1, url: tilstand.url, windowId: 1, active: true }],
    'tabs.update': (_id, o) => {
      // Siden har et ugemt udkast: Chrome viser «Leave site?» i stedet for at navigere.
      if (o && o.url && forsinkelse != null) setTimeout(() => u.fyr('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: '' }), forsinkelse);
      return { id: 1 };
    },
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Page.handleJavaScriptDialog') {
        svarDialog.push(p.accept);
        if (p.accept && forladt) setTimeout(async () => {
          tilstand.url = 'https://ny.example/'; tilstand.status = 'complete';
          await u.fyr('tabs.onUpdated', 1, { status: 'loading' }, {});
          await u.fyr('tabs.onUpdated', 1, { status: 'complete' }, { url: tilstand.url });
        }, 5);
      }
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async () => [{ result: null }];
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, svarDialog };
}

test('#69: «Leave site?» besvares med Stay, og svaret er beforeunload-blocked - straks, ikke efter 15 s', async () => {
  const { u, svarDialog } = navSele({ forladt: false });
  const t0 = Date.now();
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.ok(Date.now() - t0 < 3000, `navigate ventede ${Date.now() - t0} ms paa en side der aldrig kommer`);
  assert.deepEqual(svarDialog, [false], `boksen blev ikke besvaret med Stay: ${JSON.stringify(svarDialog)}`);
  assert.equal(svar.ok, false, `en blokeret navigation blev meldt som gennemfoert: ${JSON.stringify(svar)}`);
  assert.equal(svar.error, 'beforeunload-blocked');
  assert.equal(svar.url, 'https://kladde.example/');
  assert.match(svar.note, /leave_page: true/);
});

test('#69: med leave_page forlades siden, og navigate ender paa den nye adresse', async () => {
  const { u, svarDialog } = navSele({ forladt: true });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/', leave_page: true });
  assert.deepEqual(svarDialog, [true], 'boksen blev ikke besvaret med Leave');
  assert.equal(svar.error, undefined, JSON.stringify(svar));
  assert.equal(svar.url, 'https://ny.example/');
});

test('#69: en armeret handle_dialog (dismiss) bestemmer selv - og navigate melder det straks (R93)', async () => {
  const { u, svarDialog } = navSele({ forladt: false });
  // Den RIGTIGE armering (MAALT i Chrome: dens lytter kommer foer vagtens og fjerner armeringen, foer vagten ser boksen).
  const arm = await u.hent('dispatch')(9876, 'handle_dialog', { action: 'dismiss', timeout: 20000 });
  assert.equal(arm.armed, true);
  const t0 = Date.now();
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.deepEqual(svarDialog, [false], `boksen skulle besvares én gang, af handle_dialog (dismiss): ${JSON.stringify(svarDialog)}`);
  assert.ok(Date.now() - t0 < 3000, `navigate ventede ${Date.now() - t0} ms`);
  assert.equal(svar.error, 'beforeunload-blocked', `navigate meldte den gamle adresse uden fejl: ${JSON.stringify(svar)}`);
  assert.match(svar.note, /handle_dialog/);
});

test('#69: svarer fanen ikke, og begynder navigationen aldrig (en boks staar aaben), er svaret tab-not-responding - ikke den gamle adresse (R93/R94)', { timeout: 30000 }, async () => {
  const { u } = navSele({ forladt: false, forsinkelse: null });
  const send = u.chrome.debugger.sendCommand;
  u.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Page.enable' ? new Promise(() => {}) : send(m, metode, p));
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.equal(svar.error, 'tab-not-responding', `navigate meldte den gamle adresse uden fejl: ${JSON.stringify(svar)}`);
  assert.match(svar.note, /try browser_navigate again in a few seconds/, 'det billige raad (siden regner) mangler foerst');
});

test('#69: en side der REGNER i over 3 s kan stadig forlades - navigate sender adressen og ender paa den (R94, Opus)', { timeout: 30000 }, async () => {
  const { u } = navSele({ forladt: false, forsinkelse: null });
  const send = u.chrome.debugger.sendCommand;
  u.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Page.enable' ? new Promise((r) => setTimeout(() => r({}), 3500)) : send(m, metode, p));
  const opdater = u.chrome.tabs.update;
  u.chrome.tabs.update = async (id, o) => {
    setTimeout(async () => {           // siden bliver ledig efter 4 s, og navigationen gaar igennem
      await u.fyr('tabs.onUpdated', 1, { status: 'loading' }, {});
      u.chrome.tabs.get = async () => ({ id: 1, url: 'https://ny.example/', status: 'complete', windowId: 1, active: true });
      await u.fyr('tabs.onUpdated', 1, { status: 'complete' }, { url: 'https://ny.example/' });
    }, 4000);
    return opdater ? { id } : { id };
  };
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.equal(svar.error, undefined, `en travl side blev afvist: ${JSON.stringify(svar)}`);
  assert.equal(svar.url, 'https://ny.example/');
});

test('#69: vagten udloeber selv efter 20 s - ingen lytter bliver haengende (kendt graense 7)', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': () => ({}),
  } });
  const ure = [];
  const aegte = u.ctx.setTimeout;
  u.ctx.setTimeout = (f, ms, ...a) => { if (ms === 20000) { ure.push(f); return 0; } return aegte(f, ms, ...a); };
  await u.hent('armerForladVagt')(1, false);
  assert.equal((u.lyttere.get('debugger.onEvent') || []).length, 1, 'vagten blev ikke sat');
  assert.equal(ure.length, 1, 'vagten satte intet udloeb');
  ure[0]();
  assert.equal((u.lyttere.get('debugger.onEvent') || []).length, 0, 'vagten blev haengende efter sit udloeb');
});

test('#69: handle_dialog paa en fane med en aaben boks siger hvad der er galt, ikke Chromes noegne frist', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://kladde.example/', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://kladde.example/', windowId: 1, active: true }],
    'debugger.sendCommand': (_m, metode) => { if (metode === 'Page.enable') throw new Error('CDP did not respond within 8000 ms: Page.enable'); return {}; },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const svar = await u.hent('dispatch')(9876, 'handle_dialog', { wait: true });
  assert.equal(svar.error, 'tab-not-responding', JSON.stringify(svar));
  assert.match(svar.note, /browser_close_tab/);
});

// ── #67 ogsaa upload_file og filvaelger-vejen ────────────────────────────────
// R93 (Astra, maalt): stubbene leverede observationen, ogsaa naar ingen lytter var armeret - saa en fjernet armering var
// groen. Nu ser «siden» kun filen, hvis armeringen kom FOER afleveringen.
function filKaede() {
  const k = { armeret: false, armeretVedSet: false };
  k.armer = (x) => { if (x.includes('addEventListener')) k.armeret = true; };
  k.set = () => { k.armeretVedSet = k.armeret; };
  k.skift = () => (k.armeretVedSet ? JSON.stringify({ antal: 1, navne: ['a.png'] }) : null);
  return k;
}

test('#67: upload_file - feltet sad med filen ved change og er tomt nu: cleared_by_page', async () => {
  const k = filKaede();
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Runtime.evaluate') {
        const x = String(p.expression);
        if (x.includes('found: true')) return { result: { value: JSON.stringify({ found: true, tag: 'INPUT', type: 'file', accept: '', multiple: false }) } };
        k.armer(x);
        if (x.includes(':off') && !x.includes('addEventListener')) return { result: { value: k.skift() } };
        return { result: { value: true } };
      }
      if (metode === 'DOM.setFileInputFiles') { k.set(); return {}; }
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => (String(func).includes('.files') ? [{ result: { antal: 0, navne: [] } }] : [{ result: null }]);
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/x/a.png'] });
  assert.equal(svar.ok, true, `upload_file meldte file-not-attached, skoent siden saa filen: ${JSON.stringify(svar)}`);
  assert.equal(svar.cleared_by_page, true);
  assert.ok(k.armeretVedSet, 'lytteren blev ikke armeret foer afleveringen');
});

function vaelgerSele(feltet) {
  const k = filKaede();
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'DOM.resolveNode') return { object: { objectId: 'obj-1' } };
      if (metode === 'Runtime.callFunctionOn') {
        const f = String(p.functionDeclaration);
        if (f.includes('input:') && !f.includes('addEventListener')) {
          return { result: { value: JSON.stringify({ ...feltet, skift: feltet.skift && k.armeretVedSet ? feltet.skift : null }) } };
        }
        k.armer(f);
        return { result: { value: true } };
      }
      if (metode === 'DOM.setFileInputFiles') { k.set(); return {}; }
      if (metode === 'Runtime.evaluate' || metode === 'DOM.getDocument' || metode === 'DOM.querySelector') return new Promise(() => {});
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = () => new Promise(() => {}); // klikkets opslag haenger; filvaelgeren naar foerst
  return u;
}
async function vaelg(u) {
  const p = u.hent('interceptFileChooser')(1, '#add', ['/x/a.png']);
  for (let i = 0; i < 400 && !(u.lyttere.get('debugger.onEvent') || []).length; i++) await new Promise((r) => setTimeout(r, 5));
  await u.fyr('debugger.onEvent', { tabId: 1 }, 'Page.fileChooserOpened', { backendNodeId: 5, mode: 'selectSingle' });
  return p;
}

test('#67: filvaelger-vejen svarer ud fra feltet - ikke ud fra Chromes kvittering', async () => {
  const tomt = await vaelg(vaelgerSele({ antal: 0, navne: [], input: { selector: null, description: 'x' }, skift: null }));
  assert.equal(tomt.ok, false, `et tomt felt blev meldt som vedhaeftet: ${JSON.stringify(tomt)}`);
  assert.equal(tomt.error, 'file-not-attached');
  const fyldt = await vaelg(vaelgerSele({ antal: 1, navne: ['a.png'], input: { selector: null, description: "a file input outside the page's document" }, skift: { antal: 1, navne: ['a.png'] } }));
  assert.equal(fyldt.ok, true, JSON.stringify(fyldt));
  assert.equal(fyldt.method, 'native-chooser-intercepted');
  assert.match(String(fyldt.input.description), /outside the page/, 'svaret navngiver ikke feltet');
  const ryddet = await vaelg(vaelgerSele({ antal: 0, navne: [], input: { selector: null, description: 'x' }, skift: { antal: 1, navne: ['a.png'] } }));
  assert.equal(ryddet.cleared_by_page, true, `lytteren blev ikke armeret foer afleveringen, eller svaret mistede den: ${JSON.stringify(ryddet)}`);
});

test('#69: en input-frist naevner ogsaa en aaben dialog, ikke kun en baggrundsfane', async () => {
  const u = indlaesUdvidelse({ svar: { 'debugger.sendCommand': () => new Promise(() => {}) } });
  const fejl = await u.hent('cdpMedFrist')(1, 'Input.dispatchMouseEvent', { type: 'mousePressed' }).catch((e) => e);
  assert.match(String(fejl.message), /background/);
  assert.match(String(fejl.message), /opened a dialog/, `fristen peger kun paa baggrundsfanen: ${fejl.message}`);
});

// Mutant M12 (13/10) overlevede: drop_file's skjulte-felt-vej kunne miste sin change-laesning, uden at noget blev roedt.
test('#67: drop_file (skjult felt) - feltet sad med filen ved change og er tomt nu: cleared_by_page, og feltet navngives', async () => {
  const k = filKaede();
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Runtime.evaluate') {
        const x = String(p.expression);
        if (x.includes('candidates')) return { result: { value: JSON.stringify({ found: true, tag: 'T1', accept: '', multiple: false, input: { selector: '#f', description: 'file input 1 of 1 on the page, id "f"' } }) } };
        k.armer(x);
        if (x.includes(':off') && !x.includes('addEventListener')) return { result: { value: k.skift() } };
        return { result: { value: true } };
      }
      if (metode === 'DOM.setFileInputFiles') { k.set(); return {}; }
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => (String(func).includes('.files') ? [{ result: { antal: 0, navne: [] } }] : [{ result: null }]);
  const svar = await u.hent('dropFileOnTarget')(1, '#f', ['/x/a.png']);
  assert.equal(svar.ok, true, `drop_file meldte file-not-attached, skoent siden saa filen: ${JSON.stringify(svar)}`);
  assert.equal(svar.cleared_by_page, true);
  assert.equal(svar.method, 'hidden-input');
  assert.equal(svar.input.selector, '#f');
  assert.ok(k.armeretVedSet, 'lytteren blev ikke armeret foer afleveringen');
});

// ── R93 (Astra): vagten paa alle udgange, og et svar der ikke gik igennem ─────────────────────
test('#69: en navigation, der fejler, efterlader ingen vagt - en senere «Leave site?» besvares ikke', async () => {
  const { u, svarDialog } = navSele({ forladt: false });
  u.chrome.tabs.update = async () => { throw new Error('Invalid url'); };
  await assert.rejects(u.hent('dispatch')(9876, 'navigate', { url: 'nonsense:', leave_page: true }));
  assert.ok(u.optager.til('debugger.sendCommand').some((k) => k.args[1] === 'Page.enable'), 'vagten blev aldrig armeret - proeven maaler intet');
  const foer = (u.lyttere.get('debugger.onEvent') || []).length;
  assert.equal(foer, 0, `${foer} dialoglytter(e) blev haengende efter en fejlet navigation`);
  await u.fyr('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: '' });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(svarDialog, [], 'en senere boks blev besvaret af en vagt fra et afsluttet kald');
});

test('#69: gaar svaret paa «Leave site?» ikke igennem, siges det - ikke «Stay» og «the tab still works»', async () => {
  const { u } = navSele({ forladt: false });
  const send = u.chrome.debugger.sendCommand;
  u.chrome.debugger.sendCommand = async (m, metode, p) => {
    if (metode === 'Page.handleJavaScriptDialog') throw new Error('CDP did not respond within 8000 ms: Page.handleJavaScriptDialog');
    return send(m, metode, p);
  };
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.equal(svar.error, 'beforeunload-unanswered', JSON.stringify(svar));
  assert.doesNotMatch(String(svar.note), /still works/, 'svaret lover en fane, der virker');
});

// ── R94 (Astra): handle_dialog's svar skal vaere BEKRAEFTET paa netop denne boks ─────────────
test('#69: handle_dialog armeret, men dens svar paa boksen fejler - beforeunload-unanswered, ikke blocked og ikke 15 s', async () => {
  for (const action of ['dismiss', 'accept']) {
    const { u } = navSele({ forladt: false });
    const send = u.chrome.debugger.sendCommand;
    u.chrome.debugger.sendCommand = async (m, metode, p) => {
      if (metode === 'Page.handleJavaScriptDialog') throw new Error('CDP did not respond within 8000 ms: Page.handleJavaScriptDialog');
      return send(m, metode, p);
    };
    await u.hent('dispatch')(9876, 'handle_dialog', { action, timeout: 20000 });
    const t0 = Date.now();
    const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
    assert.equal(svar.error, 'beforeunload-unanswered', `${action}: ${JSON.stringify(svar)}`);
    assert.ok(Date.now() - t0 < 6000, `${action}: navigate ventede ${Date.now() - t0} ms`);
  }
});

test('#69: en UDLOEBET armering taeller ikke - vagten svarer selv', async () => {
  const { u, svarDialog } = navSele({ forladt: false, forsinkelse: 80 });
  await u.hent('dispatch')(9876, 'handle_dialog', { action: 'dismiss', timeout: 25 });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.deepEqual(svarDialog, [false], `boksen blev ikke besvaret af vagten: ${JSON.stringify(svarDialog)}`);
  assert.equal(svar.error, 'beforeunload-blocked', JSON.stringify(svar));
  assert.doesNotMatch(svar.note, /handle_dialog answered/, 'svaret tilskriver en udloebet armering boksen');
});

test('#69: en armering BRUGT paa en anden boks (alert) taeller ikke - vagten svarer selv', async () => {
  // Astras forloeb: armeringen findes, naar vagten saettes, men bruges paa en alert UNDER navigationen, foer «Leave site?».
  const { u, svarDialog } = navSele({ forladt: false, forsinkelse: 60 });
  await u.hent('dispatch')(9876, 'handle_dialog', { action: 'accept', timeout: 20000 });
  const opdater = u.chrome.tabs.update;
  u.chrome.tabs.update = async (id, o) => {
    setTimeout(() => u.fyr('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'alert', message: 'hej' }), 5);
    return opdater(id, o);
  };
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.deepEqual(svarDialog, [true, false], `alerten skulle have handle_dialog's svar, beforeunload vagtens: ${JSON.stringify(svarDialog)}`);
  assert.equal(svar.error, 'beforeunload-blocked', JSON.stringify(svar));
});

// ── R94 (Astra): et felt i en faelles forælder er ikke knappens ────────────────────────────
test('#67: ét filfelt ved siden af knappen faar ikke filen - knappen klikkes i stedet', async () => {
  let udtryk = null;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Runtime.evaluate' && String(p.expression).includes('candidates')) { udtryk = p.expression; return { result: { value: JSON.stringify({ found: false }) } }; }
      if (metode === 'Runtime.evaluate') return { result: { value: '[]' } };
      throw new Error('ingen filvaelger her');
    },
  } });
  await u.hent('dropFileOnTarget')(1, '#add', ['/x/a.png']);
  const avatar = { id: 'avatar', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const knap = { matches: () => false, querySelectorAll: () => [] };
  knap.parentElement = { querySelectorAll: () => [avatar], parentElement: { querySelectorAll: () => [avatar], parentElement: null } };
  const r = JSON.parse(new Function('document', 'CSS', 'return ' + udtryk)({ body: {}, querySelector: () => knap, querySelectorAll: () => [avatar] }, { escape: (x) => x }));
  assert.equal(r.found, false, `et felt i den faelles forælder blev valgt uden at knappen blev klikket: ${JSON.stringify(r)}`);
});

test('#67: teksterne om selector passer til filFeltNavn - ingen «null naar feltet mangler id og name»', async () => {
  const { TOOLS } = await import('../mcp-server/tools.js');
  const kilde = indlaesUdvidelse().hent('dropFileOnTarget').toString();
  for (const [navn, t] of [['tools.js drop_file', TOOLS.find((x) => x.name === 'browser_drop_file').description], ['drop_file-svaret', kilde]]) {
    assert.doesNotMatch(t, /without an id or name has none|null when the input has no id or name/, `${navn} siger, at et felt uden id/name ingen selector har`);
  }
});

// Mutanterne R3 og R4 (13/10) overlevede: ingen proeve viste, at vagten stadig besvarer en boks, naar en travl side bliver
// ledig, eller at en travl side, der omdirigerer, ikke meldes som tab-not-responding.
function travlSele({ boks = false, slutUrl = 'https://ny.example/' } = {}) {
  const { u, svarDialog } = navSele({ forladt: false, forsinkelse: null });
  const send = u.chrome.debugger.sendCommand;
  u.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Page.enable' ? new Promise((r) => setTimeout(() => r({}), 3500)) : send(m, metode, p));
  u.chrome.tabs.update = async (id) => {
    setTimeout(async () => {
      if (boks) { await u.fyr('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: '' }); return; }
      await u.fyr('tabs.onUpdated', 1, { status: 'loading' }, {});
      u.chrome.tabs.get = async () => ({ id: 1, url: slutUrl, status: 'complete', windowId: 1, active: true });
      await u.fyr('tabs.onUpdated', 1, { status: 'complete' }, { url: slutUrl });
    }, 4000);
    return { id };
  };
  return { u, svarDialog };
}

test('#69: en travl side, der bliver ledig og saa spoerger «Leave site?», faar vagtens svar (R3)', { timeout: 30000 }, async () => {
  const { u, svarDialog } = travlSele({ boks: true });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.deepEqual(svarDialog, [false], `boksen efter den travle periode blev ikke besvaret: ${JSON.stringify(svarDialog)}`);
  assert.equal(svar.error, 'beforeunload-blocked', JSON.stringify(svar));
});

test('#69: en travl side, der omdirigerer, er en gennemfoert navigation - ikke tab-not-responding (R4)', { timeout: 30000 }, async () => {
  const { u } = travlSele({ slutUrl: 'https://ny.example/login' });
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  assert.equal(svar.error, undefined, `en omdirigeret navigation blev meldt som en fane, der ikke svarer: ${JSON.stringify(svar)}`);
  assert.equal(svar.url, 'https://ny.example/login');
});

// ── R95 (Astra): et ubekraeftet svar ved navigates frist, og samme adresse paa en fastlaast fane ─────────
test('#69: naar navigates frist kommer, foer handle_dialog har bekraeftet sit svar, er svaret ubekraeftet - ikke Stay', { timeout: 60000 }, async () => {
  for (const action of ['dismiss', 'accept']) {
    const { u } = navSele({ forladt: false, forsinkelse: 14800 });
    const send = u.chrome.debugger.sendCommand;
    u.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Page.handleJavaScriptDialog' ? new Promise(() => {}) : send(m, metode, p));
    await u.hent('dispatch')(9876, 'handle_dialog', { action, timeout: 60000 });
    const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
    assert.equal(svar.error, 'beforeunload-unanswered', `${action}: et ubekraeftet svar blev meldt som bekraeftet: ${JSON.stringify(svar)}`);
    assert.doesNotMatch(String(svar.note), /answered Stay|still works/);
  }
});

test('#69: en fastlaast fane og samme adresse som foer er ikke en navigation - tab-not-responding', { timeout: 30000 }, async () => {
  const { u } = navSele({ forladt: false, forsinkelse: null });
  const send = u.chrome.debugger.sendCommand;
  u.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Page.enable' ? new Promise(() => {}) : send(m, metode, p));
  const svar = await u.hent('dispatch')(9876, 'navigate', { url: 'https://kladde.example/' });
  assert.equal(svar.error, 'tab-not-responding', `samme adresse paa en fastlaast fane blev meldt som gennemfoert: ${JSON.stringify(svar)}`);
});
