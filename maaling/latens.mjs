/**
 * Maaler faktisk rundtur pr. vaerktoej mod den koerende Chrome.
 *
 * Lagene kan trakkes fra hinanden fordi vaerktoejerne bruger forskellig maskineri:
 *   list_tabs        = transport-gulvet (server -> WS -> extension -> tilbage). Roerer ingen side.
 *   get_page_content = + script-indsprojtning og udtraek
 *   screenshot       = + billedoptagelse
 *   navigate         = + sideindlaesning
 *   scroll / click   = + debugger-tilkobling (CDP) + de faste ventetider bagefter
 *
 * Debugger-tilkobling er det interessante skel: kun ÉN klient ad gangen maa vaere koblet
 * paa en fane, saa alt der kraever CDP er ogsaa det der brister naar to udvidelser koerer.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const RUNDER = Number(process.env.RUNDER || 5);
const SIDE = process.env.SIDE || 'https://example.com';

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
const kald = (method, params, ms = 60000) => {
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

async function tid(navn, args) {
  const t0 = process.hrtime.bigint();
  const r = await vt(navn, args);
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, svar: txt(r).replace(/\s+/g, ' ').slice(0, 90) };
}
function stat(tal) {
  const s = [...tal].sort((a, b) => a - b);
  return { n: s.length, min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1] };
}

(async () => {
  await kald('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'maaling', version: '1' } });
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await vent(300);

  const kold = await tid('browser_list_tabs', {});
  console.log(`koldstart (allerfoerste kald): ${kold.ms.toFixed(0)} ms`);
  const foersteNav = await tid('browser_navigate', { url: SIDE, new_tab: true });
  console.log(`foerste navigate (ny fane):    ${foersteNav.ms.toFixed(0)} ms`);
  console.log(`side: ${SIDE}\n`);

  const plan = [
    ['browser_list_tabs', {}],
    ['browser_get_page_content', {}],
    ['browser_screenshot', {}],
    ['browser_navigate', { url: SIDE }],
    ['browser_scroll', { y: 300 }],
    ['browser_wait', { selector: 'body', timeout: 3000 }],
    ['browser_console_logs', {}],
    ['browser_get_cookies', {}],
  ];
  const m = {}; const sidsteSvar = {};
  for (let r = 0; r < RUNDER; r++) {
    for (const [navn, args] of plan) {
      const t = await tid(navn, args);
      (m[navn] ||= []).push(t.ms);
      sidsteSvar[navn] = t.svar;
    }
  }
  console.log('vaerktoej'.padEnd(28) + '  n     min   median      max   (ms)');
  for (const [navn, tal] of Object.entries(m)) {
    const s = stat(tal);
    console.log(navn.padEnd(28) + `  ${s.n}  ${s.min.toFixed(0).padStart(6)}  ${s.med.toFixed(0).padStart(6)}  ${s.max.toFixed(0).padStart(7)}`);
  }
  console.log('\nsidste svar pr. vaerktoej:');
  for (const [navn, s] of Object.entries(sidsteSvar)) console.log('  ' + navn.padEnd(26) + s);

  const faner = JSON.parse(txt(await vt('browser_list_tabs')));
  for (const f of (faner.tabs || [])) await vt('browser_close_tab', { tab_id: f.id });
  p.kill('SIGKILL'); process.exit(0);
})();
