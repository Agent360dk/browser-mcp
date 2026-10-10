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

function browser(d, { foerArm, efterArm, stopVed, efterHaendelse, transportFejl, aktiveringUdenKoordinater } = {}) {
  const lyttere = { window: new Map(), document: new Map() };
  const tilfoej = (m) => (n, f) => { if (!m.has(n)) m.set(n, []); m.get(n).push(f); };
  const fjern = (m) => (n, f) => { const l = m.get(n) || []; const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };
  const window = { innerWidth: 1200, innerHeight: 800, addEventListener: tilfoej(lyttere.window), removeEventListener: fjern(lyttere.window) };
  d.document.addEventListener = tilfoej(lyttere.document);
  d.document.removeEventListener = fjern(lyttere.document);
  // Elementerne i klik-dom ved ikke, om de er i dokumentet; her er alle det (vagten kraever et tilsluttet maal).
  const proto = Object.getPrototypeOf(d.body);
  // Som i en browser: en knude i en tilsluttet vaerts shadow root er ogsaa tilsluttet (R71).
  Object.defineProperty(proto, 'isConnected', { get() { for (let n = this; n; n = n.parentNode || n.host) if (n === d.document.documentElement) return true; return false; }, configurable: true });
  // Lyttere paa knuderne (R65: vagten taeller kun en haendelse, der NAAR knuden).
  proto.addEventListener = function (n, f, o) { ((this._lyt ||= {})[n] ||= []).push({ f, once: !!(o && o.once) }); };
  proto.removeEventListener = function (n, f) { const l = this._lyt?.[n] || []; const i = l.findIndex((x) => x.f === f); if (i >= 0) l.splice(i, 1); };
  const side = [];   // de haendelser, sidens egne lyttere fik: "type:id"
  // Som i en browser: URL, TextEncoder og TextDecoder findes i siden (linkreglen oploeser adresser med dem, R70).
  const ctx = vm.createContext({ document: d.document, window, getComputedStyle: (e) => e.stil, location: { href: 'https://x.example/' },
    setTimeout, clearTimeout, URL, TextEncoder, TextDecoder });
  const fyr = (type, x, y) => { fyrEn(type, x, y); efterHaendelse?.(type, d, fyr); };
  const fyrEn = (type, x, y, paa = null) => {
    const el = paa || d.document.elementFromPoint(x, y);
    // Som Chrome: en haendelse i en iframe gaar til rammens eget dokument; siden udenom (og vagten) ser den ikke.
    if (el?.tagName === 'IFRAME') { side.push(type + ':' + el.id + '(inde)'); return; }
    const vej = [];
    for (let n = el; n; n = n.assignedSlot || n.parentNode || n.host) vej.push(n);   // den flade kaede, som i en browser (R71)
    vej.push(d.document, window);
    const ev = { type, target: el, isTrusted: true, clientX: x, clientY: y, composedPath: () => vej, stoppet: false,
      preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stoppet = true; }, stopPropagation() { this.stoppet = true; } };
    for (const f of [...(lyttere.window.get(type) || []), ...(lyttere.document.get(type) || [])]) { f(ev); if (ev.stoppet) return; }
    // En side-lytter mellem document og maalet kan stoppe haendelsen (stopVed), som en side der selv lytter i fangstfasen.
    if (stopVed && stopVed(type, el)) return;
    for (const x of [...(el?._lyt?.[type] || [])]) { x.f(ev); if (x.once) el.removeEventListener(type, x.f); }
    side.push(type + ':' + (el?.id || el?.tagName));
    // Labelens aktivering (HTML): et klik i en label, der ikke rammer interaktivt indhold, sender et klik til dens felt -
    // medmindre klikket blev annulleret.
    if (type === 'click' && !ev.defaultPrevented && el?.closest) {
      const l = el.closest('label');
      const interaktiv = el.closest('a[href],button,input,select,textarea');
      if (l && l.control && l.control !== el && (!interaktiv || interaktiv === l.control)) {
        // Chrome kan sende labelens aktiveringsklik med eller uden museens koordinater; begge prøves.
        if (aktiveringUdenKoordinater) fyrEn('click', 0, 0, l.control); else fyrEn('click', x, y, l.control);
      }
    }
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
        // Som Chrome: en skjult fane faar ingen musehaendelser.
        if (d.document.visibilityState === 'hidden') return {};
        if (transportFejl && transportFejl(type)) throw new Error('CDP: transport failed');
        if (type === 'mouseMoved') {
          for (const t of ['pointerover', 'pointerenter', 'pointermove', 'mouseover', 'mouseenter', 'mousemove']) fyr(t, x, y);
          // Som Chrome: pointerenter og mouseenter gaar ogsaa til hver forfader, i samme punkt (R66, Opus).
          for (let a = d.document.elementFromPoint(x, y)?.parentNode; a && a.tagName && a.tagName !== 'HTML'; a = a.parentNode) {
            for (const t of ['pointerenter', 'mouseenter']) fyrEn(t, x, y, a);
          }
        }
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
  return { side, fyr, fyrEn, window, koer: (metode, p) => u.hent('dispatch')(9876, metode, p), u };
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

test('vagtens bevis: intet set er uvist; kun en side skjult hele vejen er et nej (R65, R66)', () => {
  const f = indlaesUdvidelse().hent('vagtBevis');
  const vb = (...a) => JSON.parse(JSON.stringify(f(...a)));
  assert.deepEqual(vb({ naaet: {}, sendt: 0, skjultHele: false }, ['dblclick']), { landed: null });
  assert.deepEqual(vb({ naaet: {}, sendt: 0, skjultHele: true }, ['dblclick']), { landed: false });
  assert.deepEqual(vb({ naaet: { dblclick: 1 }, sendt: 3, skjultHele: false }, ['dblclick']), { landed: true });
  // R66 (Astra): en vagt, der er vaek ved aflaesningen, er ikke en navigation - uvist, ikke ja.
  assert.deepEqual(vb({ udskiftet: true }, ['dblclick']), { landed: null });
  // R66 (Opus): et slip, siden flyttede, goer beviset urent - hoejst uvist.
  assert.deepEqual(vb({ naaet: { dblclick: 1 }, sendt: 3, urent: true, skjultHele: false }, ['dblclick']), { landed: null });
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
  assert.match(cl, /the remaining presses and clicks are stopped at the window, before any element of the page gets them \(the element in front may still see the mouse move over it, and a release the page moves elsewhere is let through\); because a listener on the window itself still gets them, and the first ones may already have reached the target, the answer is then `landed: null` with `maybe_landed: true`\. A release that the page moves elsewhere after the press reached the target \(a menu that opens on the press, a slider that captures the pointer\) is let through, and the answer is at most `maybe_landed`/);
  assert.match(cl, /for any other target that takes clicks itself, anything clickable inside it at its center \(a link, a button, an element with a button role or an `onclick`, such as a delete button on a card\) counts as covered by that control/);
  assert.match(cl, /for a passive container \(a list item, a card that is not a button\) its own link \(an `a` with a real address, without a button role or `onclick`\) is its action, and only a button or other action inside it counts, also one around a link however many link layers lie between, also across an open shadow root and through a slot\./);
  assert.match(cl, /An element with a link role that is not an `a`, an `a` with a role other than link, and an `a` without a real address are actions, not plain links, since a script handler on them cannot be seen; no real address means none, `#`, `javascript:` \(read as the browser reads it, so a tab or line break inside does not hide it\) or a fragment whose target is not on the page, such as `#!` or `#0`, or is the link itself or something around it; the target is looked up as HTML does \(the fragment as written, then percent-decoded, then `top`\)\. The address is resolved as the browser resolves it, so a link to the same page that differs only in its fragment \(`\/orders#!`\) counts as a fragment, and a hash route with a path \(`#\/orders\/7`, `#!\/orders\/7`; not `#\/` alone\) is a real address\. A link that is only a fragment \(`#!`\) is read against the page itself, also when `<base>` points elsewhere: such links are placeholders in practice, so this is a deliberate refusal \(a real mouse would load the base page\)\. A web component's own button - a control in its own shadow root whose box \(the rectangle around it\) covers at least 90% of the component, button or link, as `ion-button` and `sl-button` draw it - is the component's action, not a control inside it, and so is an action around it that also covers 90% of the component; a smaller button inside a component \(a delete on a card component\), a smaller action around that control, or interactive content in a checkbox component's own label \(a link, a field, a video, but not the box itself\), is\. A delete link with a real address \(rails-ujs `data-method`\), with a fragment whose target is elsewhere on the page, or with `#top`, cannot be told from a plain link\./);
  assert.match(cl, /a text next to an icon button with no text of its own now clicks the row, not the button\./);
  assert.match(cl, /If the guard cannot be set up in the page, no press or click is sent and the answer says so \(1\.30\.1 clicked without it\)\./);
  assert.match(cl, /A field or other control whose center lies on a button around it is covered by that button: the click would go to the button, and whether the button changes the field cannot be told\./);
  assert.match(cl, /A text selector still picks the innermost element whose text contains it, so on a card whose delete button reads "Slet Ordre 7", `text=Ordre 7` picks that button\./);
  assert.match(cl, /`browser_select_option` goes on to the option only when the trigger's press is shown to have reached the trigger, or its click landed; otherwise, and when the trigger's click opens a dialog, no option is clicked, and the answer says so\./);
  assert.match(cl, /Hover and right-click do not click a control inside the target/);
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

test('en blokering efter afsendelsen er uvist: en lytter paa window kan have handlet (R65)', async () => {
  const d = knapside();
  const b = browser(d, { efterArm: overlay });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.equal(svar.error, 'covered');
  assert.equal(svar.landed, null);
  assert.equal(svar.maybe_landed, true);
  assert.match(svar.note, /a listener on the window itself may still have acted on them: check the state before trying again/);
});

// ── R66 (Astra, maalt i model) ─────────────────────────────────────────────
test('en syntetisk haendelse, siden sender efter at vores blev stoppet, er ikke bevis', async () => {
  for (const [vaerktoej, type] of [['click', 'click'], ['double_click', 'dblclick'], ['right_click', 'contextmenu']]) {
    const d = knapside();
    const b = browser(d, { stopVed: (t, el) => t === type && el?.id === 'gem',
      efterHaendelse: (t, dd) => { if (t !== type) return; const g = dd.document.querySelector('#gem');
        for (const x of [...(g._lyt?.[type] || [])]) x.f({ type, target: g, isTrusted: false }); } });
    const svar = await b.koer(vaerktoej, { selector: '#gem' });
    assert.equal(svar.landed, null, `${vaerktoej}: ${JSON.stringify(svar)}`);
  }
});

test('en vagt, siden fjerner undervejs, giver uvist og ingen reserve - ikke ja', async () => {
  for (const vaerktoej of ['click', 'double_click', 'hover']) {
    const d = knapside();
    const b = browser(d, { efterArm: () => { setTimeout(() => { b.window.__bmcpVagt = null; }, 0); } });
    b.window.__bmcpVagt = undefined;
    const svar = await b.koer(vaerktoej, { selector: '#gem', duration: 5 });
    assert.notEqual(svar.landed, true, `${vaerktoej}: ${JSON.stringify(svar)}`);
  }
});

test('et klik paa et felts label, der annullerer aktiveringen, er ikke bevis for feltet', async () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  const l = d.label(boks, { id: 'l', tekst: 'Accepter', rect: [20, 20, 300, 20], lag: 1 });
  const b = browser(d);
  l.addEventListener('click', (ev) => ev.preventDefault());
  const svar = await b.koer('click', { selector: '#c' });
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
  assert.ok(!b.side.includes('click:c'), 'feltet fik et klik');
  // Uden annullering aktiverer labelen feltet, og klikket er bevist.
  const d2 = lavKlikDom();
  const boks2 = d2.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  d2.label(boks2, { id: 'l', tekst: 'Accepter', rect: [20, 20, 300, 20], lag: 1 });
  const svar2 = await browser(d2).koer('click', { selector: '#c' });
  assert.equal(svar2.landed, true, JSON.stringify(svar2));
});

test('efter en blokering stoppes en rigtig mus andre steder paa maalet ikke', async () => {
  const d = knapside();
  let n = 0;
  const b = browser(d, { efterHaendelse: (type, dd, fyr) => {
    if (type === 'pointerdown' && n === 0) { n = 1; overlay(dd); }
    else if (type === 'pointerup' && n === 1) { n = 2; dd.document.querySelector('#fremmed').stil.display = 'none'; fyr('pointerup', 30, 30); }
  } });
  await b.koer('click', { selector: '#gem' });
  assert.ok(b.side.includes('pointerup:gem'), `brugerens pointerup paa maalet blev stoppet: ${b.side}`);
});

// ── R66 (Opus, maalt i Chrome): menuer, kort, enter paa forfaedre, slip et andet sted ─────────────────────
test('hover og right_click paa en menu-li med sit eget link er ikke daekket af linket', async () => {
  for (const vaerktoej of ['hover', 'right_click']) {
    const d = lavKlikDom();
    const li = d.el('li', { id: 'menu-item-42', rect: [20, 20, 200, 40] });
    d.el('a', { id: 'lnk', tekst: 'Services', attrs: { href: '/services/' }, rect: [20, 20, 200, 40] }, li);
    const svar = await browser(d).koer(vaerktoej, { selector: '#menu-item-42', duration: 1 });
    assert.notEqual(svar.error, 'covered', `${vaerktoej}: ${JSON.stringify(svar)}`);
  }
});

test('click paa en passiv menu-li rammer dens eget link; et passivt kort med en Slet-knap er stadig daekket', async () => {
  const d = lavKlikDom();
  const li = d.el('li', { id: 'menu-item-42', rect: [20, 20, 200, 40] });
  d.el('a', { id: 'lnk', tekst: 'Services', attrs: { href: '/services/' }, rect: [20, 20, 200, 40] }, li);
  const b = browser(d);
  const svar = await b.koer('click', { selector: '#menu-item-42' });
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.ok(b.side.includes('click:lnk'));
  const d2 = lavKlikDom();
  const kort = d2.el('div', { id: 'kort', rect: [20, 20, 300, 80] });
  d2.el('button', { id: 'slet', tekst: 'Slet', rect: [120, 40, 100, 40] }, kort);
  const b2 = browser(d2);
  const svar2 = await b2.koer('click', { selector: '#kort' });
  assert.equal(svar2.error, 'covered', JSON.stringify(svar2));
  assert.ok(!b2.side.includes('click:slet'));
});

test('hover: enter-haendelser paa maalets forfaedre er ikke daekning (jQuery .hover, mouseenter paa beholderen)', async () => {
  const d = lavKlikDom();
  const boks = d.el('div', { id: 'boks', rect: [0, 0, 600, 300] });
  d.el('button', { id: 'gem', tekst: 'Gem', rect: [20, 20, 200, 40] }, boks);
  const b = browser(d);
  const svar = await b.koer('hover', { selector: '#gem', duration: 1 });
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.ok(b.side.includes('mouseenter:boks'), `beholderens mouseenter blev stoppet: ${b.side}`);
});

test('slippet efter trykket stoppes ikke, naar siden flytter det (en skyder med pointer capture haenger ikke)', async () => {
  const d = lavKlikDom();
  const spor = d.el('div', { id: 'spor', rect: [20, 20, 400, 20] });
  const greb = d.el('div', { id: 'greb', attrs: { role: 'slider' }, rect: [200, 20, 20, 20] }, spor);
  // Pointer capture: efter trykket (pointerdown + dets mousedown) gaar de naeste haendelser til sporet.
  const b = browser(d, { efterHaendelse: (type) => { if (type === 'mousedown') greb.ingenPeg = true; } });
  const svar = await b.koer('click', { selector: '#greb' });
  assert.ok(b.side.includes('pointerup:spor'), `slippet blev stoppet, og traekket haenger: ${b.side}`);
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
});

test('select_option: en dropdown, der aabner paa mousedown med en backdrop, faar sit valg (MUI-moenstret)', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'sel', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
  let aaben = false;
  const b = browser(d, { efterHaendelse: (type, dd) => {
    if (type === 'mousedown' && !aaben) {
      aaben = true;
      dd.el('div', { id: 'bd', rect: [0, 0, 1200, 800], lag: 10 });
      dd.el('li', { id: 'fi', attrs: { role: 'option' }, tekst: 'Finland', rect: [20, 70, 200, 40], lag: 20 });
    }
  } });
  const svar = await b.koer('select_option', { selector: '#sel', option: 'Finland', wait: 1 });
  assert.notEqual(svar.error, 'covered', JSON.stringify(svar));
  assert.ok(b.side.includes('click:fi'), `valget fik intet klik: ${b.side}`);
});

// ── R67 (Astra, maalt i model) ─────────────────────────────────────────────

test('select_option gaar ikke videre, naar en lytter stoppede trykket foer udloeseren', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
  d.el('li', { id: 'fi', attrs: { role: 'option' }, tekst: 'Finland', rect: [20, 300, 200, 40] });
  // Overlayet daekker kun udloeseren, saa valget kunne klikkes, hvis vaerktoejet gik videre.
  const b = browser(d, { stopVed: (type, el) => ['pointerdown', 'mousedown'].includes(type) && el?.id === 'trig',
    efterHaendelse: (type, dd) => { if (type === 'pointerdown' && !dd.document.querySelector('#fremmed')) dd.el('button', { id: 'fremmed', tekst: 'Slet', rect: [20, 20, 200, 40], lag: 20 }); } });
  const svar = await b.koer('select_option', { selector: '#trig', option: 'Finland', wait: 1 });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.ok(!b.side.includes('click:fi'), `et valg blev klikket: ${b.side}`);
});

test('select_option: naaede trykket udloeseren, men valget findes ikke, siger svaret at listen kan staa aaben', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
  const b = browser(d, { efterHaendelse: (type, dd) => { if (type === 'mousedown' && !dd.document.querySelector('#bd')) dd.el('div', { id: 'bd', rect: [0, 0, 1200, 800], lag: 10 }); } });
  const svar = await b.koer('select_option', { selector: '#trig', option: 'Finland', wait: 1 });
  assert.match(svar.error, /^Option not found: Finland/, JSON.stringify(svar));
  assert.equal(svar.trigger_clicked, true);
  assert.equal(svar.maybe_landed, true);
});

