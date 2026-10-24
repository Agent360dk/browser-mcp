/**
 * browser_wait venter paa noget, der kan SES (1.33, privat rapport 2.1).
 *
 * MAALT af to bedoemmere i headless Chrome paa 1.30.2 og d002938: `browser_wait text=...` svarede found:true for tekst i et
 * element med display:none, visibility:hidden, opacity:0 og left:-9999px. CSS-vejen svarede ja til display:none. I praksis:
 * en succesbesked, siden har klar men skjult, «dukkede op» med det samme.
 *
 * Del A proever kriteriet (ventMaal) mod en lille side-model. Den er bygget efter Chromes regler: display:none fjerner
 * boksene for elementet og alt i det, visibility arves og kan overskrives af et barn, opacity arves ikke men ganges op.
 * Samme 18 tilfaelde er maalt i en rigtig headless Chrome 21/10 (plans/browsermcp-133/maal-21/vent-dom.html).
 * Del B proever vaerktoejet gennem udvidelsens egen dispatch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

// ── Del A: side-modellen ───────────────────────────────────────────────────────
function lavSide() {
  class Tekst {
    constructor(data) { this.data = data; this.nodeType = 3; this.nodeName = '#text'; this.parentNode = null; }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  }
  class El {
    constructor(tag, o = {}) {
      this.tagName = this.nodeName = tag.toUpperCase();
      this.nodeType = 1;
      this.id = o.id || '';
      this.kids = [];
      this.parentNode = null;
      this.shadowRoot = null;
      this.stil = { display: 'block', opacity: '1', overflowX: 'visible', overflowY: 'visible', ...(o.stil || {}) };
      this.r = o.rect || [10, 10, 100, 20];   // [x, y, bredde, hoejde]
      this.selected = !!o.selected; this.multiple = !!o.multiple; this.size = o.size || 0;
      this.attrs = { ...(o.attrs || {}) };
      if ('offsetParent' in o) this.opTvang = o.offsetParent;   // fixed inde i en transform-forfader har en offsetParent
      this.scrollLeft = o.scrollLeft || 0; this.scrollTop = o.scrollTop || 0;
    }
    closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.tagName === sel.toUpperCase()) return n; return null; }
    getAttribute(n) { return this.attrs && n in this.attrs ? this.attrs[n] : null; }
    get options() { return this.kids.filter((k) => k.nodeType === 1 && k.tagName === 'OPTION'); }
    // Som i Chrome: et fast element (uden transform-forfader) har ingen offsetParent.
    get offsetParent() { if (this.opTvang !== undefined) return this.opTvang; return this.stil.position === 'fixed' ? null : this.parentNode; }
    get selectedIndex() { return this.options.findIndex((o) => o.selected); }
    add(...boern) {
      for (const c of boern) { const n = typeof c === 'string' ? new Tekst(c) : c; n.parentNode = this; this.kids.push(n); }
      return this;
    }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get textContent() { return this.kids.map((k) => (k.nodeType === 3 ? k.data : k.textContent)).join(''); }
    get childNodes() { return this.kids; }
    querySelectorAll(sel) {
      const ud = [];
      const gaa = (n) => { for (const c of n.kids) if (c.nodeType === 1) { if (sel === '*' || passer(c, sel)) ud.push(c); gaa(c); } };
      gaa(this);
      return ud;
    }
    contains(o) { for (let n = o; n; n = n.parentNode) if (n === this) return true; return false; }
    // display:none paa elementet eller en forfader (ogsaa gennem en shadow host) = ingen bokse, som i Chrome.
    vist() {
      for (let n = this; n; n = n.parentNode || n.host) if (n.nodeType === 1 && n.stil.display === 'none') return false;
      return true;
    }
    getClientRects() { return this.vist() ? [this.getBoundingClientRect()] : []; }
    getBoundingClientRect() {
      // display:contents har ingen egen boks (som i Chrome).
      const [x, y, width, height] = this.vist() && this.stil.display !== 'contents' ? this.r : [0, 0, 0, 0];
      return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
    }
    attachShadow() { const s = new El('#shadow'); s.nodeType = 11; s.host = this; this.shadowRoot = s; return s; }
  }
  const passer = (el, sel) => (sel.startsWith('#') ? el.id === sel.slice(1) : el.tagName === sel.toUpperCase());
  const html = new El('html');
  const body = new El('body', { rect: [0, 0, 1280, 4000] });
  html.add(body);
  // visibility arves; et barn kan saette den igen.
  const synlighed = (el) => {
    for (let n = el; n; n = n.parentNode || n.host) if (n.nodeType === 1 && n.stil.visibility) return n.stil.visibility;
    return 'visible';
  };
  const document = {
    kids: [html],
    childNodes: [html],
    querySelectorAll: (sel) => [...(sel === '*' || passer(html, sel) ? [html] : []), ...html.querySelectorAll(sel)],
    createTreeWalker: (rod) => {
      const tekster = [];
      const gaa = (n) => { for (const c of n.kids) { if (c.nodeType === 3) tekster.push(c); else gaa(c); } };
      gaa(rod);
      let i = 0;
      return { nextNode: () => tekster[i++] || null };
    },
  };
  const getComputedStyle = (el) => ({ ...el.stil, visibility: synlighed(el) });
  const vindue = { scrollX: 0, scrollY: 0, innerWidth: 1280, innerHeight: 800 };
  // Den synlige flade er uden rullebjaelke (clientWidth), innerWidth med (Chrome 155: 1265 mod 1280).
  document.documentElement = { clientWidth: 1265, clientHeight: 800 };
  const koer = (kilde, sel, tekst, tag = null) => new Function('document', 'window', 'getComputedStyle', 'NodeFilter',
    `return (${kilde})(${JSON.stringify(sel)}, ${JSON.stringify(tekst)}, ${JSON.stringify(tag)});`)(
    document, vindue, getComputedStyle, { SHOW_TEXT: 4 });
  return { El, Tekst, body, koer, vindue, document };
}

const KILDE = indlaesUdvidelse({ svar: {} }).hent('ventMaal').toString();

function side(byg) {
  const s = lavSide();
  byg(s.body, s.El);
  return (sel, tekst, tag) => s.koer(KILDE, sel, tekst, tag);
}

test('2.1: synlig tekst findes - ogsaa under folden og i en aaben shadow root', () => {
  const v = side((b, El) => {
    b.add(new El('p').add('Gemt'));
    b.add(new El('p', { rect: [10, 3000, 100, 20] }).add('Under folden'));
    const vaert = new El('div'); b.add(vaert);
    vaert.attachShadow().add(new El('p').add('I skyggen'));
  });
  assert.deepEqual(v(null, 'Gemt'), { synlig: true, paaSiden: true });
  assert.equal(v(null, 'Under folden').synlig, true, 'en tekst laengere nede er synlig - siden kan rulles');
  assert.equal(v(null, 'I skyggen').synlig, true);
});

const SKJULT = [
  ['display:none', (b, El) => b.add(new El('p', { stil: { display: 'none' } }).add('Gemt'))],
  ['visibility:hidden', (b, El) => b.add(new El('p', { stil: { visibility: 'hidden' } }).add('Gemt'))],
  ['visibility:hidden arvet fra en forfader', (b, El) => b.add(new El('div', { stil: { visibility: 'hidden' } }).add(new El('span').add('Gemt')))],
  ['opacity:0', (b, El) => b.add(new El('p', { stil: { opacity: '0' } }).add('Gemt'))],
  ['opacity:0 paa en forfader', (b, El) => b.add(new El('div', { stil: { opacity: '0' } }).add(new El('span').add('Gemt')))],
  ['left:-9999px (flyttet ud af siden)', (b, El) => b.add(new El('p', { rect: [-9999, 10, 100, 20] }).add('Gemt'))],
  ['1 x 1 px (skaermlaeser-tekst)', (b, El) => b.add(new El('span', { rect: [10, 10, 1, 1], stil: { overflowX: 'hidden', overflowY: 'hidden' } }).add('Gemt'))],
  ['i en lukket boks (hoejde 0, overflow hidden)', (b, El) => b.add(new El('div', { rect: [10, 10, 300, 0], stil: { overflowX: 'hidden', overflowY: 'hidden' } }).add(new El('p').add('Gemt')))],
  ['display:none paa en forfader', (b, El) => b.add(new El('div', { stil: { display: 'none' } }).add(new El('div').add(new El('b').add('Gemt'))))],
  ['shadow host med opacity:0', (b, El) => { const h = new El('div', { stil: { opacity: '0' } }); b.add(h); h.attachShadow().add(new El('p').add('Gemt')); }],
];
for (const [navn, byg] of SKJULT) {
  test(`2.1: ${navn} er paa siden, men ikke synlig`, () => {
    assert.deepEqual(side(byg)(null, 'Gemt'), { synlig: false, paaSiden: true });
  });
}

test('2.1: et barn, der saetter visibility:visible igen, er synligt (som i Chrome)', () => {
  const v = side((b, El) => b.add(new El('div', { stil: { visibility: 'hidden' } }).add(new El('span', { stil: { visibility: 'visible' } }).add('Gemt'))));
  assert.equal(v(null, 'Gemt').synlig, true);
});

test('2.1: en boks med overflow hidden i normal stoerrelse skjuler ikke sit indhold', () => {
  const v = side((b, El) => b.add(new El('div', { rect: [10, 10, 300, 200], stil: { overflowX: 'hidden', overflowY: 'hidden' } }).add(new El('p').add('Gemt'))));
  assert.equal(v(null, 'Gemt').synlig, true);
});

test('2.1: en skjult kopi ved siden af en synlig - den synlige taeller', () => {
  const v = side((b, El) => { b.add(new El('p', { stil: { display: 'none' } }).add('Gemt')); b.add(new El('p').add('Gemt')); });
  assert.equal(v(null, 'Gemt').synlig, true);
});

test('2.1: tekst, der kun staar i et <script>, er hverken paa siden eller synlig - heller ikke via <body>', () => {
  // MAALT i headless Chrome 21/10: uden undtagelsen blev <body> (hvis textContent rummer scriptet) regnet for et synligt match.
  const v = side((b, El) => { b.add(new El('p').add('Andet')); b.add(new El('script', { stil: { display: 'none' } }).add("var besked = 'Gemt';")); });
  assert.deepEqual(v(null, 'Gemt'), { synlig: false, paaSiden: false });
});

test('2.1: manglende tekst og CSS-vejen', () => {
  const v = side((b, El) => { b.add(new El('div', { id: 'c1' }).add('x')); b.add(new El('div', { id: 'c2', stil: { display: 'none' } }).add('y')); });
  assert.deepEqual(v(null, 'Findes ikke'), { synlig: false, paaSiden: false });
  assert.deepEqual(v('#c1', null), { synlig: true, paaSiden: true });
  assert.deepEqual(v('#c2', null), { synlig: false, paaSiden: true }, 'CSS-vejen svarede foer ja til display:none');
});

test('2.1: en tag-begraensning gaelder (button:text(...))', () => {
  const v = side((b, El) => b.add(new El('p').add('Gem')));
  assert.equal(v(null, 'Gem', 'p').synlig, true);
  assert.deepEqual(v(null, 'Gem', 'button'), { synlig: false, paaSiden: false });
});

// ── Del B: vaerktoejet gennem dispatch ─────────────────────────────────────────
function vaerktoej(svar) {
  const udtryk = [];
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => ({ id, url: 'https://side.example/', windowId: 1, active: true }),
    'debugger.attach': () => {},
    'debugger.getTargets': () => [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_m, metode, p = {}) => {
      if (metode !== 'Runtime.evaluate') return {};
      udtryk.push(String(p.expression));
      return { result: { value: svar.tekst() } };
    },
    'scripting.executeScript': () => [{ result: svar.css() }],
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 'Claude 1', color: 'blue' });
  return { vent: (params) => u.hent('dispatch')(9876, 'wait', params), udtryk };
}
const SKJ = { synlig: false, paaSiden: true };
const VIS = { synlig: true, paaSiden: true };

test('2.1 (vaerktoej): kun skjulte match - found:false med on_page_but_hidden, ikke found:true', async () => {
  const m = vaerktoej({ tekst: () => SKJ });
  const r = await m.vent({ selector: 'text=Gemt', timeout: 1200 });
  assert.equal(r.found, false, JSON.stringify(r));
  assert.equal(r.on_page_but_hidden, true);
  assert.match(m.udtryk[0], /^\(function ventMaal\(/, 'tekstvejen skal maale med ventMaal - ikke klikfinderen, der ruller siden');
});

test('2.1 (vaerktoej): skjult, saa synlig - found:true, visible:true', async () => {
  let n = 0;
  const m = vaerktoej({ tekst: () => (++n < 2 ? SKJ : VIS) });
  const r = await m.vent({ selector: 'text=Gemt', timeout: 3000 });
  assert.equal(r.found, true, JSON.stringify(r));
  assert.equal(r.visible, true);
  assert.equal(n, 2, 'den skjulte foerste maaling maa ikke give found');
});

test('2.1 (vaerktoej): state "attached" venter kun paa, at det findes, og siger om det kan ses', async () => {
  const m = vaerktoej({ tekst: () => SKJ });
  const r = await m.vent({ selector: 'text=Gemt', timeout: 1200, state: 'attached' });
  assert.deepEqual({ found: r.found, visible: r.visible }, { found: true, visible: false });
});

test('2.1 (vaerktoej): CSS-vejen - display:none er ikke fundet, et synligt element er', async () => {
  const skjult = await vaerktoej({ css: () => SKJ }).vent({ selector: '#besked', timeout: 1200 });
  assert.equal(skjult.found, false, JSON.stringify(skjult));
  assert.equal(skjult.on_page_but_hidden, true);
  const synlig = await vaerktoej({ css: () => VIS }).vent({ selector: '#besked', timeout: 1200 });
  assert.equal(synlig.found, true, JSON.stringify(synlig));
});

test('2.1 (vaerktoej): intet match - found:false uden on_page_but_hidden', async () => {
  const r = await vaerktoej({ tekst: () => ({ synlig: false, paaSiden: false }) }).vent({ selector: 'text=Gemt', timeout: 700 });
  // Svaret kommer fra udvidelsens VM (en anden Object-prototype), saa indholdet sammenlignes.
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { found: false });
});

// ── R173 (Astra, MAALT i side-modellen): det inderste match afgjorde sagen ─────────────────────────────────
test('R173: en synlig knap, hvis eneste tekst er en skjult <span>, er ikke synlig for button:text(...)', () => {
  const v = side((b, El) => b.add(new El('button').add(new El('span', { stil: { display: 'none' } }).add('Saved'))));
  assert.deepEqual(v(null, 'Saved', 'button'), { synlig: false, paaSiden: true });
});

test('R173: «Sa<span skjult>ved</span>» viser ikke «Saved»', () => {
  const v = side((b, El) => b.add(new El('p').add('Sa', new El('span', { stil: { display: 'none' } }).add('ved'))));
  assert.deepEqual(v(null, 'Saved'), { synlig: false, paaSiden: true });
});

test('R173: et synligt «Saved» med en skjult kopi inden i er synligt', () => {
  const v = side((b, El) => b.add(new El('p').add('Saved', new El('span', { stil: { display: 'none' } }).add('Saved'))));
  assert.equal(v(null, 'Saved').synlig, true);
});

test('R173: tekst uden for en boks med overflow hidden er skjult - i en rullebar boks er den synlig', () => {
  const ude = (overflow) => side((b, El) => b.add(new El('div', { rect: [10, 10, 300, 200], stil: { overflowX: overflow, overflowY: overflow } })
    .add(new El('p', { rect: [400, 10, 100, 20] }).add('Gemt'))))(null, 'Gemt').synlig;
  assert.equal(ude('hidden'), false, 'overflow hidden skaerer teksten af');
  assert.equal(ude('clip'), false);
  assert.equal(ude('auto'), true, 'en rullebar boks kan rulles til teksten - som siden under folden');
});

test('R173: tekst i et <style> er hverken paa siden eller synlig', () => {
  const v = side((b, El) => b.add(new El('style', { stil: { display: 'none' } }).add('.Gemt { color: red }')));
  assert.deepEqual(v(null, 'Gemt'), { synlig: false, paaSiden: false });
});

test('R173: CSS-vejen sender selektoren til siden som argument', async () => {
  const args = [];
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => ({ id, url: 'https://side.example/', windowId: 1, active: true }),
    'scripting.executeScript': (o) => { args.push(o.args); return [{ result: { synlig: true, paaSiden: true } }]; },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 'Claude 1', color: 'blue' });
  await u.hent('dispatch')(9876, 'wait', { selector: '#besked', timeout: 700 });
  assert.deepEqual(JSON.parse(JSON.stringify(args[0])), ['#besked', null, null]);
});

test('R173: browserens egen checkVisibility afgoer en lukket <details> (boksen alene ser synlig ud)', () => {
  // MAALT i headless Chrome 155: <p> i en lukket <details> har en boks paa 740 x 18, men checkVisibility() er false.
  const v = side((b, El) => { const p = new El('p').add('Gemt'); p.checkVisibility = () => false; b.add(new El('details').add(p)); });
  assert.deepEqual(v(null, 'Gemt'), { synlig: false, paaSiden: true });
  const aaben = side((b, El) => { const p = new El('p').add('Gemt'); p.checkVisibility = () => true; b.add(new El('details').add(p)); });
  assert.equal(aaben(null, 'Gemt').synlig, true);
});

test('R173: tekst direkte i en shadow root (uden element om sig) taeller med sin vaerts synlighed', () => {
  const v = side((b, El) => { const h = new El('div'); b.add(h); h.attachShadow().add('Gemt'); });
  assert.equal(v(null, 'Gemt').synlig, true);
  const skjult = side((b, El) => { const h = new El('div', { stil: { opacity: '0' } }); b.add(h); h.attachShadow().add('Gemt'); });
  assert.equal(skjult(null, 'Gemt').synlig, false);
});

test('R173 (Opus V2): en boks paa 100 x 1 eller 1 x 100 px er skjult - begge maal skal vaere mindst 2 px', () => {
  for (const rect of [[10, 10, 100, 1], [10, 10, 1, 100]]) {
    const v = side((b, El) => b.add(new El('p', { rect }).add('Gemt')));
    assert.equal(v(null, 'Gemt').synlig, false, JSON.stringify(rect));
  }
});

test('R173 (Opus V6): en tekst over vinduet paa en rullet side er synlig - kun det, der ligger foran sidens begyndelse, er skjult', () => {
  const s = lavSide();
  s.vindue.scrollY = 1000;                               // siden er rullet 1000 px ned
  s.body.add(new s.El('p', { rect: [10, -500, 100, 20] }).add('Gemt'));    // 500 px nede paa siden, over vinduet
  assert.equal(s.koer(KILDE, null, 'Gemt').synlig, true, 'teksten staar paa siden - man ruller bare op');
  const t = lavSide();
  t.vindue.scrollY = 1000;
  t.body.add(new t.El('p', { rect: [10, -1500, 100, 20] }).add('Gemt'));   // foran sidens begyndelse
  assert.equal(t.koer(KILDE, null, 'Gemt').synlig, false);
});

test('R173 (Opus V8): visibility:collapse er skjult', () => {
  const v = side((b, El) => b.add(new El('p', { stil: { visibility: 'collapse' } }).add('Gemt')));
  assert.deepEqual(v(null, 'Gemt'), { synlig: false, paaSiden: true });
});

// ── R173 (Opus, MAALT i Chrome 155) ──────────────────────────────────────────────────────────────────
test('R173 (Opus): et fast element er kun synligt i vinduet - topbjaelke skubbet op, skuffe skubbet ud til hoejre', () => {
  const s1 = lavSide(); s1.vindue.scrollY = 1000;
  s1.body.add(new s1.El('header', { stil: { position: 'fixed' }, rect: [0, -60, 1280, 60] }).add('Menu'));
  assert.equal(s1.koer(KILDE, null, 'Menu').synlig, false, 'translateY(-100%) paa en rullet side - over vinduet, ikke paa siden');
  const s2 = lavSide();
  s2.body.add(new s2.El('aside', { stil: { position: 'fixed' }, rect: [1280, 0, 300, 800] }).add('Skuffe'));
  assert.equal(s2.koer(KILDE, null, 'Skuffe').synlig, false, 'translateX(100%) - til hoejre for vinduet');
  const s3 = lavSide(); s3.vindue.scrollY = 1000;
  s3.body.add(new s3.El('header', { stil: { position: 'fixed' }, rect: [0, 0, 1280, 60] }).add('Menu'));
  assert.equal(s3.koer(KILDE, null, 'Menu').synlig, true, 'en fast topbjaelke i vinduet er synlig, ogsaa paa en rullet side');
  const s4 = lavSide();
  const fast = new s4.El('div', { stil: { position: 'fixed' }, rect: [1280, 0, 300, 800] });
  s4.body.add(fast.add(new s4.El('p', { rect: [1290, 10, 100, 20] }).add('Inde')));
  assert.equal(s4.koer(KILDE, null, 'Inde').synlig, false, 'ogsaa naar det er en forfader, der er fast');
});

test('R173 (Opus): tekst direkte i et display:contents-element er synlig - i en skjult contents-forfader ikke', () => {
  const v = side((b, El) => b.add(new El('div', { id: 'root', stil: { display: 'contents' } }).add('Velkommen')));
  assert.equal(v(null, 'Velkommen').synlig, true);
  const skjult = side((b, El) => b.add(new El('div', { stil: { display: 'contents', visibility: 'hidden' } }).add('Velkommen')));
  assert.equal(skjult(null, 'Velkommen').synlig, false);
});

test('R173 (Opus): den valgte <option> i en lukket <select> er synlig - de andre ikke', () => {
  const v = side((b, El) => b.add(new El('select', { rect: [10, 10, 200, 30] }).add(
    new El('option', { rect: [0, 0, 0, 0], selected: true }).add('Danmark'),
    new El('option', { rect: [0, 0, 0, 0] }).add('Norge'))));
  assert.equal(v(null, 'Danmark').synlig, true, 'den valgte staar i feltet');
  assert.equal(v(null, 'Norge').synlig, false, 'en ikke-valgt option i en lukket select ses ikke');
});

test('R173 (Opus): en ukendt state afvises - hidden betyder ikke stille «visible»', async () => {
  const u = indlaesUdvidelse({ svar: { 'tabs.get': (id) => ({ id, url: 'https://side.example/', windowId: 1, active: true }) } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 'Claude 1', color: 'blue' });
  await assert.rejects(u.hent('dispatch')(9876, 'wait', { selector: '#spinner', state: 'hidden', timeout: 500 }), /state must be/);
});

// ── R174 (Astra, MAALT i side-modellen) ──────────────────────────────────────────────────────────────
test('R174: en <option> med label viser sin label, ikke sin tekst', () => {
  const v = side((b, El) => b.add(new El('select', { rect: [10, 10, 200, 30] }).add(
    new El('option', { rect: [0, 0, 0, 0], selected: true, attrs: { label: 'Pending' } }).add('Saved'))));
  assert.equal(v(null, 'Saved').synlig, false, 'teksten bag en label vises ikke');
  assert.equal(v(null, 'Pending').synlig, true, 'labelen staar i feltet');
  assert.equal(v(null, 'Pending', 'select').synlig, true, 'ogsaa for select:text(Pending)');
});

test('R174: tag-vejen bruger den synlige tekst - «Sa<span skjult>X</span>ved» er button:text(Saved)', () => {
  const v = side((b, El) => b.add(new El('button').add('Sa', new El('span', { stil: { display: 'none' } }).add('X'), 'ved')));
  assert.equal(v(null, 'Saved').synlig, true);
  assert.equal(v(null, 'Saved', 'button').synlig, true, 'tag-vejen og den frie vej skal svare ens');
});

test('R174: synlig tekst direkte i en shadow root er ogsaa paa siden', () => {
  const v = side((b, El) => { const h = new El('div'); b.add(h); h.attachShadow().add('Gemt'); });
  assert.deepEqual(v(null, 'Gemt'), { synlig: true, paaSiden: true });
});

test('R174 (Astra W4): den synlige tekst laeses i dokumentets raekkefoelge', () => {
  const v = side((b, El) => b.add(new El('p').add(new El('b').add('Sa'), new El('i').add('ved'))));
  assert.equal(v(null, 'Saved').synlig, true);
  assert.equal(v(null, 'vedSa').synlig, false);
});

// ── R174 (Opus, MAALT i Chrome 155): fast-reglen var for bred ─────────────────────────────────────────
test('R174: indhold under folden i en fast boks, der kan rulles (modal, <dialog>), er synligt', () => {
  const s1 = lavSide();
  const modal = new s1.El('div', { stil: { position: 'fixed', overflowX: 'hidden', overflowY: 'auto' }, rect: [100, 100, 600, 500] });
  s1.body.add(modal.add(new s1.El('button', { rect: [110, 1400, 100, 30] }).add('Bekraeft')));
  assert.equal(s1.koer(KILDE, null, 'Bekraeft').synlig, true, 'man ruller i modalen til knappen');
  const s2 = lavSide();
  const fast = new s2.El('div', { stil: { position: 'fixed' }, rect: [100, 100, 600, 500] });
  s2.body.add(fast.add(new s2.El('p', { rect: [110, 1400, 100, 20] }).add('Under')));
  assert.equal(s2.koer(KILDE, null, 'Under').synlig, false, 'en fast boks, der ikke kan rulles, viser ikke det, der ligger under vinduet');
  const s3 = lavSide();
  const ude = new s3.El('div', { stil: { position: 'fixed', overflowY: 'auto' }, rect: [1400, 100, 300, 500] });
  s3.body.add(ude.add(new s3.El('p', { rect: [1410, 120, 100, 20] }).add('Skuffe')));
  assert.equal(s3.koer(KILDE, null, 'Skuffe').synlig, false, 'en rullebar fast boks uden for vinduet viser intet');
});

test('R174 (Opus W4): tekst helt under en boks, der skaerer af, er skjult', () => {
  const v = side((b, El) => b.add(new El('div', { rect: [10, 10, 300, 100], stil: { overflowX: 'hidden', overflowY: 'hidden' } })
    .add(new El('p', { rect: [10, 500, 100, 20] }).add('Gemt'))));
  assert.equal(v(null, 'Gemt').synlig, false);
});

test('R174: afskaering vurderes pr. akse - overflow-x hidden med overflow-y auto kan rulles lodret', () => {
  const boks = (child) => side((b, El) => b.add(new El('div', { rect: [10, 10, 300, 100], stil: { overflowX: 'hidden', overflowY: 'auto' } })
    .add(new El('p', { rect: child }).add('Gemt'))))(null, 'Gemt').synlig;
  assert.equal(boks([10, 500, 100, 20]), true, 'under boksen: man ruller ned til den');
  assert.equal(boks([400, 20, 100, 20]), false, 'til hoejre for boksen: skaaret af');
});

// ── R175 (Astra, MAALT i modellen) ───────────────────────────────────────────────────────────────────
test('R175: den inderste faste boks afgoer - en fast skuffe uden for vinduet i en synlig, rullebar fast ramme er skjult', () => {
  const s = lavSide();
  const ramme = new s.El('div', { stil: { position: 'fixed', overflowY: 'auto' }, rect: [0, 0, 1265, 800] });
  const skuffe = new s.El('aside', { stil: { position: 'fixed' }, rect: [1300, 0, 300, 800] });
  s.body.add(ramme.add(skuffe.add(new s.El('p', { rect: [1310, 10, 100, 20] }).add('Skuffe'))));
  assert.equal(s.koer(KILDE, null, 'Skuffe').synlig, false);
});

test('R175: et fixed inde i en transform-forfader (offsetParent) behandles som almindeligt indhold paa siden', () => {
  const s = lavSide(); s.vindue.scrollY = 1000;
  const t = new s.El('div', { rect: [0, 0, 1265, 4000] });
  s.body.add(t.add(new s.El('div', { stil: { position: 'fixed' }, offsetParent: t, rect: [10, 1200, 200, 20] }).add('Nede')));
  assert.equal(s.koer(KILDE, null, 'Nede').synlig, true, 'det ruller med siden - det er paa siden, under vinduet');
});

test('R175: vinduet er uden rullebjaelke - en fast skuffe paa x=1265 ligger under rullebjaelken', () => {
  const s = lavSide();
  s.body.add(new s.El('aside', { stil: { position: 'fixed' }, rect: [1265, 0, 300, 800] }).add('Skuffe'));
  assert.equal(s.koer(KILDE, null, 'Skuffe').synlig, false);
});

test('R175 (Opus W2): browserens checkVisibility med opacity-indstillingerne afgoer slottet tekst under en skygge med opacity 0', () => {
  // I Chrome ser kun checkVisibility({opacityProperty}) en opacity paa en forfader i det flade trae (slots). Modellen tager
  // det som givet: elementet ser synligt ud ad forfaderkaeden, men checkVisibility med opacity-indstillingen siger nej.
  const v = side((b, El) => { const p = new El('p').add('Gemt'); p.checkVisibility = (o) => !(o && (o.opacityProperty || o.checkOpacity)); b.add(p); });
  assert.equal(v(null, 'Gemt').synlig, false);
});

test('R175 (Astra): en lukket <select> bidrager paa sin egen plads - «Sa<select>…</select>ved» er ikke «Saved»', () => {
  const v = side((b, El) => b.add(new El('p').add('Sa', new El('select', { rect: [30, 10, 80, 20] }).add(
    new El('option', { rect: [0, 0, 0, 0], selected: true, attrs: { label: 'X' } }).add('X')), 'ved')));
  assert.equal(v(null, 'Saved').synlig, false);
  assert.equal(v(null, 'X').synlig, true, 'etiketten staar i feltet');
});

test('R175: en lukket <select>s tekst smelter ikke sammen med naboteksten («Sa[ve]d» er ikke «Saved»)', () => {
  const v = side((b, El) => b.add(new El('p').add('Sa', new El('select', { rect: [30, 10, 80, 20] }).add(
    new El('option', { rect: [0, 0, 0, 0], selected: true }).add('ve')), 'd')));
  assert.equal(v(null, 'Saved').synlig, false);
  assert.equal(v(null, 've').synlig, true);
});

// ── R175 (Opus, MAALT i Chrome 155) ──────────────────────────────────────────────────────────────────
test('R175 (Opus): indhold til venstre for eller over en rullebar fast skals begyndelse er skjult', () => {
  const menu = lavSide();
  const skal = new menu.El('div', { stil: { position: 'fixed', overflowX: 'auto', overflowY: 'auto' }, rect: [0, 0, 1265, 800] });
  menu.body.add(skal.add(new menu.El('nav', { rect: [-300, 0, 300, 800] }).add('Settings')));
  assert.equal(menu.koer(KILDE, null, 'Settings').synlig, false, 'menuen skubbet ud med translateX(-100%) kan ikke rulles frem');
  const spring = lavSide();
  const skal2 = new spring.El('div', { stil: { position: 'fixed', overflowY: 'auto' }, rect: [0, 0, 1265, 800] });
  spring.body.add(skal2.add(new spring.El('a', { rect: [-9999, 10, 120, 20] }).add('Til indhold')));
  assert.equal(spring.koer(KILDE, null, 'Til indhold').synlig, false);
  const nede = lavSide();
  const skal3 = new nede.El('div', { stil: { position: 'fixed', overflowY: 'auto' }, rect: [0, 0, 1265, 800] });
  nede.body.add(skal3.add(new nede.El('p', { rect: [10, 2000, 100, 20] }).add('Nede')));
  assert.equal(nede.koer(KILDE, null, 'Nede').synlig, true, 'under skallens bund kan man rulle til den');
});

test('R175 (Opus): i quirks-tilstand er vinduet det mindste af innerHeight og documentElement.clientHeight', () => {
  const s = lavSide();
  s.document.documentElement = { clientWidth: 1265, clientHeight: 4333 };   // quirks: hele dokumentets hoejde
  s.body.add(new s.El('div', { stil: { position: 'fixed' }, rect: [10, 1000, 200, 40] }).add('Bundark'));
  assert.equal(s.koer(KILDE, null, 'Bundark').synlig, false, 'et fast ark under vinduet (800) er ikke synligt');
});

// ── R176 (Astra, MAALT i modellen) ───────────────────────────────────────────────────────────────────
test('R176: en <option label> som soegerod (option:text(...)) viser sin label, ikke sin tekst', () => {
  const v = side((b, El) => b.add(new El('select', { rect: [10, 10, 200, 60], size: 2 }).add(
    new El('option', { rect: [10, 10, 200, 20], selected: true, attrs: { label: 'Pending' } }).add('Saved'))));
  assert.equal(v(null, 'Saved', 'option').synlig, false);
  assert.equal(v(null, 'Pending', 'option').synlig, true);
});

test('R176: et fast barn undslipper sin rulleforfaders boks - det er synligt i vinduet', () => {
  const s = lavSide();
  const rulle = new s.El('div', { stil: { overflowY: 'auto' }, rect: [400, 400, 300, 200] });
  s.body.add(rulle.add(new s.El('div', { stil: { position: 'fixed' }, rect: [10, 10, 200, 40] }).add('Banner')));
  assert.equal(s.koer(KILDE, null, 'Banner').synlig, true);
});

test('R176: i en rtl-rulleboks kan der rulles mod venstre - indhold til venstre er ikke afvist', () => {
  const s = lavSide();
  const rulle = new s.El('div', { stil: { overflowX: 'auto', direction: 'rtl' }, rect: [400, 10, 300, 100] });
  s.body.add(rulle.add(new s.El('p', { rect: [100, 20, 100, 20] }).add('Venstre')));
  assert.equal(s.koer(KILDE, null, 'Venstre').synlig, true);
});

// ── R176 (Opus, MAALT i Chrome 155): rullebokse med omvendt begyndelse, rullet forbi, og absolutte udbrud ─────────────────
const boks = (s, stil, rect, ekstra = {}) => new s.El('div', { stil: { overflowX: 'auto', overflowY: 'auto', ...stil }, rect, ...ekstra });

test('R176: en rullet ltr-boks - indhold rullet forbi (negative sidekoordinater) kan naas, et link paa left:-9999px kan ikke', () => {
  const s = lavSide();
  const b = boks(s, {}, [20, 20, 300, 200], { scrollTop: 600 });
  s.body.add(b.add(new s.El('p', { rect: [20, -480, 285, 18] }).add('Forbi'), new s.El('a', { rect: [-9999, 50, 100, 18] }).add('Spring')));
  assert.equal(s.koer(KILDE, null, 'Forbi').synlig, true, 'man ruller boksen op til det');
  assert.equal(s.koer(KILDE, null, 'Spring').synlig, false, 'til venstre for boksens begyndelse');
});

test('R176: rtl - en rullet boks viser sit indhold, og overloeb til venstre kan naas', () => {
  const s = lavSide();
  const b = boks(s, { direction: 'rtl' }, [20, 260, 400, 60], { scrollLeft: -500 });
  s.body.add(b.add(new s.El('span', { rect: [220, 260, 100, 40] }).add('Midt'), new s.El('span', { rect: [-780, 260, 100, 40] }).add('Venstre')));
  assert.equal(s.koer(KILDE, null, 'Midt').synlig, true);
  assert.equal(s.koer(KILDE, null, 'Venstre').synlig, true);
  const ude = lavSide();
  ude.body.add(boks(ude, { direction: 'rtl' }, [20, 260, 400, 60]).add(new ude.El('span', { rect: [500, 260, 100, 40] }).add('Hoejre')));
  assert.equal(ude.koer(KILDE, null, 'Hoejre').synlig, false, 'til hoejre for en rtl-boks begyndelse kan aldrig rulles frem');
});

test('R176: column-reverse og row-reverse - begyndelsen er nederst og til hoejre', () => {
  const s = lavSide();
  const chat = boks(s, { display: 'flex', flexDirection: 'column-reverse' }, [460, 480, 300, 200], { scrollTop: -400 });
  s.body.add(chat.add(new s.El('p', { rect: [460, 560, 285, 40] }).add('Besked'), new s.El('p', { rect: [460, -740, 285, 40] }).add('Aeldste')));
  assert.equal(s.koer(KILDE, null, 'Besked').synlig, true, 'en rullet chat viser beskeden paa skaermen');
  assert.equal(s.koer(KILDE, null, 'Aeldste').synlig, true, 'den aeldste besked kan rulles frem');
  const r = lavSide();
  r.body.add(boks(r, { display: 'flex', flexDirection: 'row-reverse' }, [800, 260, 300, 60], { scrollLeft: -500 })
    .add(new r.El('span', { rect: [900, 260, 100, 40] }).add('Raekke')));
  assert.equal(r.koer(KILDE, null, 'Raekke').synlig, true);
});

test('R176: vertical-rl - begyndelsen er til hoejre; indhold til venstre kan rulles frem', () => {
  const s = lavSide();
  s.body.add(boks(s, { writingMode: 'vertical-rl' }, [800, 340, 200, 120]).add(new s.El('p', { rect: [400, 340, 30, 105] }).add('Sidste')));
  assert.equal(s.koer(KILDE, null, 'Sidste').synlig, true);
});

test('R176: et absolut element slipper ud af en rulleboks, der ikke er dets indeholdende blok', () => {
  const s = lavSide();
  const tabel = boks(s, { overflowY: 'visible' }, [300, 900, 600, 60]);
  s.body.add(tabel.add(new s.El('span', { stil: { position: 'absolute' }, offsetParent: s.body, rect: [1040, 150, 200, 18] }).add('Udbrud')));
  assert.equal(s.koer(KILDE, null, 'Udbrud').synlig, true);
  const inde = lavSide();
  const pos = boks(inde, { position: 'relative', overflowX: 'hidden', overflowY: 'hidden' }, [300, 100, 300, 100]);
  inde.body.add(pos.add(new inde.El('span', { stil: { position: 'absolute' }, offsetParent: pos, rect: [700, 120, 100, 18] }).add('Skaaret')));
  assert.equal(inde.koer(KILDE, null, 'Skaaret').synlig, false, 'er rulleboksen den indeholdende blok, skaerer den');
});

test('R176: et fast element over en rulleboks laengere nede, eller til venstre for den, er synligt', () => {
  const s = lavSide();
  const main = boks(s, {}, [0, 600, 1265, 3000]);
  s.body.add(main.add(new s.El('div', { stil: { position: 'fixed' }, rect: [1040, 16, 200, 30] }).add('Toast')));
  assert.equal(s.koer(KILDE, null, 'Toast').synlig, true, 'rullebokse over et fast element afgoer ikke dets plads');
  const v = lavSide();
  const app = boks(v, {}, [300, 0, 965, 800]);
  v.body.add(app.add(new v.El('div', { stil: { position: 'fixed' }, rect: [16, 600, 200, 30] }).add('Hjaelp')));
  assert.equal(v.koer(KILDE, null, 'Hjaelp').synlig, true);
});

test('R176: paa en vandret rullet rtl-side er indhold paa skaermen synligt', () => {
  const s = lavSide();
  s.document.documentElement = { clientWidth: 1265, clientHeight: 800, stil: { direction: 'rtl' } };
  s.vindue.scrollX = -1000;
  s.body.add(new s.El('p', { rect: [765, 100, 200, 18] }).add('Paa skaermen'));
  assert.equal(s.koer(KILDE, null, 'Paa skaermen').synlig, true);
});

test('R176: i quirks-tilstand med vandret rullebjaelke giver scrollingElement vinduets hoejde', () => {
  const s = lavSide();
  s.document.documentElement = { clientWidth: 1265, clientHeight: 4333 };
  s.document.scrollingElement = { clientWidth: 1265, clientHeight: 698 };
  s.vindue.innerHeight = 713;
  s.body.add(new s.El('div', { stil: { position: 'fixed' }, rect: [0, 698, 1265, 40] }).add('Bundark'));
  assert.equal(s.koer(KILDE, null, 'Bundark').synlig, false, 'arket ligger under rullebjaelken, uden for fladen');
});

test('R176 (Opus M5-9): i en aaben liste viser en option med label sin label - ogsaa uden tag', () => {
  const v = side((b, El) => b.add(new El('select', { rect: [10, 10, 200, 60], multiple: true }).add(
    new El('option', { rect: [10, 10, 200, 20], attrs: { label: 'Pending' } }).add('Saved'),
    new El('option', { rect: [10, 30, 200, 20] }).add('Andet'))));
  assert.equal(v(null, 'Saved').synlig, false);
  assert.equal(v(null, 'Pending').synlig, true);
  assert.equal(v(null, 'Andet').synlig, true, 'en option uden label viser sin tekst');
});

test('R176: urullede reverse-bokse - indhold paa begyndelsens side kan rulles frem', () => {
  const r = lavSide();
  r.body.add(boks(r, { display: 'flex', flexDirection: 'row-reverse' }, [800, 260, 300, 60])
    .add(new r.El('span', { rect: [500, 260, 100, 40] }).add('Til venstre')));
  assert.equal(r.koer(KILDE, null, 'Til venstre').synlig, true, 'row-reverse loeber over mod venstre');
  const c = lavSide();
  c.body.add(boks(c, { display: 'flex', flexDirection: 'column-reverse' }, [460, 480, 300, 200])
    .add(new c.El('p', { rect: [460, 300, 285, 40] }).add('Over')));
  assert.equal(c.koer(KILDE, null, 'Over').synlig, true, 'column-reverse loeber over opad');
});

test('R176: en negativ rulning afgoer begyndelsen, ogsaa hvor stilen ikke siger det', () => {
  // Lodret skrift med flex column-reverse begynder til hoejre, og med direction:rtl nederst (Chrome melder negativ rulning).
  const x = lavSide();
  x.body.add(boks(x, { writingMode: 'vertical-lr', display: 'flex', flexDirection: 'column-reverse' }, [300, 100, 600, 200], { scrollLeft: -500 })
    .add(new x.El('p', { rect: [400, 100, 100, 180] }).add('Vandret')));
  assert.equal(x.koer(KILDE, null, 'Vandret').synlig, true);
  const y = lavSide();
  y.body.add(boks(y, { writingMode: 'vertical-lr', direction: 'rtl' }, [300, 100, 200, 600], { scrollTop: -400 })
    .add(new y.El('p', { rect: [300, 200, 180, 100] }).add('Lodret')));
  assert.equal(y.koer(KILDE, null, 'Lodret').synlig, true);
});

test('R176 (Opus M9-4): vandret rullet ltr-boks - indhold rullet forbi til venstre kan naas', () => {
  const s = lavSide();
  s.body.add(boks(s, {}, [20, 20, 300, 200], { scrollLeft: 600 }).add(new s.El('span', { rect: [-200, 50, 100, 18] }).add('Forbi')));
  assert.equal(s.koer(KILDE, null, 'Forbi').synlig, true);
});

test('R176: indlejrede rullebokse - den yderste boks afgoer sidens begyndelse', () => {
  const s = lavSide();
  const ydre = boks(s, {}, [20, 20, 300, 200], { scrollTop: 700 });
  const indre = boks(s, {}, [20, -500, 300, 200]);
  s.body.add(ydre.add(indre.add(new s.El('p', { rect: [20, -480, 285, 18] }).add('Dybt'))));
  assert.equal(s.koer(KILDE, null, 'Dybt').synlig, true, 'man ruller den ydre boks op til den indre');
});

// ── R177 (Astra, MAALT i modellen): indlejrede rullebokse ───────────────────────────────────────────
test('R177: tekst i en rullet indre rulleboks kan naas - den ydre boks maaler den indre boks, ikke teksten', () => {
  const s = lavSide();
  const ydre = boks(s, {}, [20, 100, 300, 400]);
  const indre = boks(s, {}, [20, 110, 300, 200], { scrollTop: 500 });
  s.body.add(ydre.add(indre.add(new s.El('p', { rect: [20, -390, 285, 18] }).add('Indre'))));
  assert.equal(s.koer(KILDE, null, 'Indre').synlig, true);
  const k = lavSide();
  const klip = new k.El('div', { stil: { overflowX: 'hidden', overflowY: 'hidden' }, rect: [0, 0, 400, 300] });
  k.body.add(klip.add(boks(k, {}, [10, 10, 300, 200], { scrollTop: 600 }).add(new k.El('p', { rect: [10, -500, 285, 18] }).add('Klippet'))));
  assert.equal(k.koer(KILDE, null, 'Klippet').synlig, true, 'en afskaerende forfader maaler ogsaa den indre boks');
});

test('R177: en indre rulleboks foer den ydre boks begyndelse kan ikke naas', () => {
  const s = lavSide();
  const ydre = boks(s, {}, [20, 100, 300, 400]);
  const indre = boks(s, {}, [-9999, 110, 300, 200]);
  s.body.add(ydre.add(indre.add(new s.El('p', { rect: [-9999, 120, 285, 18] }).add('Udenfor'))));
  assert.equal(s.koer(KILDE, null, 'Udenfor').synlig, false);
});

test('R177: en boks, der skaerer vandret og ruller lodret, skaerer stadig sit eget indhold vandret', () => {
  const s = lavSide();
  s.body.add(boks(s, { overflowX: 'hidden' }, [100, 100, 300, 200]).add(new s.El('span', { rect: [600, 150, 100, 18] }).add('Vandret')));
  assert.equal(s.koer(KILDE, null, 'Vandret').synlig, false);
});

test('R177 (Astra, MAALT i Chrome): et fixed element under en transform-forfader slipper ud af en statisk rulleboks', () => {
  const s = lavSide();
  const transform = new s.El('div', { stil: { transform: 'translateZ(0)' }, rect: [0, 0, 780, 400] });
  const rulle = boks(s, {}, [100, 200, 400, 100]);
  s.body.add(transform.add(rulle.add(new s.El('div', { stil: { position: 'fixed' }, offsetParent: transform, rect: [21, 21, 180, 30] }).add('Fast'))));
  assert.equal(s.koer(KILDE, null, 'Fast').synlig, true);
});

test('R177: et relativt eller sticky element ruller med sin boks - det slipper ikke ud', () => {
  for (const position of ['relative', 'sticky']) {
    const s = lavSide();
    // Til venstre for boksens begyndelse, men inde paa siden - kun boksens regel kan afvise det.
    s.body.add(boks(s, {}, [400, 20, 300, 200]).add(new s.El('a', { stil: { position }, offsetParent: s.body, rect: [100, 50, 100, 18] }).add('Spring')));
    assert.equal(s.koer(KILDE, null, 'Spring').synlig, false, position);
  }
});

test('R177 (Opus D3): rtl med row-reverse begynder til venstre - overloeb til hoejre kan naas', () => {
  const s = lavSide();
  s.body.add(boks(s, { direction: 'rtl', display: 'flex', flexDirection: 'row-reverse' }, [100, 260, 300, 60])
    .add(new s.El('span', { rect: [600, 260, 100, 40] }).add('Hoejre')));
  assert.equal(s.koer(KILDE, null, 'Hoejre').synlig, true);
});

// ── R178 (Astra, MAALT i modellen): kun de akser, en indre boks kan rulles paa ─────────────────────────
test('R178: en ydre boks, der klipper paa den akse, den indre ikke ruller paa, klipper stadig teksten', () => {
  const v = lavSide();
  const ydreV = new v.El('div', { stil: { overflowX: 'hidden', overflowY: 'hidden' }, rect: [20, 20, 200, 300] });
  v.body.add(ydreV.add(boks(v, { overflowX: 'hidden' }, [20, 20, 400, 200]).add(new v.El('span', { rect: [320, 50, 70, 18] }).add('Vandret'))));
  assert.equal(v.koer(KILDE, null, 'Vandret').synlig, false, 'lodret rulning flytter ikke teksten vandret');
  const l = lavSide();
  const ydreL = new l.El('div', { stil: { overflowX: 'hidden', overflowY: 'hidden' }, rect: [20, 20, 400, 100] });
  l.body.add(ydreL.add(boks(l, { overflowY: 'hidden' }, [20, 20, 300, 300]).add(new l.El('span', { rect: [40, 200, 70, 18] }).add('Lodret'))));
  assert.equal(l.koer(KILDE, null, 'Lodret').synlig, false, 'vandret rulning flytter ikke teksten lodret');
});

test('R178 (Astra): en vandret rullet indre boks i en afskaerende forfader - teksten kan rulles frem', () => {
  const s = lavSide();
  const klip = new s.El('div', { stil: { overflowX: 'hidden', overflowY: 'hidden' }, rect: [0, 0, 400, 300] });
  s.body.add(klip.add(boks(s, { overflowY: 'hidden' }, [10, 10, 300, 200], { scrollLeft: 600 }).add(new s.El('span', { rect: [-400, 50, 100, 18] }).add('Rullet'))));
  assert.equal(s.koer(KILDE, null, 'Rullet').synlig, true);
});
