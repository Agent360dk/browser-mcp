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

barn.stdout.setEncoding('utf8');
barn.stderr.setEncoding('utf8');
barn.stderr.on('data', (c) => { fejl += c; });
barn.stdout.on('data', (c) => {
  ud += c;
  for (const linje of ud.split('\n')) {
    let m;
    try { m = JSON.parse(linje); } catch { continue; }
    if (m?.id !== 1) continue;
    if (m.result?.serverInfo?.name) {
      return slut(0, `pakken svarer: ${m.result.serverInfo.name} ${m.result.serverInfo.version ?? ''}`.trim());
    }
    if (m.error) return slut(1, `pakken svarede med fejl paa initialize: ${JSON.stringify(m.error)}`);
  }
});
barn.on('error', (e) => slut(1, `pakken kunne ikke startes: ${e.message}`));
barn.on('exit', (kode, signal) => slut(1, `pakken stoppede foer den svarede (exit ${kode ?? signal})`));
barn.stdin.on('error', () => {});
barn.stdin.write(`${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pakke-roegtest', version: '1' } },
})}\n`);
