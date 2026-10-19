/**
 * 1.32 skive S4: SESSIONSGENERATION. En frigivelse gaelder kun den forbindelse (generation), den blev bestilt for.
 *
 * Astra MAALTE (R107): sessionerne i udvidelsen er noeglet paa PORTEN. Efter at en ny session var oprettet paa samme port med
 * fane 99, lukkede et forsinket `releaseSession(19874)` - bestilt af den GAMLE forbindelses lukning - fane 99 og slettede
 * sessionen. Med partitioner (#20) bliver porte genbrugt langt oftere (en partition slipper sin port ved lukning, og en
 * anden chat kan tage den), saa ejerskabet maa ikke laengere aflaeses af portnummeret alene.
 *
 * Designet (DESIGN-1.30.3-og-1.31-SAMLET.md, «Sessionsejerskab»): hver forbindelse i broen (offscreen.js) faar en generation;
 * kommandoer og `session_disconnect` baerer den; sessionen og hver af dens faner husker den generation, der ejer dem; en
 * frigivelse for en anden generation end sessionens roerer kun sin egen generations faner.
 */
import { test as nodeTest } from 'node:test';
// En proeve, der haenger (fx under en mutant), skal fejle inden for en frist - ikke holde koerslen i live.
const test = (navn, fn) => nodeTest(navn, { timeout: 60000 }, fn);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const P = 19874;
const vent = (ms = 30) => new Promise((ok) => setTimeout(ok, ms));
const lukkede = (u) => u.optager.til('tabs.remove').map((b) => b.args[0]);
const frakobl = (u, gen) => u.fyr('runtime.onMessage', { type: 'session_disconnect', port: P, gen }, {}, () => {});

// En session paa P, ejet af generationen `gen`, med fanerne `faner` (som en kommando paa forbindelsen ville lave den).
async function sessionPaa(u, gen, faner, pid = null) {
  u.hent('getSession')(P, pid, gen);
  for (const f of faner) await u.hent('addTabToSession')(P, f);
}

// ── Astras maaling ─────────────────────────────────────────────────────────────

test('et forsinket releaseSession fra den gamle forbindelse lukker IKKE den nye forbindelses fane paa samme port', async () => {
  const u = indlaesUdvidelse();
  await sessionPaa(u, 'g1', [41]);
  // Den gamle forbindelse er lukket, men dens session_disconnect er ikke behandlet endnu. En ny forbindelse paa samme port
  // (en partition eller en anden chat - pid null) sender sin foerste kommando og aabner fane 99.
  await sessionPaa(u, 'g2', [99]);
  u.optager.ryd();
  await frakobl(u, 'g1');
  await vent();
  assert.ok(!lukkede(u).includes(99), `den gamle forbindelses frigivelse lukkede den nye forbindelses fane: ${lukkede(u)}`);
  const s = u.hent('sessions').get(P);
  assert.ok(s && s.tabIds.has(99), 'den nye forbindelses session blev slettet af den gamle forbindelses frigivelse');
  // Positiv kontrol: frigivelsen gjorde sit arbejde for SIN generation - den doede forbindelses fane lukkes.
  assert.deepEqual(lukkede(u), [41], 'den gamle forbindelses egen fane blev ikke lukket - frigivelsen gjorde ingenting');
  assert.ok(!s.tabIds.has(41));
});

test('en frigivelse for sessionens EGEN generation lukker stadig alle dens faner og sletter sessionen', async () => {
  const u = indlaesUdvidelse();
  await sessionPaa(u, 'g1', [41, 42]);
  u.optager.ryd();
  await frakobl(u, 'g1');
  await vent();
  assert.deepEqual(lukkede(u).sort(), [41, 42]);
  assert.ok(!u.hent('sessions').has(P), 'sessionen blev staaende efter sin egen forbindelses frigivelse');
});

test('en ny forbindelse midt i en igangvaerende frigivelse faar en frisk session - fanen den aabner, overlever', async () => {
  let slip;
  const haenger = new Promise((ok) => { slip = ok; });
  const u = indlaesUdvidelse({ svar: { 'tabs.remove': (id) => (id === 41 ? haenger : undefined) } });
  await sessionPaa(u, 'g1', [41]);
  u.optager.ryd();
  const frigivelse = frakobl(u, 'g1');           // venter paa tabs.remove(41)
  await vent(5);
  await sessionPaa(u, 'g2', [99]);               // ny forbindelse paa porten, imens
  const ny = u.hent('sessions').get(P);
  assert.ok(ny && !ny.tabIds.has(41), 'den nye forbindelse arvede den doede forbindelses fane 41');
  slip();
  await frigivelse; await vent();
  assert.ok(!lukkede(u).includes(99), 'den nye forbindelses fane blev lukket');
  const s = u.hent('sessions').get(P);
  assert.ok(s && s.tabIds.has(99), 'frigivelsen slettede den nye forbindelses session, da den var faerdig');
});

test('en kommando paa en ny generation tager sessionen over: senere frigivelse af den NYE generation lukker dens faner', async () => {
  const u = indlaesUdvidelse();
  await sessionPaa(u, 'g1', [41], 7);
  // Samme chat (samme pid) genforbinder paa samme port, fx efter at offscreen-dokumentet blev genskabt (ingen
  // session_disconnect fra det gamle dokument). Den beholder sine faner.
  await sessionPaa(u, 'g2', [99], 7);
  const s = u.hent('sessions').get(P);
  assert.deepEqual([...s.tabIds].sort(), [41, 99]);
  assert.equal(s.gen, 'g2', 'sessionen er ikke stemplet med den forbindelse, der nu ejer den');
  u.optager.ryd();
  await frakobl(u, 'g2');
  await vent();
  assert.deepEqual(lukkede(u).sort(), [41, 99], 'den nuvaerende forbindelses afbrydelse ryddede ikke op');
});

test('en frivillig frigivelse bestilt for den gamle generation goer ikke den nye generations uventede afbrydelse frivillig', async () => {
  const u = indlaesUdvidelse();
  await sessionPaa(u, 'g1', []);
  u.hent('sessions').get(P).tabIds.clear();
  // Fristen fyrer paa den tomme session: udvidelsen beder g1's server slippe porten (frivilligt).
  await u.fyr('alarms.onAlarm', { name: `frigiv-${P}` });
  await vent(20);
  const term = u.optager.til('runtime.sendMessage').map((b) => b.args[0]).filter((m) => m && m.type === 'terminate_mcp_session');
  assert.equal(term.length, 1, 'forudsaetningen holder ikke: der blev ikke bedt om frigivelse');
  assert.equal(term[0].gen, 'g1', 'bestillingen af frigivelsen baerer ikke den generation, den gaelder');
  // Imens tager en ny forbindelse porten og aabner fane 99; saa doer den uventet.
  await sessionPaa(u, 'g2', [99]);
  u.optager.ryd();
  await frakobl(u, 'g2');
  await vent();
  assert.deepEqual(lukkede(u), [99], 'den nye forbindelses doede fane blev efterladt, fordi frigivelsen var bestilt for g1');
});

