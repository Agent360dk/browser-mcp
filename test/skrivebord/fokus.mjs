// Skrivebordsmaaling (14/10-2026, Gustav: «BrowserMCP, den bliver ved med at tage min computer»).
// En SYNLIG Chrome (ikke headless) med den rigtige udvidelse, og et andet program (TextEdit) forrest. Efter hvert
// vaerktoejskald laeses hvilket program macOS har forrest (lsappinfo - kraever ingen tilladelser).
// Koeres paa GitHubs Mac, aldrig paa en maskine et menneske sidder ved: den tager skaermen mens den koerer.
//
//   node test/skrivebord/fokus.mjs <chrome-binaer> <udvidelse-1.30.1> <udvidelse-kandidat>
//
// Kontrollen er 1.30.1: dens browser_switch_tab tog vinduet frem. Ser instrumentet IKKE det, er det blindt, og
// kandidatens «blev bagved» betyder intet - saa fejler maalingen i stedet for at melde groent.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocketServer } from '../../mcp-server/node_modules/ws/wrapper.mjs';

const [,, CHROME, EXT_GAMMEL, EXT_NY] = process.argv;
const sov = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 19873;   // udvidelsens portspaend er flyttet hertil i kopierne (offscreen.js)

const SIDER = {
  '/tast.html': '<!doctype html><title>tast</title><input id="i" value="NEW"><script>window.log=[];i.addEventListener("keydown",e=>log.push("keydown "+e.key));</script>',
  '/anden.html': '<!doctype html><title>anden</title><h1>anden</h1>',
};
const sider = createServer((q, r) => {
  const s = SIDER[new URL(q.url, 'http://x').pathname];
  r.writeHead(s ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); r.end(s || 'nej');
}).listen(19871, '127.0.0.1');
await new Promise((r) => sider.once('listening', r));
const URL0 = 'http://127.0.0.1:19871';

function forrest() {
  const asn = execFileSync('lsappinfo', ['front'], { encoding: 'utf8' }).trim();
  const info = execFileSync('lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8' });
  return (info.match(/"(?:LSDisplayName|name)"="([^"]*)"/) || [])[1] || info.trim();
}
async function textEditForrest() {
  execFileSync('open', ['-a', 'TextEdit']);
  for (let i = 0; i < 30; i++) { await sov(200); if (forrest() === 'TextEdit') return true; }
  return false;
}

