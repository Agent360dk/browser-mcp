/**
 * Virker dropdown'en? Og er det min 1,5-sekunders CDP-frist der braekkede den?
 *
 * To slags dropdowns, fordi de fejler forskelligt:
 *   1. aegte <select>   — CDP kan saette vaerdien direkte
 *   2. div-baseret      — som de fleste rigtige sider. Kraever klik, aabning, klik igen.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const p = spawn(process.execPath, [SRV], { stdio: ['pipe', 'pipe', 'pipe'] });
p.stderr.on('data', () => {});
let n = 0; const venter = new Map(); let buf = '';
p.stdout.on('data', (d) => {
  buf += d; const l = buf.split('\n'); buf = l.pop();
  for (const x of l) { if (!x.trim()) continue; let m; try { m = JSON.parse(x); } catch { continue; }
    const v = venter.get(m.id); if (v) { venter.delete(m.id); v(m); } }
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
const txt = (r) => (r?.result?.content?.[0]?.text ?? JSON.stringify(r)).replace(/\s+/g, ' ').slice(0, 190);
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
async function proev(navn, args, etiket) {
  const t0 = Date.now(); const r = await vt(navn, args);
  console.log(`  ${etiket.padEnd(32)} ${String(Date.now() - t0).padStart(6)} ms   ${txt(r)}`);
}
(async () => {
  await kald('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'd', version: '1' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await vent(300);
  await proev('browser_navigate', { url: 'http://localhost:8791/', new_tab: true }, 'navigate');
  await vent(500);
  const fb = await vt('browser_provide_feedback', { what_happened: 'version- og konflikt-tjek', kind: 'blocked' });
  const j = JSON.parse((fb?.result?.content?.[0]?.text) || '{}');
  console.log('  verdict:', j.verdict, '| udvidelser:',
    (j.environment?.extensions_connected || []).map((e) => e.extension_id.slice(0, 8) + ' v' + e.version).join(' + ') || 'ingen');
  console.log('');
  await proev('browser_select_option', { selector: '#native', value: 'b' }, 'select_option native(b)');
  await proev('browser_set_combobox', { selector: '#native', value: 'Alfa' }, 'set_combobox native(Alfa)');
  await proev('browser_click', { selector: '#custom' }, 'klik custom-dropdown (aabn)');
  await proev('browser_click', { selector: 'text=Yoghurt' }, 'klik Yoghurt');
  const r = await vt('browser_get_page_content');
  const t = (r?.result?.content?.[0]?.text) || '';
  console.log('\n  siden siger nu:', (t.match(/(native valgt: \w+|custom valgt: \w+|intet)/g) || []).join(' · '));
  const faner = JSON.parse((await vt('browser_list_tabs'))?.result?.content?.[0]?.text || '{"tabs":[]}');
  for (const f of (faner.tabs || [])) await vt('browser_close_tab', { tab_id: f.id });
  p.kill('SIGKILL'); process.exit(0);
})();
