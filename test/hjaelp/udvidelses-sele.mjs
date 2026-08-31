/**
 * Test-sele for extension/background.js
 *
 * Hvorfor den findes: 3.858 linjer udvidelseskode havde NUL automatisk daekning.
 * Hver eneste fejl vi har jagtet manuelt — dialog-deadlocken, `fill` der tilfoejer i
 * stedet for at erstatte, klik der ikke lander, switch_tab der glemte vinduet — laa
 * her. De blev alle fundet ved at snuble over dem.
 *
 * Grunden til at det aldrig er sket foer: filen ER en service worker. Den kan ikke
 * importeres, for den kalder chrome.* ved indlaesning.
 *
 * MAALT 31/8: der er praecis 8 bivirkninger paa topniveau, og de er ALLE
 * `chrome.*.addListener` eller `chrome.alarms`. Giver man filen et chrome-stub, kan
 * hele den evalueres i en VM — uden at flytte en eneste linje kode. Ingen refaktor,
 * ingen ny arkitektur. Bare en sele.
 *
 * Selen giver:
 *   - alle top-niveau funktioner, kaldbare direkte
 *   - et chrome-stub hvor hvert kald optages, saa man kan se HVAD der blev sendt
 *   - lytterne der blev registreret, saa haendelser kan fyres ind
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const her = dirname(fileURLToPath(import.meta.url));
export const ROD = join(her, '..', '..');

/** Optager hvad udvidelsen sendte til Chrome. */
class Optager {
  constructor() { this.kald = []; }
  til(sti) { return this.kald.filter((k) => k.sti === sti); }
  sidste(sti) { return this.til(sti).at(-1); }
  antal(sti) { return this.til(sti).length; }
  ryd() { this.kald.length = 0; }
}

/**
 * Byg et chrome-stub.
 *
 * `svar` giver faste svar pr. sti, fx { 'tabs.get': {id: 1, url: 'https://x'} }.
 * En funktion kaldes med argumenterne og kan svare dynamisk. En Error afvises,
 * saa fejlstier kan afproeves.
 */