test('generation og fanernes generation overlever en genstart af service-workeren', async () => {
  const u = indlaesUdvidelse();
  await sessionPaa(u, 'g1', [41]);
  await sessionPaa(u, 'g2', [99]);
  const gemt = u.optager.sidste('storage.local.set').args[0].sessions[String(P)];
  assert.equal(gemt.gen, 'g2');
  // Ny worker med lageret: den gamle forbindelses frigivelse kommer foerst nu.
  const v = indlaesUdvidelse({ svar: { 'storage.local.get': { sessions: { [String(P)]: gemt } }, 'tabs.get': (id) => ({ id, url: 'https://x' }) } });
  await v.hent('restoreSessions')();
  v.optager.ryd();
  await v.fyr('runtime.onMessage', { type: 'session_disconnect', port: P, gen: 'g1' }, {}, () => {});
  await vent();
  assert.deepEqual(lukkede(v), [41], `efter genstart lukkede frigivelsen af g1 forkerte faner: ${lukkede(v)}`);
  assert.ok(v.hent('sessions').get(P)?.tabIds.has(99));
});

test('en besked uden generation (en bro fra foer 1.32) frigiver som foer', async () => {
  const u = indlaesUdvidelse();
  await sessionPaa(u, 'g1', [41]);
  u.optager.ryd();
  await u.fyr('runtime.onMessage', { type: 'session_disconnect', port: P }, {}, () => {});
  await vent();
  assert.deepEqual(lukkede(u), [41]);
});

test('kommandoen stempler sessionen med broens generation (mcp_command -> getSession)', async () => {
  const u = indlaesUdvidelse({ svar: { 'tabs.query': [] } });
  await u.fyr('runtime.onMessage', { type: 'mcp_command', port: P, pid: null, gen: 'gX', method: 'list_tabs', params: {} }, {}, () => {});
  await vent();
  assert.equal(u.hent('sessions').get(P)?.gen, 'gX', 'broens generation naaede ikke frem til sessionen');
});

// ── Broen: hver forbindelse sin generation ─────────────────────────────────────

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
function broen() {
  const instanser = [];
  const sendt = [];
  const lyttere = [];
  function WS(url) {
    const o = { readyState: 0, url, sendt: [], send(d) { o.sendt.push(JSON.parse(d)); }, close() { o.readyState = 3; o.onclose?.(); } };
    instanser.push(o);
    return o;
  }
  WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3;
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    URLSearchParams, JSON, Promise, Uint8Array, Array, Error, String, Boolean, WeakSet, Map, Set, Object, Number, Date, Math, AbortSignal,
    location: { search: '?v=1.30.3' },
    WebSocket: WS,
    fetch: async () => { throw new Error('ingen server'); },
    crypto: { subtle: { digest: async () => new Uint8Array([1, 2, 3]).buffer }, getRandomValues: (a) => globalThis.crypto.getRandomValues(a) },
    chrome: { runtime: { id: 'proeve-id', getURL: (f) => 'chrome-extension://proeve-id/' + f,
      sendMessage: async (m) => { sendt.push(m); return { ok: true }; }, onMessage: { addListener: (f) => lyttere.push(f) } } },
  };
  ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(readFileSync(join(rod, 'extension/offscreen.js'), 'utf8'), ctx, { filename: 'offscreen.js' });
  const aabn = (port) => { ctx.tryConnect(port); const w = instanser.at(-1); w.readyState = 1; w.onopen?.(); return w; };
  return { ctx, instanser, sendt, lyttere, aabn };
}

test('broen: kommando og session_disconnect baerer forbindelsens generation, og en ny forbindelse paa porten faar en ny', async () => {
  const b = broen();
  const w1 = b.aabn(P);
  await w1.onmessage({ data: JSON.stringify({ id: 1, method: 'list_tabs', params: {}, pid: null }) });
  const k1 = b.sendt.find((m) => m.type === 'mcp_command');
  assert.ok(k1 && typeof k1.gen === 'string' && k1.gen.length > 0, 'kommandoen baerer ingen generation');
  w1.close();
  const d1 = b.sendt.find((m) => m.type === 'session_disconnect');
  assert.equal(d1.gen, k1.gen, 'frigivelsen er ikke bestilt for den forbindelse, der sendte kommandoen');
  const w2 = b.aabn(P);
  await w2.onmessage({ data: JSON.stringify({ id: 2, method: 'list_tabs', params: {}, pid: null }) });
  const k2 = b.sendt.filter((m) => m.type === 'mcp_command')[1];
  assert.notEqual(k2.gen, k1.gen, 'to forbindelser paa samme port fik samme generation');
});

test('broen: to dokumenter (offscreen genskabt) giver ikke samme generation', async () => {
  const a = broen(), b = broen();
  const wa = a.aabn(P), wb = b.aabn(P);
  await wa.onmessage({ data: JSON.stringify({ id: 1, method: 'x', params: {} }) });
  await wb.onmessage({ data: JSON.stringify({ id: 1, method: 'x', params: {} }) });
  assert.notEqual(a.sendt[a.sendt.length - 1].gen, b.sendt[b.sendt.length - 1].gen,
    'et genskabt dokument genbruger generationer - en gammel frigivelse kan ramme den nye forbindelse');
});

test('broen: en bestilt frigivelse for en anden generation end portens nuvaerende forbindelse lukker den ikke', () => {
  const b = broen();
  const w1 = b.aabn(P);
  w1.close();
  const w2 = b.aabn(P);
  const terminer = b.lyttere.map((f) => (m) => f(m, {}, () => {}));
  const gammelGen = b.sendt.find((m) => m.type === 'session_disconnect').gen;
  for (const f of terminer) f({ type: 'terminate_mcp_session', port: P, gen: gammelGen });
  assert.equal(w2.readyState, 1, 'en frigivelse bestilt for den gamle forbindelse lukkede den nye forbindelse paa porten');
  assert.equal(w2.sendt.filter((m) => m.type === 'terminate').length, 0);
  // Positiv kontrol: bestilt for den nuvaerende forbindelse lukker den.
  w2.onmessage({ data: JSON.stringify({ id: 9, method: 'x', params: {} }) });
  return vent(5).then(() => {
    const nu = b.sendt.filter((m) => m.type === 'mcp_command').at(-1).gen;
    for (const f of terminer) f({ type: 'terminate_mcp_session', port: P, gen: nu });
    assert.equal(w2.readyState, 3, 'en frigivelse for den nuvaerende forbindelse lukkede den ikke');
  });
});

// ── R138 (Astra, MAALT i model paa e2ec519) ─────────────────────────────────────
// Et kald fra den gamle forbindelse ventede i sessionsgendannelsen (storage.local.get), mens forbindelsen lukkede, og en ny
// forbindelse paa samme port (en partition, pid null) tog porten og aabnede fane 99. Da gendannelsen slap, koerte det gamle
// kald sin kode i fane 99 og stemplede sessionen tilbage til den gamle generation og dens pid. Et kald fra en forbindelse, der
// er lukket, maa intet koere og intet overtage.
// Opstilling: et kald fra `gammelGen` venter i sessionsgendannelsen; `imens` koerer, mens det venter; saa slippes det.
async function ventendeKald(gammelGen, imens, ekstraSvar = {}, foer = null) {
  let slip, ventede;
  const blokeret = new Promise((r) => { slip = r; });
  const inde = new Promise((r) => { ventede = r; });
  let blokerEn = true;
  const koert = [];
  const koertI = [];   // [kode, fane]
  const fane = { id: 99, url: 'about:blank', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'storage.local.get': (arg) => {
      if (blokerEn && arg && Object.hasOwn(arg, 'mcpPorts')) { blokerEn = false; ventede(); return blokeret; }
      return arg && typeof arg === 'object' ? { ...arg } : {};
    },
    'tabs.create': fane, 'tabs.get': fane, 'tabs.query': [], 'tabs.group': 1,
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 99, attached: true }],
    'debugger.sendCommand': (maal, metode, p) => {
      if (metode === 'Runtime.evaluate') { koert.push(p.expression); koertI.push([p.expression, maal.tabId]); return { result: { value: p.expression } }; }
      return {};
    },
    ...ekstraSvar,
  } });
  const lytter = u.lyttere.get('runtime.onMessage')[0];
  const kald = (gen, pid, kode) => new Promise((ok) => lytter(
    { type: 'mcp_command', port: 19861, gen, pid, method: 'execute_script', params: { code: kode } }, {}, ok));
  if (foer) await foer(u);
  const gammelt = kald(gammelGen, 101, '"GAMMEL"');
  await inde;
  await imens({ u, kald });
  slip({ mcpPorts: [19861] });
  return { u, sent: await gammelt, koert, koertI, kald };
}

