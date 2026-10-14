// Skrivebordsmaaling til 1.30.3 (#69), foer der bygges (DESIGN-1.30.3-og-1.31-SAMLET.md): naar udvidelsen har Page slaaet til paa
// fanen, kan et MENNESKE saa stadig se og besvare «Leave site?», og giver menneskets svar Chromes Page.javascriptDialogClosed?
// Koeres paa GitHubs Mac i en synlig Chrome - aldrig paa en maskine et menneske sidder ved.
//
//   node test/skrivebord/dialog.mjs <chrome-binaer> <udvidelse>
//
// «Mennesket» er macOS' egne tastetryk (System Events) til Chrome-vinduet. Kraever det en tilladelse runneren ikke har, siger
// maalingen UMAALT - aldrig groent.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocketServer } from '../../mcp-server/node_modules/ws/wrapper.mjs';

const [,, CHROME, EXT] = process.argv;
const sov = (ms) => new Promise((r) => setTimeout(r, ms));
const SIDER = {
  '/forlad.html': '<!doctype html><title>forlad</title><label><input type="checkbox" id="bu"> arm</label><p>side 1</p><script>addEventListener("beforeunload",e=>{if(document.getElementById("bu").checked){e.preventDefault();e.returnValue="";}});</script>',
  '/tekst.html': '<!doctype html><title>tekst</title><p>side 2</p>',
};
const sider = createServer((q, r) => { const s = SIDER[new URL(q.url, 'http://x').pathname]; r.writeHead(s ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); r.end(s || 'nej'); }).listen(19871, '127.0.0.1');
await new Promise((r) => sider.once('listening', r));
const U = 'http://127.0.0.1:19871';

const osa = (script) => { try { return { ok: true, ud: execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 15000 }).trim() }; } catch (e) { return { ok: false, fejl: String(e.stderr || e.message).trim().slice(0, 300) }; } };

const wss = new WebSocketServer({ host: '127.0.0.1', port: 19873 });
let sock = null, hello = null; const svar = new Map(); let id = 1;
wss.on('connection', (s) => { sock = s; s.on('message', (d) => { const m = JSON.parse(String(d)); if (m.type === 'hello') hello = m; else if (m.id != null) svar.set(m.id, m); }); });
const kald = async (method, params = {}, ms = 30000) => { const i = id++; sock.send(JSON.stringify({ id: i, method, params, pid: 4242 })); for (let k = 0; k < ms / 50 && !svar.has(i); k++) await sov(50); return svar.get(i)?.result ?? { timeout: true }; };

const prof = mkdtempSync(join(tmpdir(), 'dialog-'));
const chrome = spawn(CHROME, ['--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--window-size=900,700', '--window-position=40,40', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const ud_ = chrome.stdio[3], ind = chrome.stdio[4];
let buf = '', cid = 0; const vent = new Map();
ind.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\0')) > -1) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id && vent.has(m.id)) { vent.get(m.id)(m); vent.delete(m.id); } } });
const cdp = (method, params = {}, sessionId) => new Promise((r) => { const i = ++cid; vent.set(i, r); ud_.write(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'); });
const lu = await cdp('Extensions.loadUnpacked', { path: EXT });
if (lu.error) throw new Error('loadUnpacked ' + JSON.stringify(lu.error));
const EXTID = lu.result.id;
for (let i = 0; i < 200 && !hello; i++) await sov(100);
if (!hello) throw new Error('intet hello');
const swEval = async (expr) => {
  const tg = (await cdp('Target.getTargets')).result.targetInfos.find((x) => x.type === 'service_worker' && x.url.includes(EXTID));
  const a = await cdp('Target.attachToTarget', { targetId: tg.targetId, flatten: true });
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, a.result.sessionId);
  return r.result?.result?.value ?? r;
};

const ud = { chrome_version: (await cdp('Browser.getVersion')).result?.product };
const nav = await kald('navigate', { url: `${U}/forlad.html` });
const tabId = nav.tab_id;
ud.klik = (await kald('click', { selector: '#bu' })).ok;
// Udvidelsen har Page slaaet til paa fanen og lytter - som 1.30.3-designet vil have det. Saa navigeres der, saa boksen kommer.
ud.opsaetning = await swEval(`(async () => {
  globalThis.__dlg = []; const T0 = performance.now(); const t = () => Math.round(performance.now() - T0);
  try { await chrome.debugger.attach({ tabId: ${tabId} }, '1.3'); } catch (e) { globalThis.__dlg.push([t(), 'attach-fejl', e.message]); }
  chrome.debugger.onEvent.addListener((src, m, p) => { if (src.tabId === ${tabId} && m.startsWith('Page.javascriptDialog')) globalThis.__dlg.push([t(), m, p.type ?? null, p.result ?? null]); });
  await chrome.debugger.sendCommand({ tabId: ${tabId} }, 'Page.enable', {});
  chrome.tabs.update(${tabId}, { url: ${JSON.stringify(U + '/tekst.html?efter=1')} });
  return 'ok';
})()`);
await sov(2000);
ud.haendelser_foer_menneske = await swEval('globalThis.__dlg');

const PROC = 'Google Chrome for Testing';
// 1) Kan et menneske SE boksen? Laes Chrome-vinduets tilgaengelighedstraeet for knapperne «Leave»/«Cancel».
ud.ax_knapper = osa(`tell application "System Events" to tell process "${PROC}" to get name of every button of entire contents of front window`);
ud.ax_vinduer = osa(`tell application "System Events" to tell process "${PROC}" to get name of every window`);
// 2) Mennesket svarer: Chrome forrest, Escape = bliv paa siden (Cancel).
ud.forrest = osa(`tell application "System Events" to set frontmost of process "${PROC}" to true`);
await sov(800);
ud.tast = osa('tell application "System Events" to key code 53');
await sov(2000);
ud.haendelser_efter_menneske = await swEval('globalThis.__dlg');
ud.fane = await swEval(`chrome.tabs.get(${tabId}).then(f => f.url)`);

try { chrome.kill('SIGKILL'); } catch {}
try { wss.close(); } catch {}
sider.close();
console.log(JSON.stringify(ud));

const h = (ud.haendelser_efter_menneske || []);
const aabnet = h.some((x) => x[1] === 'Page.javascriptDialogOpening');
const lukket = h.find((x) => x[1] === 'Page.javascriptDialogClosed');
const saa = ud.ax_knapper.ok && /Leave|Cancel|Forlad|Bliv/i.test(ud.ax_knapper.ud);
console.log(`DIALOG-MAALING: boks aabnet med Page slaaet til=${aabnet} · mennesket kunne se knapperne=${ud.ax_knapper.ok ? saa : 'UMAALT (' + ud.ax_knapper.fejl.slice(0, 80) + ')'} · menneskets svar gav Closed=${lukket ? 'ja, result=' + lukket[3] : (ud.tast.ok ? 'nej' : 'UMAALT (tastetryk naegtet)')} · fane=${ud.fane}`);
process.exit(0);
