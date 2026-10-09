/**
 * Maalets identitet helt ind i haendelsen (1.30.2, R64).
 *
 * MAALT af Astra i model (R64): et overlay, der kom frem MELLEM opslaget og afsendelsen, fik haendelserne, og click,
 * double_click, right_click og hover svarede ok:true. Klikket genfandt sit maal ud fra koordinaten, og de tre andre talte
 * haendelser i hele fanen. Nu armeres en vagt i siden (armerMaalVagt), der afgoer ved den foerste haendelse i vores punkt,
 * om den rammer maalet eller dets egen ramme/label - og ellers stopper hele sekvensen.
 *
 * Modellen herunder koerer den aegte resolver, dispatch, vagt og efterkontrol mod klik-dom-siden. Haendelserne har
 * koordinater, fangstfasen paa window kommer foerst, og stopImmediatePropagation stopper resten, som i en browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { lavKlikDom } from './hjaelp/klik-dom.mjs';

function browser(d, { foerArm, efterArm } = {}) {
  const lyttere = { window: new Map(), document: new Map() };
  const tilfoej = (m) => (n, f) => { if (!m.has(n)) m.set(n, []); m.get(n).push(f); };
  const fjern = (m) => (n, f) => { const l = m.get(n) || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  const window = { innerWidth: 1200, innerHeight: 800, addEventListener: tilfoej(lyttere.window), removeEventListener: fjern(lyttere.window) };
  d.document.addEventListener = tilfoej(lyttere.document);
  d.document.removeEventListener = fjern(lyttere.document);
  // Elementerne i klik-dom ved ikke, om de er i dokumentet; her er alle det (vagten kraever et tilsluttet maal).
  Object.defineProperty(Object.getPrototypeOf(d.body), 'isConnected', { get() { return true; }, configurable: true });
  const side = [];   // de haendelser, sidens egne lyttere fik: "type:id"
  const ctx = vm.createContext({ document: d.document, window, getComputedStyle: (e) => e.stil, location: { href: 'https://x.example/' },
    setTimeout, clearTimeout });
  const fyr = (type, x, y) => {
    const el = d.document.elementFromPoint(x, y);
    const vej = [];
    for (let n = el; n; n = n.parentNode || n.host) vej.push(n);
    vej.push(d.document, window);
    const ev = { type, target: el, isTrusted: true, clientX: x, clientY: y, composedPath: () => vej, stoppet: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stoppet = true; }, stopPropagation() { this.stoppet = true; } };
    for (const f of [...(lyttere.window.get(type) || []), ...(lyttere.document.get(type) || [])]) { f(ev); if (ev.stoppet) return; }
    side.push(type + ':' + (el?.id || el?.tagName));
  };
  const klon = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const fane = { id: 1, url: 'https://x.example/', windowId: 1, active: true };
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': fane, 'tabs.query': [fane],
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'scripting.executeScript': (o) => [{ frameId: 0, result: klon(vm.runInContext('(' + o.func.toString() + ')', ctx)(...(o.args || []))) }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Runtime.evaluate') {
        const arm = p.expression.includes('window.__bmcpVagt = v');
        if (arm) foerArm?.(d, fyr);
        const v = vm.runInContext(p.expression, ctx);
        if (arm) efterArm?.(d, fyr);
        return { result: { value: klon(v) } };
      }
      if (metode === 'Input.dispatchMouseEvent') {
        const { type, x, y, button, clickCount } = p;
        if (type === 'mouseMoved') for (const t of ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove']) fyr(t, x, y);
        if (type === 'mousePressed') for (const t of ['pointerdown', 'mousedown']) fyr(t, x, y);
        if (type === 'mouseReleased') {
          for (const t of ['pointerup', 'mouseup']) fyr(t, x, y);
          if (button === 'right') fyr('contextmenu', x, y);
          else { fyr('click', x, y); if (clickCount === 2) fyr('dblclick', x, y); }
        }
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1 });
  return { side, koer: (metode, p) => u.hent('dispatch')(9876, metode, p), u };
}

function knapside() {
  const d = lavKlikDom();
  d.el('button', { id: 'gem', tekst: 'Gem', rect: [20, 20, 200, 40] });
  return d;
}
const overlay = (d) => d.el('button', { id: 'fremmed', tekst: 'Slet alt', rect: [0, 0, 1200, 800], lag: 20 });
const VAERKTOEJER = [['click', 'click'], ['double_click', 'dblclick'], ['right_click', 'contextmenu'], ['hover', 'mouseover']];

for (const [vaerktoej, haendelse] of VAERKTOEJER) {
  test(`${vaerktoej}: et overlay, der kommer frem efter opslaget, faar intet, og svaret er covered`, async () => {
    const d = knapside();
    const b = browser(d, { efterArm: overlay });
    const svar = await b.koer(vaerktoej, { selector: '#gem', duration: 1 });
    assert.equal(svar.ok, false, JSON.stringify(svar));
    assert.equal(svar.error, 'covered');
    assert.equal(svar.covered_by?.id, 'fremmed');
    assert.match(svar.note, /The mouse events were sent, but stopped at the window before they reached any element of the page/);
    assert.deepEqual(b.side.filter((h) => /:fremmed$/.test(h) && !/over|enter|move/.test(h)), [],
      `overlayet fik ${haendelse} eller et tryk: ${b.side}`);
    assert.ok(!b.side.includes(haendelse + ':gem'));
  });

  test(`${vaerktoej}: uden overlay naar haendelsen maalet, og svaret er ok`, async () => {
    const b = browser(knapside());
    const svar = await b.koer(vaerktoej, { selector: '#gem', duration: 1 });
    assert.equal(svar.ok, true, JSON.stringify(svar));
    assert.equal(svar.landed, true);
    assert.ok(b.side.includes(haendelse + ':gem'), String(b.side));
  });

  test(`${vaerktoej}: et overlay, der ligger der allerede, naar vagten armeres - intet sendes`, async () => {
    const d = knapside();
    const b = browser(d, { foerArm: overlay });
    const svar = await b.koer(vaerktoej, { selector: '#gem', duration: 1 });
    assert.equal(svar.error, 'covered', JSON.stringify(svar));
    assert.match(svar.note, /Nothing was done\./);
    assert.deepEqual(b.side, []);
  });

  test(`${vaerktoej}: en rigtig mus et andet sted i fanen hverken afgoer eller taeller`, async () => {
    const d = knapside();
    d.el('div', { id: 'andet', rect: [800, 600, 200, 100] });
    const b = browser(d, { efterArm: (_d, fyr) => { fyr('mousemove', 900, 650); fyr('click', 900, 650); } });
    const svar = await b.koer(vaerktoej, { selector: '#gem', duration: 1 });
    assert.equal(svar.ok, true, JSON.stringify(svar));
    assert.ok(b.side.includes('click:andet'), 'brugerens eget klik andetsteds blev stoppet');
  });
}

test('click: en label over sin afkrydsning er stadig maalets egen - klikket godtages', async () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'samtykke', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  const l = d.label(boks, { rect: [20, 20, 300, 20], lag: 1 });
  d.el('span', { id: 'tekst', tekst: 'Jeg accepterer', rect: [20, 20, 100, 20], lag: 1 }, l);
  const b = browser(d);
  const svar = await b.koer('click', { selector: '#samtykke' });
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(svar.landed, true);
});

test('click med tekst-selektor: overlayet efter opslaget faar intet', async () => {
  const d = knapside();
  const b = browser(d, { efterArm: overlay });
  const svar = await b.koer('click', { selector: 'text=Gem' });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.ok(!b.side.includes('click:fremmed'));
});

test('fill med tekst-selektor skriver intet, naar vagten stoppede klikket', async () => {
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': { id: 1, url: 'https://x.example/', windowId: 1, active: true }, 'tabs.query': [],
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }], 'debugger.sendCommand': () => ({}),
  } });
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1 });
  u.ctx.resolveElement = async () => ({ x: 60, y: 35, tag: 'INPUT', text: 'E-mail', found: true });
  u.ctx.debuggerClick = async () => ({ landed: false, fallbackFired: false, blokeret: { tag: 'INPUT', id: 'nyhed', text: '' } });
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: 'text=E-mail', value: 'x' });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.equal(svar.covered_by.id, 'nyhed');
  assert.equal(u.optager.til('debugger.sendCommand').filter((k) => k.args[1] === 'Input.dispatchKeyEvent').length, 0, 'der blev skrevet');
});