// R138 (Opus, LAEST paa e7179d4): erstatter udvidelsen selv broen (closeDocument), koerer det gamle dokuments onclose naeppe, og
// dets forbindelser faar aldrig en session_disconnect. Et kald fra det gamle dokument maa alligevel intet koere: en kommando fra
// et NYT dokument, eller en genopbygning af broen, goer alle det gamle dokuments forbindelser lukkede.
test('et kald fra et ERSTATTET bro-dokument koerer intet, naar det nye dokuments forbindelse har taget porten (R138)', async () => {
  const { u, sent, koert } = await ventendeKald('aaaa1111-1', async ({ kald }) => {
    const nyt = await kald('bbbb2222-1', null, '"NY"');
    assert.match(String(nyt.result), /NY/, 'det nye dokuments kald koerte ikke - proeven kan ikke maale noget');
  });
  assert.ok(!koert.some((k) => k.includes('GAMMEL')), `det erstattede dokuments kode koerte: ${JSON.stringify(koert)}`);
  assert.equal(sent.sent, false, JSON.stringify(sent));
  assert.equal(u.hent('sessions').get(19861).gen, 'bbbb2222-1', 'det erstattede dokument overtog sessionen');
});

test('et kald fra bro-dokumentet koerer intet, naar udvidelsen har genopbygget broen imens (R138)', async () => {
  const { sent, koert } = await ventendeKald('aaaa1111-1', async ({ u }) => {
    // samme dokument har allerede kaldt foer (det er den aktuelle bro), saa genopbygges broen
    await u.hent('genbygOffscreen')();
  }, (() => {
    // Som i Chrome: efter closeDocument findes dokumentet ikke, saa genopbygningen opretter et nyt uden at spoerge det gamle.
    let findes = true;
    return { 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; },
      'offscreen.createDocument': () => { findes = true; },
      // den nye bro svarer med den rigtige udgave, saa INTET andet end genopbygningen lukker den gamle
      'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) };
  })());
  assert.ok(!koert.some((k) => k.includes('GAMMEL')), `koden fra den lukkede bro koerte: ${JSON.stringify(koert)}`);
  assert.equal(sent.sent, false, JSON.stringify(sent));
});

test('et kald fra en LUKKET forbindelse, der ventede i gendannelsen, koerer intet i den nye forbindelses fane (R138)', async () => {
  let slip, ventede;
  const blokeret = new Promise((r) => { slip = r; });
  const inde = new Promise((r) => { ventede = r; });
  const koert = [];
  const fane = { id: 99, url: 'about:blank', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'storage.local.get': (arg) => {
      if (arg && Object.hasOwn(arg, 'mcpPorts')) { ventede(); return blokeret; }
      return arg && typeof arg === 'object' ? { ...arg } : {};
    },
    'tabs.create': fane, 'tabs.get': fane, 'tabs.query': [], 'tabs.group': 1,
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 99, attached: true }],
    'debugger.sendCommand': (maal, metode, p) => {
      if (metode === 'Runtime.evaluate') { koert.push(p.expression); return { result: { value: p.expression } }; }
      return {};
    },
  } });
  const lytter = u.lyttere.get('runtime.onMessage')[0];
  const kald = (gen, pid, kode) => new Promise((ok) => lytter(
    { type: 'mcp_command', port: 19861, gen, pid, method: 'execute_script', params: { code: kode } }, {}, ok));
  const gammelt = kald('gammel', 101, '"GAMMEL"');
  await inde;
  await u.fyr('runtime.onMessage', { type: 'session_disconnect', port: 19861, gen: 'gammel' }, {}, () => {});
  const nyt = await kald('ny', null, '"NY"');
  assert.match(String(nyt.result), /NY/, 'den nye forbindelses kald koerte ikke - proeven kan ikke maale noget');
  slip({ mcpPorts: [19861] });
  const sent = await gammelt;
  assert.ok(!koert.some((k) => k.includes('GAMMEL')), `den lukkede forbindelses kode koerte i fane 99: ${JSON.stringify(koert)}`);
  assert.equal(sent.sent, false, `svaret paa det gamle kald siger ikke sent:false: ${JSON.stringify(sent)}`);
  const s = u.hent('sessions').get(19861);
  assert.equal(s.gen, 'ny', 'den lukkede forbindelse overtog sessionen');
  assert.equal(s.pid, null, 'den lukkede forbindelses pid blev stemplet paa den nye forbindelses session');
});

// ── R139 (Astra, MAALT i model paa 1e00079) ─────────────────────────────────────
// Adoptionen venter selv (mcpPorts, tabs.get) og skrev derefter sessionskortet uden at se efter igen: et kald fra en lukket
// forbindelse adopterede en forældreløs donors session INDOVER den nye forbindelses session, og den nye forbindelses NAESTE kald
// koerte i donorens fane. Adoptionen genkontrollerer nu efter hver ventetid: kaldets forbindelse, at porten stadig ingen faner
// ejer, og at donoren er uaendret.
test('et lukket kald i adoptionen overtager ikke den nye forbindelses session - og dens naeste kald koerer i dens egen fane (R139)', async () => {
  const { u, sent, koert, koertI, kald } = await ventendeKald('aaaa1111-1', async ({ u: v, kald: k }) => {
    await v.fyr('runtime.onMessage', { type: 'session_disconnect', port: 19861, gen: 'aaaa1111-1' }, {}, () => {});
    const nyt = await k('aaaa1111-2', null, '"NY"');
    assert.match(String(nyt.result), /NY/, 'den nye forbindelses kald koerte ikke - proeven kan ikke maale noget');
  }, {}, async (v) => {
    // en forældreløs session paa 19862 med samme pid som det gamle kald: noget adoptionen kan tage
    v.hent('getSession')(19862, 101, 'donor-1');
    await v.hent('addTabToSession')(19862, 41);
  });
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `det lukkede kalds kode koerte: ${JSON.stringify(koert)}`);
  assert.equal(sent.sent, false, JSON.stringify(sent));
  const s = u.hent('sessions').get(19861);
  assert.equal(s.gen, 'aaaa1111-2', 'sessionen paa porten tilhoerer ikke laengere den nye forbindelse');
  assert.equal(s.pid, null, 'det lukkede kalds pid blev stemplet paa porten');
  assert.ok(s.tabIds.has(99) && !s.tabIds.has(41), `porten ejer forkerte faner: ${JSON.stringify([...s.tabIds])}`);
  assert.ok(u.hent('sessions').get(19862)?.tabIds.has(41), 'donorens session blev flyttet af et lukket kald');
  const naeste = await kald('aaaa1111-2', null, '"NAESTE"');
  assert.match(String(naeste.result), /NAESTE/);
  const fane = koertI.find(([x]) => x.includes('NAESTE'))?.[1];
  assert.equal(fane, 99, `den nye forbindelses naeste kald koerte i fane ${fane}, ikke i sin egen (99)`);
});