test('et brugerklik et andet sted paa maalet er ikke bevis for vaerktoejets klik', async () => {
  const d = knapside();
  const b = browser(d, { stopVed: (type, el) => type === 'click' && el?.id === 'gem' && !b.bruger,
    efterHaendelse: (type, _d, fyr) => { if (type === 'click' && !b.bruger) { b.bruger = true; fyr('click', 30, 25); } } });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
});

for (const [vaerktoej, type] of [['click', 'click'], ['double_click', 'dblclick']]) {
  test(`${vaerktoej}: et slip, siden flyttede, goer beviset urent, ogsaa naar ${type} bagefter naar maalet`, async () => {
    const d = knapside();
    const b = browser(d, { efterHaendelse: (t, dd) => {
      if (t === 'mousedown' && !dd.document.querySelector('#bd')) dd.el('div', { id: 'bd', rect: [0, 0, 1200, 800], lag: 10 });
      if (t === 'mouseup') { const bd = dd.document.querySelector('#bd'); if (bd) bd.stil.display = 'none'; }
    } });
    const svar = await b.koer(vaerktoej, { selector: '#gem' });
    assert.ok(b.side.includes(type + ':gem'), String(b.side));
    assert.notEqual(svar.landed, true, JSON.stringify(svar));
  });
}