async function koer(navn, extDir) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
  let sock = null, hello = null; const svar = new Map(); let id = 1;
  wss.on('connection', (s) => { sock = s; s.on('message', (d) => { const m = JSON.parse(String(d)); if (m.type === 'hello') hello = m; else if (m.id != null) svar.set(m.id, m); }); });
  const kald = async (method, params = {}, ms = 30000) => {
    const i = id++; sock.send(JSON.stringify({ id: i, method, params, pid: 4242 }));
    for (let k = 0; k < ms / 50 && !svar.has(i); k++) await sov(50);
    return svar.get(i)?.result ?? { timeout: true };
  };
  const prof = mkdtempSync(join(tmpdir(), 'fokus-'));
  const chrome = spawn(CHROME, ['--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${prof}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--window-size=900,700', '--window-position=40,40', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const ud = chrome.stdio[3], ind = chrome.stdio[4];
  let buf = '', cid = 0; const vent = new Map();
  ind.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\0')) > -1) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id && vent.has(m.id)) { vent.get(m.id)(m); vent.delete(m.id); } } });
  const cdp = (method, params = {}, sessionId) => new Promise((r) => { const i = ++cid; vent.set(i, r); ud.write(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0'); });
  const lu = await cdp('Extensions.loadUnpacked', { path: extDir });
  if (lu.error) throw new Error(`${navn}: loadUnpacked ${JSON.stringify(lu.error)}`);
  for (let i = 0; i < 200 && !hello; i++) await sov(100);
  if (!hello) throw new Error(`${navn}: intet hello fra udvidelsen`);
  const ev = async (urlDel, expr) => {
    const tg = (await cdp('Target.getTargets')).result.targetInfos.find((t) => t.type === 'page' && t.url.includes(urlDel));
    if (!tg) return null;
    const a = await cdp('Target.attachToTarget', { targetId: tg.targetId, flatten: true });
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true }, a.result.sessionId);
    return r.result?.result?.value;
  };

  const ud_ = { navn, version: hello.version };
  const n1 = await kald('navigate', { url: `${URL0}/tast.html` });
  const n2 = await kald('navigate', { url: `${URL0}/anden.html`, new_tab: true });
  await sov(1000);

  ud_.textedit_foer_skift = await textEditForrest();
  const s1 = await kald('switch_tab', { tab_id: n1.tab_id });
  await sov(1500);
  ud_.efter_switch_tab = forrest();
  ud_.switch_tab_svar = { windowFocused: s1.windowFocused, visibility: s1.visibility };

  ud_.textedit_foer_tast = await textEditForrest();
  await ev('tast.html', 'document.getElementById("i").focus(), document.getElementById("i").setSelectionRange(3,3), true');
  const t = await kald('press_key', { key: 'x' });
  await sov(800);
  ud_.efter_press_key = forrest();
  ud_.press_key_svar = { ok: t.ok, landed: t.landed, error: t.error };
  ud_.feltet_efter_tast = await ev('tast.html', 'document.getElementById("i").value');

  ud_.textedit_foer_billede = await textEditForrest();
  const b = await kald('screenshot', {}, 40000);
  await sov(800);
  ud_.efter_screenshot = forrest();
  ud_.screenshot_svar = b.image ? 'billede' : (b.error || JSON.stringify(b).slice(0, 120));

  ud_.textedit_foer_frem = await textEditForrest();
  const s2 = await kald('switch_tab', { tab_id: n2.tab_id, bring_to_front: true });
  await sov(1500);
  ud_.efter_bring_to_front = forrest();
  ud_.bring_to_front_svar = { windowFocused: s2.windowFocused };

  try { chrome.kill('SIGKILL'); } catch {}
  try { wss.close(); } catch {}
  await sov(1500);
  console.log(JSON.stringify(ud_));
  return ud_;
}

const erChrome = (n) => /Chrome/.test(String(n));
const gammel = await koer('1.30.1', EXT_GAMMEL);
const ny = await koer('kandidat', EXT_NY);
sider.close();

const fejl = [];
const instrument = [gammel, ny].every((x) => x.textedit_foer_skift && x.textedit_foer_tast && x.textedit_foer_billede && x.textedit_foer_frem);
if (!instrument) fejl.push('INSTRUMENT: TextEdit kom ikke forrest foer et kald - maalingen er ugyldig');
if (!erChrome(gammel.efter_switch_tab)) fejl.push(`KALIBRERING: 1.30.1's switch_tab tog ikke Chrome frem (forrest: ${gammel.efter_switch_tab}) - instrumentet er blindt`);
for (const k of ['efter_switch_tab', 'efter_press_key', 'efter_screenshot']) {
  if (erChrome(ny[k])) fejl.push(`KANDIDAT: Chrome kom forrest ${k.replace('efter_', 'efter ')}`);
}
if (!erChrome(ny.efter_bring_to_front)) fejl.push(`KANDIDAT: bring_to_front: true tog ikke Chrome frem (forrest: ${ny.efter_bring_to_front})`);
console.log(`TASTEN I ET CHROME DER IKKE ER FORREST (kandidat): landed=${ny.press_key_svar.landed} feltet=${JSON.stringify(ny.feltet_efter_tast)}`);
console.log(fejl.length ? `FOKUS-DOM: FEJL\n- ${fejl.join('\n- ')}` : 'FOKUS-DOM: OK - 1.30.1 tog Chrome frem, kandidaten lod det ligge, bring_to_front tog det frem');
process.exit(fejl.length ? 1 : 0);