test('to forbindelser fra SAMME bro-dokument efter hinanden koerer begge (R139: dokumentet doer ikke af sig selv)', async () => {
  const { u } = await ventendeKald('cccc3333-1', async () => {});
  const lytter = u.lyttere.get('runtime.onMessage')[0];
  const kald = (gen, kode) => new Promise((ok) => lytter(
    { type: 'mcp_command', port: 19861, gen, pid: null, method: 'execute_script', params: { code: kode } }, {}, ok));
  const a = await kald('cccc3333-1', '"A"');
  const b = await kald('cccc3333-2', '"B"');
  assert.match(String(a.result), /A/, `foerste kald blev afvist: ${JSON.stringify(a)}`);
  assert.match(String(b.result), /B/, `en ny forbindelse fra samme dokument blev afvist: ${JSON.stringify(b)}`);
});

test('hjerteslaget erstatter en doed bro: et kald fra den, der ventede imens, koerer intet (R139)', async () => {
  const { sent, koert } = await ventendeKald('dddd4444-1', async ({ u }) => {
    await u.hent('ensureOffscreen')();
  }, (() => {
    let findes = true;
    // broen svarer ikke (to ping), saa hjerteslaget lukker den og bygger en ny
    return { 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; },
      'offscreen.createDocument': () => { findes = true; }, 'runtime.sendMessage': () => new Promise(() => {}) };
  })());
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `koden fra den erstattede bro koerte: ${JSON.stringify(koert)}`);
  assert.equal(sent.sent, false, JSON.stringify(sent));
});