test('en fremmed iframe, der kommer foran efter trykket, giver covered (ikke kun «stoppet undervejs»)', async () => {
  const d = knapside();
  const b = browser(d, { efterHaendelse: (type, dd) => { if (type === 'pointerdown' && !dd.document.querySelector('#annonce')) dd.el('iframe', { id: 'annonce', rect: [0, 0, 600, 300], lag: 20 }); } });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.equal(svar.covered_by?.id, 'annonce');
  assert.equal(svar.maybe_landed, true);
});

test('synligheden ved armeringen taeller: skjult hele vejen er nej, skjult foerst ved aflaesningen er uvist', async () => {
  const d = knapside();
  d.document.visibilityState = 'hidden';
  const svar = await browser(d).koer('double_click', { selector: '#gem' });
  assert.equal(svar.landed, false, JSON.stringify(svar));
  const d2 = knapside();
  d2.document.visibilityState = 'visible';
  const b2 = browser(d2, { efterArm: (dd) => { dd.document.visibilityState = 'hidden'; } });
  const svar2 = await b2.koer('double_click', { selector: '#gem' });
  assert.equal(svar2.landed, null, JSON.stringify(svar2));
});

test('genmaalingen beder ogsaa tekst- og CSP-vejen om ikke at rulle', async () => {
  let n = 0;
  const udtryk = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_m, metode, p) => { if (metode !== 'Runtime.evaluate') return {}; udtryk.push(p.expression);
      return { result: { value: ++n === 1 ? { x: 60, y: 300, found: true, rullet: true } : { x: 60, y: 160, found: true } } }; },
  } });
  await u.hent('resolveElement')(1, 'text=Vaelg');
  assert.match(udtryk[0], /, true, false, false\)$/);
  assert.match(udtryk[1], /, true, false, true\)$/);
});

