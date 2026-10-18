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

// Chrome-modellen. `traeer` er Page.getFrameTree pr. session ('' = fanens egen), `kontekster` er de standardkontekster,
// Runtime.enable melder pr. session, og `oopif` er de maal, Target.setAutoAttach melder (i: den session, de meldes i).
// Som Chrome (maalt 19/10): Runtime.enable og Target.setAutoAttach melder INTET, naar de allerede staar til.
// `sene: true` leverer haendelserne 20 ms EFTER svaret - chrome.debugger lover ikke raekkefoelgen mellem de to.
// Identitet (R131, Astra og Opus): `par` er SANDHEDEN, { udvidelsens frameId: CDP-frame-id }. Framens identitet er den
// samme set fra begge sider: inde i framen (chrome.scripting, frameIdentitet(0)) og fra ejer-elementet i forælderen
// (DOM.getFrameOwner + callFunctionOn, frameIdentitet(1)): [plads i window.frames, antal, ejer-plads, antal ejere].
// Modellen giver pladsen efter udvidelsens frameId-raekkefoelge blandt soeskende, saa den IKKE falder sammen med
// debuggerens raekkefoelge. `webPlads`/`cdpPlads` overstyrer en side (tuple eller Error), og `vaek` er frames,
// webNavigation.getFrame ikke kender laengere.
function sele({ frames, traeer = {}, kontekster = {}, oopif = [], evaluate, runtimeTil = [], autoAttachTil = [], sene = false,
  par = {}, webPlads = {}, cdpPlads = {}, vaek = [] } = {}) {
  const log = [];
  let u;
  const kilde = (sid) => (sid ? { tabId: 1, sessionId: sid } : { tabId: 1 });
  const runtime = new Set(runtimeTil), auto = new Set(autoAttachTil);
  const send = (...a) => (sene ? setTimeout(() => u.fyr(...a), 20) : u.fyr(...a));
  const verdener = new Set();
  const alleFrames = frames || [{ frameId: 0, parentFrameId: -1, url: TOP }];
  const sandPlads = (f) => {
    const w = alleFrames.find((x) => x.frameId === f);
    const s = alleFrames.filter((x) => x.frameId !== 0 && x.parentFrameId === w?.parentFrameId).map((x) => x.frameId).sort((a, b) => a - b);
    return [s.indexOf(f), s.length, s.indexOf(f), s.length];
  };
  u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: TOP, windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: TOP, windowId: 1, active: true }],
    'webNavigation.getAllFrames': alleFrames,
    'webNavigation.getFrame': (q) => (vaek.includes(q.frameId) ? null : alleFrames.find((x) => x.frameId === q.frameId) || null),
    'scripting.executeScript': (o) => {
      log.push({ scripting: true, world: o.world, args: o.args, frameIds: o.target?.frameIds, func: o.func?.name });
      if (o.func?.name === 'frameIdentitet' && o.world === 'ISOLATED' && o.args?.[0] === 0) {
        const f = o.target.frameIds[0];
        const v = f in webPlads ? webPlads[f] : sandPlads(f);
        if (v instanceof Error) throw v;
        return [{ frameId: o.target.frameIds[0], result: v }];
      }
      throw new Error('scripting maa ikke bruges til agentkode');
    },
    'debugger.sendCommand': (maal, metode, p) => {
      const sid = maal.sessionId || '';
      log.push({ sid, metode, p, maal });
      if (metode === 'Page.getFrameTree') return { frameTree: traeer[sid] };
      if (metode === 'Runtime.disable') { runtime.delete(sid); return {}; }
      if (metode === 'Runtime.enable') {
        if (runtime.has(sid)) return {};
        runtime.add(sid);
        for (const context of kontekster[sid] || []) send('debugger.onEvent', kilde(sid), 'Runtime.executionContextCreated', { context });
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
      if (metode === 'Page.createIsolatedWorld') { const c = 5000 + log.length; verdener.add(c); return { executionContextId: c }; }
      if (metode === 'DOM.getFrameOwner') {
        if (cdpPlads[p.frameId] instanceof Error) throw cdpPlads[p.frameId];
        return { backendNodeId: 'ejer:' + p.frameId };
      }
      if (metode === 'DOM.resolveNode') {
        assert.ok(verdener.has(p.executionContextId), 'ejeren skal laeses i en isoleret verden, som siden ikke kan pille ved');
      }
      if (metode === 'DOM.resolveNode') return { object: { objectId: 'obj:' + String(p.backendNodeId).slice(5) } };
      if (metode === 'Runtime.callFunctionOn') {
        assert.equal(p.arguments?.[0]?.value, 1, 'debuggerens side skal koere frameIdentitet(1)');
        const c = String(p.objectId).slice(4);
        const web = Object.keys(par).find((k) => par[k] === c);
        const v = c in cdpPlads ? cdpPlads[c] : web != null ? sandPlads(Number(web)) : [90, 90, 90, 90];
        return { result: { type: 'object', value: v } };
      }
      if (metode === 'Runtime.evaluate') return evaluate ? evaluate(maal, p) : { result: { type: 'string', value: 'svar' } };
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const evalueringer = () => log.filter((x) => x.metode === 'Runtime.evaluate');
  // chrome.scripting med agentens kode (en tekst som argument) eller uden for ISOLATED. Identitetsopslaget er den pakkede
  // frameIdentitet med et tal som argument.
  const scripting = () => log.filter((x) => x.scripting && (x.world !== 'ISOLATED' || (x.args || []).some((a) => typeof a === 'string')));
  return { u, log, evalueringer, scripting, kald: (navn, params) => u.hent('dispatch')(9876, navn, params) };
}
const fang = (p) => p.then((r) => r, (e) => ({ kastet: String(e?.message || e) }));
const ctx = (id, frameId, isDefault = true) => ({ id, origin: 'x', name: '', auxData: { isDefault, type: isDefault ? 'default' : 'isolated', frameId } });

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
  assert.equal(m.evalueringer()[0].p.contextId, undefined);
  assert.equal(svar.result, 'svar');
  assert.equal(svar.frame_url, TOP);
});