test('kan broen ikke lukkes, er den ikke erstattet: kald fra den koerer stadig (R139)', async () => {
  const { sent, koert } = await ventendeKald('eeee5555-1', async ({ u }) => {
    await u.hent('genbygOffscreen')();
  }, { 'offscreen.hasDocument': true, 'offscreen.closeDocument': () => { throw new Error('closeDocument afvist'); },
    'offscreen.createDocument': undefined, 'runtime.getManifest': { version: '9.9.9' },
    'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) });
  assert.ok(koert.some((x) => x.includes('GAMMEL')), `en levende bro blev afvist, fordi lukningen fejlede: ${JSON.stringify(sent)}`);
});

test('et lukket kald adopterer ikke donorens faner til en port, ingen ny forbindelse har taget endnu (R139: generationen alene)', async () => {
  const { u, sent } = await ventendeKald('ffff6666-1', async ({ u: v }) => {
    await v.fyr('runtime.onMessage', { type: 'session_disconnect', port: 19861, gen: 'ffff6666-1' }, {}, () => {});
  }, {}, async (v) => {
    v.hent('getSession')(19862, 101, 'donor-1');
    await v.hent('addTabToSession')(19862, 41);
  });
  assert.equal(sent.sent, false, JSON.stringify(sent));
  assert.ok(u.hent('sessions').get(19862)?.tabIds.has(41), 'donorens faner blev flyttet til en lukket forbindelses port');
  assert.ok(!u.hent('sessions').get(19861)?.tabIds.has(41), 'den lukkede forbindelses port fik donorens fane');
});

test('aendres donoren, mens adoptionen venter paa fanerne, adopteres intet (R139)', async () => {
  let slipFaner, venterPaaFaner, spaer = false;
  const faneSpaerre = new Promise((r) => { slipFaner = r; });
  const inde = new Promise((r) => { venterPaaFaner = r; });
  const u = indlaesUdvidelse({ svar: {
    'storage.local.get': (arg) => (arg && Object.hasOwn(arg, 'mcpPorts') ? { mcpPorts: [19861] } : (arg && typeof arg === 'object' ? { ...arg } : {})),
    // spaerren slaas foerst til, naar opstillingen er faerdig (addTabToSession spoerger selv tabs.get)
    'tabs.get': (id) => { if (!spaer) return { id }; venterPaaFaner(); return faneSpaerre.then(() => ({ id })); },
  } });
  u.hent('getSession')(19862, 101, 'donor-1');
  await u.hent('addTabToSession')(19862, 41);
  spaer = true;
  const adoption = u.hent('adoptOrphanedSession')(19861, 101, 'gggg7777-1');
  await inde;
  // imens: donorens port faar en ny session (en anden forbindelse tog porten og aabnede sin egen fane)
  u.hent('sessions').delete(19862);
  u.hent('getSession')(19862, 202, 'anden-1');
  const ny = u.hent('sessions').get(19862);
  slipFaner();
  assert.equal(await adoption, null, 'adoptionen tog en donor, der var aendret imens');
  assert.equal(u.hent('sessions').get(19862), ny, 'den nye session paa donorens port blev flyttet');
});

// ── R140 (Astra, MAALT i model paa 38169d0) ─────────────────────────────────────
// Adoptionens slutkontrol saa kun donorens objekt-identitet. Kom donorens forbindelse tilbage, mens adoptionen ventede paa fanerne,
// skiftede getSession generationen paa SAMME objekt - kontrollen bestod, og den levende donors fane blev flyttet. Plus fire
// mutanter, der overlevede, fordi to betingelser altid blev testet sammen.
function adoptionsSele({ mcpPorts = [19861] } = {}) {
  let slipFaner, venterPaaFaner, spaer = false;
  const faneSpaerre = new Promise((r) => { slipFaner = r; });
  const inde = new Promise((r) => { venterPaaFaner = r; });
  const lager = { mcpPorts };
  const u = indlaesUdvidelse({ svar: {
    'storage.local.get': (arg) => (arg && Object.hasOwn(arg, 'mcpPorts') ? { mcpPorts: [...lager.mcpPorts] } : (arg && typeof arg === 'object' ? { ...arg } : {})),
    // kun donorens fane (41) spaerres - andre opslag (fx addTabToSession for en ny fane) svarer straks
    'tabs.get': (id) => { if (!spaer || id !== 41) return { id }; venterPaaFaner(); return faneSpaerre.then(() => ({ id })); },
  } });
  return { u, lager, spaerNu: () => { spaer = true; }, inde, slip: () => slipFaner() };
}
async function medDonor(s) {
  s.u.hent('getSession')(19862, 101, 'donor-1');
  await s.u.hent('addTabToSession')(19862, 41);
  s.spaerNu();
}

test('kommer donorens forbindelse tilbage, mens adoptionen venter, adopteres intet (R140: levende donor)', async () => {
  const s = adoptionsSele();
  await medDonor(s);
  const adoption = s.u.hent('adoptOrphanedSession')(19861, 101, 'aaaa1111-2');
  await s.inde;
  s.lager.mcpPorts = [19861, 19862];
  s.u.hent('getSession')(19862, 101, 'aaaa1111-3');   // donorens forbindelse er tilbage og har sendt en kommando
  s.slip();
  assert.equal(await adoption, null, 'en levende donors session blev adopteret');
  assert.ok(s.u.hent('sessions').get(19862)?.tabIds.has(41), 'den levende donor mistede sin fane');
});

test('donorens generation alene: skifter den, mens adoptionen venter, adopteres intet (R140)', async () => {
  const s = adoptionsSele();
  await medDonor(s);
  const adoption = s.u.hent('adoptOrphanedSession')(19861, 101, 'aaaa1111-2');
  await s.inde;
  s.u.hent('getSession')(19862, 101, 'aaaa1111-3');   // porten staar endnu ikke i mcpPorts - kun generationen viser det
  s.slip();
  assert.equal(await adoption, null, 'donoren skiftede generation, men blev adopteret');
});

test('donorens port alene: bliver den levende, mens adoptionen venter, adopteres intet (R140)', async () => {
  const s = adoptionsSele();
  await medDonor(s);
  const adoption = s.u.hent('adoptOrphanedSession')(19861, 101, 'aaaa1111-2');
  await s.inde;
  s.lager.mcpPorts = [19861, 19862];   // forbindelsen er tilbage, men har ikke sendt noget endnu
  s.slip();
  assert.equal(await adoption, null, 'donorens port blev levende, men sessionen blev adopteret');
});

test('porten faar en fane, mens adoptionen venter - adoptionen overskriver den ikke (R140: kun portenEjerFaner)', async () => {
  const s = adoptionsSele();
  await medDonor(s);
  const adoption = s.u.hent('adoptOrphanedSession')(19861, 101, 'aaaa1111-2');
  await s.inde;
  s.u.hent('getSession')(19861, 101, 'aaaa1111-2');   // samme, levende forbindelse aabner en fane imens
  await s.u.hent('addTabToSession')(19861, 99);
  s.slip();
  assert.equal(await adoption, null, 'adoptionen overskrev en port, der ejede en fane');
  assert.ok(s.u.hent('sessions').get(19861)?.tabIds.has(99), 'portens egen fane forsvandt');
});

test('lukker forbindelsen, mens adoptionen venter paa fanerne, adopteres intet (R140: generationstjekket efter tabs.get)', async () => {
  const s = adoptionsSele();
  await medDonor(s);
  const adoption = s.u.hent('adoptOrphanedSession')(19861, 101, 'hhhh8888-1');
  await s.inde;
  await s.u.fyr('runtime.onMessage', { type: 'session_disconnect', port: 19861, gen: 'hhhh8888-1' }, {}, () => {});
  s.slip();
  assert.equal(await adoption, null, 'en forbindelse, der lukkede under tabs.get, adopterede');
  assert.ok(s.u.hent('sessions').get(19862)?.tabIds.has(41));
});

test('hjerteslaget: afvises lukningen, og svarer broen igen, koerer kald fra den stadig (R140)', async () => {
  let pingSvarer = false;
  const { koert } = await ventendeKald('iiii9999-1', async ({ u }) => {
    await u.hent('ensureOffscreen')();   // broen svarer ikke -> lukning forsoeges -> afvist
    pingSvarer = true;
  }, { 'offscreen.hasDocument': true, 'offscreen.closeDocument': () => { throw new Error('closeDocument afvist'); },
    'offscreen.createDocument': undefined, 'runtime.getManifest': { version: '9.9.9' },
    'runtime.sendMessage': () => (pingSvarer ? { ok: true, version: '9.9.9' } : new Promise(() => {})) });
  assert.ok(koert.some((x) => x.includes('GAMMEL')), 'en levende bro blev markeret lukket, fordi hjerteslagets lukning fejlede');
});

// ── R141 (Astra, MAALT i model paa 08fa0b9) ─────────────────────────────────────
// Den sidste lagerlaesning kunne aflevere et AELDRE billede af de levende porte end en ws_status, udvidelsen allerede havde faaet.
// Adoptionen ser nu ogsaa broens seneste status (holdt i hukommelsen, sat synkront i lytteren). Og de to tjek, der kun blev
// proevet ved tabs.get, proeves nu ogsaa under den sidste laesning (N1, N2).
function sidsteLaesningSele() {
  let slipLaes, venterPaaLaes, laesninger = 0, spaer = false;
  const laesSpaerre = new Promise((r) => { slipLaes = r; });
  const inde = new Promise((r) => { venterPaaLaes = r; });
  const u = indlaesUdvidelse({ svar: {
    'storage.local.get': (arg) => {
      if (!(arg && Object.hasOwn(arg, 'mcpPorts'))) return arg && typeof arg === 'object' ? { ...arg } : {};
      laesninger += 1;
      // anden mcpPorts-laesning i adoptionen spaerres og afleverer det GAMLE billede
      if (spaer && laesninger === 2) { venterPaaLaes(); return laesSpaerre.then(() => ({ mcpPorts: [19861] })); }
      return { mcpPorts: [19861] };
    },
  } });
  return { u, inde, slip: () => slipLaes(), spaerNu: () => { spaer = true; laesninger = 0; } };
}
async function donorOgStart(s, gen) {
  s.u.hent('getSession')(19862, 101, 'donor-1');
  await s.u.hent('addTabToSession')(19862, 41);
  s.spaerNu();
  const adoption = s.u.hent('adoptOrphanedSession')(19861, 101, gen);
  await s.inde;
  return { adoption };   // pakket ind: et returneret promise ville blive ventet paa (og venter selv paa slip)
}

test('et forældet lagersvar overtrumfer ikke en status, udvidelsen allerede har faaet: levende donor adopteres ikke (R141)', async () => {
  const s = sidsteLaesningSele();
  const { adoption } = await donorOgStart(s, 'aaaa1111-2');
  // broen melder donorens port levende, mens lagerlaesningen er undervejs (med det gamle billede)
  await s.u.fyr('runtime.onMessage', { type: 'ws_status', connected: true, count: 2, ports: [19861, 19862] }, {}, () => {});
  s.slip();
  assert.equal(await adoption, null, 'et forældet lagersvar fik adoptionen til at tage en levende donor');
  assert.ok(s.u.hent('sessions').get(19862)?.tabIds.has(41), 'den levende donor mistede sin fane');
});

test('lukker forbindelsen under adoptionens sidste laesning, adopteres intet (R141: N1)', async () => {
  const s = sidsteLaesningSele();
  const { adoption } = await donorOgStart(s, 'jjjj1010-1');
  await s.u.fyr('runtime.onMessage', { type: 'session_disconnect', port: 19861, gen: 'jjjj1010-1' }, {}, () => {});
  s.slip();
  assert.equal(await adoption, null, 'en forbindelse, der lukkede under den sidste laesning, adopterede');
});

test('faar porten en fane under adoptionens sidste laesning, overskrives den ikke (R141: N2)', async () => {
  const s = sidsteLaesningSele();
  const { adoption } = await donorOgStart(s, 'kkkk1111-1');
  s.u.hent('getSession')(19861, 101, 'kkkk1111-1');
  await s.u.hent('addTabToSession')(19861, 99);
  s.slip();
  assert.equal(await adoption, null, 'adoptionen overskrev en port, der fik en fane under den sidste laesning');
  assert.ok(s.u.hent('sessions').get(19861)?.tabIds.has(99));
});

// ── R141 (Opus, hærdning) ───────────────────────────────────────────────────────
test('adoptionens foerste filter bruger broens status, naar den kendes: et aeldre lagersvar springer ikke en gyldig donor over (R141)', async () => {
  const u = indlaesUdvidelse({ svar: {
    // lageret er aeldre: det tror stadig, donorens port 19862 er forbundet
    'storage.local.get': (arg) => (arg && Object.hasOwn(arg, 'mcpPorts') ? { mcpPorts: [19861, 19862] } : (arg && typeof arg === 'object' ? { ...arg } : {})),
  } });
  u.hent('getSession')(19862, 101, 'donor-1');
  await u.hent('addTabToSession')(19862, 41);
  await u.fyr('runtime.onMessage', { type: 'ws_status', connected: true, count: 1, ports: [19861] }, {}, () => {});
  const r = await u.hent('adoptOrphanedSession')(19861, 101, 'llll1212-1');
  assert.ok(r && r.tabIds.has(41), 'en gyldig donor blev sprunget over, fordi lageret var aeldre end broens status');
});

test('lukker closeDocument broen og kaster bagefter, er broen erstattet: kald fra den koerer intet (R141 H3)', async () => {
  let findes = true;
  const { sent, koert } = await ventendeKald('mmmm1313-1', async ({ u }) => {
    await u.hent('genbygOffscreen')();
  }, { 'runtime.getContexts': () => (findes ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []), 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; throw new Error('lukket, men svaret fejlede'); },
    'offscreen.createDocument': () => { findes = true; }, 'runtime.getManifest': { version: '9.9.9' },
    'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) });
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `koden fra den lukkede bro koerte: ${JSON.stringify(sent)}`);
  assert.equal(sent.sent, false, JSON.stringify(sent));
});

test('hjerteslaget: lukker closeDocument broen og kaster bagefter, er broen erstattet (R141 H3)', async () => {
  let findes = true;
  const { sent, koert } = await ventendeKald('nnnn1414-1', async ({ u }) => {
    await u.hent('ensureOffscreen')();
  }, { 'runtime.getContexts': () => (findes ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []), 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; throw new Error('lukket, men svaret fejlede'); },
    'offscreen.createDocument': () => { findes = true; }, 'runtime.sendMessage': () => new Promise(() => {}) });
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `koden fra den lukkede bro koerte: ${JSON.stringify(sent)}`);
});