test('ingen flade lover kategorisk, at maalet intet fik', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  for (const f of ['mcp-server/tools.js', 'README.md', 'mcp-server/README.md', 'content/browsermcp-docs-tools.md', 'CHANGELOG.md']) {
    const s = readFileSync(join(ROD, f), 'utf8');
    const t2 = f === 'CHANGELOG.md' ? s.slice(s.indexOf('## 1.30.2'), s.indexOf('## 1.30.1')) : s;
    assert.doesNotMatch(t2, /the target gets nothing|the target got nothing|nothing is clicked \(`covered`\)|stopped at the window before they reach any element|the rest of the events are stopped/i, f);
  }
});

// ── R67 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('en deaktiveret raekke i en liste med EN onclick: klikket paa listen er ikke bevis for raekken', async () => {
  const d = lavKlikDom();
  const liste = d.el('div', { id: 'liste', attrs: { onclick: 'vaelg(event)' }, rect: [0, 0, 600, 400] });
  d.el('div', { id: 'r3', tekst: 'Ordre 3', rect: [0, 140, 600, 70], ingenPeg: true }, liste);
  const svar = await browser(d).koer('click', { selector: '#r3' });
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
});

test('select_option: et uvist udloeserklik foelger med, naar valget ikke findes', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Menu', rect: [20, 20, 200, 40] });
  const b = browser(d, { efterHaendelse: (t, dd) => {
    if (t === 'mousedown' && !dd.document.querySelector('#m')) dd.el('div', { id: 'm', rect: [20, 20, 200, 40], lag: 10 });
    if (t === 'mouseup') { const m = dd.document.querySelector('#m'); if (m) m.stil.display = 'none'; }
  } });
  const svar = await b.koer('select_option', { selector: '#trig', option: 'Omdoeb', wait: 1 });
  assert.match(svar.error || '', /^Option not found: Omdoeb/, JSON.stringify(svar));
  assert.equal(svar.trigger_clicked, true);
  assert.equal(svar.maybe_landed, true);
});

test('en dialog, der holder siden under efterkontrollen, giver uvist med vagten - ikke ja', async () => {
  const d = knapside();
  const b = browser(d);
  const send = b.u.ctx.chrome.debugger.sendCommand;
  b.u.ctx.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Runtime.evaluate' && p.expression.includes('const foerAftryk')
    ? new Promise(() => {}) : send(m, metode, p));
  const svar = await b.koer('click', { selector: '#gem' });
  assert.equal(svar.landed, null, JSON.stringify(svar));
  assert.equal(svar.maybe_landed, true);
  assert.match(svar.note, /A dialog opened during the click/);
});

// ── R67, mutanter der overlevede ───────────────────────────────────────────
test('hover og right_click paa et klikbart kort med en knap i midten er ikke daekket af knappen (de klikker den ikke)', async () => {
  for (const vaerktoej of ['hover', 'right_click']) {
    const d = lavKlikDom();
    const kort = d.el('div', { id: 'kort', attrs: { role: 'button' }, tekst: 'Ordre 7', rect: [40, 40, 400, 80] });
    d.el('button', { id: 'slet', tekst: 'Slet', rect: [190, 60, 100, 40], lag: 1 }, kort);
    const svar = await browser(d).koer(vaerktoej, { selector: '#kort', duration: 1 });
    assert.notEqual(svar.error, 'covered', `${vaerktoej}: ${JSON.stringify(svar)}`);
  }
});