test('select_frame i en frame fra samme domaene: identiteten bevises paa ejer-elementet, og koden koerer i framens standardkontekst', async () => {
  const m = sele({
    frames: toFrames, par: toPar,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN', false), ctx(3, 'CDP-BARN')] },
    evaluate: (_maal, p) => ({ result: { type: 'string', value: 'ctx' + p.contextId } }),
  });
  const svar = await m.kald('select_frame', { frame_index: 1, code: 'window.hemmelig' });
  assert.equal(m.scripting().length, 0, 'chrome.scripting fik agentens kode');
  const id = m.log.find((x) => x.scripting && x.func === 'frameIdentitet');
  assert.ok(id, 'udvidelsens side af identiteten mangler');
  assert.deepEqual([...id.frameIds], [5], 'identiteten maales INDE i netop den valgte frame');
  assert.deepEqual([...id.args], [0]);
  assert.ok(m.log.some((x) => x.metode === 'DOM.getFrameOwner' && x.p.frameId === 'CDP-BARN'), 'debuggerens side af identiteten mangler');
  const ev = m.evalueringer();
  assert.equal(ev.length, 1);
  assert.equal(ev[0].p.contextId, 3, 'framens STANDARDkontekst (isDefault), ikke en isoleret verden og ikke hovedsiden');
  assert.equal(ev[0].p.awaitPromise, true);
  assert.equal(ev[0].sid, '');
  assert.equal(svar.result, 'ctx3');
  assert.equal(svar.frame_url, BARN);
  const sidste = (navn) => m.log.map((x) => x.metode).lastIndexOf(navn);
  assert.ok(sidste('Runtime.disable') > sidste('Runtime.enable'), 'Runtime skal slaas fra igen, efter at konteksten er fundet');
});

test('select_frame: to frames fra samme domaene med samme adresse skilles ad paa ejer-elementet, ikke paa raekkefoelgen', async () => {
  // Debuggerens boern staar i omvendt raekkefoelge af udvidelsens frameId - en positionel parring ville bytte dem om.
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 4, parentFrameId: 0, url: BARN }, { frameId: 7, parentFrameId: 0, url: BARN }],
    par: { 4: 'A', 7: 'B' },
    traeer: { '': topTrae([{ id: 'B', url: BARN }, { id: 'A', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'A'), ctx(3, 'B')] },
  });
  await m.kald('select_frame', { frame_index: 1, code: '1' });   // frameId 4 = A
  assert.equal(m.evalueringer()[0].p.contextId, 2);
  await m.kald('select_frame', { frame_index: 2, code: '1' });   // frameId 7 = B
  assert.equal(m.evalueringer()[1].p.contextId, 3);
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
    ['udvidelsen maa ikke laese framen', { webPlads: { 9: new Error('Cannot access contents of the page.') } }, false],
    ['framen kan ikke se sin plads (shadow root paa en fremmed side)', { webPlads: { 9: [-1, 2, -1, -1] } }, false],
    ['to kandidater har samme plads', { cdpPlads: { F2: [0, 2, 0, 2] } }, false],
    ['debuggeren kan ikke laese nogen ejer', { cdpPlads: { F1: new Error('No node'), F2: new Error('No node') } }, true],
    ['antallet af frames passer ikke (siden aendrede sig)', { cdpPlads: { F1: [0, 3, 0, 3], F2: [1, 3, 1, 3] } }, true],
    ['framen forsvandt under opslaget', { webPlads: { 9: new Error('Frame with ID 9 was removed.') } }, true],
    ['framen er vaek, saa en varig fejl er alligevel forbigaaende', { webPlads: { 9: [-1, 2, -1, -1] }, vaek: [9] }, true],
  ]) {
    const m = sele(toFremmede(ekstra));
    const svar = await fang(m.kald('select_frame', { frame_index: 1, code: 'window.__n = 1' }));
    ikkeNaaet(svar, retry);
    assert.equal(m.evalueringer().length, 0, `${navn}: koden maa ikke koere i en frame, der ikke er bevist`);
  }
});

