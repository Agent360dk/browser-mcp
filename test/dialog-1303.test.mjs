/**
 * #69 (1.30.3): browser_navigate ved «Leave site?» og browser_handle_dialog gennem én dialog-koordinator.
 *
 * Design (godkendt af Astra og Opus, R107): ~/.claude/plans/browsermcp-1302-2026-10-07/DESIGN-1.30.3-og-1.31-SAMLET.md.
 * Proeverne koerer den RIGTIGE background.js (udvidelses-selen) mod en model af Chrome, hvis regler er MAALT i headless
 * Chrome (R106-OPUS F1-F7, R107-OPUS):
 *   - tabs.update paa en ledig side loeser foer boksen kommer (F1); en travl side udsaetter baade navigationen og Page.enable.
 *   - Page.javascriptDialogOpening/Closed kommer kun, naar Page var slaaet til, da boksen kom; Closed baerer result (F2).
 *   - mens en boks staar aaben, svarer Page.enable ikke (F4); en uset boks kan ikke besvares (F7).
 *   - en adresse sendt IND i en aaben boks loeser foerst ved lukning; Stay annullerer alle ventende, Leave giver den
 *     nyeste (F5, R107 ind-i-aaben-leave).
 * Hver proeve hedder efter trinnet i designets tabel (T0-T10) eller tilstanden i prototypen (S1-S15, proto69-r107.mjs),
 * og Astras tre modbeviser (A1-A3). Alle var roede paa main (cca888f).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

const sov = (ms) => new Promise((r) => setTimeout(r, ms));
const GAMMEL = 'https://kladde.example/';
const NY = 'https://ny.example/';
// Korte frister i proeverne; forholdet mellem dem er designets (port < loft, luk < loft).
const FRISTER = { port: 250, luk: 300, loft: 900 };

// ── Chrome-modellen ─────────────────────────────────────────────────────────────
function model(opt = {}) {
  const log = [];
  const t = { url: GAMMEL, title: 'kladde', status: 'complete', beskyt: true, pageOn: false, boks: null, travlTil: 0,
    lukMs: 30, enableFejl: null, enableForsinkelse: 0, attachFejl: null, updFejl: null, updForsinkelse: 0,
    lukkerAldrig: false, boksType: 'beforeunload', haengNav: false, ...opt };
  let u;
  const snap = () => ({ id: 1, url: t.url, title: t.title, status: t.status, windowId: 1, active: true });
  const emit = (m, p) => { log.push(['ev', m, p.type ?? p.result]); u.fyr('debugger.onEvent', { tabId: 1 }, m, p); };
  const status = (s) => { t.status = s; u.fyr('tabs.onUpdated', 1, { status: s }, snap()); };
  const begaa = (url) => {
    if (t.haengNav) return;
    // Et fragment paa samme side: ingen 'loading', kun den nye adresse (som Chrome).
    if (url.split('#')[0] === t.url.split('#')[0] && url.includes('#')) { t.url = url; status('complete'); return; }
    t.url = (t.omdiriger && t.omdiriger[url]) || url; t.title = t.url; t.beskyt = false;
    status('loading'); setTimeout(() => status('complete'), 30);
  };
  const aabnBoks = (url) => {
    t.boks = { navs: [url], set: t.pageOn, type: t.boksType };
    if (t.boks.set) emit('Page.javascriptDialogOpening', { type: t.boksType, message: t.boksType === 'beforeunload' ? '' : 'Hej' });
  };
  const forlad = (url) => {
    if (t.boks) return new Promise((r) => t.boks.navs.push([url, r]));
    const kor = () => { if (t.boks) t.boks.navs.push(url); else if (t.beskyt) aabnBoks(url); else begaa(url); };
    const nu = Date.now();
    setTimeout(kor, t.travlTil > nu ? t.travlTil - nu : 3);
    return Promise.resolve({ ...snap(), pendingUrl: url });
  };
  const luk = (accept) => {
    const b = t.boks; t.boks = null;
    if (b.set) emit('Page.javascriptDialogClosed', { result: accept });
    const sidste = b.navs.at(-1); const url = Array.isArray(sidste) ? sidste[0] : sidste;
    for (const n of b.navs) if (Array.isArray(n)) n[1](snap());
    if (accept && b.type === 'beforeunload') begaa(url);
  };
  u = indlaesUdvidelse({ svar: {
    'debugger.attach': () => { if (t.attachFejl) throw new Error(t.attachFejl); },
    'debugger.getTargets': () => (t.attachFejl ? [] : [{ tabId: 1, attached: true }]),
    'tabs.get': () => snap(),
    'tabs.query': () => [snap()],
    'tabs.update': (_id, p) => {
      if (!p || !p.url) return snap();
      log.push(['tabs.update', p.url]);
      if (t.updFejl) throw new Error(t.updFejl);
      if (t.updForsinkelse) return sov(t.updForsinkelse).then(() => forlad(p.url));
      return forlad(p.url);
    },
    'scripting.executeScript': () => [{ result: { found: false, types: [] } }],
    'debugger.sendCommand': (_m, metode, p = {}) => {
      log.push(['cdp', metode, p.accept]);
      if (metode === 'Page.enable') {
        if (t.enableFejl) throw new Error(t.enableFejl);
        if (t.boks) return new Promise(() => {});                       // haenger bag en aaben boks (F4)
        const r = () => { t.pageOn = true; return {}; };
        const vent = Math.max(t.travlTil - Date.now(), t.enableForsinkelse);
        return vent > 0 ? sov(vent).then(r) : r();
      }
      if (metode === 'Page.handleJavaScriptDialog') {
        if (!t.boks || !t.boks.set) throw new Error('No dialog is showing');   // ogsaa for en uset boks (F7)
        if (t.lukkerAldrig) return {};
        const b = t.boks;
        // kvitterFoerst: kvitteringen kommer foer lukningen (Chrome giver den 0-1 ms efter Closed, F2 - her omvendt, saa en
        // proeve kan se, hvilken af de to svaret bygger paa).
        if (t.kvitterFoerst) { setTimeout(() => { if (t.boks === b) luk(t.lukResultat ?? p.accept); }, t.lukMs); return {}; }
        return sov(t.lukMs).then(() => { if (t.boks === b) luk(p.accept); return {}; });
      }
      return t.boks ? new Promise(() => {}) : {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 'Claude 1', color: 'blue' });
  const nf = u.hent('NAV_FRISTER');
  if (nf) Object.assign(nf, FRISTER);
  // Paa main (uden NAV_FRISTER) forkortes kun main's egen 15-sekunders-ventetid, saa den roede koersel ikke tager timer.
  else { const st = u.ctx.setTimeout; u.ctx.setTimeout = (fn, ms, ...a) => st(fn, ms === 15000 ? FRISTER.loft : ms, ...a); }
  const dispatch = (metode, params) => u.hent('dispatch')(9876, metode, params);
  return {
    u, t, log,
    nav: (params = {}) => dispatch('navigate', { url: NY, ...params }),
    dialog: (params = {}) => dispatch('handle_dialog', params),
    sidenNavigerer: (url) => forlad(url),
    enable: () => u.ctx.chrome.debugger.sendCommand({ tabId: 1 }, 'Page.enable', {}),
    svar: () => log.filter((x) => x[0] === 'cdp' && x[1] === 'Page.handleJavaScriptDialog'),
    adresser: () => log.filter((x) => x[0] === 'tabs.update').length,
    enables: () => log.filter((x) => x[0] === 'cdp' && x[1] === 'Page.enable').length,
  };
}
// Et kald, der aldrig svarer (main's navigate ind i en aaben boks), bliver et roedt udfald i stedet for en haengende proeve.
const fang = (p) => {
  let ur;
  return Promise.race([p.then((r) => r, (e) => ({ kastet: String(e?.message || e) })),
    new Promise((r) => { ur = setTimeout(() => r({ haengte: true }), 12000); })]).finally(() => clearTimeout(ur));
};
const vis = (r) => JSON.stringify(r);

// ── S1-S15 (tilstandene fra prototypen) ─────────────────────────────────────────

test('S1: «Leave site?» svares Stay som standard - beforeunload-blocked med den faktiske adresse, aldrig ok:true', async () => {
  const m = model();
  const r = await fang(m.nav());
  assert.equal(r.ok, false, vis(r));
  assert.equal(r.error, 'beforeunload-blocked', vis(r));
  assert.equal(r.sent, true);
  assert.equal(r.url, GAMMEL, 'svaret skal baere fanens faktiske adresse');
  assert.equal(r.answered_by, 'navigate');
  assert.match(r.note, /browser_ask_user/, 'noten skal sige: spoerg brugeren, foer siden forlades');
  assert.match(r.note, /leave_page/);
  assert.deepEqual(m.svar().map((x) => x[2]), [false], 'praecis ét svar, og det er Stay');
  assert.equal(m.adresser(), 1);
  assert.equal(m.t.boks, null, 'boksen er lukket - fanen er fri igen');
});

test('S2: leave_page:true svarer Leave, og svaret er ok:true foerst, naar den nye side er indlaest', async () => {
  const m = model();
  const r = await fang(m.nav({ leave_page: true }));
  assert.equal(r.ok, true, vis(r));
  assert.equal(r.url, NY);
  assert.equal(r.answered_by, 'navigate');
  assert.deepEqual(m.svar().map((x) => x[2]), [true]);
});

test('S3: et langsomt Stay (250 ms) giver stadig én adresse og beforeunload-blocked (R99 E2)', async () => {
  const m = model({ lukMs: 250 });
  const r = await fang(m.nav());
  assert.equal(r.error, 'beforeunload-blocked', vis(r));
  assert.equal(m.adresser(), 1);
  assert.equal(m.t.url, GAMMEL);
});

test('S4a: en armeret dismiss vinder over leave_page - ét svar, og dommen er blocked (R99 E1)', async () => {
  const m = model();
  await m.dialog({ action: 'dismiss' });
  const r = await fang(m.nav({ leave_page: true }));
  assert.equal(r.error, 'beforeunload-blocked', vis(r));
  assert.equal(r.answered_by, 'handle_dialog');
  assert.deepEqual(m.svar().map((x) => x[2]), [false], 'to svarere paa samme boks (mutant M4)');
  assert.equal(m.t.url, GAMMEL);
});

test('S4b: en armeret accept forlader siden - ok:true, ét svar, og armeringens loefte siger accept fra Closed', async () => {
  const m = model();
  await m.dialog({ action: 'accept' });
  const loefte = m.u.hent('dialogLoefter').get(1);
  const r = await fang(m.nav());
  assert.equal(r.ok, true, vis(r));
  assert.equal(r.url, NY);
  assert.equal(r.answered_by, 'handle_dialog');
  assert.equal(m.svar().length, 1);
  const a = await loefte;
  assert.equal(a.ok, true, vis(a));
  assert.equal(a.action, 'accept');
});

test('S5 + T0: et andet navigate, mens det foerste venter paa boksen, faar navigation-in-progress - én adresse (R99 E3)', async () => {
  const m = model({ lukMs: 250 });
  const a = fang(m.nav());
  await sov(20);
  const t0 = Date.now();
  const b = await fang(m.nav({ url: 'https://b.example/', leave_page: true }));
  assert.ok(Date.now() - t0 < 150, 'B skal svare straks, ikke vente paa A');
  assert.equal(b.ok, false, vis(b));
  assert.equal(b.error, 'navigation-in-progress', vis(b));
  assert.equal(b.sent, false);
  assert.match(String(b.op_id), /^nav-/, 'ejerens op_id skal med');
  assert.equal((await a).error, 'beforeunload-blocked');
  assert.equal(m.adresser(), 1, 'B maa ikke sende sin adresse ind i A\'s boks');
  assert.deepEqual(m.svar().map((x) => x[2]), [false], 'B\'s leave_page maa ikke svare paa A\'s boks');
});

test('T1: ejerskabet tages synkront - B i samme oejeblik som A (inden for de 1-6 ms, foer A\'s boks) overhaler ikke', async () => {
  const m = model();
  const a = fang(m.nav());
  const b = fang(m.nav({ url: 'https://b.example/', leave_page: true }));
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(rb.error, 'navigation-in-progress', vis(rb));
  assert.equal(ra.error, 'beforeunload-blocked', vis(ra));
  assert.equal(m.adresser(), 1);
});

test('S6 + T4: Page.enable kaster en anden fejl - navigation-failed, intet sendt, og ejerskabet er sluppet (R99 E4)', async () => {
  const m = model({ enableFejl: 'Cannot access a chrome-extension:// URL' });
  const r = await fang(m.nav());
  assert.equal(r.error, 'navigation-failed', vis(r));
  assert.equal(r.sent, false);
  assert.match(String(r.detail), /chrome-extension/);
  assert.equal(m.adresser(), 0);
  assert.equal(m.u.hent('dialogFaner').get(1).ejer, null, 'ejerskabet skal slippes');
});

test('S7 + T4: en side, der er travl laengere end porten, faar tab-not-responding - intet sendt, ingen sen boks', async () => {
  const m = model();
  m.t.travlTil = Date.now() + 700;
  const r = await fang(m.nav());
  assert.equal(r.error, 'tab-not-responding', vis(r));
  assert.equal(r.sent, false);
  assert.equal(m.adresser(), 0);
  await sov(750);
  assert.equal(m.t.boks, null, 'en adresse sendt bag porten ville have aabnet en boks nu');
  assert.equal(m.t.url, GAMMEL);
});

test('S8: en side, der er travl kortere end porten, navigeres - ok:true med den nye adresse', async () => {
  const m = model({ beskyt: false });
  m.t.travlTil = Date.now() + 120;
  const r = await fang(m.nav());
  assert.equal(r.ok, true, vis(r));
  assert.equal(r.url, NY);
});

test('S9: en sen boks uden ejer besvares ikke; handle_dialog besvarer den straks uden Page.enable, dom fra Closed', async () => {
  const m = model({ beskyt: false });
  const r = await fang(m.nav());
  assert.equal(r.ok, true, vis(r));
  m.t.beskyt = true;
  m.sidenNavigerer('https://siden-selv.example/');
  await sov(40);
  assert.ok(m.u.hent('dialogFaner').get(1).boks, 'koordinatoren skal kende boksen');
  assert.equal(m.svar().length, 0, 'en boks uden ejer maa ikke besvares (mutant M7)');
  const enables = m.enables();
  const h = await fang(m.dialog({ action: 'dismiss' }));
  assert.equal(h.ok, true, vis(h));
  assert.equal(h.action, 'dismiss');
  assert.equal(h.dialog_type, 'beforeunload');
  assert.equal(m.enables(), enables, 'Page.enable haenger bag en aaben boks (F4) og maa ikke kaldes');
  assert.equal(m.t.url, NY);
});

test('S10 + T2: en kendt aaben boks foer navigate - dialog-open, intet sendt, ingen Page.enable; derefter gaar det', async () => {
  const m = model();
  await m.enable();
  m.sidenNavigerer('https://siden-selv.example/');
  await sov(20);
  const enables = m.enables();
  const r = await fang(m.nav());
  assert.equal(r.error, 'dialog-open', vis(r));
  assert.equal(r.sent, false);
  assert.equal(r.dialog_type, 'beforeunload');
  assert.ok('pending_url' in r, 'svaret skal have pending_url (null her)');
  assert.match(r.note, /browser_ask_user/);
  assert.equal(m.adresser(), 0, 'en adresse sendt ind i en aaben boks foelger boksens skaebne (F5)');
  assert.equal(m.enables(), enables, 'trin 2 kommer foer porten');
  const h = await fang(m.dialog({ action: 'dismiss' }));
  assert.equal(h.ok, true, vis(h));
  const r2 = await fang(m.nav({ leave_page: true }));
  assert.equal(r2.ok, true, vis(r2));
  assert.equal(r2.url, NY);
});

test('S11 + T8: svaret kvitteres, men Chrome melder aldrig boksen lukket - dialog-unconfirmed, intet sendes igen', async () => {
  const m = model({ lukkerAldrig: true });
  const r = await fang(m.nav());
  assert.equal(r.ok, false, vis(r));
  assert.equal(r.error, 'dialog-unconfirmed', vis(r));
  assert.equal(r.sent, true);
  assert.equal(r.answered_by, 'navigate');
  assert.equal(m.svar().length, 1, 'intet mere maa sendes');
  assert.equal(m.u.hent('dialogFaner').get(1).ejer, null);
  const r2 = await fang(m.nav());
  assert.equal(r2.error, 'dialog-open', `boksen er stadig kendt som aaben: ${vis(r2)}`);
});

test('S12: en uset boks (Page slaaet fra, da den kom) - tab-not-responding fra baade navigate og handle_dialog', async () => {
  const m = model();
  m.sidenNavigerer('https://siden-selv.example/');
  await sov(20);
  const r = await fang(m.nav());
  assert.equal(r.error, 'tab-not-responding', vis(r));
  assert.equal(r.sent, false);
  const h = await fang(m.dialog({ action: 'dismiss' }));
  assert.equal(h.error, 'tab-not-responding', vis(h));
  assert.equal(m.adresser(), 0);
  assert.equal(m.svar().length, 0);
});

test('S13: siden aabner selv en boks i samme oejeblik som adressen - aerligt Stay, faktisk adresse', async () => {
  const m = model();
  await m.enable();
  const orig = m.u.ctx.chrome.tabs.update;
  m.u.ctx.chrome.tabs.update = (id, p) => { m.sidenNavigerer('https://siden-selv.example/'); return orig(id, p); };
  const r = await fang(m.nav());
  assert.equal(r.error, 'beforeunload-blocked', vis(r));
  assert.equal(r.url, GAMMEL);
  assert.equal(m.svar().length, 1);
});

test('S14 + T10: siden bliver travl lige efter porten, boksen kommer efter loftet - navigation-unconfirmed, aldrig ok:true', async () => {
  const m = model();
  const orig = m.u.ctx.chrome.tabs.update;
  m.u.ctx.chrome.tabs.update = (id, p) => { m.t.travlTil = Date.now() + FRISTER.loft + 300; return orig(id, p); };
  const r = await fang(m.nav());
  assert.equal(r.ok, false, `#69's symptom: ${vis(r)}`);
  assert.equal(r.error, 'navigation-unconfirmed', vis(r));
  assert.equal(r.sent, true);
  assert.equal(r.may_complete_later, true);
  assert.equal(r.pending_url, NY);
  assert.equal(r.url, GAMMEL);
  await sov(450);
  assert.ok(m.t.boks, 'boksen kom efter loftet');
  assert.equal(m.svar().length, 0, 'en sen boks uden ejer maa ikke besvares (mutant M7)');
  const r2 = await fang(m.nav({ leave_page: true }));
  assert.equal(r2.error, 'dialog-open', vis(r2));
  assert.equal(r2.pending_url, NY, 'naeste kald skal se den ventende adresse');
  assert.equal(m.adresser(), 1);
});

test('S15 + T6 (Astra A3): et afvist tabs.update afventes - navigation-failed, intet sendt, ikke ok:true', async () => {
  const m = model({ beskyt: false, updFejl: 'Invalid url' });
  const t0 = Date.now();
  const r = await fang(m.nav({ url: 'ugyldig:adresse' }));
  assert.equal(r.ok, false, vis(r));
  assert.equal(r.error, 'navigation-failed', vis(r));
  assert.equal(r.sent, false);
  assert.match(String(r.detail), /Invalid url/);
  assert.ok(Date.now() - t0 < FRISTER.loft, 'afvisningen skal ikke vente paa loftet');
});

// ── Trinene, der ikke er en S-tilstand ──────────────────────────────────────────

test('T3: debuggeren kan ikke tilknyttes - mains vej, ok:true kun med bevist indlaesning', async () => {
  const m = model({ beskyt: false, attachFejl: 'Cannot attach to this target' });
  const r = await fang(m.nav());
  assert.equal(r.ok, true, vis(r));
  assert.equal(r.url, NY);
});

test('T3 (Astra: reservevej): debuggeren kan ikke tilknyttes, og intet indlaeses - navigation-unconfirmed, aldrig ok:true', async () => {
  const m = model({ beskyt: false, attachFejl: 'Cannot attach to this target', haengNav: true });
  const r = await fang(m.nav());
  assert.equal(r.ok, false, vis(r));
  assert.equal(r.error, 'navigation-unconfirmed', vis(r));
  assert.equal(r.may_complete_later, true);
  assert.match(r.note, /debugger could not attach/);
});

test('T5: en boks, der aabner, mens porten venter, giver dialog-open - intet sendt', async () => {
  const m = model({ enableForsinkelse: 60 });
  await m.enable();
  const p = fang(m.nav());
  await sov(15);
  m.sidenNavigerer('https://siden-selv.example/');
  const r = await p;
  assert.equal(r.error, 'dialog-open', vis(r));
  assert.equal(r.sent, false);
  assert.equal(m.adresser(), 0);
  assert.equal(m.svar().length, 0, 'en ejer, der ikke har sendt, maa ikke svare paa sidens egen boks');
});

test('T7: en anden boks-type end beforeunload uden armering besvares ikke - dialog-open, sent:true', async () => {
  const m = model({ boksType: 'alert' });
  const r = await fang(m.nav({ leave_page: true }));
  assert.equal(r.error, 'dialog-open', vis(r));
  assert.equal(r.sent, true);
  assert.equal(r.dialog_type, 'alert');
  assert.equal(m.svar().length, 0, 'leave_page gaelder kun «Leave site?»');
});

test('T7: en udloebet armering forbruges ikke - udloebet tjekkes i samme tur, som svareren vaelges', async () => {
  const m = model();
  await m.enable();
  // En armering, hvis udloeb er passeret, men hvis ur endnu ikke har ryddet den.
  m.u.hent('armeredeDialoger').set(1, { timer: null, action: 'accept', accept: true, text: '', udloeb: Date.now() - 1, opfyld: () => {} });
  const r = await fang(m.nav());
  assert.equal(r.error, 'beforeunload-blocked', vis(r));
  assert.equal(r.answered_by, 'navigate');
  assert.deepEqual(m.svar().map((x) => x[2]), [false]);
});

test('T7: en armering brugt paa en tidligere alert gaelder ikke for «Leave site?» bagefter', async () => {
  const m = model({ boksType: 'alert' });
  await m.dialog({ action: 'accept' });
  m.sidenNavigerer('https://alert.example/');
  await sov(60);
  assert.equal(m.svar().length, 1, 'armeringen tog alerten');
  m.t.boksType = 'beforeunload';
  m.t.beskyt = true;
  const r = await fang(m.nav());
  assert.equal(r.error, 'beforeunload-blocked', vis(r));
  assert.equal(r.answered_by, 'navigate');
});

test('T8 + T9: Closed(true) venter paa bevist indlaesning med mains regler - samme adresse, fragment og omdirigering', async () => {
  for (const [url, forventet, ekstra] of [[GAMMEL, GAMMEL, {}], [GAMMEL + '#afsnit', GAMMEL + '#afsnit', {}],
    ['https://example.com/kort', 'https://example.com/lang', { omdiriger: { 'https://example.com/kort': 'https://example.com/lang' } }]]) {
    const m = model({ beskyt: false, ...ekstra });
    const t0 = Date.now();
    const r = await fang(m.nav({ url }));
    assert.equal(r.ok, true, `${url}: ${vis(r)}`);
    assert.equal(r.url, forventet, url);
    assert.ok(Date.now() - t0 < FRISTER.loft, `${url}: ventede paa loftet`);
  }
  const m = model();
  const r = await fang(m.nav({ leave_page: true }));
  assert.equal(r.ok, true, vis(r));
  assert.equal(r.answered_by, 'navigate');
  assert.equal(r.dialog_type, 'beforeunload');
});

test('T8: en gammel sides \'complete\' efter Stay er ikke bevis - beforeunload-blocked, ikke ok:true', async () => {
  const m = model();
  const orig = m.u.ctx.chrome.debugger.sendCommand;
  m.u.ctx.chrome.debugger.sendCommand = (x, metode, p) => {
    const r = orig(x, metode, p);
    // Chrome melder den gamle side 'complete' igen, lige efter Stay.
    if (metode === 'Page.handleJavaScriptDialog') r.then(() => m.u.fyr('tabs.onUpdated', 1, { status: 'complete' }, { id: 1, url: GAMMEL, status: 'complete' }));
    return r;
  };
  const r = await fang(m.nav());
  assert.equal(r.error, 'beforeunload-blocked', vis(r));
});

test('tab-closed: fanen lukkes, mens navigate venter', async () => {
  const m = model({ beskyt: false, haengNav: true });
  const p = fang(m.nav());
  await sov(60);
  await m.u.fyr('tabs.onRemoved', 1);
  const r = await p;
  assert.equal(r.error, 'tab-closed', vis(r));
  assert.ok(m.u.hent('dialogFaner').get(1) === undefined, 'tilstanden for en lukket fane skal vaek');
});

test('debugger frakoblet med en aaben boks: dialog-unconfirmed nu, og naeste kald spoerger porten i stedet for at huske', async () => {
  const m = model({ lukkerAldrig: true });
  const p = fang(m.nav());
  await sov(60);
  await m.u.fyr('debugger.onDetach', { tabId: 1 }, 'canceled_by_user');
  const r = await p;
  assert.equal(r.error, 'dialog-unconfirmed', vis(r));
  assert.match(String(r.detail), /detached/);
  const enables = m.enables();
  const r2 = await fang(m.nav());
  assert.equal(r2.error, 'tab-not-responding', `boksen er ukendt nu; porten afgoer: ${vis(r2)}`);
  assert.ok(m.enables() > enables, 'porten skal spoerges');
  assert.equal(m.svar().length, 1, 'intet gensendes');
  assert.equal(m.adresser(), 1);
});

// ── Astras modbeviser (R107) ────────────────────────────────────────────────────

test('A1: sen navigation + nyt kald efter loftet - B overtager ikke A\'s ventende navigation', async () => {
  const m = model({ updForsinkelse: FRISTER.loft + 250 });
  const a = await fang(m.nav());
  assert.equal(a.ok, false, `A meldte succes for en navigation, Chrome endnu ikke havde udfoert: ${vis(a)}`);
  assert.equal(a.error, 'navigation-unconfirmed', vis(a));
  assert.equal(a.may_complete_later, true);
  assert.equal(a.pending_url, NY);
  const b = await fang(m.nav({ url: 'https://b.example/', leave_page: true }));
  assert.equal(b.error, 'navigation-in-progress', `B tog fanen, mens A's adresse stadig var undervejs: ${vis(b)}`);
  assert.equal(b.sent, false);
  assert.equal(b.pending_url, NY);
  await sov(400);
  assert.ok(m.t.boks, 'A\'s boks kom sent');
  assert.equal(m.svar().length, 0, 'B\'s Leave maa ikke svare paa A\'s sene boks');
  const c = await fang(m.nav());
  assert.equal(c.error, 'dialog-open', vis(c));
  assert.equal(c.pending_url, NY);
  assert.equal(m.adresser(), 1);
});

test('A2: handle_dialog, mens en boks aabner bag porten - besvares, ikke armed:true med 0 svar', async () => {
  const m = model({ enableForsinkelse: 60 });
  await m.enable();
  const p = fang(m.dialog({ action: 'dismiss' }));
  await sov(15);
  m.sidenNavigerer('https://siden-selv.example/');
  const h = await p;
  assert.notEqual(h.armed, true, `armeret, mens boksen stod aaben: ${vis(h)}`);
  assert.equal(h.ok, true, vis(h));
  assert.equal(h.action, 'dismiss');
  assert.equal(m.svar().length, 1);
  assert.equal(m.t.boks, null);
});

// ── handle_dialog ───────────────────────────────────────────────────────────────

test('handle_dialog: en boks, navigate er ved at besvare, giver dialog-being-answered - intet andet svar', async () => {
  const m = model({ lukMs: 200 });
  const p = fang(m.nav());
  await sov(40);
  const h = await fang(m.dialog({ action: 'accept' }));
  assert.equal(h.error, 'dialog-being-answered', vis(h));
  assert.equal(h.answered_by, 'navigate');
  assert.equal((await p).error, 'beforeunload-blocked');
  assert.equal(m.svar().length, 1);
});

test('handle_dialog: en boks, hvis svar aldrig blev meldt lukket, er ubekraeftet - ikke «under besvarelse» for evigt', async () => {
  const m = model({ lukkerAldrig: true });
  const r = await fang(m.nav());
  assert.equal(r.error, 'dialog-unconfirmed', vis(r));
  const h = await fang(m.dialog({ action: 'accept' }));
  assert.equal(h.error, 'dialog-unconfirmed', vis(h));
  assert.equal(m.svar().length, 1, 'intet sendes igen');
});

test('pending_url: en ventende adresse, fanen siden er kommet til, vises ikke som ventende', async () => {
  const m = model({ beskyt: false });
  m.u.hent('dialogFaner').get(1) || m.u.hent('dialogFaner').set(1, { ejer: null, boks: null, pendingUrl: null, uafgjort: null, ukendt: false, lukketFane: false });
  m.u.hent('dialogFaner').get(1).pendingUrl = GAMMEL;   // fanen staar allerede paa den
  await m.enable();
  m.t.beskyt = true;
  m.sidenNavigerer('https://siden-selv.example/');
  await sov(20);
  const r = await fang(m.nav());
  assert.equal(r.error, 'dialog-open', vis(r));
  assert.equal(r.pending_url, null, vis(r));
});

test('handle_dialog: dommen kommer fra Closed - kvitteret uden lukning er dialog-unconfirmed, ikke ok:true', async () => {
  const m = model({ lukkerAldrig: true });
  await m.enable();
  m.sidenNavigerer('https://siden-selv.example/');
  await sov(20);
  const h = await fang(m.dialog({ action: 'accept' }));
  assert.equal(h.ok, false, vis(h));
  assert.equal(h.error, 'dialog-unconfirmed', vis(h));
});

test('klik-vejen: armeringens loefte (dialogLoefter) opfyldes ved Closed, ikke ved kvitteringen', async () => {
  const m = model({ boksType: 'confirm', lukMs: 80, kvitterFoerst: true, lukResultat: false });
  await m.dialog({ action: 'accept' });
  const loefte = m.u.hent('dialogLoefter').get(1);
  let svar = null; loefte.then((r) => { svar = r; });
  assert.equal(m.u.hent('armeredeDialoger').has(1), true, 'dispatchTaalmodigt ser armeringen');
  m.sidenNavigerer('https://confirm.example/');
  await sov(40);
  assert.equal(svar, null, 'loeftet maa ikke opfyldes, foer Chrome melder boksen lukket');
  await sov(120);
  assert.equal(svar?.ok, true, vis(svar));
  assert.equal(svar.action, 'dismiss', 'action er det Chrome meldte ved lukningen (her: et menneske trykkede Escape foerst)');
});

test('klik-vejen: kvitteret, men aldrig meldt lukket - loeftet siger dialog-unconfirmed, ikke ok:true', async () => {
  const m = model({ boksType: 'confirm', lukkerAldrig: true });
  await m.dialog({ action: 'accept' });
  const loefte = m.u.hent('dialogLoefter').get(1);
  m.sidenNavigerer('https://confirm.example/');
  const svar = await fang(loefte);
  assert.equal(svar.ok, false, vis(svar));
  assert.equal(svar.error, 'dialog-unconfirmed', vis(svar));
});

// ── Kildeproeven: kun koordinatoren sender Page.handleJavaScriptDialog ───────────

test('kun dialog-koordinatoren sender Page.handleJavaScriptDialog - og der er én debugger-lytter til dialoger', () => {
  for (const sti of ['../extension/background.js', '../mcp-server/extension/background.js']) {
    const kilde = readFileSync(new URL(sti, import.meta.url), 'utf8');
    const kode = kilde.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
    const steder = [...kode.matchAll(/['"`]Page\.handleJavaScriptDialog['"`]/g)].map((x) => x.index);
    assert.equal(steder.length, 1, `${sti}: Page.handleJavaScriptDialog sendes fra ${steder.length} steder`);
    const fn = kode.lastIndexOf('function ', steder[0]);
    assert.match(kode.slice(fn, fn + 40), /^function dialogSvar\(/, `${sti}: afsenderen er ikke dialogSvar`);
    const opening = [...kode.matchAll(/Page\.javascriptDialogOpening/g)].length;
    assert.equal(opening, 1, `${sti}: kun koordinatoren maa lytte efter Page.javascriptDialogOpening (${opening} steder)`);
    assert.match(kode, /\nchrome\.debugger\.onEvent\.addListener\(dialogKoordinator\);/, `${sti}: koordinatoren skal lytte fra start`);
  }
});

// ── Serveren: fejlkoderne bliver isError for klienten ───────────────────────────
// Designet: «alle fejl isError:true». Foer svarede serveren et ok:false fra udvidelsen som et almindeligt resultat.

const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const { WebSocket } = createRequire(new URL('../mcp-server/package.json', import.meta.url))('ws');
const BASE = await ledigtSpaend(5), MAX = BASE + 4;
const boern = [], sokler = [];
after(() => {
  for (const x of sokler) try { x.terminate(); } catch {}
  for (const b of boern) try { b.kill('SIGKILL'); } catch {}
});

function falskUdvidelse(result) {
  let stop = false;
  const forbundet = new Set();
  const proev = () => {
    if (stop) return;
    for (let p = BASE; p <= MAX; p++) {
      if (forbundet.has(p)) continue;
      forbundet.add(p);
      const ws = new WebSocket(`ws://127.0.0.1:${p}`, { origin: 'chrome-extension://' + 'a'.repeat(32) });
      ws.on('error', () => {});
      ws.on('close', () => forbundet.delete(p));
      ws.on('open', () => {
        sokler.push(ws);
        ws.send(JSON.stringify({ type: 'hello', extensionId: 'a'.repeat(32), version: '1.30.2', name: 'fake' }));
      });
      ws.on('message', (d) => {
        let m; try { m = JSON.parse(d); } catch { return; }
        if (m.id === undefined) return;
        ws.send(JSON.stringify({ id: m.id, result }));
      });
    }
    setTimeout(proev, 400);
  };
  proev();
  return () => { stop = true; };
}

function kald(navn, result) {
  const p = spawn(process.execPath, [SRV], { stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER_MCP_BASE_PORT: String(BASE), BROWSER_MCP_MAX_PORT: String(MAX) } });
  boern.push(p); p.stderr.on('data', () => {});
  const stopUdvidelse = falskUdvidelse(result);
  let buf = '';
  return new Promise((res) => {
    const ur = setTimeout(() => { stopUdvidelse(); p.kill('SIGKILL'); res(null); }, 40000);
    p.stdout.on('data', (d) => {
      buf += d;
      for (const l of buf.split('\n')) {
        let m; try { m = JSON.parse(l); } catch { continue; }
        if (m.id === 2) { clearTimeout(ur); stopUdvidelse(); p.kill('SIGKILL'); res(m.result); }
      }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: navn, arguments: navn === 'browser_navigate' ? { url: NY } : {} } }) + '\n');
  });
}

test('serveren: navigate- og dialogfejl er isError:true, et bevist ok:true er det ikke', { timeout: 90000 }, async () => {
  const blokeret = await kald('browser_navigate', { ok: false, error: 'beforeunload-blocked', sent: true, url: GAMMEL });
  assert.ok(blokeret, 'intet svar fra serveren');
  assert.equal(blokeret.isError, true, `en agent laeser ellers fejlen som et gennemfoert kald: ${vis(blokeret)}`);
  assert.match(blokeret.content[0].text, /beforeunload-blocked/);
  const igang = await kald('browser_handle_dialog', { ok: false, error: 'dialog-being-answered', answered_by: 'navigate' });
  assert.equal(igang.isError, true, vis(igang));
  const ok = await kald('browser_navigate', { ok: true, url: NY, tab_id: 1 });
  assert.notEqual(ok.isError, true, vis(ok));
});
