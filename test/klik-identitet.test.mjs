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

function browser(d, { foerArm, efterArm, stopVed, efterHaendelse, transportFejl } = {}) {
  const lyttere = { window: new Map(), document: new Map() };
  const tilfoej = (m) => (n, f) => { if (!m.has(n)) m.set(n, []); m.get(n).push(f); };
  const fjern = (m) => (n, f) => { const l = m.get(n) || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  const window = { innerWidth: 1200, innerHeight: 800, addEventListener: tilfoej(lyttere.window), removeEventListener: fjern(lyttere.window) };
  d.document.addEventListener = tilfoej(lyttere.document);
  d.document.removeEventListener = fjern(lyttere.document);
  // Elementerne i klik-dom ved ikke, om de er i dokumentet; her er alle det (vagten kraever et tilsluttet maal).
  const proto = Object.getPrototypeOf(d.body);
  Object.defineProperty(proto, 'isConnected', { get() { for (let n = this; n; n = n.parentNode) if (n === d.document.documentElement) return true; return false; }, configurable: true });
  // Lyttere paa knuderne (R65: vagten taeller kun en haendelse, der NAAR knuden).
  proto.addEventListener = function (n, f, o) { ((this._lyt ||= {})[n] ||= []).push({ f, once: !!(o && o.once) }); };
  proto.removeEventListener = function (n, f) { const l = this._lyt?.[n] || []; const i = l.findIndex((x) => x.f === f); if (i >= 0) l.splice(i, 1); };
  const side = [];   // de haendelser, sidens egne lyttere fik: "type:id"
  const ctx = vm.createContext({ document: d.document, window, getComputedStyle: (e) => e.stil, location: { href: 'https://x.example/' },
    setTimeout, clearTimeout });
  const fyr = (type, x, y) => { fyrEn(type, x, y); efterHaendelse?.(type, d, fyr); };
  const fyrEn = (type, x, y) => {
    const el = d.document.elementFromPoint(x, y);
    const vej = [];
    for (let n = el; n; n = n.parentNode || n.host) vej.push(n);
    vej.push(d.document, window);
    const ev = { type, target: el, isTrusted: true, clientX: x, clientY: y, composedPath: () => vej, stoppet: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stoppet = true; }, stopPropagation() { this.stoppet = true; } };
    for (const f of [...(lyttere.window.get(type) || []), ...(lyttere.document.get(type) || [])]) { f(ev); if (ev.stoppet) return; }
    // En side-lytter mellem document og maalet kan stoppe haendelsen (stopVed), som en side der selv lytter i fangstfasen.
    if (stopVed && stopVed(type, el)) return;
    for (const x of [...(el?._lyt?.[type] || [])]) { x.f(ev); if (x.once) el.removeEventListener(type, x.f); }
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
        if (transportFejl && transportFejl(type)) throw new Error('CDP: transport failed');
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
  return { side, fyr, window, koer: (metode, p) => u.hent('dispatch')(9876, metode, p), u };
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

// ── R65 (Astra, maalt i model): hver haendelse doemmes, og kun det der NAAR maalet, taeller ────────────────────
const efterTryk = (laeg) => (type, d) => { if (type === 'pointerdown' && !d.document.querySelector('#fremmed')) laeg(d); };

for (const [vaerktoej, haendelse] of [['click', 'click'], ['double_click', 'dblclick'], ['right_click', 'contextmenu']]) {
  test(`${vaerktoej}: et overlay, der kommer frem EFTER trykket paa maalet, faar ikke ${haendelse}, og svaret er delvist`, async () => {
    const d = knapside();
    const b = browser(d, { efterHaendelse: efterTryk(overlay) });
    const svar = await b.koer(vaerktoej, { selector: '#gem' });
    assert.equal(svar.ok, false, JSON.stringify(svar));
    assert.equal(svar.error, 'covered');
    assert.equal(svar.landed, null);
    assert.equal(svar.maybe_landed, true);
    assert.match(svar.note, /^The first mouse events reached #gem, then BUTTON#fremmed came in front of it/);
    assert.ok(!b.side.some((h) => /^(click|dblclick|contextmenu|mouseup|pointerup):fremmed$/.test(h)), String(b.side));
  });
}

test('select_option: et overlay, der kommer frem efter trykket paa valget, faar ikke klikket', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'trig', attrs: { role: 'combobox' }, tekst: 'Land', rect: [20, 20, 200, 40] });
  d.el('div', { id: 'dk', attrs: { role: 'option' }, tekst: 'Danmark', rect: [20, 80, 200, 40] });
  let tryk = 0;
  const b = browser(d, { efterHaendelse: (type, dd) => {
    if (type === 'pointerdown' && ++tryk === 2) dd.el('button', { id: 'fremmed', tekst: 'Slet konto', rect: [20, 80, 200, 40], lag: 20 });
  } });
  const svar = await b.koer('select_option', { selector: '#trig', option: 'Danmark', wait: 1 });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.equal(svar.trigger_clicked, true);
  assert.ok(!b.side.includes('click:fremmed'), String(b.side));
});

test('et link, der dukker op i en label efter armeringen, faar ikke klikket som labelens', async () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'samtykke', attrs: { type: 'checkbox' }, rect: [40, 40, 16, 16] });
  d.label(boks, { id: 'lsam', tekst: 'Jeg accepterer alle betingelserne', rect: [40, 36, 400, 24] });
  const b = browser(d, { efterArm: (dd) => dd.el('a', { id: 'vilk', tekst: 'vilkaar', attrs: { href: '#v' }, rect: [40, 36, 400, 24], lag: 1 }, dd.document.querySelector('#lsam')) });
  const svar = await b.koer('click', { selector: '#lsam' });
  assert.equal(svar.ok, false, JSON.stringify(svar));
  assert.equal(svar.error, 'covered');
  assert.ok(!b.side.includes('click:vilk'), String(b.side));
});

