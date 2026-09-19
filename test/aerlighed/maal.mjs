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
    vaelg: () => ['browser_select_option', { selector: '#valg', option: 'b' }],
    evaluer: (js) => ['browser_execute_script', { script: js }],
  },
  playwright: {
    navn: 'Playwright MCP (Microsoft)',
    start: () => klient('npx', ['-y', '@playwright/mcp@latest', '--headless', '--isolated']),
    navigate: (u) => ['browser_navigate', { url: u }],
    // MAALT 19/9: feltet hedder `target`, ikke `ref`, og det tager en selector. Foerste
    // udgave sendte `ref` og fik "Invalid arguments" - deres vaerktoej afviste aerligt, men
    // det maaler MIT kald, ikke deres aerlighed. En maaling der doemmer paa en misformet
    // anmodning er vaerdiloes. browser_type er det naermeste modstykke til vores fill.
    fyld: (v) => ['browser_type', { element: 'styret felt', target: '#styret', text: v }],
    vaelg: () => ['browser_select_option', { element: 'styret select', target: '#valg', values: ['b'] }],
    evaluer: (js) => ['browser_evaluate', { function: `() => { return ${js}; }` }],
  },
  devtools: {
    navn: 'Chrome DevTools MCP (Google)',
    start: () => klient('npx', ['-y', 'chrome-devtools-mcp@latest', '--headless', '--isolated']),
    // MAALT 19/9: `navigate_page` kraever OGSAA et pageId, saa uden det skete navigeringen
    // aldrig - siden stod paa about:blank, og `evaluate_script` svarede pligtskyldigt "null".
    // Havde jeg ikke kalibreret, havde jeg udgivet et resultat om Google maalt paa en tom
    // side. Og deres sider taelles fra 1, ikke 0.
    foerNavigate: async (kald) => {
      const sider = await kald('tools/call', { name: 'list_pages', arguments: {} });
      const st = (sider?.result?.content || []).map((x) => x.text ?? '').join('\n');
      const pm = st.match(/^\s*(\d+):/m);
      return { pageId: pm ? Number(pm[1]) : 1 };
    },
    navigate: (u, h) => ['navigate_page', { pageId: h?.pageId ?? 1, url: u }],
    // Google vil have et `uid` fra deres eget side-snapshot, ikke en selector. Uden det
    // opslag maaler vi igen os selv. `forbered` koeres foer fyld og giver handtaget.
    // MAALT 19/9: `fill` og `evaluate_script` kraever BEGGE et `pageId`, og `fill` desuden
    // et `uid` fra deres eget snapshot. To opslag foer vi overhovedet kan stille
    // spoergsmaalet. Uden dem afviser deres server aerligt - og saa maaler vi igen mig.
    forbered: async (kald, h) => {
      const pageId = h?.pageId ?? 1;
      const sn = await kald('tools/call', { name: 'take_snapshot', arguments: { pageId } });
      const t = (sn?.result?.content || []).map((x) => x.text ?? '').join('\n');
      const linje = t.split('\n').find((l) => /styret/i.test(l)) || '';
      const um = linje.match(/uid=?["']?([\w_-]+)/i) || linje.match(/^\s*([\w_-]+)\b/);
      const sl = t.split('\n').find((l) => /valg|select|combobox/i.test(l)) || '';
      const sm = sl.match(/uid=?["']?([\w_-]+)/i) || sl.match(/^\s*([\w_-]+)\b/);
      return { pageId, uid: um ? um[1] : null, selectUid: sm ? sm[1] : null, snapshot: t.slice(0, 200) };
    },
    fyld: (v, h) => ['fill', { pageId: h?.pageId ?? 0, uid: h?.uid || 'styret', value: v }],
    vaelg: (h) => ['fill', { pageId: h?.pageId ?? 0, uid: h?.selectUid || 'valg', value: 'b' }],
    evaluer: (js, h) => ['evaluate_script', { pageId: h?.pageId ?? 0, function: `() => { return ${js}; }` }],
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

    const foer = d.foerNavigate ? await d.foerNavigate(k.kald) : null;
    const [nn, na] = d.navigate(url, foer);
    const nav = await k.kald('tools/call', { name: nn, arguments: na });
    if (nav?.error) return { navn: d.navn, dom: 'KOM-IKKE-I-GANG', note: 'navigate: ' + tekst(nav).slice(0, 120) };

    const handtag = d.forbered ? await d.forbered(k.kald, foer) : foer;
    const [fn, fa] = d.fyld('gennemtraengt', handtag);
    const fyld = await k.kald('tools/call', { name: fn, arguments: fa });
    const svarTekst = tekst(fyld);
    const fejlede = !!fyld?.error || fyld?.result?.isError === true || /\berror\b|failed|kunne ikke/i.test(svarTekst);
    const uvist = /uvist|unverified|maybe_landed|maaske|could not be (read|verified)|ramme_hoerte_ikke/i.test(svarTekst);

    const [en, ea] = d.evaluer('JSON.stringify(window.__rapport ? window.__rapport() : null)', handtag);
    const rap = await k.kald('tools/call', { name: en, arguments: ea });
    // Hver server pakker svaret forskelligt ind: Playwright i markdown med escaped JSON,
    // Chrome DevTools i sin egen ramme. Vi leder derfor efter JSON'en BAADE raa og escaped,
    // og fejler hoejlydt hvis ingen af delene findes - et tomt svar maa ikke blive til en dom.
    const raaTekst = tekst(rap);
    let r = null;
    for (const kandidat of [raaTekst, raaTekst.replace(/\\"/g, '"').replace(/\\\\/g, '\\')]) {
      const m = kandidat.match(/\{[^{}]*"tilstand"[^{}]*\}/);
      if (m) { try { r = JSON.parse(m[0]); break; } catch {} }
    }
    if (!r) return { navn: d.navn, dom: 'KUNNE-IKKE-LAESES',
      vaerktoejet_sagde: svarTekst.replace(/\s+/g, ' ').slice(0, 200),
      raa_rapport: raaTekst.replace(/\s+/g, ' ').slice(0, 160) };

    const hoerte = r.tilstand === 'gennemtraengt';

    // Sag 2: styret <select>. Det var HER det eksterne fund laa (issue #19).
    let selectDom = 'SPRUNGET';
    if (d.vaelg) {
      const [sn2, sa2] = d.vaelg(handtag);
      const valg = await k.kald('tools/call', { name: sn2, arguments: sa2 });
      const valgTekst = tekst(valg);
      const vFejl = !!valg?.error || valg?.result?.isError === true || /\berror\b|failed|kunne ikke/i.test(valgTekst);
      const vUvist = /uvist|unverified|maaske_landet|maybe_landed|uverificeret/i.test(valgTekst);
      const [en2, ea2] = d.evaluer('JSON.stringify(window.__rapport ? window.__rapport() : null)', handtag);
      const rap2 = await k.kald('tools/call', { name: en2, arguments: ea2 });
      const raa2 = tekst(rap2);
      let r2 = null;
      for (const kandidat of [raa2, raa2.replace(/\\"/g, '"')]) {
        const m2 = kandidat.match(/\{[^{}]*"select_tilstand"[^{}]*\}/) || kandidat.match(/\{.*"select_tilstand".*\}/s);
        if (m2) { try { r2 = JSON.parse(m2[0]); break; } catch {} }
      }
      selectDom = r2 ? dom(!vFejl, vUvist, r2.select_tilstand === 'b') : 'KUNNE-IKKE-LAESES';
    }

    return {
      navn: d.navn,
      dom: dom(!fejlede, uvist, hoerte),
      dom_select: selectDom,
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
    console.log(`  ${r.navn.padEnd(30)} fyld: ${(r.dom||'-').padEnd(18)} select: ${r.dom_select || '-'}`);
    for (const [k, v] of Object.entries(r)) if (!['navn','dom','dom_select'].includes(k)) console.log(`      ${k}: ${v}`);
  }
  s.close();
  console.log('\n  LOEGN = vaerktoejet sagde ja, og komponenten hoerte intet.');
  console.log('  Vores egne fejl staar paa samme liste. Uden det er det reklame, ikke en maaling.\n');
}
