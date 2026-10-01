#!/usr/bin/env node
/**
 * koldt-forsoeg.mjs <version> <hjem> - ÉT forsoeg paa det kolde tjek: hent den UDGIVNE pakke med npx og tal MCP med den.
 *
 * Koeres af scripts/koldt-tjek.sh (som staar for de seks forsoeg og pauserne). Findes som eget program (Astra runde 5, 1/10-2026) fordi
 * shell-udgaven havde tre maalte huller:
 *   1. Et korrekt svar efterfulgt af et nedbrud gav groent (stdin blev lukket med det samme, og pipelinefejl blev slugt med `|| true`).
 *      Nu holdes stdin aaben, og pakken skal vaere i live KOLDT_EFTERTID_MS efter svaret (samme krav som scripts/pakke-roegtest.mjs).
 *   2. Fristen gjaldt kun den proces timeout/perl startede; et barnebarn der arvede stdout holdt roeret aabent langt efter fristen.
 *      Nu startes npx som egen procesgruppe, og HELE gruppen draebes (SIGKILL) ved frist, fejl og afslutning.
 *   3. Valideringen var for loes (`error: null`, `jsonrpc: "garbage"`, `tools: []`, `protocolVersion: "bogus"` blev godkendt).
 *
 * Miljoeet er en hvidliste: HOME (frisk), PATH, TMPDIR, LANG, npm_config_ignore_scripts. Ingen af udgivelsens hemmeligheder.
 * Exit 0 = pakken svarer som vores server og lever videre; 1 = den goer ikke (aarsagen printes).
 */
import { spawn } from 'node:child_process';

const [version, hjem] = process.argv.slice(2);
if (!version || !hjem) { console.error('brug: koldt-forsoeg.mjs <version> <hjem>'); process.exit(2); }
const FRIST = Number(process.env.KOLDT_FRIST_MS || 90000);
const EFTERTID = Number(process.env.KOLDT_EFTERTID_MS || 1500);
const SERVERNAVN = 'agent360-browser';

/** Hvad der er galt med et initialize-svar, som en tom liste hvis intet. Eksporteret til proever. */
export function problemer(m, forventetVersion) {
  const f = [];
  if (m.jsonrpc !== '2.0') f.push(`jsonrpc er ${JSON.stringify(m.jsonrpc)}, ikke "2.0"`);
  if ('error' in m) f.push(`svaret har et error-felt (${JSON.stringify(m.error)})`);
  const r = m.result;
  if (!r || typeof r !== 'object' || Array.isArray(r)) { f.push('result mangler eller er ikke et objekt'); return f; }
  if (typeof r.protocolVersion !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.protocolVersion)) f.push(`protocolVersion er ${JSON.stringify(r.protocolVersion)}, ikke en dato-streng`);
  const t = r.capabilities && r.capabilities.tools;
  if (!t || typeof t !== 'object' || Array.isArray(t)) f.push('capabilities.tools er ikke et objekt');
  if (!r.serverInfo || r.serverInfo.name !== SERVERNAVN) f.push(`serverInfo.name er ${JSON.stringify(r.serverInfo && r.serverInfo.name)}, ikke ${SERVERNAVN}`);
  else if (r.serverInfo.version !== forventetVersion) f.push(`serverInfo.version er ${JSON.stringify(r.serverInfo.version)}, ikke ${forventetVersion}`);
  return f;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('koldt-forsoeg.mjs')) {
  const barn = spawn('npx', ['-y', `@agent360/browser-mcp@${version}`], {
    detached: true, // egen procesgruppe, saa hele traeet kan draebes
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      HOME: hjem,
      PATH: process.env.PATH ?? '',
      TMPDIR: process.env.TMPDIR || '/tmp',
      LANG: process.env.LANG || 'C',
      npm_config_ignore_scripts: 'true',
    },
  });
  let ud = ''; let fejl = ''; let svaret = false; let faerdig = false; let efter;

  const draeb = () => { try { process.kill(-barn.pid, 'SIGKILL'); } catch { /* gruppen er allerede vaek */ } };
  const slut = (kode, tekst) => {
    if (faerdig) return;
    faerdig = true; clearTimeout(ur); clearTimeout(efter);
    draeb();
    console.log(tekst);
    if (kode !== 0 && fejl.trim()) console.log(fejl.trim().split('\n').slice(-5).join('\n'));
    process.exit(kode);
  };
  const ur = setTimeout(() => slut(1, `intet gyldigt svar inden ${FRIST / 1000} s`), FRIST);

  barn.stdout.setEncoding('utf8');
  barn.stderr.setEncoding('utf8');
  barn.stderr.on('data', (c) => { fejl += c; });
  barn.stdout.on('data', (c) => {
    ud += c;
    if (svaret) return;
    let i;
    while ((i = ud.indexOf('\n')) >= 0) {
      const linje = ud.slice(0, i).trim(); ud = ud.slice(i + 1);
      if (!linje) continue;
      let m;
      try { m = JSON.parse(linje); } catch { return slut(1, `stdout indeholder tekst der ikke er JSON-RPC: ${linje.slice(0, 120)}`); }
      if (m && m.id === undefined && typeof m.method === 'string') continue; // lovlig notifikation foer svaret
      if (!m || m.id !== 1) return slut(1, `svar med forkert id: ${linje.slice(0, 120)}`);
      const f = problemer(m, version);
      if (f.length) return slut(1, `svaret er ikke et gyldigt initialize-svar fra ${version}: ${f.join('; ')}`);
      svaret = true;
      efter = setTimeout(() => slut(0, `pakken svarer som vores server (${SERVERNAVN} ${version}) og koerer stadig efter ${EFTERTID} ms`), EFTERTID);
      return;
    }
  });
  barn.on('error', (e) => slut(1, `npx kunne ikke startes: ${e.message}`));
  barn.on('exit', (kode, signal) => slut(1, svaret
    ? `pakken stoppede lige efter sit svar (exit ${kode ?? signal})`
    : `pakken stoppede foer den svarede (exit ${kode ?? signal})`));
  barn.stdin.on('error', () => {});
  barn.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'koldt-tjek', version: '1' } },
  })}\n`);
}
