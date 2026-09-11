#!/usr/bin/env node
// Pakketjek: starter en udpakket pakke som en rigtig MCP-klient ville, og kraever et gyldigt
// svar paa initialize. Exit 0 = pakken svarer. Crash, tavshed eller fejlsvar = exit 1.
//
// Brug: node scripts/pakke-roegtest.mjs <pakkemappe>   (PAKKE_ROEGTEST_FRIST_MS, standard 20000)
//
// MAALT 11/9 (Astra, efterproevet): release-scriptets tjek grep'ede kun efter
// ERR_MODULE_NOT_FOUND og SyntaxError, og en manglende "server running"-linje gav kun en
// advarsel. En pakke der crashede af enhver anden grund blev godkendt og kunne udgives. En
// log-linje beviser heller ikke at serveren svarer; det goer kun svaret.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const mappe = resolve(process.argv[2] || '.');
const frist = Number(process.env.PAKKE_ROEGTEST_FRIST_MS || 20000);

// MAALT 11/9 af Fable (sign-off): bin/cli.js kopierer ved start sin udvidelse over ~/.browser-mcp/extension, hvis den er
// nyere. Et tjek af en kandidat der endnu ikke er udgivet, skrev derfor i brugerens rigtige udvidelsesmappe.
// Kandidaten koeres med et midlertidigt hjem.
const hjem = mkdtempSync(join(tmpdir(), 'pakke-roegtest-hjem-'));
const barn = spawn(process.execPath, [join(mappe, 'bin/cli.js')], {
  cwd: mappe, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: hjem, USERPROFILE: hjem },
});
let ud = '';
let fejl = '';
let faerdig = false;

function slut(kode, besked) {
  if (faerdig) return;
  faerdig = true;
  clearTimeout(ur);
  try { barn.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { rmSync(hjem, { recursive: true, force: true }); } catch {} }, 300).unref();
  if (kode === 0) {
    process.stdout.write(`${besked}\n`);
  } else {
    process.stderr.write(`${besked}\n--- stderr fra pakken ---\n${fejl.slice(-2000)}\n--- stdout fra pakken ---\n${ud.slice(-1000)}\n`);
  }
  process.exitCode = kode;
  setTimeout(() => process.exit(kode), 500).unref();
}

const ur = setTimeout(() => slut(1, `pakken svarede ikke paa initialize inden for ${frist} ms`), frist);

// MAALT 11/9 af Astra (sign-off): {id:1,result:{serverInfo:{name:"broken"}}} efterfulgt af crash gav exit 0. Svaret skal
// nu have vores servers form (mcp-server/index.js: name 'agent360-browser', capabilities.tools), og pakken skal stadig
// koere et oejeblik efter svaret - et svar beviser ikke at den lever videre.
const SERVERNAVN = 'agent360-browser';
const eftertid = Number(process.env.PAKKE_ROEGTEST_EFTERTID_MS || 1500);
let svaret = false;

barn.stdout.setEncoding('utf8');
barn.stderr.setEncoding('utf8');
barn.stderr.on('data', (c) => { fejl += c; });
barn.stdout.on('data', (c) => {
  ud += c;
  if (svaret) return;
  for (const linje of ud.split('\n')) {
    let m;
    try { m = JSON.parse(linje); } catch { continue; }
    if (m?.id !== 1) continue;
    if (m.error) return slut(1, `pakken svarede med fejl paa initialize: ${JSON.stringify(m.error)}`);
    const r = m.result || {};
    const forkert = [];
    if (typeof r.protocolVersion !== 'string' || !r.protocolVersion) forkert.push('protocolVersion mangler');
    if (!r.capabilities || typeof r.capabilities.tools !== 'object' || r.capabilities.tools === null) forkert.push('capabilities.tools mangler');
    if (r.serverInfo?.name !== SERVERNAVN) forkert.push(`serverInfo.name er ${JSON.stringify(r.serverInfo?.name)}, ikke ${SERVERNAVN}`);
    if (forkert.length) return slut(1, `pakken svarede, men ikke som vores server: ${forkert.join('; ')}`);
    svaret = true;
    clearTimeout(ur);
    setTimeout(() => slut(0, `pakken svarer og koerer stadig efter ${eftertid} ms: ${r.serverInfo.name} ${r.serverInfo.version ?? ''}`.trim()), eftertid);
    return;
  }
});
barn.on('error', (e) => slut(1, `pakken kunne ikke startes: ${e.message}`));
barn.on('exit', (kode, signal) => slut(1, svaret
  ? `pakken stoppede lige efter sit svar (exit ${kode ?? signal})`
  : `pakken stoppede foer den svarede (exit ${kode ?? signal})`));
barn.stdin.on('error', () => {});
barn.stdin.write(`${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pakke-roegtest', version: '1' } },
})}\n`);