test('double_click: en fremmed iframe, der kommer foran efter det foerste klik, giver covered', async () => {
  const d = knapside();
  let n = 0;
  const b = browser(d, { efterHaendelse: (type, dd) => { if (type === 'click' && ++n === 1) dd.el('iframe', { id: 'annonce', rect: [0, 0, 600, 300], lag: 20 }); } });
  const svar = await b.koer('double_click', { selector: '#gem' });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.equal(svar.covered_by?.id, 'annonce');
});

// ── R68 (Astra, maalt i model) ─────────────────────────────────────────────
test('select_option: stoppes alle haendelser til udloeseren (uden overlay), klikkes intet valg', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
  d.el('li', { id: 'fi', attrs: { role: 'option' }, tekst: 'Finland', rect: [20, 300, 200, 40] });
  const b = browser(d, { stopVed: (_type, el) => el?.id === 'trig' });
  const svar = await b.koer('select_option', { selector: '#trig', option: 'Finland', wait: 1 });
  assert.notEqual(svar.ok, true, JSON.stringify(svar));
  assert.ok(!b.side.includes('click:fi'), `et valg blev klikket: ${b.side}`);
});

test('select_option: et udloeserklik, der landede, og et valg, der ikke findes, siger trigger_clicked', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
  const svar = await browser(d).koer('select_option', { selector: '#trig', option: 'Finland', wait: 1 });
  assert.match(svar.error || '', /^Option not found: Finland/, JSON.stringify(svar));
  assert.equal(svar.trigger_clicked, true);
});

test('et klik ved (0,0) paa et maal uden label er ikke en labelaktivering og ikke bevis', async () => {
  const d = knapside();
  const b = browser(d, { stopVed: (type, el) => type === 'click' && el?.id === 'gem' && !b.bruger,
    efterHaendelse: (type) => { if (type === 'click' && !b.bruger) { b.bruger = true; b.fyrEn('click', 0, 0, d.document.querySelector('#gem')); } } });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
});

test('en fremmed iframe, der kommer frem efter armeringen men foer klikmaalet gemmes, giver covered', async () => {
  const d = knapside();
  const b = browser(d, { efterArm: (dd) => dd.el('iframe', { id: 'annonce', rect: [0, 0, 600, 300], lag: 20 }) });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.equal(svar.covered_by?.id, 'annonce');
});

test('ingen flade lover mere, end koden goer: kategoriske loefter er vaek, og graenserne staar der', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const laes = (f) => readFileSync(join(ROD, f), 'utf8');
  const cl = laes('CHANGELOG.md'); const afsnit = cl.slice(cl.indexOf('## 1.30.2'), cl.indexOf('## 1.30.1')).replace(/\s+/g, ' ');
  for (const [f, s] of [['tools.js', laes('mcp-server/tools.js')], ['README.md', laes('README.md')], ['mcp-server/README.md', laes('mcp-server/README.md')],
    ['docs', laes('content/browsermcp-docs-tools.md')], ['CHANGELOG 1.30.2', afsnit]]) {
    assert.doesNotMatch(s, /nothing happens to the target|the target is never|nothing was done to the target|guarantees? that the target|always reaches the target|only the target ever gets|the remaining press, release and click events are stopped|the target (?:always )?(?:gets|got|receives) nothing/i, f);
  }
  assert.match(laes('content/browsermcp-docs-tools.md'), /\| `browser_click` \|[^\n]*`covered` or `maybe_landed`, never a plain yes/);
  assert.match(afsnit, /Inside a closed shadow root the guard cannot see which control gets the click\./);
  assert.match(afsnit, /A real mouse at the same point at the same time cannot be told apart from the tool's\./);
});

test('labelens aktiveringsklik uden koordinater er bevis for feltet, naar vaerktoejets klik gik til labelen (R68)', async () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  d.label(boks, { id: 'l', tekst: 'Accepter', rect: [20, 20, 300, 20], lag: 1 });
  const b = browser(d, { aktiveringUdenKoordinater: true });
  const svar = await b.koer('click', { selector: '#c' });
  assert.equal(svar.landed, true, JSON.stringify(svar));
  assert.ok(b.side.includes('click:c'), String(b.side));
});

// ── R68 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('select_option: et udloeserklik, der aabner en dialog, svarer straks uvist med trigger_clicked - ingen bar fejl', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
  const b = browser(d);
  const send = b.u.ctx.chrome.debugger.sendCommand;
  b.u.ctx.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Runtime.evaluate' && p.expression.includes('const foerAftryk')
    ? new Promise(() => {}) : send(m, metode, p));
  const start = Date.now();
  const svar = await b.koer('select_option', { selector: '#trig', option: 'Finland', wait: 1 });
  assert.match(svar.error || '', /A dialog opened when the dropdown was clicked/, JSON.stringify(svar));
  assert.equal(svar.trigger_clicked, true);
  assert.equal(svar.maybe_landed, true);
  assert.ok(Date.now() - start < 8000, 'svaret kom ikke straks');
});

