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
const kald = (method, params, ms = 45000) => {
  const id = ++n;
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((res) => {
    const u = setTimeout(() => { venter.delete(id); res({ error: 'TIMEOUT' }); }, ms);
    venter.set(id, (m) => { clearTimeout(u); res(m); });
  });
};
const vt = (navn, args = {}) => kald('tools/call', { name: navn, arguments: args });
const txt = (r) => r?.result?.content?.[0]?.text ?? JSON.stringify(r);
const vent = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await kald('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await vent(300);
  console.log('--- navigate ---\n' + txt(await vt('browser_navigate', { url: 'https://example.com', new_tab: true })).slice(0, 300));
  console.log('--- get_page_content ---\n' + txt(await vt('browser_get_page_content')).slice(0, 500));
  const t0 = Date.now();
  console.log('--- scroll ---\n' + txt(await vt('browser_scroll', { direction: 'down', amount: 200 })).slice(0, 300) + `  [${Date.now() - t0} ms]`);
  console.log('--- list_tabs ---\n' + txt(await vt('browser_list_tabs')).slice(0, 500));
  p.kill('SIGKILL'); process.exit(0);
})();
