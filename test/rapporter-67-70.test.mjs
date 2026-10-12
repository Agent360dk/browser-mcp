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
test('#67: siden laeste filen og ryddede feltet - svaret er modtaget, ikke file-not-attached', () => {
  const fyld = indlaesUdvidelse().hent('fildSvar');
  const svar = fyld({ antal: 0, navne: [] }, ['/x/a.png'], { method: 'hidden-input' }, { antal: 1, navne: ['a.png'] });
  assert.equal(svar.ok, true, `en side der fik filen, blev meldt som fejl: ${JSON.stringify(svar)}`);
  assert.equal(svar.consumed_by_page, true);
  assert.deepEqual(svar.attached, ['a.png']);
  // Positive kontroller: intet change, eller et change uden filer, er stadig et nej.
  assert.equal(fyld({ antal: 0, navne: [] }, ['/x/a.png'], {}, null).error, 'file-not-attached');
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
  assert.equal(svar2.input, '#f', 'svaret navngiver ikke feltet, der fik filen');
});

// ── #69 navigate og «Leave site?» ────────────────────────────────────────────
function navSele({ forladt }) {
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
      if (o && o.url) setTimeout(() => u.fyr('debugger.onEvent', { tabId: 1 }, 'Page.javascriptDialogOpening', { type: 'beforeunload', message: '' }), 5);
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

test('#69: en armeret handle_dialog bestemmer selv - vagten svarer ikke oven i den', async () => {
  const { u, svarDialog } = navSele({ forladt: false });
  u.hent('armeredeDialoger').set(1, { listener: () => {}, timer: null, action: 'accept', opfyld: () => {} });
  const p = u.hent('dispatch')(9876, 'navigate', { url: 'https://ny.example/' });
  p.catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(svarDialog, [], 'vagten svarede boksen, skoent agenten havde armeret handle_dialog');
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
test('#67: upload_file - siden laeste filen og ryddede feltet, svaret er modtaget', async () => {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Runtime.evaluate') {
        const x = String(p.expression);
        if (x.includes('found: true')) return { result: { value: JSON.stringify({ found: true, tag: 'INPUT', type: 'file', accept: '', multiple: false }) } };
        if (x.includes('removeEventListener') || x.includes(':af')) return { result: { value: x.includes('lager[noegle + \':af\']()') && !x.includes('addEventListener') ? JSON.stringify({ antal: 1, navne: ['a.png'] }) : true } };
        return { result: { value: true } };
      }
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => (String(func).includes('.files') ? [{ result: { antal: 0, navne: [] } }] : [{ result: null }]);
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/x/a.png'] });
  assert.equal(svar.ok, true, `upload_file meldte file-not-attached, skoent siden fik filen: ${JSON.stringify(svar)}`);
  assert.equal(svar.consumed_by_page, true);
});

function vaelgerSele(feltet) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'DOM.resolveNode') return { object: { objectId: 'obj-1' } };
      if (metode === 'Runtime.callFunctionOn') {
        return String(p.functionDeclaration).includes('el.files ?') && String(p.functionDeclaration).includes('input:')
          ? { result: { value: JSON.stringify(feltet) } } : { result: { value: true } };
      }
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
  const tomt = await vaelg(vaelgerSele({ antal: 0, navne: [], input: 'x', skift: null }));
  assert.equal(tomt.ok, false, `et tomt felt blev meldt som vedhaeftet: ${JSON.stringify(tomt)}`);
  assert.equal(tomt.error, 'file-not-attached');
  const fyldt = await vaelg(vaelgerSele({ antal: 1, navne: ['a.png'], input: "an <input type=\"file\"> outside the page's document", skift: { antal: 1, navne: ['a.png'] } }));
  assert.equal(fyldt.ok, true, JSON.stringify(fyldt));
  assert.equal(fyldt.method, 'native-chooser-intercepted');
  assert.match(String(fyldt.input), /outside the page/, 'svaret navngiver ikke feltet');
  const ryddet = await vaelg(vaelgerSele({ antal: 0, navne: [], input: 'x', skift: { antal: 1, navne: ['a.png'] } }));
  assert.equal(ryddet.consumed_by_page, true, JSON.stringify(ryddet));
});

test('#69: en input-frist naevner ogsaa en aaben dialog, ikke kun en baggrundsfane', async () => {
  const u = indlaesUdvidelse({ svar: { 'debugger.sendCommand': () => new Promise(() => {}) } });
  const fejl = await u.hent('cdpMedFrist')(1, 'Input.dispatchMouseEvent', { type: 'mousePressed' }).catch((e) => e);
  assert.match(String(fejl.message), /background/);
  assert.match(String(fejl.message), /opened a dialog/, `fristen peger kun paa baggrundsfanen: ${fejl.message}`);
});
