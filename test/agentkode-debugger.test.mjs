/**
 * Agentens JavaScript koeres KUN gennem Chromes Debugger API (1.31.0).
 *
 * Chrome Web Stores MV3-regler tillader kode, der ikke ligger i pakken, kun gennem et API der udtrykkeligt er lavet til
 * det (Debugger API eller User Scripts API), og undtagelsen gaelder kun den kode, de API'er daekker. Op til 1.30.3 koerte
 * browser_execute_script agentens kode gennem chrome.scripting.executeScript + new Function (ISOLATED, saa MAIN) og kun
 * til sidst gennem debuggeren, og browser_select_frame havde slet ingen debuggervej. R129b (Astra + Opus) naaede samme
 * konklusion: begge vaerktoejer skal gaa gennem chrome.debugger -> Runtime.evaluate, og new Function skal vaek.
 *
 * Proeverne koerer den aegte background.js i selen. Debuggeren er en model, der svarer som Chrome gjorde i den raa
 * CDP-maaling 19/10 (~/.claude/plans/browsermcp-131/maal-dbg/raa-cdp.mjs, Chrome 155): forældrefanens Page.getFrameTree
 * udelader en frame fra et andet domæne helt; Runtime.enable og Target.setAutoAttach sender deres haendelser FOER svaret;
 * en OOPIF's mål-id er dens frame-id, og dens egen frametrae har parentId = forældrens frame-id.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indlaesUdvidelse, ROD } from './hjaelp/udvidelses-sele.mjs';

const TOP = 'https://top.example/';
const BARN = 'https://top.example/barn';
const FREMMED = 'https://pay.example/frame';

// Chrome-modellen. `traeer` er Page.getFrameTree pr. session ('' = fanens egen), `kontekster` er standardkontekster pr.
// session; for hver af dem melder Runtime.enable OGSAA udvidelsens isolerede verden i samme frame (type isolated, origin
// chrome-extension://<id>, id = 100 + standardkontekstens id) - som Chrome gjorde i maalingen 19/10. `oopif` er de maal,
// Target.setAutoAttach melder (i: den session, de meldes i). Som Chrome: Runtime.enable og Target.setAutoAttach melder INTET,
// naar de allerede staar til. `sene: true` leverer haendelserne 20 ms EFTER svaret.
// Identitet: `par` er SANDHEDEN, { udvidelsens frameId: CDP-frame-id }. Hver frame har sit eget dokument med udvidelsens
// maerker (R132). For 5b66c97's placeringsbevis giver modellen ogsaa pladsen i forælderen efter `orden` (udvidelsens
// frameId-raekkefoelge, medmindre andet er sat), og `karrusel: { forfaelder, efter }` udskifter soeskende lige efter det
// foerste chrome.scripting-kald - Opus' karrusel. `maerkFejl` lader udvidelsens maerkning fejle for en frame, og `vaek` er
// frames, webNavigation.getFrame ikke kender laengere.
function sele({ frames, traeer = {}, kontekster = {}, oopif = [], evaluate, runtimeTil = [], autoAttachTil = [], sene = false,
  par = {}, maerkFejl = {}, vaek = [], karrusel = null, oedelagt = {}, genbrug = null, ur = null, langsomOprydning = 0, ryddet = {} } = {}) {
  // genbrug (R133, Astra): et processkift genbruger det NUMERISKE kontekst-id. { naar: 'foer'|'efter' maerkeopslaget, fra: id,
  // til: id }: derefter betyder standardkontekst-id `fra` det samme som `til`, udvidelses-verdenens id (100+fra) er en
  // sidekontekst, hvis forfalskede Set svarer ja, og `fra`-kontekstens uniqueId'er er vaek («uniqueContextId not found»).
  const log = [];
  const unikke = new Map();       // uniqueId -> { id, iso }
  let byttet = false;
  const numerisk = (id) => (byttet && id === genbrug.fra ? genbrug.til : id);
  let u;
  const kilde = (sid) => (sid ? { tabId: 1, sessionId: sid } : { tabId: 1 });
  const runtime = new Set(runtimeTil), auto = new Set(autoAttachTil);
  const send = (...a) => (sene ? setTimeout(() => u.fyr(...a), 20) : u.fyr(...a));
  const alleFrames = frames || [{ frameId: 0, parentFrameId: -1, url: TOP }];
  const orden = new Map();
  for (const f of alleFrames) if (f.frameId !== 0) orden.set(f.parentFrameId, [...(orden.get(f.parentFrameId) || []), f.frameId].sort((a, b) => a - b));
  let karruselKoert = false;
  const pladsAf = (web) => {
    const w = alleFrames.find((x) => x.frameId === web);
    const s = orden.get(w ? w.parentFrameId : -2) || [];
    return [s.indexOf(web), s.length, s.indexOf(web), s.length];
  };
  const webAf = (cdp) => { const k = Object.keys(par).find((x) => par[x] === cdp); return k == null ? null : Number(k); };
  const dokumenter = new Map();   // udvidelsens frameId -> maerker i udvidelsens isolerede verden
  const iso = new Map();          // isoleret kontekst-id (pr. session) -> CDP-frame-id
  u = indlaesUdvidelse({ ur, svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: TOP, windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: TOP, windowId: 1, active: true }],
    'webNavigation.getAllFrames': alleFrames,
    'webNavigation.getFrame': (q) => (vaek.includes(q.frameId) ? null : alleFrames.find((x) => x.frameId === q.frameId) || null),
    'scripting.executeScript': (o) => {
      log.push({ scripting: true, world: o.world, args: o.args, frameIds: o.target?.frameIds, func: o.func?.name });
      const f = o.target?.frameIds?.[0];
      try {
        if (o.world === 'ISOLATED' && o.func?.name === 'frameMaerke') {
          if (maerkFejl[f]) throw maerkFejl[f];
          const [h, maerke] = o.args;
          if (!dokumenter.has(f)) dokumenter.set(f, new Set());
          if (h === 0) dokumenter.get(f).add(maerke); else if (h === 2) dokumenter.get(f).delete(maerke);
          if (h === 2 && langsomOprydning) return new Promise((r) => setTimeout(() => { log.push({ oprydningFaerdig: true }); r([{ frameId: f, result: true }]); }, langsomOprydning));
          return [{ frameId: f, result: true }];
        }
        if (o.world === 'ISOLATED' && o.func?.name === 'frameIdentitet' && o.args?.[0] === 0) {
          if (maerkFejl[f]) throw maerkFejl[f];
          return [{ frameId: f, result: pladsAf(f) }];
        }
        throw new Error('scripting maa ikke bruges til agentkode');
      } finally {
        if (karrusel && !karruselKoert) { karruselKoert = true; orden.set(karrusel.forfaelder, karrusel.efter); }
      }
    },
    'debugger.sendCommand': (maal, metode, p) => {
      const sid = maal.sessionId || '';
      const k = p && p.uniqueContextId != null ? unikke.get(p.uniqueContextId)?.id : p && p.contextId != null ? numerisk(p.contextId) : undefined;
      log.push({ sid, metode, p, maal, k });
      if (metode === 'Page.getFrameTree') return { frameTree: traeer[sid] };
      if (metode === 'Runtime.disable') { runtime.delete(sid); return {}; }
      if (metode === 'Runtime.enable') {
        if (runtime.has(sid)) return {};
        runtime.add(sid);
        for (const context of kontekster[sid] || []) {
          unikke.set(context.uniqueId, { id: context.id, iso: false });
          send('debugger.onEvent', kilde(sid), 'Runtime.executionContextCreated', { context });
          // `oedelagt`: framen navigerede under Runtime.enable - konteksten forsvinder igen, og en ny melder sig.
          if (oedelagt[context.id]) {
            send('debugger.onEvent', kilde(sid), 'Runtime.executionContextDestroyed', { executionContextId: context.id });
            unikke.set(oedelagt[context.id].uniqueId, { id: oedelagt[context.id].id, iso: false });
            send('debugger.onEvent', kilde(sid), 'Runtime.executionContextCreated', { context: oedelagt[context.id] });
          }
          if (context.auxData.isDefault) {
            const c = { id: 100 + context.id, uniqueId: context.uniqueId + ':iso', origin: 'chrome-extension://test-udvidelse-id',
              name: 'Agent360 Browser MCP', auxData: { isDefault: false, type: 'isolated', frameId: context.auxData.frameId } };
            iso.set(sid + '/' + c.id, context.auxData.frameId);
            unikke.set(c.uniqueId, { id: c.id, iso: true, sid, frameId: context.auxData.frameId });
            send('debugger.onEvent', kilde(sid), 'Runtime.executionContextCreated', { context: c });
          }
        }
        // `ryddet`: Chrome toemmer sessionens kontekster (executionContextsCleared) og melder nye.
        if (ryddet[sid]) {
          send('debugger.onEvent', kilde(sid), 'Runtime.executionContextsCleared', {});
          for (const context of ryddet[sid]) {
            unikke.set(context.uniqueId, { id: context.id, iso: false });
            send('debugger.onEvent', kilde(sid), 'Runtime.executionContextCreated', { context });
            const c = { id: 100 + context.id, uniqueId: context.uniqueId + ':iso', origin: 'chrome-extension://test-udvidelse-id',
              name: 'Agent360 Browser MCP', auxData: { isDefault: false, type: 'isolated', frameId: context.auxData.frameId } };
            iso.set(sid + '/' + c.id, context.auxData.frameId);
            unikke.set(c.uniqueId, { id: c.id, iso: true, sid, frameId: context.auxData.frameId });
            send('debugger.onEvent', kilde(sid), 'Runtime.executionContextCreated', { context: c });
          }
        }
        return {};
      }
      if (metode === 'Target.setAutoAttach' && !p.autoAttach) { auto.delete(sid); return {}; }
      if (metode === 'Target.setAutoAttach' && p.autoAttach) {
        if (auto.has(sid)) return {};
        auto.add(sid);
        for (const o of oopif.filter((x) => (x.i || '') === sid)) {
          send('debugger.onEvent', kilde(sid), 'Target.attachedToTarget',
            { sessionId: o.sessionId, targetInfo: { targetId: o.targetId, type: 'iframe', url: o.url }, waitingForDebugger: false });
        }
        return {};
      }
      // 5b66c97's placeringsbevis (bruges kun af den gamle kode i roed-foer-proeven).
      if (metode === 'Page.createIsolatedWorld') return { executionContextId: 5000 + log.length };
      if (metode === 'DOM.getFrameOwner') return { backendNodeId: 'ejer:' + p.frameId };
      if (metode === 'DOM.resolveNode') return { object: { objectId: 'obj:' + String(p.backendNodeId).slice(5) } };
      if (metode === 'Runtime.callFunctionOn' && p.objectId) {
        const web = webAf(String(p.objectId).slice(4));
        return { result: { type: 'object', value: web == null ? [90, 90, 90, 90] : pladsAf(web) } };
      }
      // R132: maerket spoerges i udvidelsens isolerede verden, med maerket som argument (5b66c97/37821c6: numerisk id,
      // R133: uniqueContextId).
      if (metode === 'Runtime.callFunctionOn' && (p.executionContextId != null || p.uniqueContextId != null)) {
        if (genbrug && genbrug.naar === 'foer') byttet = true;
        let cdp;
        if (p.uniqueContextId != null) {
          const e = unikke.get(p.uniqueContextId);
          if (!e || (byttet && (e.id === genbrug.fra || e.id === 100 + genbrug.fra))) throw new Error('{"code":-32602,"message":"uniqueContextId not found"}');
          cdp = e.frameId;
        } else {
          // Efter et processkift er det gamle isolerede id en SIDEkontekst, hvis forfalskede Set svarer ja.
          if (byttet && p.executionContextId === 100 + genbrug.fra) return { result: { type: 'boolean', value: true } };
          cdp = iso.get(sid + '/' + p.executionContextId);
        }
        if (cdp == null) throw new Error('Cannot find context with specified id');
        const web = webAf(cdp);
        const [h, maerke] = (p.arguments || []).map((a) => a.value);
        const d = web == null ? new Set() : (dokumenter.get(web) || new Set());
        const svar = { result: { type: 'boolean', value: h === 1 ? d.has(maerke) : true } };
        if (genbrug && genbrug.naar === 'efter' && svar.result.value === true) byttet = true;
        return svar;
      }
      if (metode === 'Runtime.evaluate') {
        if (p.uniqueContextId != null) {
          const e = unikke.get(p.uniqueContextId);
          if (!e || (byttet && e.id === genbrug.fra)) throw new Error('{"code":-32602,"message":"uniqueContextId not found"}');
        }
        return evaluate ? evaluate(maal, { ...p, contextId: k }) : { result: { type: 'string', value: 'svar' } };
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const evalueringer = () => log.filter((x) => x.metode === 'Runtime.evaluate');
  // chrome.scripting med agentens kode: alt andet end de pakkede identitetsfunktioner i ISOLATED.
  const scripting = () => log.filter((x) => x.scripting && !(x.world === 'ISOLATED' && ['frameMaerke', 'frameIdentitet'].includes(x.func)));
  return { u, log, evalueringer, scripting, dokumenter, kald: (navn, params) => u.hent('dispatch')(9876, navn, params) };
}
const fang = (p) => p.then((r) => r, (e) => ({ kastet: String(e?.message || e) }));
const ctx = (id, frameId, isDefault = true) => ({ id, uniqueId: `u.${frameId}.${id}`, origin: 'x', name: '', auxData: { isDefault, type: isDefault ? 'default' : 'isolated', frameId } });

// ── browser_execute_script ─────────────────────────────────────────────────────

test('execute_script koerer agentens kode via Runtime.evaluate og aldrig via chrome.scripting', async () => {
  const m = sele({ evaluate: () => ({ result: { type: 'number', value: 42 } }) });
  const svar = await m.kald('execute_script', { code: '6 * 7' });
  assert.equal(m.scripting().length, 0, 'chrome.scripting.executeScript blev brugt til agentens kode');
  assert.equal(m.evalueringer().length, 1);
  const p = m.evalueringer()[0].p;
  assert.match(p.expression, /6 \* 7/);
  assert.equal(p.awaitPromise, true, 'et Promise skal afventes');
  assert.equal(p.returnByValue, true);
  assert.equal(p.contextId, undefined, 'hovedsidens standardkontekst (sidens egne globale variabler), ikke en isoleret verden');
  assert.equal(m.evalueringer()[0].sid, '', 'fanens egen session');
  assert.deepEqual({ ...svar }, { result: 42, method: 'debugger' });
});

test('execute_script: kode der returnerer undefined er et svar, ikke en fejl', async () => {
  const m = sele({ evaluate: () => ({ result: { type: 'undefined' } }) });
  const svar = await fang(m.kald('execute_script', { code: 'void 0' }));
  assert.equal(svar.kastet, undefined, `undefined blev til en fejl: ${JSON.stringify(svar)}`);
  assert.equal(svar.ok, undefined);
  assert.equal(svar.method, 'debugger');
  assert.equal(m.evalueringer().length, 1, 'koden maa ikke koeres igen, fordi svaret var undefined');
});

test('execute_script: kode der kaster, giver ok:false med kodens egen fejl og koeres ikke igen', async () => {
  const m = sele({ evaluate: () => ({ result: { type: 'object', subtype: 'error', className: 'TypeError' }, exceptionDetails: {
    text: 'Uncaught', exception: { type: 'object', subtype: 'error', className: 'TypeError', description: 'TypeError: boom efter effekt\n    at <anonymous>:1:20' } } }) });
  const svar = await fang(m.kald('execute_script', { code: "(() => { window.x = 1; throw new TypeError('boom efter effekt'); })()" }));
  assert.equal(svar.ok, false, JSON.stringify(svar));
  assert.equal(svar.error, 'boom efter effekt');
  assert.equal(svar.name, 'TypeError');
  assert.equal(svar.method, 'debugger');
  assert.match(String(svar.note), /not run again automatically/);
  assert.equal(m.evalueringer().length, 1, 'kode der koerte og kastede, maa ikke koeres igen');
});

test('execute_script: en kastet vaerdi, der ikke er en Error, kommer med som tekst', async () => {
  const m = sele({ evaluate: () => ({ result: { type: 'string', value: 'nej' }, exceptionDetails: { text: 'Uncaught', exception: { type: 'string', value: 'nej' } } }) });
  const svar = await m.kald('execute_script', { code: "(() => { throw 'nej'; })()" });
  assert.equal(svar.ok, false);
  assert.equal(svar.error, 'nej');
});

test('execute_script: falder debuggeren af efter afsendelsen, koeres koden ikke igen og svaret siger det', async () => {
  const m = sele({ evaluate: () => { throw new Error('Debugger is not attached to the tab with id: 1.'); } });
  const svar = await fang(m.kald('execute_script', { code: 'window.__n = (window.__n || 0) + 1' }));
  assert.equal(m.evalueringer().length, 1, `koden blev sendt ${m.evalueringer().length} gange`);
  assert.match(svar.kastet || '', /MAY already have run/);
  assert.equal(m.scripting().length, 0, 'ingen reserve gennem chrome.scripting');
});

test('execute_script: kan debuggeren ikke tilsluttes, sendes intet - og der er ingen reserve gennem scripting', async () => {
  const m = sele();
  m.u.chrome.debugger.attach = () => Promise.reject(new Error('Cannot attach to this target.'));
  m.u.chrome.debugger.getTargets = () => Promise.resolve([{ tabId: 1, attached: false }]);
  m.u.hent('debuggerAttached').clear();
  const svar = await fang(m.kald('execute_script', { code: '1' }));
  assert.ok(svar.kastet, JSON.stringify(svar));
  assert.match(svar.kastet, /not run/i, 'fejlen skal sige, at koden ikke koerte');
  assert.equal(m.evalueringer().length, 0);
  assert.equal(m.scripting().length, 0);
});

test('execute_script: et svar UDEN result (debuggeren faldt af midt i kaldet) er ikke et tomt resultat - koden kan have koert', async () => {
  for (const tomt of [undefined, {}]) {
    const m = sele({ evaluate: () => tomt });
    const svar = await fang(m.kald('execute_script', { code: 'window.__n = 1' }));
    assert.match(svar.kastet || '', /MAY already have run/, `${JSON.stringify(tomt)}: ${JSON.stringify(svar)}`);
    assert.equal(m.evalueringer().length, 1);
  }
});

test('execute_script: fejler tilslutningen FOER afsendelsen, proeves igen, og koden koerer én gang', async () => {
  const m = sele({ evaluate: () => ({ result: { type: 'number', value: 7 } }) });
  let forsoeg = 0;
  m.u.chrome.debugger.attach = () => (++forsoeg <= 3 ? Promise.reject(new Error('Cannot attach to this target.')) : Promise.resolve());
  m.u.hent('debuggerAttached').clear();
  const svar = await fang(m.kald('execute_script', { code: '7' }));
  assert.equal(svar.result, 7, JSON.stringify(svar));
  assert.equal(m.evalueringer().length, 1);
  assert.ok(forsoeg > 3, 'tilslutningen blev ikke proevet igen');
});

// ── browser_select_frame ───────────────────────────────────────────────────────

const toFrames = [
  { frameId: 0, parentFrameId: -1, url: TOP },
  { frameId: 5, parentFrameId: 0, url: BARN },
  { frameId: 9, parentFrameId: 0, url: FREMMED },
];
const toPar = { 5: 'CDP-BARN', 9: 'PAY' };
const topTrae = (boern) => ({ frame: { id: 'TOP', url: TOP }, childFrames: boern.map((b) => ({ frame: { parentId: 'TOP', ...b } })) });
const ikkeNaaet = (svar, retry) => {
  assert.equal(svar.error, 'frame-not-reachable', JSON.stringify(svar));
  assert.equal(svar.sent, false);
  assert.equal(svar.retry, retry, `retry skulle vaere ${retry}: ${JSON.stringify(svar)}`);
  assert.match(svar.note, retry ? /try once more/ : /same answer/);
};

test('select_frame 0 koerer i hovedsiden via debuggeren', async () => {
  const m = sele({ frames: toFrames });
  const svar = await m.kald('select_frame', { frame_index: 0, code: 'location.href' });
  assert.equal(m.scripting().length, 0);
  assert.equal(m.evalueringer().length, 1);
  assert.equal(m.evalueringer()[0].k, undefined);
  assert.equal(svar.result, 'svar');
  assert.equal(svar.frame_url, TOP);
});

test('select_frame i en frame fra samme domaene: identiteten bevises med et engangsmaerke i framens dokument, og koden koerer i framens standardkontekst', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN', false), ctx(3, 'CDP-BARN')] },
    evaluate: (_maal, p) => ({ result: { type: 'string', value: 'ctx' + p.contextId } }),
  });
  const svar = await m.kald('select_frame', { frame_index: 1, code: 'window.hemmelig' });
  assert.equal(m.scripting().length, 0, 'chrome.scripting fik agentens kode');
  const saet = m.log.find((x) => x.scripting && x.func === 'frameMaerke' && x.args[0] === 0);
  assert.ok(saet, 'udvidelsen satte intet maerke');
  assert.deepEqual([...saet.frameIds], [5], 'maerket saettes i NETOP den valgte frame (Chrome vaelger dokumentet ud fra frameId)');
  assert.match(saet.args[1], /^[0-9a-f]{32}$/, 'et tilfaeldigt engangsmaerke');
  const spurgt = m.log.find((x) => x.metode === 'Runtime.callFunctionOn' && x.p.uniqueContextId === 'u.CDP-BARN.3:iso');
  assert.ok(spurgt, 'debuggeren spurgte ikke udvidelsens isolerede verden i framen');
  assert.deepEqual([...spurgt.p.arguments.map((a) => a.value)], [1, saet.args[1]], 'maerket gives som ARGUMENT, ikke bygget ind i koden');
  assert.ok(m.log.some((x) => x.scripting && x.func === 'frameMaerke' && x.args[0] === 2 && x.args[1] === saet.args[1]), 'maerket fjernes bagefter');
  assert.equal(m.dokumenter.get(5).size, 0);
  const ev = m.evalueringer();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].k, 3, 'framens STANDARDkontekst (isDefault), ikke en isoleret verden og ikke hovedsiden');
  assert.equal(ev[0].p.awaitPromise, true);
  assert.equal(ev[0].sid, '');
  assert.equal(svar.result, 'ctx3');
  assert.equal(svar.frame_url, BARN);
  const sidste = (navn) => m.log.map((x) => x.metode).lastIndexOf(navn);
  assert.ok(sidste('Runtime.disable') > sidste('Runtime.enable'), 'Runtime skal slaas fra igen, efter at konteksten er fundet');
});

test('select_frame: to frames fra samme domaene med samme adresse skilles ad paa maerket, ikke paa raekkefoelgen', async () => {
  // Debuggerens boern staar i omvendt raekkefoelge af udvidelsens frameId - en positionel parring ville bytte dem om.
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 4, parentFrameId: 0, url: BARN }, { frameId: 7, parentFrameId: 0, url: BARN }],
    par: { 4: 'A', 7: 'B' },
    traeer: { '': topTrae([{ id: 'B', url: BARN }, { id: 'A', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'A'), ctx(3, 'B')] },
  });
  await m.kald('select_frame', { frame_index: 1, code: '1' });   // frameId 4 = A
  assert.equal(m.evalueringer()[0].k, 2);
  await m.kald('select_frame', { frame_index: 2, code: '1' });   // frameId 7 = B
  assert.equal(m.evalueringer()[1].k, 3);
});

// R131 (Astra, maalt i model med den uaendrede dispatcher): to OOPIF-soeskende med samme adresse, attach-raekkefoelge SECOND,
// FIRST gav frame 1 -> SECOND og frame 2 -> FIRST - med normale svar. Chromium samler maalene i et flat_set; raekkefoelgen er
// ikke dokumenteret (maalt i raa CDP 19/10: t2 meldt foer t1).
const toFremmede = (ekstra = {}, oopifOrden = ['S-2', 'S-1']) => ({
  frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 9, parentFrameId: 0, url: FREMMED }, { frameId: 12, parentFrameId: 0, url: FREMMED }],
  par: { 9: 'F1', 12: 'F2' },
  traeer: { '': topTrae([]), 'S-1': { frame: { id: 'F1', parentId: 'TOP', url: FREMMED } }, 'S-2': { frame: { id: 'F2', parentId: 'TOP', url: FREMMED } } },
  kontekster: { '': [ctx(1, 'TOP')], 'S-1': [ctx(1, 'F1')], 'S-2': [ctx(1, 'F2')] },
  oopif: oopifOrden.map((sid) => ({ sessionId: sid, targetId: sid === 'S-1' ? 'F1' : 'F2', url: FREMMED })),
  evaluate: (maal) => ({ result: { type: 'string', value: maal.sessionId } }),
  ...ekstra,
});

test('select_frame: to OOPIF-soeskende med samme adresse rammer hver sin rigtige frame i begge attach-raekkefoelger (R131)', async () => {
  for (const orden of [['S-2', 'S-1'], ['S-1', 'S-2']]) {
    const m = sele(toFremmede({}, orden));
    assert.equal((await m.kald('select_frame', { frame_index: 1, code: '1' })).result, 'S-1', `orden ${orden}: frameId 9 skal vaere F1`);
    assert.equal((await m.kald('select_frame', { frame_index: 2, code: '1' })).result, 'S-2', `orden ${orden}: frameId 12 skal vaere F2`);
  }
});

test('select_frame: kan identiteten ikke bevises, koeres intet - og svaret siger, om et nyt forsoeg kan hjaelpe', async () => {
  for (const [navn, ekstra, retry] of [
    ['udvidelsen maa ikke koere i framen', { maerkFejl: { 9: new Error('Cannot access contents of url "chrome-extension://x/y". Extension manifest must request permission to access this host.') } }, false],
    ['framen forsvandt under maerkningen', { maerkFejl: { 9: new Error('Frame with ID 9 was removed.') } }, true],
    ['maerket findes ingen steder i debuggeren', { par: { 12: 'F2' } }, true],
    ['maerket findes i to kontekster', { par: { 9: 'F1' }, ekstraPar: true }, true],
    ['framen er vaek, saa en varig fejl er alligevel forbigaaende', { maerkFejl: { 9: new Error('Cannot access contents of the page.') }, vaek: [9] }, true],
  ]) {
    const model = toFremmede(ekstra);
    if (ekstra.ekstraPar) model.kontekster[''] = [ctx(1, 'TOP'), ctx(7, 'F1'), ctx(8, 'F1')];   // to kontekster med maerket
    const m = sele(model);
    const svar = await fang(m.kald('select_frame', { frame_index: 1, code: 'window.__n = 1' }));
    ikkeNaaet(svar, retry);
    assert.equal(m.evalueringer().length, 0, `${navn}: koden maa ikke koere i en frame, der ikke er bevist`);
  }
});

// R132 (Astra i model, Opus i Chrome): siden fjerner en tidligere soester og tilfoejer en ny MELLEM udvidelsens maaling og
// debuggerens. En anden frame faar samme plads, og 5b66c97 koerte koden i soeskende-framen med et normalt svar.
test('select_frame: karrusellen (soester fjernet, ny tilfoejet under kaldet) rammer stadig netop den valgte frame (R132)', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 3, parentFrameId: 0, url: TOP + 'X' },
      { frameId: 4, parentFrameId: 0, url: TOP + 'A' }, { frameId: 5, parentFrameId: 0, url: TOP + 'B' }],
    par: { 3: 'X', 4: 'A', 5: 'B', 6: 'C' },
    karrusel: { forfaelder: 0, efter: [4, 5, 6] },
    traeer: { '': topTrae([{ id: 'X', url: TOP + 'X' }, { id: 'A', url: TOP + 'A' }, { id: 'B', url: TOP + 'B' }, { id: 'C', url: TOP + 'C' }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'X'), ctx(3, 'A'), ctx(4, 'B'), ctx(5, 'C')] },
    evaluate: (_maal, p) => ({ result: { type: 'string', value: { 2: 'X', 3: 'A', 4: 'B', 5: 'C' }[p.contextId] } }),
  });
  const svar = await fang(m.kald('select_frame', { frame_index: 2, code: '++window.__n' }));
  assert.equal(svar.result, 'A', `koden koerte i ${svar.result} - den valgte frame er A: ${JSON.stringify(svar)}`);
});

test('select_frame: en about:blank skrevet med document.write (debuggeren viser forælderens adresse) naas (R131 Opus)', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 16, parentFrameId: 0, url: 'about:blank' }],
    par: { 16: 'W' },
    traeer: { '': topTrae([{ id: 'W', url: TOP }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'W')] },
  });
  await m.kald('select_frame', { frame_index: 1 });
  assert.equal(m.evalueringer()[0]?.k, 2);
});

test('select_frame: en frame, der ikke kan bevises, slaar ikke dens soeskende ud (R131 Opus)', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 16, parentFrameId: 0, url: 'about:blank' },
      { frameId: 17, parentFrameId: 0, url: 'about:blank' }, { frameId: 20, parentFrameId: 0, url: 'about:blank' }],
    par: { 16: 'X1', 17: 'X2', 20: 'X3' },
    maerkFejl: { 17: new Error('Frame with ID 17 was removed.') },
    traeer: { '': topTrae([{ id: 'X1', url: TOP }, { id: 'X2', url: 'about:blank' }, { id: 'X3', url: 'about:blank' }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'X1'), ctx(3, 'X2'), ctx(4, 'X3')] },
  });
  await m.kald('select_frame', { frame_index: 1, code: '1' });
  assert.equal(m.evalueringer()[0]?.k, 2);
  await m.kald('select_frame', { frame_index: 3, code: '1' });
  assert.equal(m.evalueringer()[1]?.k, 4);
  ikkeNaaet(await m.kald('select_frame', { frame_index: 2, code: '1' }), true);
  assert.equal(m.evalueringer().length, 2);
});

test('select_frame i en frame fra et andet domaene (OOPIF): Target.setAutoAttach med flatten, og koden koerer i barnets session', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: {
      '': topTrae([{ id: 'CDP-BARN', url: BARN }]),   // forældrens trae udelader OOPIF'en (maalt i Chrome 155)
      'S-PAY': { frame: { id: 'PAY', parentId: 'TOP', url: FREMMED } },
    },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')], 'S-PAY': [ctx(1, 'PAY')] },
    oopif: [{ sessionId: 'S-PAY', targetId: 'PAY', url: FREMMED }],
    evaluate: (maal, p) => ({ result: { type: 'string', value: `${maal.sessionId}/${p.contextId}` } }),
  });
  const svar = await m.kald('select_frame', { frame_index: 2, code: 'document.title' });
  assert.equal(m.scripting().length, 0);
  const aa = m.log.find((x) => x.metode === 'Target.setAutoAttach' && x.p.autoAttach);
  assert.ok(aa, 'OOPIF kraever Target.setAutoAttach');
  assert.equal(aa.p.flatten, true, 'flade sessioner (Chrome 125+)');
  assert.equal(aa.p.waitForDebuggerOnStart, false, 'en ny frame maa ikke fryses');
  assert.ok(m.log.some((x) => x.metode === 'Runtime.callFunctionOn' && x.sid === 'S-PAY' && x.p.uniqueContextId === 'u.PAY.1:iso'), 'maerket findes i barnets egen session');
  const ev = m.evalueringer();
  assert.equal(ev.length, 1);
  assert.deepEqual({ ...ev[0].maal }, { tabId: 1, sessionId: 'S-PAY' }, 'koden skal sendes til barnets session');
  assert.equal(ev[0].k, 1);
  assert.equal(svar.result, 'S-PAY/1');
  assert.equal(svar.frame_url, FREMMED);
  await new Promise((r) => setTimeout(r, 50));   // oprydningen koerer efter svaret (R133) - vent paa den
  const aaFanen = m.log.filter((x) => x.metode === 'Target.setAutoAttach' && x.sid === '');
  assert.equal(aaFanen.at(-1).p.autoAttach, false, 'auto-attach skal slaas fra igen bagefter');
  assert.ok(m.log.indexOf(aaFanen.at(-1)) > m.log.indexOf(ev[0]), 'auto-attach slaas foerst fra, naar koden har koert i framen');
});

const oopifModel = (ekstra = {}) => ({
  frames: toFrames, par: toPar,
  traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]), 'S-PAY': { frame: { id: 'PAY', parentId: 'TOP', url: FREMMED } } },
  kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')], 'S-PAY': [ctx(1, 'PAY')] },
  oopif: [{ sessionId: 'S-PAY', targetId: 'PAY', url: FREMMED }],
  evaluate: (maal, p) => ({ result: { type: 'string', value: `${maal.sessionId}/${p.contextId}` } }),
  ...ekstra,
});

test('select_frame: haendelser, der kommer EFTER svaret paa kommandoen, findes stadig (frame fra samme og fra andet domaene)', async () => {
  const m = sele(oopifModel({ sene: true }));
  assert.equal((await m.kald('select_frame', { frame_index: 1, code: '1' })).result, 'undefined/2');
  assert.equal((await m.kald('select_frame', { frame_index: 2, code: '1' })).result, 'S-PAY/1');
});

test('select_frame: staar Runtime og auto-attach allerede til (fx efter console_logs), slaas de fra foerst, saa Chrome melder igen', async () => {
  const m = sele(oopifModel({ runtimeTil: ['', 'S-PAY'], autoAttachTil: [''] }));
  assert.equal((await m.kald('select_frame', { frame_index: 1, code: '1' })).result, 'undefined/2');
  assert.equal((await m.kald('select_frame', { frame_index: 2, code: '1' })).result, 'S-PAY/1');
});

test('select_frame: to kald i traek i en fremmed frame virker begge (auto-attach nulstilles mellem dem)', async () => {
  const m = sele(oopifModel());
  assert.equal((await m.kald('select_frame', { frame_index: 2, code: '1' })).result, 'S-PAY/1');
  assert.equal((await m.kald('select_frame', { frame_index: 2, code: '2' })).result, 'S-PAY/1');
  const maerker = m.log.filter((x) => x.scripting && x.func === 'frameMaerke' && x.args[0] === 0).map((x) => x.args[1]);
  assert.equal(new Set(maerker).size, 2, 'hvert kald faar sit eget engangsmaerke');
});

test('select_frame: en frame inde i en fremmed frame (OOPIF i OOPIF) naas gennem barnets egen auto-attach', async () => {
  const DYB = 'https://dyb.example/x';
  const m = sele({
    frames: [...toFrames, { frameId: 11, parentFrameId: 9, url: DYB }],
    par: { ...toPar, 11: 'DYB' },
    traeer: {
      '': topTrae([{ id: 'CDP-BARN', url: BARN }]),
      'S-PAY': { frame: { id: 'PAY', parentId: 'TOP', url: FREMMED } },
      'S-DYB': { frame: { id: 'DYB', parentId: 'PAY', url: DYB } },
    },
    kontekster: { '': [ctx(1, 'TOP')], 'S-PAY': [ctx(1, 'PAY')], 'S-DYB': [ctx(4, 'DYB')] },
    oopif: [{ sessionId: 'S-PAY', targetId: 'PAY', url: FREMMED }, { i: 'S-PAY', sessionId: 'S-DYB', targetId: 'DYB', url: DYB }],
    evaluate: (maal, p) => ({ result: { type: 'string', value: `${maal.sessionId}/${p.contextId}` } }),
  });
  const svar = await m.kald('select_frame', { frame_index: 3, code: '1' });
  assert.equal(svar.result, 'S-DYB/4', JSON.stringify(svar));
  assert.equal(svar.frame_url, DYB);
  assert.ok(m.log.some((x) => x.metode === 'Runtime.callFunctionOn' && x.sid === 'S-DYB'), 'maerket findes i DYB\'s egen session');
});

test('select_frame: en kontekst, der forsvinder under opslaget, bruges ikke - den nye goer', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')] },
    oedelagt: { 2: ctx(9, 'CDP-BARN') },
  });
  await m.kald('select_frame', { frame_index: 1, code: '1' });
  assert.equal(m.evalueringer()[0]?.k, 9);
});

test('select_frame: forsvinder konteksten, foer Chrome slaar den op, er intet koert - frame-not-reachable med retry (R132)', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')] },
    evaluate: () => { throw new Error('{"code":-32000,"message":"Cannot find context with specified id"}'); },
  });
  ikkeNaaet(await fang(m.kald('select_frame', { frame_index: 1, code: 'window.__n = 1' })), true);
  assert.equal(m.evalueringer().length, 1, 'ingen gentagelse i samme kald');
  // execute_script: samme fejl siger, at intet er koert (ikke «MAY already have run»).
  const e = await fang(m.kald('execute_script', { code: '1' }));
  assert.match(e.kastet || '', /not run \(nothing was sent\)/);
});

// ── R133 (Astra): numeriske kontekst-id'er kan genbruges paa tvaers af processer; uniqueId kan ikke ──
const genbrugModel = (naar) => ({
  frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 4, parentFrameId: 0, url: TOP + 'A' }, { frameId: 5, parentFrameId: 0, url: TOP + 'B' }],
  par: { 4: 'A', 5: 'B' },
  traeer: { '': topTrae([{ id: 'A', url: TOP + 'A' }, { id: 'B', url: TOP + 'B' }]) },
  kontekster: { '': [ctx(1, 'TOP'), ctx(3, 'A'), ctx(4, 'B')] },
  genbrug: { naar, fra: 3, til: 4 },
  evaluate: (_maal, p) => ({ result: { type: 'string', value: { 3: 'A', 4: 'B' }[p.contextId] } }),
});

for (const naar of ['efter', 'foer']) {
  test(`select_frame: genbruges et kontekst-id ${naar} maerkeopslaget, koerer koden aldrig i den anden kontekst (R133)`, async () => {
    const m = sele(genbrugModel(naar));
    const svar = await fang(m.kald('select_frame', { frame_index: 1, code: '++window.__n' }));
    assert.notEqual(svar.result, 'B', `koden koerte i B, men svaret siger A: ${JSON.stringify(svar)}`);
    if (svar.result !== 'A') {
      ikkeNaaet(svar, true);
      assert.ok(!m.evalueringer().some((e) => e.k === 4), 'agentkoden blev sendt til B');
    }
  });
}

test('select_frame: executionContextsCleared toemmer de kendte kontekster - en gammel standardkontekst bruges ikke (R133)', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')] },
    ryddet: { '': [ctx(8, 'TOP'), ctx(9, 'CDP-BARN')] },
  });
  await m.kald('select_frame', { frame_index: 1, code: '1' });
  assert.equal(m.evalueringer()[0]?.k, 9);
  assert.equal(m.evalueringer()[0]?.p.uniqueContextId, 'u.CDP-BARN.9', 'koden sendes med uniqueContextId');
  assert.equal(m.evalueringer()[0]?.p.contextId, undefined, 'og aldrig med det numeriske id');
  assert.ok(m.log.filter((x) => x.metode === 'Runtime.callFunctionOn').every((x) => x.p.uniqueContextId && x.p.executionContextId == null),
    'maerket spoerges med uniqueContextId');
});

// ── R133 (Astra, virtuelt ur): budgettet gaelder hele vejen ──
test('budget: tilslutningen i cdpSend kan ikke skubbe afsendelsen forbi fristen (virtuelt ur)', async () => {
  let nu = 1_000_000;
  const m = sele({ ur: () => nu });
  let kald = 0;
  m.u.chrome.debugger.getTargets = () => { kald++; if (kald === 2) nu += 1000; return Promise.resolve([{ tabId: 1, attached: true }]); };
  m.u.hent('debuggerAttached').add(1);
  const svar = await fang(m.u.hent('koerAgentKode')(1, 'window.__n = 1', {}, nu + 500));
  assert.equal(m.evalueringer().length, 0, 'koden blev sendt efter fristen');
  assert.match(svar.kastet || '', /not run \(nothing was sent\)/);
});

test('budget: uret starter, naar udvidelsen modtager kaldet - ikke efter sessionsgendannelsen (virtuelt ur)', async () => {
  let nu = 1_000_000;
  const m = sele({ ur: () => nu });
  const get = m.u.chrome.storage.local.get;
  m.u.chrome.storage.local.get = (...a) => { nu += 29_600; return get(...a); };   // gendannelsen bruger hele budgettet
  const svar = await new Promise((r) => m.u.fyr('runtime.onMessage', { type: 'mcp_command', port: 9876, method: 'execute_script', params: { code: 'window.__n = 1' } }, {}, r));
  assert.equal(m.evalueringer().length, 0, `koden blev sendt, efter at kaldets tid var brugt: ${JSON.stringify(svar)}`);
  assert.match(String(svar && svar.__error), /not run \(nothing was sent\)/);
});

test('budget: oprydningen (maerket fjernes) holder ikke svaret tilbage', async () => {
  const m = sele({ frames: toFrames, par: toPar, traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')] }, langsomOprydning: 400 });
  const svar = await m.kald('select_frame', { frame_index: 1, code: '1' });
  assert.equal(svar.result, 'svar');
  assert.ok(!m.log.some((x) => x.oprydningFaerdig), 'svaret ventede paa oprydningen');
  await new Promise((r) => setTimeout(r, 500));
  assert.ok(m.log.some((x) => x.oprydningFaerdig), 'oprydningen blev ikke gjort faerdig');
});

// R133 (Opus): med 40 eller flere fremmede frames i toppen saa tilknytningen ikke i deres egne fremmede boern.
test('select_frame: en fremmed frame inde i den 41. fremmede frame naas', async () => {
  const top = Array.from({ length: 41 }, (_, i) => ({ frameId: 100 + i, parentFrameId: 0, url: `https://x${i}.example/` }));
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, ...top, { frameId: 999, parentFrameId: 140, url: 'https://dyb.example/' }],
    par: Object.fromEntries([...top.map((f, i) => [f.frameId, 'X' + i]), [999, 'DYB']]),
    traeer: { '': topTrae([]) },
    kontekster: Object.fromEntries([['', [ctx(1, 'TOP')]], ...top.map((_, i) => ['S' + i, [ctx(1, 'X' + i)]]), ['S-DYB', [ctx(7, 'DYB')]]]),
    oopif: [...top.map((f, i) => ({ sessionId: 'S' + i, targetId: 'X' + i, url: f.url })), { i: 'S40', sessionId: 'S-DYB', targetId: 'DYB', url: 'https://dyb.example/' }],
    evaluate: (maal, p) => ({ result: { type: 'string', value: `${maal.sessionId}/${p.contextId}` } }),
  });
  const svar = await fang(m.kald('select_frame', { frame_index: 42, code: '1' }));
  assert.equal(svar.result, 'S-DYB/7', JSON.stringify(svar));
});

test('select_frame uden kode laeser framens tekst med et fast udtryk fra pakken', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')] },
  });
  await m.kald('select_frame', { frame_index: 1 });
  assert.equal(m.scripting().length, 0);
  assert.equal(m.evalueringer().length, 1);
  assert.match(m.evalueringer()[0].p.expression, /^\(?document\.body\.innerText\.slice\(0, 5000\)/);
  assert.equal(m.evalueringer()[0].k, 2);
});

test('select_frame: kaster koden, svares ok:false med framens adresse', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')] },
    evaluate: () => ({ exceptionDetails: { text: 'Uncaught', exception: { className: 'Error', description: 'Error: inde i rammen\n    at x' } } }),
  });
  const svar = await m.kald('select_frame', { frame_index: 1, code: "(() => { throw new Error('inde i rammen'); })()" });
  assert.equal(svar.ok, false);
  assert.equal(svar.error, 'inde i rammen');
  assert.equal(svar.frame_url, BARN);
  assert.equal(m.evalueringer().length, 1);
});

test('select_frame: en frame uden modpart i debuggeren koerer intet, mens dens soeskende virker', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 4, parentFrameId: 0, url: BARN }, { frameId: 7, parentFrameId: 0, url: BARN }],
    par: { 7: 'B' },
    traeer: { '': topTrae([{ id: 'B', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(3, 'B')] },
  });
  ikkeNaaet(await fang(m.kald('select_frame', { frame_index: 1, code: 'window.__n = 1' })), true);
  assert.equal(m.evalueringer().length, 0, 'koden maa ikke koere i en frame, der maaske er en anden');
  await m.kald('select_frame', { frame_index: 2, code: '1' });
  assert.equal(m.evalueringer()[0]?.k, 3);
});

test('select_frame: findes framen slet ikke i debuggeren, koeres intet', async () => {
  const m = sele({ frames: toFrames, par: toPar, traeer: { '': topTrae([]) }, kontekster: { '': [ctx(1, 'TOP')] } });
  ikkeNaaet(await fang(m.kald('select_frame', { frame_index: 1, code: 'window.__n = 1' })), true);
  assert.equal(m.evalueringer().length, 0, 'koden maa ikke ende i en anden frame');
  assert.equal(m.scripting().length, 0);
});

test('select_frame: har framen ingen standardkontekst, koeres intet', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN', false)] },
  });
  ikkeNaaet(await fang(m.kald('select_frame', { frame_index: 1, code: '1' })), true);
  assert.equal(m.evalueringer().length, 0, 'en isoleret verden er ikke framens egen kontekst');
});

test('agentens kode faar serverens frist minus hjemrejsen (29,5 s), ikke 20 s (R131 Opus: et loefte paa 21 s)', () => {
  const u = indlaesUdvidelse({ svar: {} });
  assert.equal(u.hent('cdpFrist')('Runtime.evaluate', { awaitPromise: true }), 29500);
  assert.equal(u.hent('cdpFrist')('Runtime.evaluate', {}), 8000, 'kun loefter, der afventes, faar den lange frist');
});

test('29,5 s gaelder HELE kaldet: tiden brugt paa fane og frame traekkes fra, og et brugt budget sender intet (R132 Astra)', async () => {
  const m = sele({ frames: toFrames, par: toPar, traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')] } });
  const frister = [];
  const send = m.u.chrome.debugger.sendCommand;
  m.u.chrome.debugger.sendCommand = (maal, metode, p) => {
    if (metode === 'Runtime.evaluate') frister.push(Date.now());
    return send(maal, metode, p);
  };
  const start = Date.now();
  await m.kald('select_frame', { frame_index: 1, code: '1' });
  assert.equal(m.u.hent('agentKodeSlut')(start), start + 29500);
  // Et kald, hvis budget allerede er brugt: koden sendes ikke, og fejlen siger det.
  const svar = await fang(m.u.hent('koerAgentKode')(1, 'window.__n = 1', {}, Date.now() - 1));
  assert.match(svar.kastet || '', /not run \(nothing was sent\)/);
  assert.equal(m.evalueringer().length, 1, 'koden maa ikke sendes, naar budgettet er brugt');
});

test('agentens kode faar kun det, der er TILBAGE af budgettet - ikke en ny fuld frist', async () => {
  const m = sele({ evaluate: () => new Promise(() => {}) });   // et loefte, der aldrig indfries
  const t0 = Date.now();
  const svar = await fang(m.u.hent('koerAgentKode')(1, 'new Promise(() => {})', {}, Date.now() + 150));
  assert.ok(Date.now() - t0 < 3000, `ventede ${Date.now() - t0} ms - fristen fulgte ikke budgettet`);
  assert.match(svar.kastet || '', /CDP did not respond within 1\d\d ms/);
  assert.match(svar.kastet || '', /MAY already have run/);
});

// ── Kilden: ingen strengkompilering i udvidelsen, intet activeTab ─────────────

const UDV_FILER = ['background.js', 'offscreen.js', 'popup.js', 'popup.html', 'offscreen.html'];

test('ingen new Function, eval eller anden kompilering af strenge nogen steder i udvidelsen (begge kopier)', () => {
  for (const mappe of ['extension', 'mcp-server/extension']) {
    for (const f of UDV_FILER) {
      const t = readFileSync(join(ROD, mappe, f), 'utf8');
      for (const [moenster, navn] of [
        [/\bnew\s+Function\b/, 'new Function'],
        [/(?<![\w$.])eval\s*\(/, 'eval('],
        [/(?<![\w$.])Function\s*\(/, 'Function('],
        [/\bset(?:Timeout|Interval)\s*\(\s*['"`]/, 'setTimeout/setInterval med en streng'],
        [/(?<![\w$.])import\s*\(/, 'dynamisk import('],
        [/createElement\(\s*['"`]script/, 'et <script>-element bygget i koden'],
      ]) {
        assert.doesNotMatch(t, moenster, `${mappe}/${f} indeholder ${navn}`);
      }
    }
  }
});

test('chrome.scripting faar aldrig agentens kode med som argument', () => {
  const bg = readFileSync(join(ROD, 'extension/background.js'), 'utf8');
  assert.doesNotMatch(bg, /args:\s*\[\s*(?:params\.code|code|params\.script)\b/, 'agentens kode sendes til chrome.scripting');
  for (const navn of ['execute_script', 'select_frame']) {
    const i = bg.indexOf(`case '${navn}': {`);
    assert.ok(i > 0, navn);
    const blok = bg.slice(i, bg.indexOf('\n    case ', i + 10));
    assert.doesNotMatch(blok, /scripting\.executeScript|safeExecuteScript/, `${navn} bruger stadig chrome.scripting`);
  }
});

// ── Popuppens handlingslog: agentens JavaScript fremhaeves i begge vaerktoejer ──
// R129-ASTRA D40: execute_script stod i SENSITIVE, select_frame gjorde ikke - men begge koerer agentens kode.
test('handlingsloggen fremhaever select_frame som execute_script (kategori sensitive)', async () => {
  for (const metode of ['execute_script', 'select_frame']) {
    const u = indlaesUdvidelse({ svar: {} });
    await u.hent('logAction')(9876, metode);
    const gemt = u.optager.til('storage.local.set').map((k) => k.args[0]).find((o) => o && Array.isArray(o.actionLog));
    assert.equal(gemt?.actionLog[0]?.category, 'sensitive', `${metode} fremhaeves ikke i popuppens log`);
  }
});