export function byggChrome(svar = {}, optager = new Optager()) {
  const lyttere = new Map();

  const kald = (sti) => (...args) => {
    optager.kald.push({ sti, args });
    const s = svar[sti];
    if (typeof s === 'function') {
      try { return Promise.resolve(s(...args)); } catch (e) { return Promise.reject(e); }
    }
    if (s instanceof Error) return Promise.reject(s);
    return Promise.resolve(s);
  };

  const haendelse = (sti) => ({
    addListener: (fn) => {
      if (!lyttere.has(sti)) lyttere.set(sti, []);
      lyttere.get(sti).push(fn);
    },
    removeListener: (fn) => {
      const l = lyttere.get(sti) || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    hasListener: (fn) => (lyttere.get(sti) || []).includes(fn),
  });

  const chrome = {
    runtime: {
      id: 'test-udvidelse-id',
      lastError: null,
      getManifest: (...a) => { optager.kald.push({ sti: 'runtime.getManifest', args: a }); return svar['runtime.getManifest'] ?? { version: '1.28.1' }; },
      sendMessage: kald('runtime.sendMessage'),
      reload: kald('runtime.reload'),
      getURL: (p) => 'chrome-extension://test/' + p,
      onMessage: haendelse('runtime.onMessage'),
      onStartup: haendelse('runtime.onStartup'),
      onInstalled: haendelse('runtime.onInstalled'),
    },
    tabs: {
      get: kald('tabs.get'), update: kald('tabs.update'), create: kald('tabs.create'),
      remove: kald('tabs.remove'), query: kald('tabs.query'), group: kald('tabs.group'),
      captureVisibleTab: kald('tabs.captureVisibleTab'), sendMessage: kald('tabs.sendMessage'),
      onRemoved: haendelse('tabs.onRemoved'), onCreated: haendelse('tabs.onCreated'),
      onUpdated: haendelse('tabs.onUpdated'),
    },
    tabGroups: { update: kald('tabGroups.update'), query: kald('tabGroups.query') },
    windows: { update: kald('windows.update'), get: kald('windows.get'), getLastFocused: kald('windows.getLastFocused') },
    debugger: {
      attach: kald('debugger.attach'), detach: kald('debugger.detach'),
      sendCommand: kald('debugger.sendCommand'), getTargets: kald('debugger.getTargets'),
      onEvent: haendelse('debugger.onEvent'), onDetach: haendelse('debugger.onDetach'),
    },
    scripting: { executeScript: kald('scripting.executeScript') },
    storage: {
      local: { get: kald('storage.local.get'), set: kald('storage.local.set'), remove: kald('storage.local.remove') },
      session: { get: kald('storage.session.get'), set: kald('storage.session.set') },
    },
    offscreen: {
      hasDocument: kald('offscreen.hasDocument'), createDocument: kald('offscreen.createDocument'),
      closeDocument: kald('offscreen.closeDocument'),
    },
    action: { setBadgeText: kald('action.setBadgeText'), setBadgeBackgroundColor: kald('action.setBadgeBackgroundColor'), setTitle: kald('action.setTitle') },
    alarms: {
      create: kald('alarms.create'), clear: kald('alarms.clear'),
      get: (navn, cb) => { optager.kald.push({ sti: 'alarms.get', args: [navn] }); if (cb) cb(svar['alarms.get']); },
      onAlarm: haendelse('alarms.onAlarm'),
    },
    webNavigation: { getAllFrames: kald('webNavigation.getAllFrames') },
    cookies: { getAll: kald('cookies.getAll'), set: kald('cookies.set') },
    permissions: { contains: kald('permissions.contains'), request: kald('permissions.request') },
  };

  return { chrome, optager, lyttere };
}

/**
 * Indlaes background.js i en VM og giv adgang til alt indeni.
 *
 *   const u = indlaesUdvidelse();
 *   u.hent('debuggerClick')             -> funktionen selv
 *   u.optager.sidste('tabs.update')     -> hvad der blev sendt til Chrome
 *   u.fyr('tabs.onRemoved', 42)         -> fyr en registreret lytter
 */
export function indlaesUdvidelse({ svar = {}, kilde = 'extension/background.js' } = {}) {
  const { chrome, optager, lyttere } = byggChrome(svar);
  const src = readFileSync(join(ROD, kilde), 'utf8');

  const ctx = vm.createContext({
    chrome,
    console: { log() {}, warn() {}, error() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    fetch: (...a) => {
      optager.kald.push({ sti: 'fetch', args: a });
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(''), json: () => Promise.resolve({}) });
    },
    URL, TextEncoder, TextDecoder, atob, btoa, structuredClone,
    // background.js laeser navigator.userAgent ved indlaesning (linje 14) for at
    // afgoere om "vaelg alt" er Cmd eller Ctrl. Uden den kaster hele filen.
    navigator: { userAgent: svar['navigator.userAgent'] ?? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  ctx.globalThis = ctx;
  ctx.self = ctx;

  // `const`/`let` paa topniveau bliver IKKE egenskaber paa globalThis — kun `var` og
  // funktions-erklaeringer goer. Udvidelsens tilstand (armeredeDialoger, sessions,
  // debuggerAttached ...) ligger i const'er, saa uden det her kan en test se
  // funktionerne men ikke det de arbejder paa.
  //
  // Loesningen roerer ikke produktionskoden: vi haefter en linje BAGEFTER kilden, i
  // samme scope, der loefter de navne vi kender frem. Findes et navn ikke, springes
  // det over — saa selen ikke gaar i stykker naar filen aendrer sig.
  const loeft = [
    'armeredeDialoger', 'dialogLoefter', 'sessions', 'debuggerAttached',
    'agentLukkedeFaner', 'SELECT_ALL_MODS', 'CDP_CHAR_CODES', 'RETRYABLE_CDP_METHODS',
  ];
  const hale = '\n;' + loeft.map((n) => `try { globalThis.__t_${n} = ${n}; } catch (e) {}`).join('\n');

  vm.runInContext(src + hale, ctx, { filename: kilde });

  for (const n of loeft) {
    if (ctx['__t_' + n] !== undefined && ctx[n] === undefined) ctx[n] = ctx['__t_' + n];
  }

  return {
    ctx, chrome, optager, lyttere,
    hent: (navn) => ctx[navn],
    fyr: (sti, ...args) => Promise.all((lyttere.get(sti) || []).map((fn) => fn(...args))),
  };
}