// ── R142 (Astra, dækning) ───────────────────────────────────────────────────────
// Broens portliste i hukommelsen: hver status ERSTATTER den forrige, portnumre kan komme som tekst, og en gyldig adoption skal
// lykkes, naar listen kendes. Hver proeve er det eneste vaern for sin mutant (M1-M4).
async function statusOgAdoption(statusser, gen) {
  const u = indlaesUdvidelse({ svar: {
    'storage.local.get': (arg) => (arg && Object.hasOwn(arg, 'mcpPorts') ? { mcpPorts: [] } : (arg && typeof arg === 'object' ? { ...arg } : {})),
  } });
  u.hent('getSession')(19862, 101, 'donor-1');
  await u.hent('addTabToSession')(19862, 41);
  for (const ports of statusser) await u.fyr('runtime.onMessage', { type: 'ws_status', connected: true, count: ports.length, ports }, {}, () => {});
  return { u, r: await u.hent('adoptOrphanedSession')(19861, 101, gen) };
}

test('kommer donorens port igen i en SENERE status, er donoren levende (R142: M1, kun foerste status gemt)', async () => {
  const { r, u } = await statusOgAdoption([[19861], [19861, 19862]], 'oooo1515-1');
  assert.equal(r, null, 'den seneste status blev ignoreret, og en levende donor blev adopteret');
  assert.ok(u.hent('sessions').get(19862)?.tabIds.has(41));
});

test('portnumre som tekst i status beskytter ogsaa donoren (R142: M2)', async () => {
  const { r } = await statusOgAdoption([['19861', '19862']], 'pppp1616-1');
  assert.equal(r, null, 'en donorport sendt som tekst blev ikke genkendt som levende');
});

test('gyldig adoption med kendt portliste: kun adoptørens port er forbundet, donoren adopteres (R142: M3)', async () => {
  const { r } = await statusOgAdoption([[19861]], 'qqqq1717-1');
  assert.ok(r && r.tabIds.has(41), 'en gyldig adoption blev afvist, selv om kun adoptørens egen port er forbundet');
});

test('forsvinder donorens port fra en senere status, adopteres den (R142: M4, listen erstattes - den lægges ikke sammen)', async () => {
  const { r } = await statusOgAdoption([[19861, 19862], [19861]], 'rrrr1818-1');
  assert.ok(r && r.tabIds.has(41), 'en port, broen ikke længere melder, blev stadig regnet som levende');
});

// ── R143 (Astra, dækning A1-A4) ─────────────────────────────────────────────────
test('afvises lukningen, og kan Chrome ikke svare paa om broen findes, er broen IKKE erstattet: kald fra den koerer (R143: A1)', async () => {
  const { koert } = await ventendeKald('ssss1919-1', async ({ u }) => {
    await u.hent('genbygOffscreen')();
  }, (() => {
    // efter det afviste lukkeforsoeg kan Chrome ikke svare paa, om dokumentet findes (foerste kontrol); derefter svarer det igen
    let lukForsoegt = false, kontrolAfvist = false;
    return { 'offscreen.hasDocument': () => { if (lukForsoegt && !kontrolAfvist) { kontrolAfvist = true; throw new Error('hasDocument afvist'); } return true; },
      'offscreen.closeDocument': () => { lukForsoegt = true; throw new Error('closeDocument afvist'); }, 'offscreen.createDocument': undefined,
      'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) };
  })());
  assert.ok(koert.some((x) => x.includes('GAMMEL')), 'en bro, hvis lukning ikke kunne bekræftes, blev markeret lukket');
});

test('hjerteslaget: lukker closeDocument og kaster bagefter, bygges en ny bro (R143: A2)', async () => {
  let findes = true, oprettet = 0;
  await ventendeKald('tttt2020-1', async ({ u }) => {
    await u.hent('ensureOffscreen')();
  }, { 'runtime.getContexts': () => (findes ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []), 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; throw new Error('lukket, men svaret fejlede'); },
    'offscreen.createDocument': () => { oprettet += 1; findes = true; }, 'runtime.sendMessage': () => new Promise(() => {}) });
  assert.equal(oprettet, 1, 'hjerteslaget gav op efter H3 i stedet for at bygge en ny bro');
});

test('genopbygningen: H3 og en fejlet oprettelse - den gamle bro er stadig erstattet (R143: A3)', async () => {
  let findes = true;
  const { sent, koert } = await ventendeKald('uuuu2121-1', async ({ u }) => {
    await u.hent('genbygOffscreen')().catch(() => {});
  }, { 'runtime.getContexts': () => (findes ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []), 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; throw new Error('lukket, men svaret fejlede'); },
    'offscreen.createDocument': () => { throw new Error('oprettelse fejlede'); }, 'runtime.getManifest': { version: '9.9.9' },
    'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) });
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `koden fra den lukkede bro koerte, fordi oprettelsen fejlede: ${JSON.stringify(sent)}`);
});

test('foerste filter: en levende donor sorteres fra, og den doede donor adopteres - ogsaa naar den levende er stoerst (R143: A4)', async () => {
  const u = indlaesUdvidelse({ svar: {
    'storage.local.get': (arg) => (arg && Object.hasOwn(arg, 'mcpPorts') ? { mcpPorts: [] } : (arg && typeof arg === 'object' ? { ...arg } : {})),
  } });
  u.hent('getSession')(19862, 101, 'levende-1');
  await u.hent('addTabToSession')(19862, 41);
  await u.hent('addTabToSession')(19862, 42);
  u.hent('getSession')(19863, 101, 'doed-1');
  await u.hent('addTabToSession')(19863, 43);
  await u.fyr('runtime.onMessage', { type: 'ws_status', connected: true, count: 2, ports: [19861, 19862] }, {}, () => {});
  const r = await u.hent('adoptOrphanedSession')(19861, 101, 'vvvv2222-1');
  assert.ok(r && r.tabIds.has(43), `den doede donor blev ikke adopteret (den levende blev valgt og afvist): ${r && JSON.stringify([...r.tabIds])}`);
  assert.ok(u.hent('sessions').get(19862)?.tabIds.has(41), 'den levende donor mistede sine faner');
});

