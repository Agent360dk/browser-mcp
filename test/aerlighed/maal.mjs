/**
 * Aerligheds-maalingen: svarer et browser-MCP-vaerktoej ja, naar siden ikke hoerte det?
 *
 * Hvorfor den findes: 1.29.2 lukkede ni af VORES egne vaerktoejer der svarede ja fordi
 * Chrome kvitterede for kommandoen, ikke fordi siden modtog den. Vi har brugt det som
 * argument for at vi er anderledes. Den paastand er ubevist indtil nogen maaler de andre.
 *
 * Maalingen er skruppeloest ens for alle, os selv inklusive:
 *   1. aabn en fixtur med et styret felt der foerer protokol over hvad det HOERTE
 *   2. bed vaerktoejet skrive en vaerdi
 *   3. laes komponentens EGEN tilstand - ikke DOM'ens vaerdi
 *   4. sammenlign det vaerktoejet SAGDE med det der SKETE
 *
 * Fire udfald:
 *   SAND-JA    vaerktoejet sagde ja, og komponenten hoerte det
 *   SAND-NEJ   vaerktoejet sagde nej, og komponenten hoerte det ikke
 *   UVIST      vaerktoejet sagde "det ved jeg ikke" - det bedste svar naar det er sandt
 *   LOEGN      vaerktoejet sagde ja, og komponenten hoerte INTET        <- det vi leder efter
 *
 * Koer:  node test/aerlighed/maal.mjs [--kun os|playwright|devtools]
 * Den henter konkurrenternes pakker med npx. Intet sendes nogen steder.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const her = dirname(fileURLToPath(import.meta.url));
const VENT_START = Number(process.env.AERLIGHED_START_MS || 30000);
const VENT_KALD = Number(process.env.AERLIGHED_KALD_MS || 25000);

function server() {
  return new Promise((ok) => {
    const s = createServer((rq, rs) => {
      const navn = rq.url === '/' ? '/fixture.html' : rq.url.split('?')[0];
      try {
        const krop = readFileSync(join(her, navn.replace(/^\//, '')));
        rs.writeHead(200, { 'content-type': extname(navn) === '.js' ? 'text/javascript' : 'text/html' });
        rs.end(krop);
      } catch { rs.writeHead(404); rs.end('nej'); }
    });
    s.listen(0, '127.0.0.1', () => ok({ s, url: `http://127.0.0.1:${s.address().port}/` }));
  });
}

function klient(kommando, args) {
  const p = spawn(kommando, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const venter = new Map();
  p.stdout.on('data', (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const linje = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      if (!linje.trim()) continue;
      let m; try { m = JSON.parse(linje); } catch { continue; }
      if (m.id != null && venter.has(m.id)) { venter.get(m.id)(m); venter.delete(m.id); }
    }
  });
  let næste = 1;
  const kald = (method, params, ms = VENT_KALD) => new Promise((ok) => {
    const id = næste++;
    const timer = setTimeout(() => { venter.delete(id); ok({ error: { message: 'timeout' } }); }, ms);
    venter.set(id, (m) => { clearTimeout(timer); ok(m); });
    try { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); }
    catch { clearTimeout(timer); ok({ error: { message: 'stdin lukket' } }); }
  });
  const notify = (method) => { try { p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: {} }) + '\n'); } catch {} };
  return { p, kald, notify, luk: () => p.kill() };
}

const tekst = (svar) => {
  const c = svar?.result?.content;
  if (Array.isArray(c)) return c.map((x) => x.text ?? '').join('\n');
  return JSON.stringify(svar?.result ?? svar?.error ?? svar);
};

export const DELTAGERE = {
  os: {
    navn: 'Browser MCP (os)',
    start: () => klient('node', [join(her, '..', '..', 'mcp-server', 'index.js')]),
    kraeverUdvidelse: true,
    navigate: (u) => ['browser_navigate', { url: u }],
    fyld: (v) => ['browser_fill', { selector: '#styret', value: v }],
    evaluer: (js) => ['browser_execute_script', { script: js }],
  },
  playwright: {
    navn: 'Playwright MCP (Microsoft)',
    start: () => klient('npx', ['-y', '@playwright/mcp@latest', '--headless', '--isolated']),
    navigate: (u) => ['browser_navigate', { url: u }],
    fyld: (v) => ['browser_fill_form', { fields: [{ name: 'styret felt', type: 'textbox', ref: '#styret', value: v }] }],
    evaluer: (js) => ['browser_evaluate', { function: `() => { return ${js}; }` }],
  },
  devtools: {
    navn: 'Chrome DevTools MCP (Google)',
    start: () => klient('npx', ['-y', 'chrome-devtools-mcp@latest', '--headless', '--isolated']),
    navigate: (u) => ['navigate_page', { url: u }],
    fyld: (v) => ['fill', { uid: '#styret', value: v }],
    evaluer: (js) => ['evaluate_script', { function: `() => { return ${js}; }` }],
  },
};

export function dom(sagdeJa, sagdeUvist, hoerte) {
  if (sagdeUvist) return 'UVIST';
  if (sagdeJa && hoerte) return 'SAND-JA';
  if (sagdeJa && !hoerte) return 'LOEGN';
  if (!sagdeJa && !hoerte) return 'SAND-NEJ';
  return 'FALSK-NEJ';
}

async function maalEn(noegle, url) {
  const d = DELTAGERE[noegle];
  const k = d.start();
  try {
    const init = await k.kald('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aerlighed', version: '1' } }, VENT_START);
    if (!init?.result) return { navn: d.navn, dom: 'KOM-IKKE-I-GANG', note: tekst(init).slice(0, 120) };
    k.notify('notifications/initialized');

    const nav = await k.kald('tools/call', { name: d.navigate(url)[0], arguments: d.navigate(url)[1] });
    if (nav?.error) return { navn: d.navn, dom: 'KOM-IKKE-I-GANG', note: 'navigate: ' + tekst(nav).slice(0, 120) };

    const [fn, fa] = d.fyld('gennemtraengt');
    const fyld = await k.kald('tools/call', { name: fn, arguments: fa });
    const svarTekst = tekst(fyld);
    const fejlede = !!fyld?.error || fyld?.result?.isError === true || /\berror\b|failed|kunne ikke/i.test(svarTekst);
    const uvist = /uvist|unverified|maybe_landed|maaske|could not be (read|verified)|ramme_hoerte_ikke/i.test(svarTekst);

    const [en, ea] = d.evaluer('JSON.stringify(window.__rapport ? window.__rapport() : null)');
    const rap = await k.kald('tools/call', { name: en, arguments: ea });
    const m = tekst(rap).match(/\{[^{}]*"tilstand"[^{}]*\}/);
    const r = m ? JSON.parse(m[0].replace(/\\"/g, '"')) : null;
    if (!r) return { navn: d.navn, dom: 'KUNNE-IKKE-LAESES', note: tekst(rap).slice(0, 140) };

    const hoerte = r.tilstand === 'gennemtraengt';
    return {
      navn: d.navn,
      dom: dom(!fejlede, uvist, hoerte),
      dom_viser: r.dom, komponenten_ved: r.tilstand, haendelser: r.hoert, betroede: r.betroet,
      vaerktoejet_sagde: svarTekst.replace(/\s+/g, ' ').slice(0, 150),
    };
  } finally { k.luk(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const kun = process.argv.includes('--kun') ? process.argv[process.argv.indexOf('--kun') + 1] : null;
  const { s, url } = await server();
  const noegler = kun ? [kun] : Object.keys(DELTAGERE);
  console.log(`\nAERLIGHEDS-MAALING  ${new Date().toISOString().slice(0, 10)}  fixtur: ${url}\n`);
  for (const n of noegler) {
    if (DELTAGERE[n].kraeverUdvidelse && !process.env.AERLIGHED_MED_OS) {
      console.log(`  ${DELTAGERE[n].navn.padEnd(30)} SPRUNGET OVER - kraever Chrome-udvidelsen. Koer med AERLIGHED_MED_OS=1`);
      continue;
    }
    const r = await maalEn(n, url);
    console.log(`  ${r.navn.padEnd(30)} ${r.dom}`);
    for (const [k, v] of Object.entries(r)) if (k !== 'navn' && k !== 'dom') console.log(`      ${k}: ${v}`);
  }
  s.close();
  console.log('\n  LOEGN = vaerktoejet sagde ja, og komponenten hoerte intet.');
  console.log('  Vores egne fejl staar paa samme liste. Uden det er det reklame, ikke en maaling.\n');
}
