#!/usr/bin/env node
/**
 * Maaleinstrument for issue #100 (Aras, 7/11): et klik der aabner confirm() paa en frisk fane,
 * hvor browser_handle_dialog aldrig er kaldt, laaser fanen.
 * Koeres KUN isoleret:  node scripts/flow-isoleret.mjs --koer test/flow/repro-100.mjs
 * (egen profil, porte 19900-19904, headless Chrome for Testing - aldrig menneskets Chrome).
 *
 * Trin pr. runde, ordret efter issuet: navigate(new_tab) -> click("#cfBtn") uden armering ->
 * handle_dialog(dismiss) -> et almindeligt kald paa fanen bagefter (er den laast?).
 * Variant A = som Aras (ingen switch_tab). Variant B = med switch_tab foer klikket.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.BROWSER_MCP_EXTENSION_ID) { console.error('Koer via scripts/flow-isoleret.mjs --koer (isoleret).'); process.exit(2); }

const SIDE = `<!doctype html><title>repro-100</title>
<button id="cfBtn">Ask confirm</button>
<script>
  document.getElementById('cfBtn').addEventListener('click', () => {
    const r = confirm('Testbench confirm?');
    document.title = 'RESULT ' + r;
  });
</script>`;
const web = createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end(SIDE); });
await new Promise((r) => web.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${web.address().port}/`;

const srv = spawn(process.execPath, [join(rod, 'mcp-server/index.js')], { cwd: mkdtempSync(join(tmpdir(), 'r100-')), stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', klar = false; const venter = new Map();
srv.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); let m; try { m = JSON.parse(l); } catch { continue; } if (m.id != null && venter.has(m.id)) { venter.get(m.id)(m); venter.delete(m.id); } } });
srv.stderr.on('data', (d) => { if (String(d).includes('extension connected')) klar = true; });
let n = 0;
const rpc = (method, params, ms = 70000) => new Promise((res) => { const id = ++n; venter.set(id, res); setTimeout(() => { if (venter.delete(id)) res({ klientfrist: true }); }, ms); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const kald = async (name, args, ms) => {
  const t0 = Date.now(); const r = await rpc('tools/call', { name, arguments: args }, ms);
  const tekst = r.klientfrist ? '<ingen svar inden klientens frist>' : (r.result?.content?.map((c) => c.text ?? `<${c.type}>`).join('\n') ?? JSON.stringify(r.error));
  let data = null; try { data = JSON.parse(tekst); } catch {}
  return { ms: Date.now() - t0, tekst, data, fejl: !!r.result?.isError || r.klientfrist };
};
const kort = (r) => `${r.ms} ms · ${r.fejl ? 'FEJL' : 'ok'} · ${r.tekst.replace(/\s+/g, ' ').slice(0, 220)}`;

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'repro-100', version: '0' } });
srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
// Serveren binder foerst en port ved foerste browser-kald (run.mjs, MAALT 7/9) - aabn doeren uden at vente paa svaret.
rpc('tools/call', { name: 'browser_list_tabs', arguments: {} }, 90000);
const frist = Date.now() + 90000; while (!klar && Date.now() < frist) await new Promise((r) => setTimeout(r, 500));
if (!klar) { console.log('⛔ udvidelsen forbandt aldrig - ingen maaling'); process.exit(3); }

const runder = [['A', 1], ['A', 2], ['A', 3], ['B', 1]];
const domme = [];
for (const [variant, nr] of runder) {
  console.log(`\n── Runde ${variant}${nr} ──`);
  const nav = await kald('browser_navigate', { url: URL_, new_tab: true });
  console.log('  navigate     :', kort(nav));
  const tab = nav.data?.tab_id;
  if (variant === 'B' && tab != null) console.log('  switch_tab   :', kort(await kald('browser_switch_tab', { tab_id: tab })));
  const klik = await kald('browser_click', { selector: '#cfBtn' });
  console.log('  click        :', kort(klik));
  const dlg = await kald('browser_handle_dialog', { action: 'dismiss' });
  console.log('  handle_dialog:', kort(dlg));
  const efter = await kald('browser_execute_script', { code: 'document.title' }, 45000);
  console.log('  efter (title):', kort(efter));
  const titel = efter.tekst;
  const laast = efter.fejl || /timed out|tab-not-responding|did not respond/i.test(efter.tekst);
  const besvaret = /RESULT false/.test(titel);
  const dom = laast ? 'LAAST' : besvaret ? 'BESVARET (dismiss -> RESULT false), fanen svarer' : 'svarer, men dialogens udfald ukendt';
  console.log('  DOM          :', dom);
  domme.push(`${variant}${nr}: ${dom}`);
  if (tab != null) await kald('browser_close_tab', { tab_id: tab }, 20000);
}
console.log('\n── SAMLET #100 ──\n' + domme.map((d) => '  ' + d).join('\n'));
const laaste = domme.filter((d) => d.includes('LAAST')).length;
console.log(`REPRO-100-DOM: ${laaste === 0 ? 'IKKE LAAST' : `LAAST i ${laaste} af ${domme.length}`}`);
// B-10: scriptet afsluttede FOER altid med exit(0) - ogsaa naar fanen kilede. Saa kunne det
// aldrig bruges som port: en koersel, der GENSKABTE fejlen, meldte groent. Og nul runder er
// heller ikke groent; da har instrumentet maalt ingenting.
let kode = 0;
if (domme.length === 0) { console.log('\u26d4 ingen runder koert - instrumentet maalte INGENTING'); kode = 4; }
else if (laaste > 0) { console.log(`\u26d4 #100 genskabt: ${laaste} af ${domme.length} faner kilede`); kode = 1; }
else { console.log(`\u2705 ingen fane kilede i ${domme.length} runder`); }
srv.kill(); web.close(); process.exit(kode);
