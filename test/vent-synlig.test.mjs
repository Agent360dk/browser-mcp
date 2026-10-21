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
  class Tekst { constructor(data) { this.data = data; this.nodeType = 3; this.nodeName = '#text'; this.parentNode = null; } }
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
    }
    add(...boern) {
      for (const c of boern) { const n = typeof c === 'string' ? new Tekst(c) : c; n.parentNode = this; this.kids.push(n); }
      return this;
    }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get textContent() { return this.kids.map((k) => (k.nodeType === 3 ? k.data : k.textContent)).join(''); }
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
      const [x, y, width, height] = this.vist() ? this.r : [0, 0, 0, 0];
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
  const koer = (kilde, sel, tekst, tag = null) => new Function('document', 'window', 'getComputedStyle', 'NodeFilter',
    `return (${kilde})(${JSON.stringify(sel)}, ${JSON.stringify(tekst)}, ${JSON.stringify(tag)});`)(
    document, { scrollX: 0, scrollY: 0 }, getComputedStyle, { SHOW_TEXT: 4 });
  return { El, body, koer };
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