// ── R143 (Opus, hærdning F1/F2) ─────────────────────────────────────────────────
// Svarer hasDocument falsk om en bro, der lever, blev den markeret doed, og alle dens kald afvist, indtil Reconnect. Broen regnes nu
// kun som vaek, naar ogsaa Chromes kontekstliste er tom - to uafhaengige kilder.
test('siger hasDocument falsk, men findes broens kontekst stadig, er broen IKKE erstattet: kald fra den koerer (R143 F1)', async () => {
  const { koert } = await ventendeKald('wwww2323-1', async ({ u }) => {
    await u.hent('genbygOffscreen')();
  }, (() => {
    let lukForsoegt = false, falskSvar = false;
    return {
      'offscreen.hasDocument': () => { if (lukForsoegt && !falskSvar) { falskSvar = true; return false; } return true; },
      'offscreen.closeDocument': () => { lukForsoegt = true; throw new Error('closeDocument afvist'); }, 'offscreen.createDocument': undefined,
      'runtime.getContexts': () => [{ contextType: 'OFFSCREEN_DOCUMENT', documentUrl: 'chrome-extension://test/offscreen.html' }],
      'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }),
    };
  })());
  assert.ok(koert.some((x) => x.includes('GAMMEL')), 'en levende bro blev markeret doed paa ét falsk hasDocument-svar');
});

test('kan Chrome ikke liste sine kontekster, er broen IKKE erstattet: kald fra den koerer (R143 F1, uafklaret)', async () => {
  const { koert } = await ventendeKald('xxxx2424-1', async ({ u }) => {
    await u.hent('genbygOffscreen')();
  }, (() => {
    let lukForsoegt = false, falskSvar = false;
    return {
      'offscreen.hasDocument': () => { if (lukForsoegt && !falskSvar) { falskSvar = true; return false; } return true; },
      'offscreen.closeDocument': () => { lukForsoegt = true; throw new Error('closeDocument afvist'); }, 'offscreen.createDocument': undefined,
      'runtime.getContexts': () => { throw new Error('getContexts afvist'); },
      'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }),
    };
  })());
  assert.ok(koert.some((x) => x.includes('GAMMEL')), 'en bro blev markeret doed, selv om Chrome ikke kunne bekræfte det');
});

// ── R144 (Astra) ────────────────────────────────────────────────────────────────
// B1: uden runtime.getContexts (Chrome foer 116) afgoer hasDocument alene. B2: kontekstlisten skal spoerges efter OFFSCREEN_DOCUMENT -
// svaret her afhaenger af filteret. Og: finder hjerteslaget ingen bro, og bekræfter begge kilder det, er den forrige bro erstattet.
function h3Svar(ekstra = {}) {
  let findes = true;
  return { 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; throw new Error('lukket, men svaret fejlede'); },
    'offscreen.createDocument': () => { findes = true; }, 'runtime.getManifest': { version: '9.9.9' },
    'runtime.getContexts': () => (findes ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
    'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }), ...ekstra };
}

test('uden runtime.getContexts afgoer hasDocument alene: H3 erstatter broen (R144: B1)', async () => {
  const { sent, koert } = await ventendeKald('yyyy2525-1', async ({ u }) => {
    await u.hent('genbygOffscreen')();
  }, h3Svar(), (u) => { delete u.ctx.chrome.runtime.getContexts; });
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `uden getContexts blev en lukket bro ikke erstattet: ${JSON.stringify(sent)}`);
});

test('kontekstlisten spoerges efter OFFSCREEN_DOCUMENT - service workerens egen kontekst holder ikke broen i live (R144: B2)', async () => {
  const { sent, koert } = await ventendeKald('zzzz2626-1', async ({ u }) => {
    await u.hent('genbygOffscreen')();
  }, h3Svar({ 'runtime.getContexts': (filter) => [{ contextType: 'BACKGROUND' }]   // dokumentet er lukket; workeren findes
    .filter((k) => !filter?.contextTypes || filter.contextTypes.includes(k.contextType)) }));
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `en lukket bro blev holdt i live af en anden konteksttype: ${JSON.stringify(sent)}`);
});

test('finder hjerteslaget ingen bro, og bekræfter begge kilder det, er den forrige bro erstattet (R144)', async () => {
  let kontekstHaenger = true;
  const { sent, koert } = await ventendeKald('abab2727-1', async ({ u }) => {
    await u.hent('genbygOffscreen')().catch(() => {});     // H3, men kontekstlisten viser stadig dokumentet -> ikke markeret
    kontekstHaenger = false;
    await u.hent('ensureOffscreen')().catch(() => {});     // naeste hjerteslag: intet dokument, ingen kontekst
  }, h3Svar({ 'offscreen.createDocument': () => { throw new Error('oprettelse fejlede'); },
    'runtime.getContexts': () => (kontekstHaenger ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []) }));
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `hjerteslaget genoprettede uden at erstatte den forrige bro: ${JSON.stringify(sent)}`);
});

test('uden getContexts: kan Chrome ikke svare paa om broen findes, er den IKKE erstattet (R144: A1 for Chrome foer 116)', async () => {
  const { koert } = await ventendeKald('cdcd2828-1', async ({ u }) => {
    await u.hent('genbygOffscreen')();
  }, (() => {
    let lukForsoegt = false, kontrolAfvist = false;
    return { 'offscreen.hasDocument': () => { if (lukForsoegt && !kontrolAfvist) { kontrolAfvist = true; throw new Error('hasDocument afvist'); } return true; },
      'offscreen.closeDocument': () => { lukForsoegt = true; throw new Error('closeDocument afvist'); }, 'offscreen.createDocument': undefined,
      'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) };
  })(), (u) => { delete u.ctx.chrome.runtime.getContexts; });
  assert.ok(koert.some((x) => x.includes('GAMMEL')), 'uden getContexts blev en bro markeret lukket paa et uafklaret hasDocument');
});

// ── R145 (Astra, dækning C2-C4 + den trofaste A3) ───────────────────────────────
// Hjerteslaget, naar broen er forsvundet af sig selv: markerer det, og bygger det en ny? Og H3-markeringen sker FOER oprettelsen.
function forsvundetSvar(kontekster) {
  const s = { findes: true, oprettet: 0 };
  const svar = { 'offscreen.hasDocument': () => s.findes, 'offscreen.createDocument': () => { s.oprettet += 1; s.findes = true; },
    'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) };
  if (kontekster !== undefined) svar['runtime.getContexts'] = kontekster;
  return { s, svar };
}

test('broen forsvinder af sig selv: hjerteslaget markerer den forrige OG bygger én ny (R145: C2)', async () => {
  const { s, svar } = forsvundetSvar(() => []);
  const { sent, koert } = await ventendeKald('efef2929-1', async ({ u }) => {
    await u.hent('ensureOffscreen')();   // opstartens egen opbygning er faerdig - ellers slutter hjerteslaget sig blot til den
    s.findes = false;
    await u.hent('ensureOffscreen')();
  }, svar);
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `den forsvundne bros kald koerte: ${JSON.stringify(sent)}`);
  assert.equal(s.oprettet, 1, `hjerteslaget byggede ${s.oprettet} broer, ikke én`);
});

test('broen forsvinder af sig selv uden getContexts: hasDocument alene markerer (R145: C3)', async () => {
  const { s, svar } = forsvundetSvar();
  const { sent, koert } = await ventendeKald('ghgh3030-1', async ({ u }) => {
    await u.hent('ensureOffscreen')();   // opstartens egen opbygning er faerdig - ellers slutter hjerteslaget sig blot til den
    s.findes = false;
    await u.hent('ensureOffscreen')();
  }, svar, (u) => { delete u.ctx.chrome.runtime.getContexts; });
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `uden getContexts blev den forsvundne bro ikke markeret: ${JSON.stringify(sent)}`);
  assert.equal(s.oprettet, 1);
});

