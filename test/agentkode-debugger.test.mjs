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
function sele({ frames, traeer = {}, kontekster = {}, oopif = [], evaluate, runtimeTil = [], autoAttachTil = [], sene = false } = {}) {
  const log = [];
  let u;
  const kilde = (sid) => (sid ? { tabId: 1, sessionId: sid } : { tabId: 1 });
  const runtime = new Set(runtimeTil), auto = new Set(autoAttachTil);
  const send = (...a) => (sene ? setTimeout(() => u.fyr(...a), 20) : u.fyr(...a));
  u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: TOP, windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: TOP, windowId: 1, active: true }],
    'webNavigation.getAllFrames': frames || [{ frameId: 0, parentFrameId: -1, url: TOP }],
    'scripting.executeScript': (o) => { log.push({ scripting: true, world: o.world }); throw new Error('scripting maa ikke bruges til agentkode'); },
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
      if (metode === 'Runtime.evaluate') return evaluate ? evaluate(maal, p) : { result: { type: 'string', value: 'svar' } };
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const evalueringer = () => log.filter((x) => x.metode === 'Runtime.evaluate');
  const scripting = () => log.filter((x) => x.scripting);
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
const topTrae = (boern) => ({ frame: { id: 'TOP', url: TOP }, childFrames: boern.map((b) => ({ frame: { parentId: 'TOP', ...b } })) });

test('select_frame 0 koerer i hovedsiden via debuggeren', async () => {
  const m = sele({ frames: toFrames });
  const svar = await m.kald('select_frame', { frame_index: 0, code: 'location.href' });
  assert.equal(m.scripting().length, 0);
  assert.equal(m.evalueringer().length, 1);
  assert.equal(m.evalueringer()[0].p.contextId, undefined);
  assert.equal(svar.result, 'svar');
  assert.equal(svar.frame_url, TOP);
});

test('select_frame i en frame fra samme domaene: frameId oversaettes via Page.getFrameTree, og koden koerer i framens standardkontekst', async () => {
  const m = sele({
    frames: toFrames,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN', false), ctx(3, 'CDP-BARN')] },
    evaluate: (_maal, p) => ({ result: { type: 'string', value: 'ctx' + p.contextId } }),
  });
  const svar = await m.kald('select_frame', { frame_index: 1, code: 'window.hemmelig' });
  assert.equal(m.scripting().length, 0, 'chrome.scripting.executeScript blev brugt');
  assert.ok(m.log.some((x) => x.metode === 'Page.getFrameTree'), 'udvidelsens frameId skal oversaettes via Page.getFrameTree');
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

test('select_frame: to frames med samme adresse skilles ad i oprettelsesraekkefoelge', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 7, parentFrameId: 0, url: BARN }, { frameId: 4, parentFrameId: 0, url: BARN }],
    traeer: { '': topTrae([{ id: 'A', url: BARN }, { id: 'B', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'A'), ctx(3, 'B')] },
  });
  await m.kald('select_frame', { frame_index: 1, code: '1' });   // frameId 7 er den senest oprettede af de to
  assert.equal(m.evalueringer()[0].p.contextId, 3);
  await m.kald('select_frame', { frame_index: 2, code: '1' });   // frameId 4 er den foerste
  assert.equal(m.evalueringer()[1].p.contextId, 2);
});

test('select_frame i en frame fra et andet domaene (OOPIF): Target.setAutoAttach med flatten, og koden koerer i barnets session', async () => {
  const m = sele({
    frames: toFrames,
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
  frames: toFrames,
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
});

test('select_frame uden kode laeser framens tekst med et fast udtryk fra pakken', async () => {
  const m = sele({
    frames: toFrames,
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
    frames: toFrames,
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

test('select_frame: viser debuggeren faerre frames med adressen end udvidelsen, gaettes der ikke', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 4, parentFrameId: 0, url: BARN }, { frameId: 7, parentFrameId: 0, url: BARN }],
    traeer: { '': topTrae([{ id: 'B', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(3, 'B')] },
  });
  const svar = await fang(m.kald('select_frame', { frame_index: 1, code: 'window.__n = 1' }));
  assert.equal(svar.error, 'frame-not-reachable', JSON.stringify(svar));
  assert.equal(m.evalueringer().length, 0, 'koden maa ikke koere i en frame, der maaske er en anden');
});

test('select_frame: en adresse med #fragment parres (debuggeren har fragmentet i urlFragment)', async () => {
  const m = sele({
    frames: [{ frameId: 0, parentFrameId: -1, url: TOP }, { frameId: 5, parentFrameId: 0, url: BARN + '#trin2' }],
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN, urlFragment: '#trin2' }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN')] },
  });
  await m.kald('select_frame', { frame_index: 1, code: '1' });
  assert.equal(m.evalueringer()[0]?.p.contextId, 2);
});

test('select_frame: findes framen ikke i debuggeren, koeres intet - heller ikke i en anden frame', async () => {
  const m = sele({
    frames: toFrames,
    traeer: { '': topTrae([]) },
    kontekster: { '': [ctx(1, 'TOP')] },
  });
  const svar = await fang(m.kald('select_frame', { frame_index: 1, code: 'window.__n = 1' }));
  assert.equal(svar.ok, false, JSON.stringify(svar));
  assert.equal(svar.error, 'frame-not-reachable');
  assert.equal(svar.sent, false);
  assert.equal(m.evalueringer().length, 0, 'koden maa ikke ende i en anden frame');
  assert.equal(m.scripting().length, 0);
});

test('select_frame: har framen ingen standardkontekst, koeres intet', async () => {
  const m = sele({
    frames: toFrames,
    traeer: { '': topTrae([{ id: 'CDP-BARN', url: BARN }]) },
    kontekster: { '': [ctx(1, 'TOP'), ctx(2, 'CDP-BARN', false)] },
  });
  const svar = await fang(m.kald('select_frame', { frame_index: 1, code: '1' }));
  assert.equal(svar.error, 'frame-not-reachable', JSON.stringify(svar));
  assert.equal(m.evalueringer().length, 0, 'en isoleret verden er ikke framens egen kontekst');
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
