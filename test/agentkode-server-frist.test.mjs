/**
 * R137 (maalt 19/10, panel-mappen R137-hang): paa en side med 50-200 navigationer i sekundet lammes Chromes browsertraad.
 * Udvidelsen svarer `execute_script` og `select_frame` til tiden (29,5 s efter at den modtog kaldet), men svaret naaede ikke
 * serveren inden dens 30 s, og agenten fik den generelle «Command timed out after 30000ms», som ikke siger, om koden kan have
 * koert. Maalt ogsaa paa 1.30.3.
 *
 * Rettelsen: serveren venter laengere end udvidelsens budget paa netop de to vaerktoejer (standardfristen + en margen), og
 * fyrer serverens eget ur alligevel, er svaret struktureret: `no-answer`, `sent: 'unknown'`, «MAY have run», isError.
 *
 * Proeven starter den AEGTE server med en falsk udvidelse over WebSocket (mønstret fra dobbelt-sokkel-og-ventende-kald) og
 * korter fristerne med miljoet: standard 3000 ms, margen 1500 ms (samme forhold som 30 s + 15 s).
 *  (a) udvidelsen svarer `call-timeout, sent:false` 3300 ms efter at den fik kaldet - efter standardfristen, foer serverens
 *      udvidede frist: vaerktoejets resultat er udvidelsens svar.
 *  (b) udvidelsen svarer aldrig: resultatet er serverens strukturerede no-answer.
 *  (c) et andet vaerktoej er uaendret: den generelle tekst efter standardfristen.
 *  (d) serverens egne tal uden proevemiljoet: 30 s for alle, 45 s for de to (broen koert i en VM, se hjaelp/bro-model).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';
import { broModel } from './hjaelp/bro-model.mjs';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const krav = createRequire(join(rod, 'mcp-server', 'index.js'));
const WebSocket = krav('ws');
const VERSION = JSON.parse(readFileSync(join(rod, 'mcp-server', 'package.json'), 'utf8')).version;

const STANDARD_MS = 3000;
const MARGEN_MS = 1500;
const SENT_SVAR_MS = 3300;   // «lidt efter 30 s», skaleret: efter standardfristen, inden for standard + margen
const vent = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function startServer() {
  const spaend = await ledigtSpaend();
  const p = spawn(process.execPath, [join(rod, 'mcp-server', 'index.js')], {
    env: { ...process.env, BROWSER_MCP_TOKEN: '', BROWSER_MCP_PROFILE: '', BROWSER_MCP_EXTENSION_ID: '',
      BROWSER_MCP_BASE_PORT: String(spaend), BROWSER_MCP_MAX_PORT: String(spaend + 4),
      BROWSER_MCP_TEST_CALL_TIMEOUT_MS: String(STANDARD_MS), BROWSER_MCP_TEST_AGENTCODE_MARGIN_MS: String(MARGEN_MS) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let fejl = ''; const ud = []; let rest = '';
  p.stderr.on('data', (d) => { fejl += d.toString(); });
  p.stdout.on('data', (d) => {
    rest += d.toString();
    let i;
    while ((i = rest.indexOf('\n')) > -1) {
      const l = rest.slice(0, i); rest = rest.slice(i + 1);
      try { ud.push({ t: Date.now(), m: JSON.parse(l) }); } catch { /* ikke json */ }
    }
  });
  const skriv = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'proeve', version: '0' } } });
  for (let i = 0; i < 100 && !ud.find((x) => x.m.id === 1); i++) await vent(50);
  skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
  // Porten bindes foerst ved det foerste vaerktoejskald (den falske udvidelse besvarer det).
  skriv({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });
  for (let i = 0; i < 200; i++) {
    const m = fejl.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (m) return { proces: p, port: Number(m[1]), ud, skriv, fejl: () => fejl };
    await vent(50);
  }
  p.kill();
  throw new Error('serveren bandt aldrig en port: ' + fejl);
}

/** Falsk udvidelse: besvarer alt straks, undtagen `maal`, som besvares efter `svarEfterMs` (null = aldrig). */
async function udvidelse(port, maal, svarEfterMs, svar) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: `chrome-extension://${'a'.repeat(32)}` });
  const fik = [];
  ws.on('error', () => {});
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    if (!m || typeof m.method !== 'string') return;
    fik.push({ t: Date.now(), m });
    if (m.method !== maal) { ws.send(JSON.stringify({ id: m.id, result: { tabs: [] } })); return; }
    if (svarEfterMs !== null) setTimeout(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ id: m.id, result: svar })); }, svarEfterMs);
  });
  await new Promise((ok, nej) => { ws.once('open', ok); ws.once('error', nej); });
  ws.send(JSON.stringify({ type: 'hello', extensionId: 'a'.repeat(32), version: VERSION, kode: 'abcdef012345' }));
  return { ws, fik };
}

