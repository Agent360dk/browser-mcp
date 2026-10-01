#!/usr/bin/env node
/**
 * koldt-forsoeg.mjs <version> <hjem> - ÉT forsoeg paa det kolde tjek: hent den UDGIVNE pakke med npx og tal MCP med den.
 *
 * Koeres af scripts/koldt-tjek.sh (som staar for de seks forsoeg og pauserne). Findes som eget program (Astra runde 5-6, 1/10-2026) fordi
 * shell-udgaven havde maalte huller:
 *   1. Et korrekt svar efterfulgt af et nedbrud gav groent. Nu holdes stdin aaben; klienten sender `notifications/initialized` som en rigtig
 *      klient, og pakken skal vaere i live KOLDT_EFTERTID_MS efter svaret (samme krav som scripts/pakke-roegtest.mjs). Output paa stdout
 *      kontrolleres ogsaa EFTER svaret.
 *   2. Fristen gjaldt kun den proces timeout/perl startede; et barnebarn der arvede stdout holdt roeret aabent. Nu startes npx som egen
 *      procesgruppe, og hele gruppen draebes (SIGKILL) ved frist, fejl, afslutning og SIGTERM/SIGINT. Et barn der bevidst opretter en NY
 *      session (setsid) ligger uden for gruppen; det dækker dette program ikke.
 *   3. Valideringen var for loes. Nu: jsonrpc "2.0", ingen error-nøgle, result er et objekt, protocolVersion fra en eksplicit liste,
 *      capabilities.tools et objekt, serverInfo.name og serverInfo.version == versionen.
 *   4. process.exit() lige efter console.log() afkortede stor diagnostik, og svartimeren blev ikke afmeldt ved et gyldigt svar (et svar
 *      taet paa fristen blev afvist). Nu tømmes outputtet foer afslutning, buffere er begraenset, og eftertiden har sin egen frist.
 *
 * Miljoeet er en hvidliste: HOME (frisk), PATH, TMPDIR, LANG, npm_config_ignore_scripts. Ingen af udgivelsens hemmeligheder.
 * Exit 0 = pakken svarer som vores server og lever videre; 1 = den goer ikke (aarsagen printes).
 */
import { spawn } from 'node:child_process';

const SERVERNAVN = 'agent360-browser';
/** De MCP-protokolversioner vi accepterer i svaret (klienten beder om 2025-06-18). */
export const PROTOKOLLER = ['2024-11-05', '2025-03-26', '2025-06-18'];
const MAX_UD = 1_000_000;        // stdout-buffer foer svaret (en enkelt linje er under 1 KB)
const MAX_FEJL = 4000;           // vi gemmer kun slutningen af stderr

/** Hvad der er galt med et initialize-svar, som en tom liste hvis intet. */
export function problemer(m, forventetVersion) {
  const f = [];
  if (m.jsonrpc !== '2.0') f.push(`jsonrpc er ${JSON.stringify(m.jsonrpc)}, ikke "2.0"`);
  if ('error' in m) f.push(`svaret har et error-felt (${JSON.stringify(m.error)})`);
  const r = m.result;
  if (!r || typeof r !== 'object' || Array.isArray(r)) { f.push('result mangler eller er ikke et objekt'); return f; }
  if (!PROTOKOLLER.includes(r.protocolVersion)) f.push(`protocolVersion er ${JSON.stringify(r.protocolVersion)}, ikke en af ${PROTOKOLLER.join(', ')}`);
  const t = r.capabilities && r.capabilities.tools;
  if (!t || typeof t !== 'object' || Array.isArray(t)) f.push('capabilities.tools er ikke et objekt');
  if (!r.serverInfo || r.serverInfo.name !== SERVERNAVN) f.push(`serverInfo.name er ${JSON.stringify(r.serverInfo && r.serverInfo.name)}, ikke ${SERVERNAVN}`);
  else if (r.serverInfo.version !== forventetVersion) f.push(`serverInfo.version er ${JSON.stringify(r.serverInfo.version)}, ikke ${forventetVersion}`);
  return f;
}