test('en fremmed ramme efter et tryk, der naaede maalet, siger at trykket naaede det', async () => {
  const d = knapside();
  const b = browser(d, { efterHaendelse: (type, dd) => { if (type === 'mousedown' && !dd.document.querySelector('#annonce')) dd.el('iframe', { id: 'annonce', rect: [0, 0, 600, 300], lag: 20 }); } });
  const svar = await b.koer('click', { selector: '#gem' });
  assert.equal(svar.error, 'covered', JSON.stringify(svar));
  assert.match(svar.note, /^The press reached #gem, then IFRAME#annonce - a frame - came in front of it/);
});

test('et ikon uden pointer-events i en div med onclick: klikket naaede rammen, ikke ikonet - noten siger det', async () => {
  const d = lavKlikDom();
  const ramme = d.el('div', { id: 'ramme', attrs: { onclick: 'aabn()' }, rect: [20, 20, 200, 40] });
  d.el('span', { id: 'ikon', rect: [100, 30, 20, 20], ingenPeg: true }, ramme);
  const svar = await browser(d).koer('click', { selector: '#ikon' });
  assert.equal(svar.landed, null, JSON.stringify(svar));
  assert.match(svar.note, /The click reached an element around the target that listens for clicks itself, not the target/);
});

// ── R69 (Astra, maalt i model) ─────────────────────────────────────────────
test('select_option: forsvinder vagten, eller giver efterkontrollen intet, klikkes intet valg (R69)', async () => {
  for (const variant of ['vagt', 'tom']) {
    const d = lavKlikDom();
    d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
    d.el('li', { id: 'fi', attrs: { role: 'option' }, tekst: 'Finland', rect: [20, 300, 200, 40] });
    const b = browser(d, { stopVed: (_type, el) => el?.id === 'trig',
      efterArm: variant === 'vagt' ? () => { setTimeout(() => { b.window.__bmcpVagt = null; }, 0); } : undefined });
    if (variant === 'tom') {
      const send = b.u.ctx.chrome.debugger.sendCommand;
      b.u.ctx.chrome.debugger.sendCommand = (m, metode, p) => (metode === 'Runtime.evaluate' && p.expression.includes('const foerAftryk')
        ? { result: { value: undefined } } : send(m, metode, p));
    }
    const svar = await b.koer('select_option', { selector: '#trig', option: 'Finland', wait: 1 });
    assert.notEqual(svar.ok, true, `${variant}: ${JSON.stringify(svar)}`);
    assert.ok(!b.side.includes('click:fi'), `${variant}: et valg blev klikket: ${b.side}`);
    assert.match(svar.error || '', /^Whether the click on the dropdown reached it cannot be told, so no option was clicked\.$/, variant);
    assert.equal(svar.landed, null, `${variant}: uvist er null, ikke false`);
    assert.equal(svar.maybe_landed, true, variant);
  }
});

test('et labelklik, siden annullerede, og et klik ved (0,0) bagefter er ikke bevis for feltet (R69)', async () => {
  for (const hvor of ['label', 'window']) {
    const d = lavKlikDom();
    const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
    const l = d.label(boks, { id: 'l', tekst: 'Accepter', rect: [20, 20, 300, 20], lag: 1 });
    const annuller = (e) => e.preventDefault();
    const b = browser(d, { efterHaendelse: (type) => { if (type === 'click' && !b.bruger) { b.bruger = true; b.fyrEn('click', 0, 0, boks); } } });
    if (hvor === 'label') l.addEventListener('click', annuller); else b.window.addEventListener('click', annuller, true);
    const svar = await b.koer('click', { selector: '#c' });
    assert.notEqual(svar.landed, true, `${hvor}: ${JSON.stringify(svar)}`);
  }
});

test('et klik ved (0,0) i en senere opgave end labelklikket er ikke labelens aktivering (R69)', async () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  d.label(boks, { id: 'l', tekst: 'Accepter', rect: [20, 20, 300, 20], lag: 1 });
  // Siden stopper labelklikket (ingen aktivering); brugerens eget klik paa feltet kommer i en senere opgave.
  const b = browser(d, { stopVed: (type, el) => type === 'click' && el?.id === 'l',
    efterHaendelse: (type) => { if (type === 'click' && !b.bruger) { b.bruger = true; setTimeout(() => b.fyrEn('click', 0, 0, boks), 0); } } });
  const svar = await b.koer('click', { selector: '#c' });
  assert.ok(b.side.includes('click:c'), `brugerens klik naaede ikke feltet foer svaret: ${b.side}`);
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
});

test('et ikon uden pointer-events i en menuitemcheckbox eller menuitemradio: rammen er ikonets egen (R69)', async () => {
  for (const role of ['menuitemcheckbox', 'menuitemradio']) {
    const d = lavKlikDom();
    const ramme = d.el('div', { id: 'ramme', attrs: { role }, rect: [20, 20, 200, 40] });
    d.el('span', { id: 'ikon', rect: [100, 30, 20, 20], ingenPeg: true }, ramme);
    const svar = await browser(d).koer('click', { selector: '#ikon' });
    assert.equal(svar.landed, true, `${role}: ${JSON.stringify(svar)}`);
  }
});

test('en labelaktivering ved (0,0) taeller kun een gang: et andet klik ved (0,0) efter den er ikke bevis (R69)', async () => {
  const d = lavKlikDom();
  const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20] });
  d.label(boks, { id: 'l', tekst: 'Accepter', rect: [20, 20, 300, 20], lag: 1 });
  // Siden stopper aktiveringsklikket til feltet; et klik mere ved (0,0) i samme opgave kommer igennem.
  const b = browser(d, { aktiveringUdenKoordinater: true, stopVed: (type, el) => type === 'click' && el?.id === 'c' && !b.bruger,
    efterHaendelse: (type) => { if (type === 'click' && !b.bruger) { b.bruger = true; b.fyrEn('click', 0, 0, boks); } } });
  const svar = await b.koer('click', { selector: '#c' });
  assert.ok(b.side.includes('click:c'), `det andet klik naaede ikke feltet: ${b.side}`);
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
});

