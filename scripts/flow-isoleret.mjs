#!/usr/bin/env node
/**
 * En isoleret browser til flow-spaerren - saa en koersel aldrig behoever menneskets skaerm.
 *
 * ## Hvorfor det her fandtes som «virker ikke» indtil 21/9
 *
 * Foerste udgave (19/9) konkluderede at udvidelsen ALDRIG indlaeses med `--load-extension`.
 * Det var maalt i **Google Chrome**, som har fjernet flaget for Chrome-maerkede builds.
 * Chrome for Testing har det stadig - og huset havde selv brugt netop den browser 11/9 og
 * tabt vejen igen.
 *
 * ⛔ Og 19/9-maalingen gik galt paa noget andet ogsaa: den greb det foerste CDP-target med
 * «background» i url'en, og det var Chromes EGEN udvidelse. Derfor spoerger dette script
 * hver service worker hvad den HEDDER, og kraever at finde «Agent360 Browser MCP». Et target
 * er ikke vores fordi det ligner vores.
 *
 * MAALT 21/9 i Chrome for Testing 153: udvidelsen indlaeses, og alle 12 fokus-kraevende
 * vaerktoejer leverer aegte haendelser (isTrusted: true) efter et `browser_switch_tab`.
 *
 * ## Isolationen - tre lag, saa Gustavs egen Chrome ikke kan blande sig
 *
 * 1. Egen profil (frisk mappe), saa intet arves fra hans.
 * 2. Eget portomraade 19900-19904, sat via `bmcpPorte` i udvidelsens lager. Hans egen
 *    udvidelse skanner 9876-9895 og kan derfor ALDRIG naa denne servers port.
 * 3. Serveren bindes til dette udvidelses-id med BROWSER_MCP_EXTENSION_ID, saa selv hvis
 *    noget alligevel forbandt, ville det blive afvist.
 *
 * ## Brug
 *
 *   node scripts/flow-isoleret.mjs            # henter browseren foerste gang
 *   node scripts/flow-isoleret.mjs --behold   # lad browseren koere bagefter (fejlsoegning)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROD = dirname(dirname(fileURLToPath(import.meta.url)));
const krav = createRequire(join(ROD, 'mcp-server', 'index.js'));
const WebSocket = krav('ws');

// ⛔ MAALT 23/9: her stod en FAST port. Koerer to koersler efter hinanden, naar den forrige
// browser ikke altid at doe foerst - saa kan den nye ikke tage porten, og vi spoerger den
// DOEENDE instans, som ingen udvidelse har. Fejlen kom ud som «udvidelsen blev ikke
// indlaest», og det passede: bare ikke om den browser vi lige havde startet.
// Forklarer moenstret praecis: foerste koersel virker, de naeste fejler.
const CDP_PORT = 19340 + Math.floor(Math.random() * 400);
const PORTE = '19900-19904';       // aldrig 9876-9895: det er menneskets eget spaend
const BEHOLD = process.argv.includes('--behold');
const SPAERRE = process.argv.includes('--spaerre');
const UDVIDELSENS_NAVN = 'Agent360 Browser MCP';

/** Finder Chrome for Testing, og henter den hvis den mangler. */
function findBrowser() {
  const rod = join(ROD, 'chrome');
  const find = () => {
    if (!existsSync(rod)) return null;
    for (const d of readdirSync(rod)) {
      const p = join(rod, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app',
        'Contents', 'MacOS', 'Google Chrome for Testing');
      if (existsSync(p)) return p;
      const linux = join(rod, d, 'chrome-linux64', 'chrome');
      if (existsSync(linux)) return linux;
    }
    return null;
  };
  let p = find();
  if (p) return p;
  console.log('Henter Chrome for Testing (~360 MB, én gang)...');
  const r = spawnSync('npx', ['--yes', '@puppeteer/browsers', 'install', 'chrome@stable'],
    { cwd: ROD, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('kunne ikke hente Chrome for Testing');
  p = find();
  if (!p) throw new Error('hentede Chrome for Testing, men fandt den ikke bagefter');
  return p;
}

/** Ét CDP-kald mod et target, og svaret tilbage. */
function cdp(url, metode, params = {}, ms = 8000) {
  return new Promise((ok, fejl) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { try { ws.close(); } catch {} fejl(new Error(`${metode}: ingen svar`)); }, ms);
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: metode, params })));
    ws.on('message', (m) => {
      const r = JSON.parse(m.toString());
      if (r.id !== 1) return;
      clearTimeout(t); try { ws.close(); } catch {}
      r.error ? fejl(new Error(r.error.message)) : ok(r.result);
    });
    ws.on('error', (e) => { clearTimeout(t); fejl(e); });
  });
}

const vent = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  return r.json();
}

