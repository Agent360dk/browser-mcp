#!/usr/bin/env node
/**
 * Flow-test: alle 43 vaerktoejer mod en ægte Chrome.
 *
 * Hvorfor den findes (21/8): repoet havde tre testfiler, og ingen af dem roerte en
 * browser. Alt var kilde-inspektion. Det betoed at en fejl som "click svarer ok:true
 * uanset om siden reagerede" kun kunne findes ved at bruge vaerktoejet i haanden —
 * hvilket kostede en nat. Denne harness starter den rigtige MCP-server, venter paa
 * den rigtige udvidelse, og kalder hvert eneste vaerktoej mod en fixture-side.
 *
 * Den kan IKKE koere i CI (kraever Chrome + udvidelsen indlaest), saa den er ikke
 * en del af `npm test`. Koer den i haanden:  npm run flow
 *
 * Vaerktoejer der kraever et menneske markeres SPRUNGET — de er ikke daekket, og det
 * skal staa i rapporten frem for at blive talt som groenne.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const her = dirname(fileURLToPath(import.meta.url));
const rod = dirname(dirname(her));
const VENT_PAA_UDVIDELSE_MS = 40000;

// ── fixture-server ──────────────────────────────────────────────────────────
const html = readFileSync(join(her, 'fixture.html'), 'utf8');
const hardHtml = readFileSync(join(her, 'fixture-hard.html'), 'utf8');
const hardJs = readFileSync(join(her, 'fixture-hard.js'), 'utf8');

// Anden server = anden ORIGIN. En iframe herfra er aegte cross-origin, hvilket er
// det eneste der saetter frame-haandteringen rigtigt paa proeve — en srcdoc-ramme
// deler oprindelse med siden og er derfor en langt nemmere oevelse.
const fremmed = createServer((_q, r) => {
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  r.end('<p id="ifremmed">fra en anden oprindelse</p>');
});
await new Promise(r => fremmed.listen(0, '127.0.0.1', r));
const FREMMED = `http://localhost:${fremmed.address().port}/`;   // localhost ≠ 127.0.0.1 → anden origin

const web = createServer((req, res) => {
  if (req.url.startsWith('/langsom')) {                     // til wait_for_network
    return setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }, 700);
  }
  if (req.url.startsWith('/fixture-hard.js')) {
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    return res.end(hardJs);
  }
  if (req.url.startsWith('/hard')) {
    // Stram CSP: ingen inline scripts, ingen eval. Extensionens saedvanlige vej
    // afvises af siden, saa cspBlocked-fallbacken bliver den der maales.
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'self'; script-src 'self'; frame-src *",
    });
    return res.end(hardHtml.replace('__FREMMED_URL__', FREMMED));
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise(r => web.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${web.address().port}`;

// ── MCP-server over stdio ───────────────────────────────────────────────────
const srv = spawn(process.execPath, [join(rod, 'mcp-server/index.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
let stdoutBuf = '', udvidelseKlar = false;
const venter = new Map();
srv.stdout.on('data', d => {
  stdoutBuf += d;
  let i;
  while ((i = stdoutBuf.indexOf('\n')) >= 0) {
    const l = stdoutBuf.slice(0, i).trim(); stdoutBuf = stdoutBuf.slice(i + 1);
    if (!l) continue;
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.id != null && venter.has(m.id)) { venter.get(m.id)(m); venter.delete(m.id); }
  }
});
const serverLog = [];
srv.stderr.on('data', d => {
  const t = String(d); serverLog.push(t);
  if (t.includes('extension connected')) udvidelseKlar = true;
});

let n = 0;
const rpc = (method, params, ms = 60000) => new Promise((res, rej) => {
  const id = ++n;
  venter.set(id, res);
  setTimeout(() => { if (venter.delete(id)) rej(new Error('timeout')); }, ms);
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const kald = async (navn, args = {}, ms) => {
  const r = await rpc('tools/call', { name: navn, arguments: args }, ms);
  const tekst = r.result?.content?.map(c => c.text ?? `<${c.type}>`).join('\n') ?? '';
  if (r.result?.isError) throw new Error(tekst.slice(0, 300));
  let data = null; try { data = JSON.parse(tekst); } catch {}
  // Et vaerktoej der selv siger ok:false skal fejle her. Ellers ser man kun DOM-forskellen
  // bagefter og leder det forkerte sted — det var praecis det der skete med drop_file.
  if (data && data.ok === false) throw new Error(`vaerktoejet svarede ok:false — ${data.error || tekst.slice(0, 200)}`);
  return { data, tekst };
};

// ── rapportering ────────────────────────────────────────────────────────────
const resultat = new Map();
async function proev(vaerktoej, beskrivelse, fn) {
  const t0 = Date.now();
  try {
    await fn();
    resultat.set(vaerktoej, { status: 'OK', beskrivelse, ms: Date.now() - t0 });
    console.log(`  ✓ ${vaerktoej.padEnd(30)} ${beskrivelse}`);
  } catch (e) {
    resultat.set(vaerktoej, { status: 'FEJL', beskrivelse, fejl: e.message, ms: Date.now() - t0 });
    console.log(`  ✗ ${vaerktoej.padEnd(30)} ${beskrivelse}\n      → ${e.message.split('\n')[0].slice(0, 200)}`);
  }
}
const spring = (vaerktoej, grund) => {
  resultat.set(vaerktoej, { status: 'SPRUNGET', beskrivelse: grund });
  console.log(`  ⃝ ${vaerktoej.padEnd(30)} SPRUNGET — ${grund}`);
};
const skalVaere = (betingelse, besked) => { if (!betingelse) throw new Error(besked); };

// ── kør ─────────────────────────────────────────────────────────────────────
let kode = 0;
try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'flow', version: '0' } });
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const liste = await rpc('tools/list', {});
  const alle = liste.result.tools.map(t => t.name);
  console.log(`\nServeren udstiller ${alle.length} vaerktoejer. Fixture: ${BASE}\n`);

  process.stdout.write('Venter paa at Chrome-udvidelsen forbinder');
  const frist = Date.now() + VENT_PAA_UDVIDELSE_MS;
  while (!udvidelseKlar && Date.now() < frist) { await new Promise(r => setTimeout(r, 1000)); process.stdout.write('.'); }
  if (!udvidelseKlar) {
    console.log('\n\n✗ Ingen udvidelse forbandt. Aabn Chrome og slaa Agent360 Browser MCP til paa chrome://extensions.');
    process.exit(2);
  }
  console.log(' forbundet.\n');

  console.log('── Navigation & indhold ──');
  await proev('browser_navigate', 'aabner fixture-siden', async () => {
    const r = await kald('browser_navigate', { url: BASE });
    skalVaere(/flow-fixture/i.test(r.tekst), 'titlen kom ikke med i svaret');
  });
  await proev('browser_get_page_content', 'laeser sidens tekst', async () => {
    const r = await kald('browser_get_page_content', { format: 'text' });
    skalVaere(r.tekst.includes('Fast tekst der kan laeses'), 'fandt ikke den faste tekst');
  });
  await proev('browser_execute_script', 'koerer JS og faar vaerdien tilbage', async () => {
    const r = await kald('browser_execute_script', { script: 'document.getElementById("titel").textContent' });
    skalVaere(r.tekst.includes('Flow-fixture'), 'fik ikke vaerdien tilbage');
  });
  await proev('browser_screenshot', 'tager et billede af fanen', async () => {
    const r = await rpc('tools/call', { name: 'browser_screenshot', arguments: {} });
    skalVaere(r.result.content.some(c => c.type === 'image'), 'intet billede i svaret');
  });
  await proev('browser_extract_list', 'laeser alle 60 raekker i en scroll-boks', async () => {
    const r = await kald('browser_extract_list', { selector: '.raekke' }, 120000);
    skalVaere(r.tekst.includes('raekke 60'), 'naaede ikke til sidste raekke — kun en sliver blev laest');
  });

  console.log('\n── Interaktion ──');
  const status = async () => (await kald('browser_execute_script', { script: 'document.getElementById("status").textContent' })).tekst;
  await proev('browser_click', 'klikker og siden reagerer FAKTISK', async () => {
    await kald('browser_click', { selector: '#klik' });
    skalVaere((await status()).includes('klikket'), 'siden reagerede ikke — klikket landede ikke');
  });
  await proev('browser_double_click', 'dobbeltklik udloeser ondblclick', async () => {
    await kald('browser_double_click', { selector: '#dbl' });
    skalVaere((await status()).includes('dobbeltklikket'), 'ondblclick fyrede ikke');
  });
  await proev('browser_right_click', 'hoejreklik udloeser contextmenu', async () => {
    await kald('browser_right_click', { selector: '#hoejre' });
    skalVaere((await status()).includes('hoejreklikket'), 'contextmenu fyrede ikke');
  });
  await proev('browser_click_xy', 'klik paa koordinater rammer det rigtige felt', async () => {
    const raa = (await kald('browser_execute_script', {
      script: '(r=>Math.round(r.x+r.width/2)+","+Math.round(r.y+r.height/2))(document.getElementById("xy").getBoundingClientRect())',
    })).tekst;
    const [x, y] = (raa.match(/(\d+),(\d+)/) || []).slice(1).map(Number);
    skalVaere(Number.isFinite(x) && Number.isFinite(y), `kunne ikke laese koordinater af: ${raa.slice(0, 80)}`);
    await kald('browser_click_xy', { x, y });
    skalVaere((await status()).includes('xy-klikket'), 'koordinatklikket ramte ikke feltet');
  });
  await proev('browser_hover', 'hover udloeser mouseover', async () => {
    await kald('browser_hover', { selector: '#hover' });
    skalVaere((await status()).includes('hoveret'), 'mouseover fyrede ikke');
  });
  await proev('browser_fill', 'skriver i et tekstfelt', async () => {
    await kald('browser_fill', { selector: '#tekstfelt', value: 'flowtest' });
    skalVaere((await kald('browser_execute_script', { script: 'document.getElementById("tekstfelt").value' })).tekst.includes('flowtest'), 'vaerdien blev ikke sat');
  });
  await proev('browser_press_key', 'Enter naar frem til keydown', async () => {
    await kald('browser_execute_script', { script: 'document.getElementById("tast").focus()' });
    await kald('browser_press_key', { key: 'Enter' });
    skalVaere((await status()).includes('enter-trykket'), 'tastetrykket naaede ikke siden');
  });
  await proev('browser_select_option', 'vaelger i en native select', async () => {
    await kald('browser_select_option', { selector: '#vaelger', option: 'b' });
    skalVaere((await kald('browser_execute_script', { script: 'document.getElementById("vaelger").value' })).tekst.includes('b'), 'valget slog ikke igennem');
  });
  await proev('browser_set_date', 'saetter en datovaerdi', async () => {
    await kald('browser_set_date', { selector: '#datofelt', date: '2026-08-21' });
    skalVaere((await kald('browser_execute_script', { script: 'document.getElementById("datofelt").value' })).tekst.includes('2026-08-21'), 'datoen blev ikke sat');
  });
  await proev('browser_scroll', 'scroller ned ad siden', async () => {
    await kald('browser_scroll', { selector: '#bund' });
    skalVaere(Number((await kald('browser_execute_script', { script: 'window.scrollY' })).tekst.replace(/\D/g, '')) > 200, 'siden scrollede ikke');
  });
  await proev('browser_wait', 'venter paa et element der findes', async () => {
    await kald('browser_wait', { selector: '#titel' });
  });
  await proev('browser_dismiss_overlays', 'fjerner cookie-banneret', async () => {
    await kald('browser_dismiss_overlays', {});
    skalVaere((await kald('browser_execute_script', { script: 'String(!document.getElementById("banner"))' })).tekst.includes('true'), 'banneret sidder der endnu');
  });
  await proev('browser_set_combobox', 'skriver, venter paa listen og vaelger', async () => {
    await kald('browser_set_combobox', { selector: '#combo', value: 'Danmark' }, 20000);
    const v = await kald('browser_execute_script', { script: 'document.getElementById("combo").value' });
    skalVaere(v.tekst.includes('Danmark'), 'valget landede ikke i feltet');
  });

  console.log('\n── Faner & rammer ──');
  let nyFane = null, hovedFane = null;
  await proev('browser_list_tabs', 'ser sessionens egne faner', async () => {
    const r = await kald('browser_list_tabs', {});
    skalVaere(/\d/.test(r.tekst), 'ingen faner i svaret');
    hovedFane = r.data?.tabs?.[0]?.id ?? null;
  });
  await proev('browser_get_new_tab', 'finder en nyaabnet fane', async () => {
    await kald('browser_navigate', { url: BASE + '/#to', new_tab: true });
    const r = await kald('browser_get_new_tab', {});
    nyFane = r.data?.id ?? r.data?.tab?.id ?? null;
    skalVaere(nyFane != null || /\d/.test(r.tekst), 'ingen ny fane rapporteret');
  });
  await proev('browser_switch_tab', 'skifter til en anden fane', async () => {
    const t = (await kald('browser_list_tabs', {})).data?.tabs || [];
    skalVaere(t.length >= 2, `forventede mindst 2 faner, fandt ${t.length}`);
    await kald('browser_switch_tab', { tab_id: t[0].id });
  });
  await proev('browser_list_frames', 'ser iframen paa siden', async () => {
    await kald('browser_navigate', { url: BASE });
    const r = await kald('browser_list_frames', {});
    skalVaere(/\d/.test(r.tekst), 'ingen rammer rapporteret');
  });
  await proev('browser_select_frame', 'koerer JS inde i iframen', async () => {
    const r = await kald('browser_select_frame', { frame_index: 1, code: 'document.getElementById("iramme")?.textContent' });
    skalVaere(r.tekst.includes('inde i rammen'), 'naaede ikke ind i rammen');
    // `script` skal virke som alias — samme navne-faelde som execute_script havde.
    const a = await kald('browser_select_frame', { frame_index: 1, script: 'document.getElementById("iramme")?.textContent' });
    skalVaere(a.tekst.includes('inde i rammen'), 'aliaset `script` blev ignoreret — koden faldt tilbage til standardteksten');
  });
  await proev('browser_close_tab', 'lukker en fane igen', async () => {
    const t = (await kald('browser_list_tabs', {})).data?.tabs || [];
    skalVaere(t.length >= 2, 'ingen ekstra fane at lukke');
    await kald('browser_close_tab', { tab_id: t[t.length - 1].id });
    const efter = (await kald('browser_list_tabs', {})).data?.tabs || [];
    skalVaere(efter.length < t.length, 'fanen blev ikke lukket');
  });

  console.log('\n── Data & lager ──');
  await proev('browser_set_cookies', 'saetter en cookie', () => kald('browser_set_cookies', { url: BASE, name: 'flow', value: 'ja' }));
  await proev('browser_get_cookies', 'laeser cookien tilbage', async () => {
    const r = await kald('browser_get_cookies', { url: BASE });
    skalVaere(r.tekst.includes('flow'), 'cookien kom ikke tilbage');
  });
  await proev('browser_set_local_storage', 'skriver til localStorage', () => kald('browser_set_local_storage', { key: 'flow', value: 'ja' }));
  await proev('browser_get_local_storage', 'laeser localStorage tilbage', async () => {
    const r = await kald('browser_get_local_storage', { key: 'flow' });
    skalVaere(r.tekst.includes('ja'), 'vaerdien kom ikke tilbage');
  });
  await proev('browser_console_logs', 'fanger en console-linje siden skriver nu', async () => {
    await kald('browser_console_logs', {});                       // start opsamlingen
    await kald('browser_execute_script', { script: 'String(console.log("flow-markoer-42"))' });
    await new Promise(r => setTimeout(r, 600));
    const r = await kald('browser_console_logs', {});
    skalVaere(r.tekst.includes('flow-markoer-42'), 'linjen kom ikke med i logbogen');
  });

  console.log('\n── Filer ──');
  const mappe = mkdtempSync(join(tmpdir(), 'bmcp-flow-'));
  const fil = join(mappe, 'proeve.txt');
  writeFileSync(fil, 'flow-test');
  await proev('browser_upload_file', 'lægger en fil i et file-input', async () => {
    await kald('browser_upload_file', { selector: '#fil', file: fil });
    skalVaere((await kald('browser_execute_script', { script: 'String(document.getElementById("fil").files.length)' })).tekst.includes('1'), 'filen kom ikke ind i feltet');
  });
  await proev('browser_drop_file', 'finder det skjulte input i en dropzone', async () => {
    await kald('browser_drop_file', { selector: '#dropzone', file: fil });
    skalVaere((await kald('browser_execute_script', { script: 'String(document.querySelector("#dropzone input").files.length)' })).tekst.includes('1'), 'filen kom ikke ind i dropzonen');
  });

  console.log('\n── Netvaerk ──');
  await proev('browser_fetch', 'henter uden om sidens CORS', async () => {
    const r = await kald('browser_fetch', { url: BASE + '/langsom' });
    skalVaere(r.tekst.includes('ok'), 'intet svar fra fixture-endepunktet');
  });
  await proev('browser_wait_for_network', 'venter paa et kald der er undervejs', async () => {
    await kald('browser_execute_script', { script: 'String(setTimeout(()=>fetch("/langsom"),150))' });
    await kald('browser_wait_for_network', { url_pattern: 'langsom', timeout: 8000 }, 20000);
  });
  await proev('browser_extract_token', 'kender sine udbydere og afviser ukendte pænt', async () => {
    const r = await kald('browser_extract_token', { provider: 'findes-ikke-som-udbyder' });
    skalVaere(/Unknown provider/i.test(r.tekst) && /stripe/i.test(r.tekst), 'listede ikke de kendte udbydere');
  });

  console.log('\n── CAPTCHA, udklipsholder, meta ──');
  await proev('browser_solve_captcha', 'rapporterer korrekt at der ingen CAPTCHA er', async () => {
    const r = await kald('browser_solve_captcha', { action: 'detect' }, 70000);
    skalVaere(!/error/i.test(r.tekst), 'detect fejlede paa en side uden CAPTCHA');
  });
  // MAALT 22/8: ALLE tre udklipsholder-vaerktoejer er fjernet i denne udgivelse.
  // clipboardRead udloeser Chrome-advarslen "Read data you copy and paste" — og
  // clipboardWrite udloeser "Modify data you copy and paste". Begge er advarsler, og
  // en opdatering der tilfoejer EN advarsels-tilladelse SLUKKER udvidelsen hos hele
  // den installerede base indtil hver bruger selv klikker acceptér. Kilde: Chromes
  // egen permissions-liste. Jeg troede foerst kun clipboardRead udloeste en advarsel;
  // det var forkert, og en agent fangede det. Ingen udgivet version har nogensinde
  // haft nogen af dem, saa ingen mister noget — og rettighedslisten er nu byte-for-byte
  // identisk med v1.25.0, altsaa nul risiko for at slukke nogen.
  await proev('browser_reattach_debugger', 'kobler debuggeren om', () => kald('browser_reattach_debugger', {}));
  await proev('browser_about', 'giver projektinfo og indsendelseslink', async () => {
    const r = await kald('browser_about', { intent: 'info' });
    skalVaere(r.tekst.includes('github.com'), 'intet indsendelseslink');
  });
  await proev('browser_provide_feedback', 'selv-diagnose svarer med en dom', async () => {
    const r = await kald('browser_provide_feedback', { what_happened: 'flow-test, ingen aegte fejl' });
    skalVaere(['current', 'outdated', 'conflict', 'disconnected', 'unknown'].includes(r.data?.verdict), 'ingen brugbar dom');
  });
  await proev('#shadow-dom', 'selektorer naar ind i shadow DOM', async () => {
    await kald('browser_click', { selector: '#ishadow' });
  });

  // ask_user kan ikke automattestes helt: den venter paa at et menneske svarer.
  // Men SVAR-vejen er ikke det hele. Naar ingen svarer, skal den give op til tiden
  // og sige det ligeud — ikke haenge, og ikke svare som om den fik et svar. Den del
  // kan maales, og den var indtil nu helt udaekket.
  await proev('browser_ask_user', 'giver op til tiden og siger det ligeud naar ingen svarer', async () => {
    const t0 = Date.now();
    let svar;
    try {
      svar = await kald('browser_ask_user', { message: 'Flowtest — luk denne, der skal ikke svares.', timeout: 8000 }, 30000);
    } catch (e) {
      skalVaere(/timeout|timed out|no response/i.test(e.message), `fejlede uden at forklare hvorfor: ${e.message.slice(0, 140)}`);
      const dt = Date.now() - t0;
      skalVaere(dt < 25000, `ventede ${dt} ms paa en frist paa 8000 — fristen holdes ikke`);
      return;
    }
    const dt = Date.now() - t0;
    skalVaere(dt < 25000, `ventede ${dt} ms paa en frist paa 8000 — fristen holdes ikke`);
    skalVaere(/timeout|timed out|cancel|no response|ingen svar/i.test(svar.tekst),
      `svarede uden at et menneske havde svaret — det maa den aldrig: ${svar.tekst.slice(0, 160)}`);
  });

  // Dialogen blokerer hele fanen mens den staar aaben. Kommentaren her sagde foer at
  // testen derfor koeres SIDST i sin egen fane — men den var IKKE sidst (elleve
  // kontroller laa efter den), og den lukkede ikke fanen igen.
  //
  // MAALT 30/8: begge de foelgende kontroller BESTAAR naar de koeres for sig selv
  // (#usynligt-element paa 41 ms, #klik-aerlighed svarer korrekt). I flow-testen
  // arvede de en frossen fane og timede ud efter 30 sek — to roede linjer der maalte
  // testens egen manglende oprydning, ikke koden. Vi jagede dem i to dage.
  //
  // Fanen lukkes nu i en finally, saa udfaldet af DEN her test aldrig kan smitte af
  // paa de naeste. Fejler den, skal den fejle alene.
  await proev('browser_handle_dialog', 'accepterer en confirm() uden at blokere fanen', async () => {
    await kald('browser_navigate', { url: BASE, new_tab: true });
    try {
      await kald('browser_handle_dialog', { action: 'accept' });     // arm FOER klikket
      await kald('browser_click', { selector: '#dialogknap' }, 15000);
      const r = await kald('browser_execute_script', { script: 'String(window.__svar)' }, 15000);
      skalVaere(/true|false/.test(r.tekst), 'confirm() blev aldrig besvaret — fanen stod laast');
    } finally {
      // Staar dialogen stadig aaben, skal den vaek FOER fanen lukkes — ellers naegter
      // Chrome at lukke fanen, og saa er vi lige vidt.
      await kald('browser_handle_dialog', { action: 'accept', wait: true, timeout: 2000 }, 6000).catch(() => {});
      // IKKE close_tab: lukkes sessionens sidste fane, beder udvidelsen serveren om at
      // lukke ned (terminate) — og saa fejler alt efter med timeouts der ligner alt
      // muligt andet. Maalt 30/8. En navigation frigoer fanen lige saa godt.
      await kald('browser_navigate', { url: BASE }, 10000).catch(() => {});
    }
  });

  // ── ekstra: adfaerd der har kostet tid foer ────────────────────────────────
  console.log('\n── Kontrakter der har kostet tid foer ──');
  await proev('#usynligt-element', 'click AFVISER et 0x0-element i stedet for at ramme (0,0)', async () => {
    // display:none giver rect 0x0 ved (0,0). Uden vaernet bliver midtpunktet (0,0),
    // og der sendes et AEGTE museklik i sidens oeverste venstre hjoerne — paa hvad
    // der nu ligger der. I en live annoncekonto kostede det en nat.
    let afvist = false, svar = '';
    try {
      const r = await kald('browser_click', { selector: '#usynlig' });
      svar = r.tekst; afvist = r.data?.ok === false || /ikke synlig|hidden/i.test(r.tekst);
    } catch (e) { afvist = /ikke synlig|hidden/i.test(e.message); svar = e.message; }
    skalVaere(afvist, `et skjult element blev klikket — museklikket landede i sidens hjoerne paa noget andet. Svar: ${svar.slice(0, 160)}`);
  });

  await proev('#klik-aerlighed', 'click siger til naar eventet ikke blev taget imod', async () => {
    // Et klik paa et element uden handler skal rapportere landed:false, ikke bare ok:true.
    const r = await kald('browser_click', { selector: '#tekst' });
    skalVaere(r.data && 'landed' in r.data, 'svaret oplyser ikke om klikket blev taget imod');
  });

  // ── haard fixture: stram CSP + React-styret felt + cross-origin iframe ────
  //
  // Alt ovenfor koerer mod en side jeg selv har skrevet uden nogen begraensninger.
  // Det er ikke der browser-mcp knaekker i virkeligheden. Otte kaldesteder i
  // background.js har en cspBlocked-fallback, og den blev aldrig afproevet foer nu.
  console.log('\n── Haard fixture: stram CSP, styret felt, fremmed iframe ──');
  await proev('#csp-navigate', 'aabner en side med stram CSP', async () => {
    const r = await kald('browser_navigate', { url: BASE + '/hard' });
    skalVaere(/[Hh]aard fixture/.test(r.tekst), 'kom ikke ind paa siden');
  });
  await proev('#csp-execute_script', 'JS koerer trods CSP (falder tilbage til debuggeren)', async () => {
    const r = await kald('browser_execute_script', { script: 'document.getElementById("titel").textContent' });
    skalVaere(r.tekst.includes('Haard fixture'), `fik ikke vaerdien: ${r.tekst.slice(0, 120)}`);
  });
  await proev('#csp-get_page_content', 'laeser indhold trods CSP', async () => {
    const r = await kald('browser_get_page_content', { format: 'text' });
    skalVaere(r.tekst.includes('Tekst bag en stram CSP'), 'fandt ikke teksten');
  });
  await proev('#csp-wait', 'venter paa et element trods CSP', () => kald('browser_wait', { selector: '#titel' }));
  await proev('#csp-click', 'klik virker trods CSP', async () => {
    await kald('browser_click', { selector: '#klik' });
    const st = await kald('browser_execute_script', { script: 'document.getElementById("status").textContent' });
    skalVaere(st.tekst.includes('klikket'), 'siden reagerede ikke');
  });
  await proev('#csp-extract_list', 'siger aerligt fra ELLER laeser listen — men lyver ikke', async () => {
    let r;
    try { r = await kald('browser_extract_list', { selector: '.raekke' }, 60000); }
    catch (e) {
      skalVaere(/blocks script injection|screenshots/i.test(e.message),
        `fejlede uden at forklare hvorfor: ${e.message.slice(0, 140)}`);
      return;
    }
    skalVaere(r.tekst.includes('haard raekke 40'),
      'returnerede et delvist resultat uden at sige at siden blokerer — det laeses som "hele listen"');
  });
  await proev('#styret-felt', 'fill sidder fast i et React-agtigt styret felt', async () => {
    // Feltet ruller en naiv `.value = x` tilbage. Kun den native setter + en aegte
    // input-haendelse slaar igennem — praecis det browser_fill paastaar at goere.
    await kald('browser_fill', { selector: '#styret', value: 'gennemtrængt' });
    const v = await kald('browser_execute_script', { script: 'document.getElementById("styret").value' });
    skalVaere(v.tekst.includes('gennemtrængt'),
      `vaerdien blev rullet tilbage — fill meldte succes, men feltet staar paa noget andet: ${v.tekst.slice(0, 100)}`);
  });
  await proev('#fremmed-iframe', 'ser og naar ind i en iframe paa fremmed oprindelse', async () => {
    const f = await kald('browser_list_frames', {});
    skalVaere(/localhost/.test(f.tekst), `den fremmede ramme blev ikke set: ${f.tekst.slice(0, 200)}`);
    const r = await kald('browser_select_frame', { frame_index: 1, code: 'document.getElementById("ifremmed")?.textContent' });
    skalVaere(r.tekst.includes('anden oprindelse'), `naaede ikke ind i rammen: ${r.tekst.slice(0, 200)}`);
  });

  // ── rapport ───────────────────────────────────────────────────────────────
  const vaerktoejer = alle.filter(v => resultat.has(v));
  const udaekket = alle.filter(v => !resultat.has(v));
  const ok = [...resultat.values()].filter(r => r.status === 'OK').length;
  const fejl = [...resultat.entries()].filter(([, r]) => r.status === 'FEJL');
  const sprunget = [...resultat.values()].filter(r => r.status === 'SPRUNGET').length;

  console.log('\n' + '='.repeat(72));
  console.log(`DAEKNING: ${vaerktoejer.length}/${alle.length} vaerktoejer beroert · ${ok} OK · ${fejl.length} FEJL · ${sprunget} SPRUNGET`);
  if (udaekket.length) console.log(`UDAEKKET: ${udaekket.join(', ')}`);
  if (fejl.length) {
    console.log('\nFEJL:');
    for (const [v, r] of fejl) console.log(`  ${v}: ${r.fejl?.split('\n')[0]}`);
  }
  const advarsler = serverLog.join('').split('\n').filter(l => l.includes('ADVARSEL'));
  if (advarsler.length) { console.log('\nSERVER-ADVARSLER:'); advarsler.forEach(a => console.log('  ' + a.replace('[MCP] ', ''))); }
  console.log('='.repeat(72));
  kode = fejl.length ? 1 : 0;
} catch (e) {
  console.log('\n✗ harness kastede:', e.message);
  console.log(serverLog.join('').split('\n').slice(-15).join('\n'));
  kode = 3;
} finally {
  srv.kill('SIGTERM');
  web.close();
  fremmed.close();
  setTimeout(() => { srv.kill('SIGKILL'); process.exit(kode); }, 900);
}