// ── R69 (Opus, maalt i Chrome) ─────────────────────────────────────────────
test('hover: en ramme eller et lag, der kommer foran efter den foerste bevaegelse, faar en note om musens bevaegelse, ikke om tryk (R69)', async () => {
  for (const [hvad, lag] of [['iframe', 'annonce'], ['div', 'linse']]) {
    const d = knapside();
    const b = browser(d, { efterHaendelse: (type, dd) => { if (type === 'pointerover' && !dd.document.querySelector('#' + lag)) dd.el(hvad, { id: lag, rect: [0, 0, 600, 300], lag: 20 }); } });
    const svar = await b.koer('hover', { selector: '#gem', duration: 1 });
    assert.equal(svar.error, 'covered', `${hvad}: ${JSON.stringify(svar)}`);
    assert.equal(svar.maybe_landed, true, hvad);
    assert.match(svar.note, hvad === 'iframe' ? /^When the mouse moved onto #gem, IFRAME#annonce - a frame - lay in front of it/ : /^The first mouse movement reached #gem, then DIV#linse came in front of it/, hvad);
    assert.doesNotMatch(svar.note, /press|click/i, hvad);
  }
});

// ── R70 (Astra, maalt i model) ─────────────────────────────────────────────
test('kan vagten ikke armeres, sendes intet: click, double_click, right_click og select_option svarer det (R70)', async () => {
  for (const [vaerktoej, p] of [['click', { selector: '#trig' }], ['double_click', { selector: '#trig' }], ['right_click', { selector: '#trig' }],
    ['select_option', { selector: '#trig', option: 'Finland', wait: 1 }]]) {
    const d = lavKlikDom();
    d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
    d.el('li', { id: 'fi', attrs: { role: 'option' }, tekst: 'Finland', rect: [20, 300, 200, 40] });
    // En lytter paa en forfader stopper trykket og klikket foer udloeseren - den gamle reservevej saa det som et klik.
    const b = browser(d, { stopVed: (_type, el) => el?.id === 'trig' });
    const send = b.u.ctx.chrome.debugger.sendCommand;
    b.u.ctx.chrome.debugger.sendCommand = (m, metode, q) => (metode === 'Runtime.evaluate' && q.expression.includes('window.__bmcpVagt = v')
      ? { result: { value: null } } : send(m, metode, q));
    const svar = await b.koer(vaerktoej, p);
    assert.equal(svar.ok, false, `${vaerktoej}: ${JSON.stringify(svar)}`);
    assert.match(svar.error || '', /^The click could not be checked in the page, so it was not sent/, vaerktoej);
    assert.ok(!b.side.some((h) => /^(pointerdown|mousedown|click|dblclick|contextmenu):/.test(h)), `${vaerktoej} sendte musen: ${b.side}`);
  }
});

test('en omsluttende label: feltets aktiveringsklik genarmerer ikke labelbeviset (R70)', async () => {
  const d = lavKlikDom();
  const l = d.el('label', { id: 'l', tekst: 'Accepter', rect: [20, 20, 300, 20] });
  const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [20, 20, 20, 20], ingenPeg: true, lag: 1 }, l);
  boks.labels.push(l); l.control = boks;
  // Siden stopper feltets foerste klik (aktiveringen); et klik mere ved (0,0) i samme opgave kommer igennem.
  const b = browser(d, { aktiveringUdenKoordinater: true, stopVed: (type, el) => type === 'click' && el?.id === 'c' && !b.bruger,
    efterHaendelse: (type) => { if (type === 'click' && !b.bruger) { b.bruger = true; b.fyrEn('click', 0, 0, boks); } } });
  const svar = await b.koer('click', { selector: '#c' });
  assert.ok(b.side.includes('click:c'), `det andet klik naaede ikke feltet: ${b.side}`);
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
});

test('tools.js: select_option-stoppet og click/double_clicks fragmentregel staar der, og intet lover det modsatte (R70)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const kilde = readFileSync(join(ROD, 'mcp-server/tools.js'), 'utf8');
  const beskrivelse = (navn) => kilde.split(`name: 'browser_${navn}'`)[1].split('inputSchema')[0];
  const sel = beskrivelse('select_option');
  assert.match(sel, /If the click on the trigger was sent, but neither its press is shown to have reached it nor its click landed, no option is clicked and the answer is ok:false with maybe_landed: true; a click that cannot be checked in the page is not sent, and the answer says so; if it opens a dialog, or the option is not found, the answer has trigger_clicked: true\./);
  assert.doesNotMatch(sel, /never clicked unless|only (?:when|if) the trigger click (?:itself )?landed/i);
  for (const navn of ['click', 'double_click']) {
    const b = beskrivelse(navn);
    assert.match(b, /its own plain link with a real address \(a hash route with a path, such as #\/orders, counts; a fragment with no target on the page does not\) does not count, nor does a web component\\'s own button that covers it\)/, navn);
    assert.doesNotMatch(b, /every fragment|any fragment link|fragment links? (?:is|are) (?:always )?allowed|hash routes? (?:is|are) not (?:a )?real address|bare #\/ is a (?:hash )?route|#\/ alone (?:is|counts)/i, navn);
  }
});

// ── R71 (Astra, maalt i model) ─────────────────────────────────────────────
test('fill med tekstvaelger: kan vagten ikke armeres, sendes intet (R71)', async () => {
  const d = lavKlikDom();
  const felt = d.el('input', { id: 'mail', attrs: { type: 'text' }, rect: [20, 60, 300, 30] });
  d.label(felt, { id: 'lm', tekst: 'E-mail', rect: [20, 20, 300, 30] });
  const b = browser(d);
  const send = b.u.ctx.chrome.debugger.sendCommand;
  b.u.ctx.chrome.debugger.sendCommand = (m, metode, q) => (metode === 'Runtime.evaluate' && q.expression.includes('window.__bmcpVagt = v')
    ? { result: { value: null } } : send(m, metode, q));
  const svar = await b.koer('fill', { selector: 'text=E-mail', value: 'x' });
  assert.equal(svar.ok, false, JSON.stringify(svar));
  assert.match(svar.error || '', /^The click could not be checked in the page, so it was not sent/);
  assert.ok(!b.side.some((h) => /^(pointerdown|mousedown|click):/.test(h)), String(b.side));
});

test('select_option: kan valgets vagt ikke armeres efter udloeserklikket, siger noten at udloeseren ER klikket (R71)', async () => {
  const d = lavKlikDom();
  d.el('div', { id: 'trig', attrs: { role: 'button' }, tekst: 'Land', rect: [20, 20, 200, 40] });
  d.el('li', { id: 'fi', attrs: { role: 'option' }, tekst: 'Finland', rect: [20, 300, 200, 40] });
  const b = browser(d);
  const send = b.u.ctx.chrome.debugger.sendCommand;
  let armeringer = 0;
  b.u.ctx.chrome.debugger.sendCommand = (m, metode, q) => (metode === 'Runtime.evaluate' && q.expression.includes('window.__bmcpVagt = v') && ++armeringer > 1
    ? { result: { value: null } } : send(m, metode, q));
  const svar = await b.koer('select_option', { selector: '#trig', option: 'Finland', wait: 1 });
  assert.equal(svar.trigger_clicked, true, JSON.stringify(svar));
  assert.match(svar.note || '', /^The dropdown was clicked, but the click on the option could not be checked in the page, so it was not sent/);
  assert.ok(b.side.includes('click:trig'), String(b.side));
  assert.ok(!b.side.includes('click:fi'), String(b.side));
});

test('click paa en knap i en shadow root, hvis punkt er dens eget slottede ikon, lander (R71)', async () => {
  const d = lavKlikDom();
  const vaert = d.el('my-button', { id: 'vaert', rect: [20, 20, 200, 40] });
  const knap = d.el('button', { id: 'gem', tekst: 'Save', rect: [20, 20, 200, 40] }, d.skygge(vaert));
  const slot = d.el('slot', { rect: [20, 20, 200, 40] }, knap);
  const ikon = d.el('span', { id: 'ikon', rect: [20, 20, 200, 40], lag: 1 }, vaert);
  ikon.assignedSlot = slot;
  const svar = await browser(d).koer('click', { selector: '#gem' });
  assert.equal(svar.landed, true, JSON.stringify(svar));
});

// ── R75 (Opus, maalt i Chrome) ─────────────────────────────────────────────
// En label med et felt som maal: kun feltets aktiveringsklik er et ja. En lytter, der annullerer labelens klik (Reacts onClick,
// addEventListener), gav landed:true med boksen tom.
test('en label med et felt som maal: et annulleret labelklik er uvist, et aktiveret er ja (R75)', async () => {
  for (const [annuller, udenKoordinater] of [[true, false], [false, false], [false, true]]) {
    const d = lavKlikDom();
    const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [400, 20, 20, 20] });
    const l = d.label(boks, { id: 'l', tekst: 'Accepter vilkaarene', rect: [20, 20, 300, 20] });
    const b = browser(d, { aktiveringUdenKoordinater: udenKoordinater });
    if (annuller) l.addEventListener('click', (ev) => ev.preventDefault());   // efter browser(): den saetter lytterne paa knuderne
    const svar = await b.koer('click', { selector: '#l' });
    if (annuller) {
      assert.notEqual(svar.landed, true, JSON.stringify(svar));
      assert.equal(svar.maybe_landed, true, JSON.stringify(svar));
      assert.ok(!b.side.includes('click:c'), 'feltet fik intet klik');
    } else {
      assert.equal(svar.landed, true, JSON.stringify({ udenKoordinater, svar }));
      assert.ok(b.side.includes('click:c'), String(b.side));
    }
  }
});

