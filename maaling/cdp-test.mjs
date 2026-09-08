/**
 * Skiller "scroll er i stykker" fra "debugger-tilkobling er i stykker".
 *
 * scroll(selector:) returnerer FOER debuggerAttach. scroll(y:) gaar igennem den.
 * click og press_key bruger ogsaa debuggeren. Haenger alt der roerer debuggeren,
 * er det tilkoblingen — og saa er den mest sandsynlige aarsag den anden udvidelse,
 * der holder debuggeren paa fanen. Chrome tillader kun én klient ad gangen.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const p = spawn(process.execPath, [SRV], { stdio: ['pipe', 'pipe', 'pipe'] });
p.stderr.on('data', () => {});
let n = 0; const venter = new Map(); let buf = '';
p.stdout.on('data', (d) => {
  buf += d; const l = buf.split('\n'); buf = l.pop();
  for (const x of l) {
    if (!x.trim()) continue;
    let m; try { m = JSON.parse(x); } catch { continue; }
    const v = venter.get(m.id); if (v) { venter.delete(m.id); v(m); }
  }
});
const kald = (method, params, ms = 40000) => {
  const id = ++n;
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((res) => {
    const u = setTimeout(() => { venter.delete(id); res({ error: 'TIMEOUT' }); }, ms);
    venter.set(id, (m) => { clearTimeout(u); res(m); });
  });
};
const vt = (navn, args = {}) => kald('tools/call', { name: navn, arguments: args });
const txt = (r) => (r?.result?.content?.[0]?.text ?? JSON.stringify(r)).replace(/\s+/g, ' ').slice(0, 130);
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

async function proev(navn, args, etiket) {
  const t0 = Date.now();
  const r = await vt(navn, args);
  console.log(`${etiket.padEnd(38)} ${String(Date.now() - t0).padStart(6)} ms   ${txt(r)}`);
}

(async () => {
  await kald('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cdp', version: '1' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await vent(300);
  await proev('browser_navigate', { url: 'https://example.com', new_tab: true }, 'navigate (ingen debugger)');
  await proev('browser_scroll', { selector: 'h1' }, 'scroll(selector) — FOER debugger');
  await proev('browser_reattach_debugger', {}, 'reattach_debugger (ren tilkobling)');
  await proev('browser_scroll', { y: 300 }, 'scroll(y) — GENNEM debugger');
  await proev('browser_click', { selector: 'a' }, 'click — gennem debugger');
  await proev('browser_press_key', { key: 'End' }, 'press_key — gennem debugger');
  const faner = JSON.parse((await vt('browser_list_tabs'))?.result?.content?.[0]?.text || '{"tabs":[]}');
  for (const f of (faner.tabs || [])) await vt('browser_close_tab', { tab_id: f.id });
  p.kill('SIGKILL'); process.exit(0);
})();
