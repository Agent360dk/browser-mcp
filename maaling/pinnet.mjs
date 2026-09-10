/** Beviser at BROWSER_MCP_EXTENSION_ID binder serveren til ÉN udvidelse. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const p = spawn(process.execPath, [SRV], { stdio: ['pipe','pipe','pipe'],
  env: { ...process.env, BROWSER_MCP_EXTENSION_ID: process.argv[2] || '' } });
p.stderr.on('data', () => {});
let n = 0; const venter = new Map(); let buf = '';
p.stdout.on('data', (d) => { buf += d; const l = buf.split('\n'); buf = l.pop();
  for (const x of l) { if (!x.trim()) continue; let m; try { m = JSON.parse(x); } catch { continue; }
    const v = venter.get(m.id); if (v) { venter.delete(m.id); v(m); } } });
const kald = (method, params, ms = 30000) => { const id = ++n;
  p.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params }) + '\n');
  return new Promise((r) => { const u = setTimeout(() => { venter.delete(id); r({error:'TIMEOUT'}); }, ms);
    venter.set(id, (m) => { clearTimeout(u); r(m); }); }); };
const vent = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  await kald('initialize', { protocolVersion:'2024-11-05', capabilities:{}, clientInfo:{name:'pin',version:'1'} });
  p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n'); await vent(300);
  await kald('tools/call', { name:'browser_list_tabs', arguments:{} });
  const r = await kald('tools/call', { name:'browser_provide_feedback',
    arguments:{ what_happened:'pin-tjek', kind:'blocked' } });
  const j = JSON.parse(r?.result?.content?.[0]?.text || '{}');
  console.log('pinnet til :', process.argv[2] || '(ingen)');
  console.log('verdict    :', j.verdict);
  console.log('forbundne  :', (j.environment?.extensions_connected||[]).map(e=>e.extension_id.slice(0,10)+(e.active?' AKTIV':'')).join(' + ') || 'ingen');
  p.kill('SIGKILL'); process.exit(0);
})();