/** Kalder vaerktoejet og venter paa resultatet; giver resultatet og tiden fra udvidelsen fik kaldet. */
async function kald(navn, metode, args, svarEfterMs, svar = null) {
  const s = await startServer();
  try {
    const u = await udvidelse(s.port, metode, svarEfterMs, svar);
    // det bindende kald (id 2) skal vaere besvaret, foer maalingen begynder
    for (let i = 0; i < 160 && !s.ud.find((x) => x.m.id === 2); i++) await vent(50);
    assert.ok(s.ud.find((x) => x.m.id === 2), 'det foerste kald blev aldrig besvaret - proeven kan ikke maale noget: ' + s.fejl());
    s.skriv({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: navn, arguments: args } });
    let ud = null;
    for (let i = 0; i < 300 && !ud; i++) { ud = s.ud.find((x) => x.m.id === 10) || null; if (!ud) await vent(50); }
    assert.ok(ud, `${navn} gav intet resultat inden for 15 s`);
    const sendt = u.fik.find((x) => x.m.method === metode);
    assert.ok(sendt, `udvidelsen fik aldrig ${metode} - proeven kan ikke maale noget`);
    u.ws.close();
    return { res: ud.m.result, ms: ud.t - sendt.t };
  } finally { s.proces.kill(); }
}

const CALL_TIMEOUT = { ok: false, error: 'call-timeout', sent: false, retry: true,
  note: 'Nothing was run; the call ran out of time before the code could be sent. Call again.' };

const VAERKTOEJER = [
  ['browser_execute_script', 'execute_script', { code: '1' }],
  ['browser_select_frame', 'select_frame', { frame_index: 0, code: '1' }],
];

describe('R137: serverens frist for agentkodens to vaerktoejer', { concurrency: true }, () => {
  for (const [navn, metode, args] of VAERKTOEJER) {
    test(`(a) ${navn}: udvidelsens svar lidt efter standardfristen naar frem - det ER resultatet`, async () => {
      const { res, ms } = await kald(navn, metode, args, SENT_SVAR_MS, CALL_TIMEOUT);
      const tekst = res.content.map((c) => c.text).join('\n');
      assert.doesNotMatch(tekst, /Command timed out/, `serveren opgav ved standardfristen, foer udvidelsens svar kom (${ms} ms): ${tekst}`);
      assert.deepEqual(JSON.parse(res.content[0].text), CALL_TIMEOUT, 'resultatet er ikke udvidelsens svar');
      assert.ok(ms >= SENT_SVAR_MS, `svaret kom foer udvidelsen sendte det (${ms} ms) - proeven maaler ikke fristen`);
    });

    test(`(b) ${navn}: intet svar - struktureret no-answer, sent:'unknown', «MAY», isError`, async () => {
      const { res, ms } = await kald(navn, metode, args, null);
      assert.equal(res.isError, true, 'et manglende svar er en fejl for klienten');
      let svar;
      try { svar = JSON.parse(res.content[0].text); } catch { assert.fail(`resultatet er ikke struktureret: ${res.content[0].text}`); }
      assert.equal(svar.ok, false);
      assert.equal(svar.error, 'no-answer');
      assert.equal(svar.sent, 'unknown');
      assert.match(svar.note, /MAY have run/);
      assert.match(svar.note, /not repeated automatically/);
      assert.match(svar.note, /only if it is safe to run twice/);
      assert.ok(ms >= STANDARD_MS + MARGEN_MS - 100, `serveren ventede kun ${ms} ms, ikke standard + margen`);
    });
  }

  test('(c) andre vaerktoejer er uaendrede: den generelle tekst efter standardfristen', async () => {
    const { res, ms } = await kald('browser_get_page_content', 'get_page_content', {}, null);
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, new RegExp(`Command timed out after ${STANDARD_MS}ms: get_page_content`));
    assert.ok(ms < STANDARD_MS + MARGEN_MS - 300, `et andet vaerktoej fik ogsaa den laengere frist (${ms} ms)`);
  });
});

test('(d) uden proevemiljoet: 30 s for alle vaerktoejer, 30 + 15 s for de to; et ugyldigt tal giver standarden', () => {
  for (const env of [{}, { BROWSER_MCP_TEST_CALL_TIMEOUT_MS: '0', BROWSER_MCP_TEST_AGENTCODE_MARGIN_MS: 'abc' },
    { BROWSER_MCP_TEST_CALL_TIMEOUT_MS: '-5', BROWSER_MCP_TEST_AGENTCODE_MARGIN_MS: '' }]) {
    const m = broModel(env);
    try {
      assert.equal(m.k('KALD_FRIST_MS'), 30000, JSON.stringify(env));
      assert.equal(m.k('AGENTKODE_MARGEN_MS'), 15000, JSON.stringify(env));
      assert.equal(m.k('JSON.stringify([...AGENTKODE_SERVER].sort())'), '["execute_script","select_frame"]');
    } finally { m.luk(); }
  }
  const m = broModel({ BROWSER_MCP_TEST_CALL_TIMEOUT_MS: String(STANDARD_MS), BROWSER_MCP_TEST_AGENTCODE_MARGIN_MS: String(MARGEN_MS) });
  try {
    assert.equal(m.k('KALD_FRIST_MS + AGENTKODE_MARGEN_MS'), STANDARD_MS + MARGEN_MS);
  } finally { m.luk(); }
});