/**
 * ⛔ Finder VORES service worker ved at spoerge om navnet. Et target er ikke vores fordi
 * url'en indeholder «background» - det var fejlen 19/9, hvor Chromes egen betalings-
 * udvidelse blev taget for vores og hele konklusionen byggede paa den.
 */
async function vorosServiceWorker() {
  for (const t of (await targets()).filter((t) => t.type === 'service_worker')) {
    try {
      // ⛔ MAALT 23/9: her stod standard-taalmodigheden paa 8 sekunder. Chromes EGNE
      // udvidelser (Hangouts, google.com, Docs Offline) svarer nogle gange slet ikke, og tre
      // tavse maal aad derfor hele soegningens budget paa 20 s - foer vores egen blev spurgt.
      // Vores udvidelse ER der: maalt dukker den op efter ~4 s. Fejlen «udvidelsen blev ikke
      // indlaest» var altsaa min egen soegning der loeb toer, ikke browseren.
      const r = await cdp(t.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: 'chrome.runtime.getManifest().name', returnByValue: true,
      }, 2500);
      if (r?.result?.value === UDVIDELSENS_NAVN) {
        return { ...t, id: t.url.split('/')[2] };
      }
    } catch { /* et target der ikke svarer, er ikke vores */ }
  }
  return null;
}