function koer(version, hjem) {
  const FRIST = Number(process.env.KOLDT_FRIST_MS || 90000);
  const EFTERTID = Number(process.env.KOLDT_EFTERTID_MS || 1500);
  const barn = spawn('npx', ['-y', `@agent360/browser-mcp@${version}`], {
    detached: true, // egen procesgruppe, saa hele gruppen kan draebes
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      HOME: hjem,
      PATH: process.env.PATH ?? '',
      TMPDIR: process.env.TMPDIR || '/tmp',
      LANG: process.env.LANG || 'C',
      npm_config_ignore_scripts: 'true',
    },
  });
  let ud = ''; let fejl = ''; let svaret = false; let faerdig = false; let efter; let ur;

  const draeb = () => { try { process.kill(-barn.pid, 'SIGKILL'); } catch { /* gruppen er allerede vaek */ } };
  const slut = (kode, tekst) => {
    if (faerdig) return;
    faerdig = true; clearTimeout(ur); clearTimeout(efter);
    draeb();
    let uddata = tekst;
    if (kode !== 0 && fejl.trim()) uddata += `\n${fejl.trim().split('\n').slice(-5).join('\n')}`;
    // process.exit() lige efter en skrivning afkorter output der er i koe (maalt: 500 KB blev til 64 KB). Toem foer afslutning.
    process.stdout.write(`${uddata}\n`, () => process.exit(kode));
  };
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => slut(sig === 'SIGINT' ? 130 : 143, `afbrudt af ${sig}`));
  ur = setTimeout(() => slut(1, `intet gyldigt svar inden ${FRIST / 1000} s`), FRIST);

  const linje = (raa) => {
    let m;
    try { m = JSON.parse(raa); } catch { return slut(1, `stdout indeholder tekst der ikke er JSON-RPC: ${raa.slice(0, 120)}`); }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return slut(1, `stdout indeholder JSON der ikke er en JSON-RPC-besked: ${raa.slice(0, 120)}`);
    // Server-notifikationer og server-requests (fx ping) maa komme foer og efter svaret, men skal have en gyldig kuvert.
    if (typeof m.method === 'string') {
      const idOk = m.id === undefined || typeof m.id === 'string' || typeof m.id === 'number';
      const paramsOk = m.params === undefined || (m.params !== null && typeof m.params === 'object'); // objekt eller liste
      if (m.jsonrpc !== '2.0' || m.method === '' || !idOk || !paramsOk) slut(1, `besked fra serveren har en ugyldig JSON-RPC-kuvert: ${raa.slice(0, 120)}`);
      return;
    }
    if (svaret) return slut(1, `uventet svar efter initialize: ${raa.slice(0, 120)}`);
    if (m.id !== 1) return slut(1, `svar med forkert id: ${raa.slice(0, 120)}`);
    const f = problemer(m, version);
    if (f.length) return slut(1, `svaret er ikke et gyldigt initialize-svar fra ${version}: ${f.join('; ')}`);
    svaret = true;
    clearTimeout(ur); // svartimeren afmeldes: eftertiden har sin egen frist
    barn.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    efter = setTimeout(() => {
      // En rest paa stdout uden afsluttende linjeskift er ikke en komplet JSON-RPC-besked (stoej, eller en server der skriver midt i en linje).
      if (ud.trim()) return slut(1, `stdout slutter med en ufuldstaendig linje: ${ud.trim().slice(0, 120)}`);
      slut(0, `pakken svarer som vores server (${SERVERNAVN} ${version}) og koerer stadig efter ${EFTERTID} ms`);
    }, EFTERTID);
  };

  barn.stdout.setEncoding('utf8');
  barn.stderr.setEncoding('utf8');
  barn.stderr.on('data', (c) => { fejl = (fejl + c).slice(-MAX_FEJL); });
  barn.stdout.on('data', (c) => {
    ud += c;
    if (ud.length > MAX_UD) return slut(1, 'stdout er over 1 MB uden en komplet linje');
    let i;
    while ((i = ud.indexOf('\n')) >= 0) {
      const raa = ud.slice(0, i).trim(); ud = ud.slice(i + 1);
      if (raa && !faerdig) linje(raa);
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

if (process.argv[1]?.endsWith('koldt-forsoeg.mjs')) {
  const [version, hjem] = process.argv.slice(2);
  if (!version || !hjem) { console.error('brug: koldt-forsoeg.mjs <version> <hjem>'); process.exit(2); }
  koer(version, hjem);
}
