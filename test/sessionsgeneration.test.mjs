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