async function main() {
  const browser = findBrowser();
  const d = mkdtempSync(join(tmpdir(), 'bmcp-isoleret-'));
  cpSync(join(ROD, 'extension'), join(d, 'ext'), { recursive: true });

  console.log(`Browser:  ${browser.split('/').slice(-1)[0]}`);
  console.log(`Profil:   ${d}`);
  console.log(`Porte:    ${PORTE}  (menneskets eget spaend 9876-9895 roeres ikke)\n`);

  const chrome = spawn(browser, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${join(d, 'profil')}`, `--load-extension=${join(d, 'ext')}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
    // ⛔ MAALT 23/9, roden efter syv fejlspor: udvidelsens probe mod 127.0.0.1 HANG - ikke
    // langsomt, men uendeligt, afbrudt af vores egen frist uanset om den stod paa 400 eller
    // 2000 ms. Serveren svarer 426 paa 8 ms maalt fra Node, saa den var uskyldig.
    // Chrome behandler kald til lokalnetvaerket FRA ET DOKUMENT saerskilt og kan kraeve en
    // tilladelse. Offscreen-dokumentet er et dokument - og i en browser uden vindue kan den
    // dialog ikke vises, saa kaldet venter for evigt. Det forklarer baade haengningen og at
    // den kun rammer headless: rigtige brugere med et vindue ser den aldrig.
    '--disable-features=BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults',
    'about:blank',
  ], { stdio: 'ignore' });

  let server = null;
  const ryd = () => {
    if (server) { try { server.kill(); } catch {} }
    if (!BEHOLD) {
      try { chrome.kill(); } catch {}
      try { rmSync(d, { recursive: true, force: true }); } catch {}
    }
  };
  process.on('exit', ryd);
  process.on('SIGINT', () => { ryd(); process.exit(130); });

  // 1 · vent paa VORES udvidelse, og kun vores
  // ⛔ Og efterproev at fejlfindings-porten svarer den browser VI startede. Svarer en fremmed,
  // er alt hvad vi maaler bagefter om en anden proces.
  let egen = false;
  for (let i = 0; i < 20 && !egen; i++) {
    await vent(500);
    try { egen = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()) != null; } catch { /* ikke oppe endnu */ }
  }
  if (!egen) {
    console.error(`⛔ Browserens fejlfindings-port ${CDP_PORT} svarede ikke paa 10 s.`);
    process.exit(1);
  }

  // Frist paa UR, ikke paa antal forsoeg: et forsoeg kan tage alt fra 0,1 til 8 sekunder,
  // saa «40 forsoeg» er ikke en tid - det var derfor budgettet kunne loebe toer uset.
  let sw = null;
  const frist = Date.now() + 60000;
  while (!sw && Date.now() < frist) { await vent(500); try { sw = await vorosServiceWorker(); } catch {} }
  if (!sw) {
    console.error('⛔ Udvidelsen blev ikke indlaest. Det er ikke det samme som at den ikke KAN:');
    console.error('   maal foerst om browseren er Chrome for Testing - Google Chrome har fjernet');
    console.error('   --load-extension, og dét var fejlen bag den gamle «virker ikke»-note.');
    process.exit(1);
  }
  console.log(`✓ Vores udvidelse indlaest: ${sw.id}`);

  // 2 · flyt dens portomraade, og genskab offscreen saa det traeder i kraft
  // ⛔ Det er ikke nok at lukke dokumentet: `ensureOffscreen()` kaldes ved indlaesning og
  // ved onStartup, og ingen af delene sker igen naar vi selv lukker det. Uden det genskabes
  // broen aldrig, og porten skannes af ingen. Vi kalder den derfor selv - den er global i
  // servicearbejderen.
  await cdp(sw.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression: `chrome.storage.local.set({ bmcpPorte: '${PORTE}' })
      .then(() => chrome.offscreen.closeDocument().catch(() => {}))
      .then(() => new Promise(r => setTimeout(r, 300)))
      .then(() => ensureOffscreen())
      .then(() => 'ok')`,
    awaitPromise: true, returnByValue: true,
  });
  await vent(1500);

  // Efterproev at dokumentet FAKTISK bar det nye spaend med. En tavs genskabelse uden
  // `porte=` ville skanne 9876-9895 - altsaa menneskets eget, hvilket er hele det vi undgaar.
  const doks = (await targets()).filter((t) => t.url.includes('offscreen.html'));
  const medSpaend = doks.filter((t) => t.url.includes(`porte=${PORTE}`));
  if (!medSpaend.length) {
    console.error(`⛔ Offscreen-dokumentet blev genskabt UDEN porte=${PORTE}: `
      + (doks.map((t) => t.url).join(', ') || 'intet dokument'));
    console.error('   Uden det ville koerslen skanne menneskets eget spaend 9876-9895.');
    process.exit(1);
  }
  console.log(`✓ Offscreen-dokumentet koerer paa ${PORTE}`);

  // 3 · serveren, bundet til netop denne udvidelse
  const [fra, til] = PORTE.split('-');
  server = spawn(process.execPath, [join(ROD, 'mcp-server', 'index.js')], {
    env: { ...process.env, BROWSER_MCP_BASE_PORT: fra, BROWSER_MCP_MAX_PORT: til,
      BROWSER_MCP_EXTENSION_ID: sw.id, BROWSER_MCP_TOKEN: '' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let log = '';
  server.stderr.on('data', (b) => { log += b.toString(); });
  const skriv = (o) => server.stdin.write(JSON.stringify(o) + '\n');
  skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05',
    capabilities: {}, clientInfo: { name: 'flow-isoleret', version: '0' } } });
  // ⛔ MAALT 23/9: her stod en ventetid UDEN graense. Svarede serveren aldrig paa stdout,
  // hang hele spaerren for evigt - maalt tre gange, senest 54 minutter midt i en udgivelse,
  // med 23 efterladte browsere. Og fordi den hang FOER `run.mjs` blev startet, saa loggen ud
  // som om spaerren koerte. En vagt der kan haenge, er ikke en vagt - den er en blokering
  // uden fejlmelding.
  const svarede = await Promise.race([
    new Promise((ok) => server.stdout.once('data', () => ok(true))),
    vent(20000).then(() => false),
  ]);
  if (!svarede) {
    console.error('⛔ Serveren svarede ikke paa 20 s. Spaerren stopper hellere end at haenge.');
    console.error(log.split('\n').slice(-6).join('\n'));
    process.exit(1);
  }
  // ⛔ Draen resten. Uden det hobede serverens svar sig op i roeret, og en server der
  // ikke kan skrive, kan heller ikke svare - saa udvidelsens probe hang til sin graense.
  server.stdout.on('data', () => {});
  skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
  skriv({ jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'browser_list_tabs', arguments: {} } });

  // ⛔ MAALT 22/9: den her forbindelse er FLAKKENDE - ca. 1 ud af 3 koersler naaede den ikke.
  // Roden er lokaliseret, ikke loest: udvidelsen finder levende porte med et HTTP-kald
  // (se offscreen.js' lange note om Chromes WebSocket-bremse), og i headless Chrome HAENGER
  // det kald nogle gange - det svarer hverken ja eller nej, saa skanningen ser aldrig porten.
  // Maalt ved at koere kaldet direkte i servicearbejderen: intet svar paa 10 s.
  //
  // Indtil roden er fundet, nudger vi skanningen og giver den laengere tid. Det er en
  // OMGAAELSE, ikke en rettelse, og den staar her saa den ikke bliver forvekslet med en.
  // Falder den alligevel, er det en gate - ikke et tilbagefald til menneskets skaerm.
  for (let runde = 0; runde < 3 && !/extension connected/i.test(log); runde++) {
    for (let i = 0; i < 40 && !/extension connected/i.test(log); i++) await vent(500);
    if (/extension connected/i.test(log)) break;
    console.log(`  (forbindelsen udeblev - genskaber broen, forsoeg ${runde + 2} af 3)`);
    try {
      await cdp(sw.webSocketDebuggerUrl, 'Runtime.evaluate', {
        expression: `chrome.offscreen.closeDocument().catch(() => {})
          .then(() => new Promise(r => setTimeout(r, 500)))
          .then(() => ensureOffscreen()).then(() => 'ok')`,
        awaitPromise: true, returnByValue: true,
      }, 15000);
    } catch (e) { /* servicearbejderen kan sove; naeste runde proever igen */ }
  }
  if (!/extension connected/i.test(log)) {
    // ⛔ En fejlmelding der bare siger «forbandt ikke» tvinger den naeste til at gaette. Her
    // spoerges broen selv, saa fejlen forklarer sig: hvilket spaend den skanner, om skanningen
    // staar laast, og hvad en probe mod den KENDT levende port faktisk svarer.
    try {
      const off = (await targets()).find((t) => t.url.includes('offscreen.html'));
      if (off?.webSocketDebuggerUrl) {
        const spoerg = async (x) => {
          try {
            const r = await cdp(off.webSocketDebuggerUrl, 'Runtime.evaluate',
              { expression: x, awaitPromise: true, returnByValue: true }, 8000);
            return r?.result?.value;
          } catch (e) { return 'kunne ikke spoerge: ' + e.message; }
        };
        console.error('   broens egen tilstand:');
        console.error(`     spaend        : ${await spoerg('BASE_PORT + "-" + MAX_PORT')}`);
        console.error(`     skanner-laast : ${await spoerg('String(skanner)')}`);
        console.error(`     forbindelser  : ${await spoerg('connections.size')}`);
        console.error(`     probe mod ${fra}: ${await spoerg(`(async()=>{const t=Date.now();const r=await harServer(${fra});return r+" efter "+(Date.now()-t)+" ms"})()`)}`);
        console.error(`     noegle-tilstand: ${await spoerg('typeof noegleTilstand !== "undefined" ? noegleTilstand : "(ukendt)"')}`);
      } else {
        console.error('   ⛔ offscreen-dokumentet findes slet ikke laengere - broen er vaek.');
      }
    } catch (e) { console.error('   (kunne ikke laese broens tilstand: ' + e.message + ')'); }
    console.error('⛔ Udvidelsen forbandt ikke til den isolerede server paa 3 forsoeg (~60 s).');
    console.error('   Kendt flakiness - se noten ovenfor. Roden er den haengende HTTP-probe.');
    console.error(log.split('\n').slice(-8).join('\n'));
    process.exit(1);
  }
  const port = (log.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/) || [])[1];
  console.log(`✓ Udvidelsen forbundet paa port ${port}\n`);
  if (!SPAERRE) {
    console.log('Koer spaerren mod den med:');
    console.log(`  BROWSER_MCP_BASE_PORT=${fra} BROWSER_MCP_MAX_PORT=${til} \\`);
    console.log(`  BROWSER_MCP_EXTENSION_ID=${sw.id} npm --prefix mcp-server run flow\n`);
    if (BEHOLD) { console.log('--behold: browseren koerer videre. Ctrl-C for at lukke.'); await new Promise(() => {}); }
    return;
  }

  // ⛔ MAALT 22/9: kontrol-serveren skal VAEK foer spaerren starter. run.mjs starter sin EGEN
  // server i samme portomraade, og udvidelsen forbinder til alle servere den finder - saa to
  // servere konkurrerede om den, og den ene var en zombie ingen laeste fra. Det var én af
  // aarsagerne til at forbindelsen svigtede i 3 af 4 koersler. Kontrol-serverens eneste job
  // er at bevise at broen virker, og det har den gjort paa dette tidspunkt.
  try { server.kill(); } catch {}
  server = null;
  await vent(1500);

  // ⛔ Spaerren skal koere UDEN FLOW_KUN_BAGGRUND: hele pointen er at de 12 fokus-kraevende
  // vaerktoejer maales. Den maa ikke arves fra skallen, for saa springer de over igen og
  // koerslen ville se groen ud uden at have maalt det den blev bygget til.
  const miljoe = { ...process.env, BROWSER_MCP_BASE_PORT: fra, BROWSER_MCP_MAX_PORT: til,
    BROWSER_MCP_EXTENSION_ID: sw.id };
  delete miljoe.FLOW_KUN_BAGGRUND;
  delete miljoe.FLOW_VINDUE_X;
  console.log('── Flow-spaerren, isoleret ' + '─'.repeat(44) + '\n');
  const kode = await new Promise((ok) => {
    const f = spawn(process.execPath, [join(ROD, 'test', 'flow', 'run.mjs')],
      { env: miljoe, stdio: 'inherit', cwd: join(ROD, 'mcp-server') });
    f.on('exit', (c) => ok(c ?? 1));
  });
  process.exitCode = kode;
}

main().catch((e) => { console.error('⛔', e.message); process.exit(1); });
