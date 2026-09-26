/**
 * Serveren skal overleve enhver besked paa broen - ogsaa fra en sokkel der aldrig hilser.
 *
 * MAALT 26/9 (fuld review, A#5): teksten `null` er gyldig JSON. `JSON.parse('null')` giver null,
 * og den naeste linje laeste `msg.type` - et TypeError inde i en 'message'-lytter, og
 * serverprocessen doede. Ethvert program paa maskinen kunne altsaa stoppe agentens browser med
 * fire tegn, uden noegle og uden at hilse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const WebSocket = createRequire(join(rod, 'mcp-server', 'index.js'))('ws');
const SPAEND = await ledigtSpaend();

async function server() {
  const p = spawn(process.execPath, [join(rod, 'mcp-server', 'index.js')], {
    env: { ...process.env, BROWSER_MCP_TOKEN: '',
      BROWSER_MCP_BASE_PORT: String(SPAEND), BROWSER_MCP_MAX_PORT: String(SPAEND + 4) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let fejl = '';
  let ud = '';
  p.stderr.on('data', (d) => { fejl += d.toString(); });
  p.stdout.on('data', (d) => { ud += d.toString(); });
  const skriv = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'proeve', version: '0' } } });
  await new Promise((ok) => p.stdout.once('data', ok));
  skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
  skriv({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });
  for (let i = 0; i < 200; i++) {
    const m = fejl.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (m) return { p, port: Number(m[1]), skriv, ud: () => ud, fejl: () => fejl };
    await new Promise((ok) => setTimeout(ok, 50));
  }
  p.kill();
  throw new Error('serveren bandt aldrig en port: ' + fejl);
}

for (const tekst of ['null', '42', '"en tekst"', '[]', 'true']) {
  test(`serveren overlever beskeden ${tekst} fra en sokkel der aldrig hilser`, async () => {
    const s = await server();
    let doede = null;
    s.p.on('exit', (kode, signal) => { doede = { kode, signal }; });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}`, { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
      ws.on('error', () => {});
      await new Promise((ok) => ws.on('open', ok));
      ws.send(tekst);
      await new Promise((ok) => setTimeout(ok, 700));
      assert.equal(doede, null, `serveren doede paa ${tekst}: ${s.fejl().split('\n').slice(-6).join(' | ')}`);
      // Og den svarer stadig paa MCP - en proces der lever men haenger, er ikke bedre.
      s.skriv({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
      for (let i = 0; i < 60 && !s.ud().includes('"id":3'); i++) await new Promise((ok) => setTimeout(ok, 50));
      assert.ok(s.ud().includes('"id":3'), 'serveren lever men svarer ikke laengere paa MCP');
      ws.close();
    } finally { s.p.kill(); }
  });
}