test('click: en side-lytter, der stopper klikket foer maalet, giver uvist - og et brugerklik andetsteds goer det ikke til ja', async () => {
  const d = knapside();
  d.el('div', { id: 'andet', rect: [800, 600, 200, 100] });
  const b = browser(d, { stopVed: (type, el) => type === 'click' && el?.id === 'gem',
    efterHaendelse: (type, _d, fyr) => { if (type === 'click' && !b.brugerKlik) { b.brugerKlik = true; fyr('click', 900, 650); } } });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.equal(svar.ok, false, JSON.stringify(svar));
  assert.equal(svar.landed, null);
  assert.equal(svar.maybe_landed, true);
  assert.match(svar.note, /something on the way stopped it before the target/);
});

test('double_click: en side-lytter, der stopper dblclick foer maalet, giver uvist, ikke ja', async () => {
  const b = browser(knapside(), { stopVed: (type, el) => type === 'dblclick' && el?.id === 'gem' });
  const svar = await b.koer('double_click', { selector: '#gem' });
  assert.equal(svar.landed, null, JSON.stringify(svar));
  assert.equal(svar.maybe_landed, true);
});

test('en transportfejl efter armeringen efterlader ingen vagt over brugerens egne klik', async () => {
  const d = knapside();
  const b = browser(d, { transportFejl: (type) => type === 'mousePressed' });
  await assert.rejects(b.koer('double_click', { selector: '#gem' }));
  assert.equal(b.window.__bmcpVagt, null, 'vagten blev staaende');
  b.fyr('pointerdown', 120, 40); b.fyr('click', 120, 40);
  assert.ok(b.side.includes('click:gem'), 'brugerens eget klik blev stoppet');
});

test('en knap, der genopbygges paa mousedown, giver uvist - ikke ok:true', async () => {
  const d = knapside();
  const b = browser(d, { efterHaendelse: (type, dd) => {
    if (type !== 'mousedown' || dd.document.querySelector('#ny')) return;
    const gammel = dd.document.querySelector('#gem');
    dd.body.children.splice(dd.body.children.indexOf(gammel), 1); gammel.parentNode = null;
    dd.el('button', { id: 'ny', tekst: 'Gem', rect: [20, 20, 200, 40] });
  } });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.equal(svar.landed, null, JSON.stringify(svar));
  assert.equal(svar.maybe_landed, true);
  assert.match(svar.note, /The page replaced the target while the mouse was on it/);
});

test('et maal, der er vaek ved genmaalingen, er ikke fundet - det gamle punkt klikkes ikke', async () => {
  let n = 0;
  const u = indlaesUdvidelse({ svar: { 'scripting.executeScript': () => [{ result: ++n === 1 ? { x: 60, y: 300, found: true, rullet: true } : null }] } });
  assert.equal(await u.hent('resolveElement')(1, '#b6'), null);
});

test('vagtens bevis: intet set i en synlig side er uvist; i en skjult side er det nej', () => {
  const f = indlaesUdvidelse().hent('vagtBevis');
  const vb = (...a) => JSON.parse(JSON.stringify(f(...a)));
  assert.deepEqual(vb({ naaet: {}, sendt: 0, synlig: true }, ['dblclick']), { landed: null });
  assert.deepEqual(vb({ naaet: {}, sendt: 0, synlig: false }, ['dblclick']), { landed: false });
  assert.deepEqual(vb({ naaet: { dblclick: 1 }, sendt: 3, synlig: true }, ['dblclick']), { landed: true });
});

test('vagten udloeber selv i siden, ogsaa hvis ingen laeser den', async () => {
  const b = browser(knapside());
  await b.u.hent('resolveElement')(1, '#gem');
  const armet = await b.u.hent('armerMaalVagt')(1, 120, 40, ['click'], 5);
  assert.equal(armet.armet, true);
  await new Promise((r) => setTimeout(r, 40));
  b.fyr('click', 120, 40);
  assert.equal(b.window.__bmcpVagt.sendt, 0, 'vagten lyttede stadig efter sin levetid');
  assert.ok(b.side.includes('click:gem'));
});

test('CHANGELOG 1.30.2 siger, at kun en covered fundet foer trykket ikke flytter musen, og hvornaar svaret er delvist', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const cl = readFileSync(join(ROD, 'CHANGELOG.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(cl, /A covered answer found before the press moves no mouse;/);
  assert.match(cl, /stopped at the window, before any element of the page gets them \(a listener on the window itself still does\); if the first ones had already reached the target, the answer is `landed: null` with `maybe_landed: true`/);
});

test('click: efter en blokering stoppes resten, ogsaa hvis daekningen forsvinder igen', async () => {
  const d = knapside();
  let fase = 0;
  const b = browser(d, { efterHaendelse: (type, dd) => {
    if (type === 'pointerdown' && fase === 0) { fase = 1; overlay(dd); }
    else if (type === 'mousedown' && fase === 1) { fase = 2; const o = dd.document.querySelector('#fremmed'); o.stil.display = 'none'; }
  } });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.ok(!b.side.includes('click:gem'), `maalet fik klikket efter blokeringen: ${b.side}`);
});