test('select_frame: en about:blank skrevet med document.write (debuggeren viser forælderens adresse) naas (R131 Opus)', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 16, parentFrameId: 0, url: 'about:blank' }],
    par: { 16: 'W' },
    traeer: { '': topTrae([{ id: 'W', url: TOP }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'W')] },
  });
  await m.kald('select_frame', { frame_index: 1 });
  assert.equal(m.evalueringer()[0]?.p.contextId, 2);
});

test('select_frame: en frame, der ikke kan bevises, slaar ikke dens soeskende ud (R131 Opus)', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 16, parentFrameId: 0, url: 'about:blank' },
      { frameId: 17, parentFrameId: 0, url: 'about:blank' }, { frameId: 20, parentFrameId: 0, url: 'about:blank' }],
    par: { 16: 'X1', 17: 'X2', 20: 'X3' },
    cdpPlads: { X2: new Error('No node with given id found') },
    traeer: { '': topTrae([{ id: 'X1', url: TOP }, { id: 'X2', url: 'about:blank' }, { id: 'X3', url: 'about:blank' }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'X1'), ctx(3, 'X2'), ctx(4, 'X3')] },
  });
  await m.kald('select_frame', { frame_index: 1, code: '1' });
  assert.equal(m.evalueringer()[0]?.p.contextId, 2);
  await m.kald('select_frame', { frame_index: 3, code: '1' });
  assert.equal(m.evalueringer()[1]?.p.contextId, 4);
  ikkeNaaet(await m.kald('select_frame', { frame_index: 2, code: '1' }), true);
  assert.equal(m.evalueringer().length, 2);
});

test('select_frame: en frame i en shadow root (ingen plads i window.frames) bevises paa ejer-elementet', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 4, parentFrameId: 0, url: BARN }, { frameId: 6, parentFrameId: 0, url: 'about:srcdoc' }],
    par: { 4: 'A', 6: 'S' },
    webPlads: { 4: [0, 1, 0, 2], 6: [-1, 1, 1, 2] },
    cdpPlads: { A: [0, 1, 0, 2], S: [-1, 1, 1, 2] },
    traeer: { '': topTrae([{ id: 'A', url: BARN }, { id: 'S', url: 'about:srcdoc' }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'A'), ctx(3, 'S')] },
  });
  await m.kald('select_frame', { frame_index: 2, code: '1' });
  assert.equal(m.evalueringer()[0]?.p.contextId, 3);
  await m.kald('select_frame', { frame_index: 1, code: '1' });
  assert.equal(m.evalueringer()[1]?.p.contextId, 2);
});

test('select_frame: ejer-pladsen bruges kun for en frame uden plads i window.frames', async () => {
  // Kandidaten S har samme ejer-plads som framen, men en plads i window.frames - det er ikke den samme frame.
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 6, parentFrameId: 0, url: 'about:srcdoc' }],
    par: { 6: 'S' },
    webPlads: { 6: [-1, 1, 1, 2] },
    cdpPlads: { S: [0, 1, 1, 2] },
    traeer: { '': topTrae([{ id: 'S', url: 'about:srcdoc' }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(3, 'S')] },
  });
  ikkeNaaet(await fang(m.kald('select_frame', { frame_index: 1, code: '1' })), true);
  assert.equal(m.evalueringer().length, 0);
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
  assert.ok(m.log.some((x) => x.metode === 'DOM.getFrameOwner' && x.p.frameId === 'PAY' && x.sid === ''), 'OOPIF-ejeren ligger i FORAELDERENS session');
  const ev = m.evalueringer();
  assert.equal(ev.length, 1);
  assert.deepEqual({ ...ev[0].maal }, { tabId: 1, sessionId: 'S-PAY' }, 'koden skal sendes til barnets session');
  assert.equal(ev[0].p.contextId, 1);
  assert.equal(svar.result, 'S-PAY/1');
  assert.equal(svar.frame_url, FREMMED);
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
  assert.ok(m.log.some((x) => x.metode === 'DOM.getFrameOwner' && x.p.frameId === 'DYB' && x.sid === 'S-PAY'), 'ejeren af DYB ligger i PAY');
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
  assert.equal(m.evalueringer()[0].p.contextId, 2);
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
  assert.equal(m.evalueringer()[0]?.p.contextId, 3);
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
