/**
 * Serverens bro (mcp-server/index.js) i en VM - med AEGTE WebSocket-servere paa 127.0.0.1, men uden stdio og uden MCP.
 *
 * Hvorfor (1.31, S1a): en partition (#20) er en ekstra bane i samme proces, og den findes foerst som vaerktoej i en senere
 * skive. PR #20's fem maalte fejl (T1-T5, R106) handler om to lyttere i ÉN proces, saa proeverne skal kunne lave en bane mere
 * uden at serveren har en proeve-indgang. Blokken fra `const BASE_PORT` til `// ── MCP Server` er hele broen: baner,
 * createWSS, svar-tjekket, porten og sendToExtension. Den skaeres ud ved de to graenser (kaster hellere end at gaette) og
 * koeres uaendret. Kun process er en attrap (env, stderr, ppid).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const rod = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const krav = createRequire(join(rod, 'mcp-server', 'index.js'));
export const WebSocket = krav('ws');

export function broKilde() {
  const kilde = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');
  const fra = kilde.indexOf('const BASE_PORT = ');
  const til = kilde.indexOf('// ── MCP Server');
  if (fra < 0 || til < 0 || til < fra) throw new Error('broens graenser (const BASE_PORT / // ── MCP Server) findes ikke i index.js');
  return kilde.slice(fra, til);
}

/**
 * Starter broen med det givne env. k(kode) koerer kode i broens scope.
 * `foersteValgMs` saetter ventetiden foer foerste valg (standard 0 i proeverne; serveren bruger 2500).
 * `genforsoegMs` korter broens genforsoeg (5 x 1500 ms, plus 5 til hvis porten lige er aabnet) ned, saa en proeve af et
 * udtoemt budget ikke tager 15 s. Kun de 1500 ms aendres; alle andre frister er broens egne.
 */
export function broModel(env = {}, { genforsoegMs = null, foersteValgMs = 0 } = {}) {
  const log = [];
  const timere = new Set();
  const ctx = {
    process: { env: { ...env }, ppid: 4242, stderr: { write: (t) => { log.push(String(t)); return true; } } },
    WebSocketServer: krav('ws').WebSocketServer,
    setTimeout: (f, ms, ...a) => setTimeout(f, genforsoegMs && ms === 1500 ? genforsoegMs : ms, ...a),
    clearTimeout,
    // Broens egne intervaller (tomgangsvagten, hjerteslaget) maa ikke holde proeveprocessen i live.
    setInterval: (f, ms) => { const t = setInterval(f, ms); t.unref?.(); timere.add(t); return t; },
    clearInterval: (t) => { timere.delete(t); clearInterval(t); },
    console, Date, Promise, JSON, Map, Set, Number, String, Math, Error, Boolean, Array, Object, RegExp, Buffer,
    gracefulShutdown: () => { log.push('gracefulShutdown'); },
  };
  vm.createContext(ctx);
  vm.runInContext(broKilde(), ctx, { filename: 'index.js (broen)' });
  const k = (kode) => vm.runInContext(kode, ctx);
  // R115: foerste valg venter, til porten har vaeret aaben i ~2,5 s (FOERSTE_VALG_MS). Proeverne starter med 0, saa hvert
  // foerste kald ikke koster 2,5 s; proeverne af ventetiden saetter den selv.
  // foersteValgMs: null beholder kildens egen vaerdi (proeven af den maalte ventetid skal maale serverens tal).
  if (foersteValgMs !== null) k(`FOERSTE_VALG_MS = ${Number(foersteValgMs)}`);
  // Ryddes ogsaa naar en proeve fejler (fx under en mutant): ellers holder aabne sokler og ventende frister proeveprocessen
  // i live, og koerslen haenger i stedet for at blive roed.
  const luk = () => {
    // Et kald, der stadig proever igen, maa ikke binde en NY port efter proeven (den holdt processen i live, maalt under
    // mutant B10). Bindingen slaas fra foerst.
    try { k('sikrePort = async () => false;'); } catch {}
    try { k('for (const p of pending.values()) clearTimeout(p.timer); pending.clear()'); } catch {}
    // 1.32: ogsaa partitionernes baner - en bane, der er taget ud af `baner` (lukket), men alligevel har bundet en port (fx
    // under en mutant), maa ikke holde proeveprocessen i live (maalt: mutant P2 gav TIDSUDLOEB).
    try { k('if (typeof partitioner !== "undefined") for (const p of partitioner.values()) frigivPort(p.bane, "proeven er slut")'); } catch {}
    try { k('for (const b of baner) frigivPort(b, "proeven er slut")'); } catch {
      // En kilde uden baner (fx 07f01ef, naar en proeve skal ses roed foer rettelsen): den gamle frigivPort(grund).
      try { k('frigivPort("proeven er slut")'); } catch {}
    }
    for (const t of timere) clearInterval(t);
    for (const u of klienter) u.luk();
    klienter.clear();
  };
  return { ctx, k, log, luk };
}

const klienter = new Set();

export const vent = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function venteTil(f, ms = 3000, trin = 20) {
  const t0 = Date.now();
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await vent(trin);
  }
}

/**
 * En falsk udvidelse: forbinder med en chrome-extension-Origin, hilser, og logger de kommandoer den faar. Svarer kun naar
 * proeven beder om det. `hello` kan erstattes (fx med instance/profile i S2) eller udelades (hello: null).
 */
export async function falskUdvidelse(port, { id = 'a'.repeat(32), hello = undefined } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${id}` });
  const kom = [];
  ws.on('message', (d) => { try { const m = JSON.parse(String(d)); if (m && m.method) kom.push(m); } catch {} });
  ws.on('error', () => {});
  await new Promise((ok, fejl) => { ws.once('open', ok); ws.once('error', fejl); });
  const u = {
    ws, kom,
    svar: (cmdId, result) => ws.send(JSON.stringify({ id: cmdId, result })),
    send: (obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)),
    luk: () => { try { ws.terminate(); } catch {} },
  };
  klienter.add(u);
  const h = hello === undefined ? { type: 'hello', extensionId: id, version: '1.30.2', name: null } : hello;
  if (h) ws.send(JSON.stringify(h));
  return u;
}
