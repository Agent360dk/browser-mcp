// Vindues-hypotesen: leverer Chrome Input.* til en AKTIV fane i et vindue UDEN fokus?
// Tre tilstande, samme tastetryk, samme maaling af hvad siden hoerte.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
const SIDE = `<!doctype html><meta charset=utf-8><title>vindue</title><input id=f>
<script>window.__h=[];addEventListener('keydown',e=>window.__h.push({k:e.key,t:e.isTrusted}));
document.getElementById('f').focus();</script>`;
const s = createServer((_q, r) => { r.writeHead(200, {'content-type':'text/html'}); r.end(SIDE); });
await new Promise(r => s.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${s.address().port}/`;
const p = spawn('node', ['mcp-server/index.js'], { stdio: ['pipe','pipe','pipe'] });
let buf = ''; const venter = new Map(); let id = 1;
p.stdout.on('data', d => { buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0,i); buf = buf.slice(i+1);
    if (!l.trim()) continue; let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.id != null && venter.has(m.id)) { venter.get(m.id)(m); venter.delete(m.id); } } });
const kald = (method, params, ms=40000) => new Promise(ok => { const i = id++;
  const t = setTimeout(() => { venter.delete(i); ok({error:{message:'timeout'}}); }, ms);
  venter.set(i, m => { clearTimeout(t); ok(m); });
  p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n'); });
const T = x => (x?.result?.content||[]).map(y=>y.text??'').join('\n');
await kald('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'v',version:'1'}},45000);
p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');

async function proev(navn, navArgs) {
  const nav = await kald('tools/call',{name:'browser_navigate',arguments:navArgs});
  await new Promise(r=>setTimeout(r,2500));
  const tast = await kald('tools/call',{name:'browser_press_key',arguments:{key:'a'}});
  await new Promise(r=>setTimeout(r,1200));
  const h = await kald('tools/call',{name:'browser_execute_script',arguments:{script:'JSON.stringify(window.__h||[])'}});
  const m = T(h).match(/\[.*\]/s);
  const hoert = m ? JSON.parse(m[0]) : null;
  console.log(`  ${navn.padEnd(34)} navigate:   ${T(nav).replace(/\s+/g,' ').slice(0,150)}`);
  console.log(`  ${''.padEnd(34)} vaerktoejet: ${T(tast).replace(/\s+/g,' ').slice(0,90)}`);
  console.log(`  ${''.padEnd(34)} siden hoerte: ${hoert ? hoert.length + ' tast(er), betroet=' + hoert.filter(x=>x.t).length : 'kunne ikke laeses'}`);
  return { nav: T(nav).slice(0,80), hoert };
}
console.log('\nVINDUES-HYPOTESEN - leverer Chrome input til en aktiv fane i et UFOKUSERET vindue?\n');
await proev('A) baggrundsfane (som i dag)', { url, new_tab: true });
await proev('B) eget vindue, UDEN fokus', { url, new_tab: true, eget_vindue: true });
p.kill(); s.close();
