/**
 * Et bundt der pakker er ikke et bundt der virker.
 *
 * Starter serveren INDE i det byggede bundt og taler MCP med den over stdio. Svarer den
 * ikke `initialize` med sit eget navn og version, og lister den ikke det antal vaerktoejer
 * `tools.js` eksporterer, er bundtet ikke klar til at blive udgivet.
 *
 * Skriver samtidig `payload.json` - Smitherys udgivelses-API kraever et serverCard, og
 * uden det svarer den 400 «No values to set». Kortet UDTRAEKKES her, saa det beskriver hvad
 * serveren faktisk rapporterer i stedet for hvad nogen troede den gjorde.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const byg = process.argv[2];
if (!byg) { console.error('brug: node scripts/mcpb-roegtest.mjs <byggemappe>'); process.exit(2); }

const forventet = (readFileSync(new URL('../mcp-server/tools.js', import.meta.url), 'utf8')
  .match(/name: *['"]browser_[a-z_]+['"]/g) ?? []).length;

const p = spawn('node', [join(byg, 'server', 'index.js')], { stdio: ['pipe', 'pipe', 'ignore'] });
let ud = '';
p.stdout.on('data', (d) => { ud += d; });
const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');

send({ jsonrpc: '2.0', id: 1, method: 'initialize',
       params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'roegtest', version: '1' } } });
setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), 900);

setTimeout(() => {
  p.kill();
  let info = null, tools = null;
  for (const l of ud.trim().split('\n')) {
    try { const o = JSON.parse(l); if (o.id === 1) info = o.result?.serverInfo; if (o.id === 2) tools = o.result?.tools; } catch {}
  }
  if (!info) { console.error('✗ serveren i bundtet svarede ikke paa initialize'); process.exit(1); }
  if (!tools) { console.error('✗ serveren i bundtet listede ingen vaerktoejer'); process.exit(1); }
  if (tools.length !== forventet) {
    console.error(`✗ bundtet lister ${tools.length} vaerktoejer, tools.js eksporterer ${forventet}`);
    process.exit(1);
  }
  writeFileSync(join(byg, 'payload.json'), JSON.stringify({
    type: 'stdio', runtime: 'node', configSchema: {},
    serverCard: { serverInfo: info, tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
  }));
  console.log(`✓ ${info.name} v${info.version} svarer · ${tools.length} vaerktoejer · payload.json skrevet`);
  process.exit(0);
}, 2600);