test('CHANGELOG siger, at feltets egen boks ikke er daekning, og at kun feltets aktiveringsklik er et ja for en label (R75)', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const cl = readFileSync(join(ROD, 'CHANGELOG.md'), 'utf8').replace(/\s+/g, ' ');
  assert.match(cl, /anything inside the label's field is the field's own, and so is an element around it that is not itself an action \(or is a box with a checkbox, switch or radio role\), and a box with such a role right next to the label's field when the field itself is hidden \(a 1x1 or non-displayed stand-in input, as Base UI and sr-only patterns draw it\); next to a visible field, or further from a hidden one, such a box is another control\. With a label that has a field as the target, only the field's own activation click, counted when it reaches the field, counts as proof: a click on the label that a page listener cancels, or an activation stopped on the way, is `maybe_landed`, not a yes;/);
});

test('feltets egen boks med role=checkbox i labelen (Element UI, Base UI) er ikke daekning, og aktiveringen er ja (R75)', async () => {
  for (const inputIBoksen of [true, false]) {
    const d = lavKlikDom();
    const l = d.el('label', { id: 'l', rect: [20, 20, 300, 30] });
    const boks = d.el('span', { id: 'boks', attrs: { role: 'checkbox' }, rect: [20, 20, 300, 30], lag: 1 }, l);
    const felt = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [0, 0, 1, 1] }, inputIBoksen ? boks : l);
    felt.labels.push(l); l.control = felt;
    const b = browser(d);
    const svar = await b.koer('click', { selector: '#l' });
    assert.equal(svar.covered_by, undefined, JSON.stringify(svar));
    assert.equal(svar.landed, true, JSON.stringify({ inputIBoksen, svar }));
  }
});

test('en label med et felt: double_click med et annulleret labelklik er uvist; right_click paa labelen er ja (R76)', async () => {
  const lav = (annuller) => {
    const d = lavKlikDom();
    const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [400, 20, 20, 20] });
    const l = d.label(boks, { id: 'l', tekst: 'Accepter vilkaarene', rect: [20, 20, 300, 20] });
    const b = browser(d);
    if (annuller) l.addEventListener('click', (ev) => ev.preventDefault());
    return b;
  };
  const dbl = await lav(true).koer('double_click', { selector: '#l' });
  assert.notEqual(dbl.landed, true, JSON.stringify(dbl));
  const hoejre = await lav(false).koer('right_click', { selector: '#l' });
  assert.equal(hoejre.landed, true, JSON.stringify(hoejre));
});

test('en label med en rolle som forfader til maalet er ikke maalets ramme i beviset (R66, R76)', async () => {
  const d = lavKlikDom();
  const l = d.el('label', { id: 'l', attrs: { role: 'button' }, rect: [20, 20, 300, 40] });
  d.el('span', { id: 't', tekst: 'Tekst', rect: [20, 20, 300, 40], ingenPeg: true }, l);
  const svar = await browser(d).koer('click', { selector: '#t' });
  assert.notEqual(svar.landed, true, JSON.stringify(svar));
});

// ── R76 (Astra, maalt i model) ─────────────────────────────────────────────
test('en label med et felt: et aktiveringsklik, som siden stopper foer feltet, er ikke et ja (R76)', async () => {
  for (const udenKoordinater of [false, true]) {
    const d = lavKlikDom();
    const boks = d.el('input', { id: 'c', attrs: { type: 'checkbox' }, rect: [400, 20, 20, 20] });
    d.label(boks, { id: 'l', tekst: 'Accepter vilkaarene', rect: [20, 20, 300, 20] });
    const b = browser(d, { aktiveringUdenKoordinater: udenKoordinater });
    // En fangstlytter paa document stopper feltets aktiveringsklik, foer det naar feltet.
    d.document.addEventListener('click', (ev) => { if (ev.target === boks) { ev.preventDefault(); ev.stopImmediatePropagation(); } });
    const svar = await b.koer('click', { selector: '#l' });
    assert.notEqual(svar.landed, true, JSON.stringify({ udenKoordinater, svar }));
    assert.ok(!b.side.includes('click:c'), String(b.side));
  }
});