test('broen forsvinder, men fraværet kan ikke bekræftes: hjerteslaget bygger stadig en ny bro (R145: C4)', async () => {
  const { s, svar } = forsvundetSvar(() => { throw new Error('getContexts afvist'); });
  const { koert } = await ventendeKald('ijij3131-1', async ({ u }) => {
    await u.hent('ensureOffscreen')();   // opstartens egen opbygning er faerdig - ellers slutter hjerteslaget sig blot til den
    s.findes = false;
    await u.hent('ensureOffscreen')();
  }, svar);
  assert.equal(s.oprettet, 1, 'hjerteslaget opgav at bygge en ny bro, fordi fraværet ikke kunne bekræftes');
  // R146 (Astra D2): uafklaret fravær markerer IKKE forgængeren - et kald fra den koerer stadig
  assert.ok(koert.some((x) => x.includes('GAMMEL')), 'uafklaret fravær dødsmarkerede den forrige bro');
});

test('H3 i genopbygningen markerer FOER oprettelsen: fejler oprettelsen, og kan naeste kontrol ikke afgoere noget, er broen erstattet (R145: A3)', async () => {
  let findes = true, kontekstKald = 0;
  const { sent, koert } = await ventendeKald('klkl3232-1', async ({ u }) => {
    await u.hent('genbygOffscreen')().catch(() => {});
  }, { 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; throw new Error('lukket, men svaret fejlede'); },
    'offscreen.createDocument': () => { throw new Error('oprettelse fejlede'); },
    'runtime.getContexts': () => { kontekstKald += 1; if (kontekstKald === 1) return []; throw new Error('getContexts afvist'); },
    'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) });
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `markeringen ventede paa oprettelsen, og den lukkede bros kald koerte: ${JSON.stringify(sent)}`);
});

// ── R146 (Astra D1): H3-markeringen sker FOER oprettelsen - ogsaa mens oprettelsen stadig venter ──────────────
test('H3 i genopbygningen: mens oprettelsen af den nye bro venter, er den gamle bros kald allerede afvist (R146: D1)', async () => {
  let findes = true, slipOpret, kontekstKald = 0;
  const opretVenter = new Promise((r) => { slipOpret = r; });
  let genbyg;
  const { sent, koert } = await ventendeKald('mnmn3333-1', async ({ u }) => {
    genbyg = u.hent('genbygOffscreen')().catch(() => {});   // holdes ved createDocument
    await new Promise((r) => setTimeout(r, 30));
  }, { 'offscreen.hasDocument': () => findes, 'offscreen.closeDocument': () => { findes = false; throw new Error('lukket, men svaret fejlede'); },
    'offscreen.createDocument': () => opretVenter.then(() => { findes = true; }),
    'runtime.getContexts': () => { kontekstKald += 1; if (kontekstKald === 1) return []; throw new Error('getContexts afvist'); },
    'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) });
  // det gamle kald er sluppet og besvaret, mens oprettelsen STADIG venter
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `den gamle bros kald koerte, foer den nye bro var bygget: ${JSON.stringify(sent)}`);
  assert.equal(sent.sent, false, JSON.stringify(sent));
  slipOpret(); await genbyg;
});

// ── R147 (Astra E2/E3): hjerteslagets fraværsgren ───────────────────────────────
test('hjerteslaget: mens den nye bro bygges, er den forsvundne bros kald allerede afvist (R147: E2)', async () => {
  let findes = true, slipOpret, opretKaldt;
  const opretVenter = new Promise((r) => { slipOpret = r; });
  const opretStartet = new Promise((r) => { opretKaldt = r; });
  let hjerteslag;
  const { sent, koert } = await ventendeKald('opop3434-1', async ({ u }) => {
    await u.hent('ensureOffscreen')();          // opstartens egen opbygning er faerdig
    findes = false;                             // broen forsvinder af sig selv
    hjerteslag = u.hent('ensureOffscreen')().catch(() => {});
    await opretStartet;                         // hjerteslaget er naaet til oprettelsen, som venter
  }, { 'offscreen.hasDocument': () => findes,
    // R148/R149 (Astra F2/F3): kontekstlisten filtreres som i Chrome - service workeren (BACKGROUND) findes altid, og et filter med
    // flere typer faar alle de matchende
    'runtime.getContexts': (filter) => [{ contextType: 'BACKGROUND' }, ...(findes ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [])]
      .filter((k) => !filter?.contextTypes || filter.contextTypes.includes(k.contextType)),
    'offscreen.createDocument': () => { opretKaldt(); return opretVenter.then(() => { findes = true; }); },
    'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) });
  assert.ok(!koert.some((x) => x.includes('GAMMEL')), `den forsvundne bros kald koerte, foer den nye bro var bygget: ${JSON.stringify(sent)}`);
  assert.equal(sent.sent, false, JSON.stringify(sent));
  slipOpret(); await hjerteslag;
});

test('hjerteslaget: siger hasDocument falsk, men findes broens kontekst stadig, markeres den IKKE (R147: E3)', async () => {
  let falske = 0;
  const { u, koert } = await ventendeKald('qrqr3535-1', async ({ u: v }) => {
    await v.hent('ensureOffscreen')();          // opstartens egen opbygning er faerdig
    falske = 2;                                 // de naeste to hasDocument-svar er falske; konteksten lever
    await v.hent('ensureOffscreen')().catch(() => {});
  }, { 'offscreen.hasDocument': () => { if (falske > 0) { falske -= 1; return false; } return true; },
    'runtime.getContexts': () => [{ contextType: 'OFFSCREEN_DOCUMENT' }],
    'offscreen.createDocument': () => { throw new Error('Only a single offscreen document may be created.'); },
    'runtime.getManifest': { version: '9.9.9' }, 'runtime.sendMessage': () => ({ ok: true, version: '9.9.9' }) });
  assert.ok(koert.some((x) => x.includes('GAMMEL')), 'en levende bro blev dødsmarkeret af hjerteslaget trods en levende kontekst');
  const lytter = u.lyttere.get('runtime.onMessage')[0];
  const naeste = await new Promise((ok) => lytter({ type: 'mcp_command', port: 19861, gen: 'qrqr3535-1', pid: 101, method: 'execute_script', params: { code: '"NAESTE"' } }, {}, ok));
  assert.match(String(naeste.result), /NAESTE/, `naeste kald fra den levende bro blev afvist: ${JSON.stringify(naeste)}`);
});
