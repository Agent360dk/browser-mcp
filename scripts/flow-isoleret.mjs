#!/usr/bin/env node
/**
 * ⚠️ VIRKER IKKE - og den foerste aarsag jeg skrev her var FORKERT. Laes begge dele.
 *
 * MAALT og virker: serveren kan bindes til ét udvidelses-id med `BROWSER_MCP_EXTENSION_ID`,
 * og Gustavs egen udvidelse bliver saa aktivt lukket ude (set i loggen: «Afviser udvidelse
 * nggfamghkbkjjpooipchhehabjkgicim»). Selve isolations-mekanikken er bevist.
 *
 * ⛔ **Rettelse 19/9, samme aften.** Foerste udgave af dette hoved sagde at `--load-extension`
 * giver en `background_page`-kontekst hvor `chrome.offscreen` er `undefined`, og at broen
 * derfor ikke kan starte. **Det var maalt paa den forkerte udvidelse.** Mit filter greb det
 * foerste CDP-target med «background» i url'en, og det var Chromes egen betalings-udvidelse.
 *
 * Den rigtige maaling: i en frisk profil med `--load-extension` er der 2-4 udvidelses-targets,
 * og de er ALLE Chromes egne - «Betalinger i Chrome Webshop», «Google Hangouts», «Google
 * Network Speech», «Google Docs Offline». **Vores er slet ikke ét af dem.** Udvidelsen bliver
 * altsaa aldrig indlaest. Hverken med `--disable-features=DisableLoadExtensionCommandLineSwitch`
 * eller med `--disable-extensions-except`.
 *
 * Og det modsatte af det jeg foerst skrev er sandt: to af Chromes egne er MV3 med
 * `chrome.offscreen` som **object** i samme headless-koersel. Headless er fint. MV3 er fint.
 * Offscreen er fint. Det er indlaesningen der ikke sker.
 *
 * Konsekvens: udvidelses-id'et scriptet «fandt» og bandt serveren til, var Chromes eget.
 * Isolationen virkede, men den isolerede den forkerte ting.
 *
 * Vejen der ikke er proevet: installér udvidelsen i en fast profil ÉN gang via
 * chrome://extensions (kan ikke skriptes - chrome:// er spaerret for baade CDP og os), og lad
 * scriptet genbruge den profil. Kraever et menneske én gang, eller UI-automatisering med
 * skriveadgang. computer-mcp koerer readonly her.
 *
 * Indtil da koeres flow-spaerren mod den rigtige Chrome - og derfor foer en udgivelse,
 * ikke efter hver commit.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CDP = 9333;                       // ikke i 9876-9895; det er vores egne porte
const profil = mkdtempSync(join(tmpdir(), 'bmcp-flow-profil-'));

const log = (s) => process.stdout.write(s + '\n');

async function cdp(sti) {
  const r = await fetch(`http://127.0.0.1:${CDP}/json/${sti}`);
  return r.json();
}

/** Venter paa at Chrome svarer paa fejlfinder-porten. */
async function venterPaaChrome(ms = 15000) {
  const slut = Date.now() + ms;
  while (Date.now() < slut) {
    try { await cdp('version'); return true; } catch { /* ikke oppe endnu */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/** Finder udvidelsens id ud af dens egne targets. */
async function udvidelsesId(ms = 20000) {
  const slut = Date.now() + ms;
  while (Date.now() < slut) {
    const t = await cdp('list').catch(() => []);
    const m = t.map((x) => String(x.url || '')).find((u) => u.startsWith('chrome-extension://'));
    if (m) return m.slice('chrome-extension://'.length).split('/')[0];
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

log(`→ starter en isoleret Chrome (${process.argv.includes('--synlig') ? 'synlig' : 'headless'}, egen profil, din browser roeres ikke)`);
// --headless=new er standard: saa ser brugeren INTET. Chrome leverer Input.* i headless,
// fordi der ikke er en vinduesmanager der skal give fokus foerst - praecis den begraensning
// der goer den synlige koersel forstyrrende. Virker en proeve ikke headless, koer med
// `--synlig` og se den.
const synlig = process.argv.includes('--synlig');
const chrome = spawn(CHROME, [
  ...(synlig ? [] : ['--headless=new']),
  `--user-data-dir=${profil}`,
  `--load-extension=${join(rod, 'extension')}`,
  `--remote-debugging-port=${CDP}`,
  '--no-first-run', '--no-default-browser-check',
  // Chrome 137+ slaar `--load-extension` fra af sikkerhedshensyn; flaget her aabner den
  // igen. Uden det indlaeses udvidelsen, men koeres ikke - og saa forbinder broen aldrig.
  '--disable-features=ChromeWhatsNewUI,DisableLoadExtensionCommandLineSwitch',
  // En rigtig side, ikke about:blank: service workeren skal vaekkes for at broen aabner.
  'https://example.com/',
], { stdio: 'ignore', detached: false });

let kode = 1;
try {
  if (!await venterPaaChrome()) throw new Error('Chrome svarede ikke paa fejlfinder-porten');
  const id = await udvidelsesId();
  if (!id) throw new Error('udvidelsen blev ikke indlaest i test-profilen');
  log(`→ udvidelsen er indlaest som ${id}`);

  // Isolationen sker med `BROWSER_MCP_EXTENSION_ID`. Test-profilen indlaeser udvidelsen fra
  // repoets sti og faar derfor et ANDET id end den kopi Chrome koerer i din egen profil.
  // Serveren lukker enhver udvidelse der ikke er den pinnede (index.js:281), saa din browser
  // melder sig forgaeves og bliver ikke styret.
  //
  // Foerste to forsoeg gik gennem parringsnoeglen i stedet: den skulle skrives i test-profilens
  // storage, og hverken popup-siden (chrome.storage undefined saa tidligt) eller service
  // workeren (ikke listet af /json/list) var til at naa. Pinning loeser det samme uden at
  // skrive noget som helst - og er en funktion der allerede er proevet.
  log(`→ serveren bindes til ${id} - din egen udvidelse lukkes ude`);

  if (process.argv.includes('--kun-forbind')) {
    // Kort proeve: forbinder udvidelsen overhovedet i denne profil? Den koerer ingen
    // muse- eller tastehaendelser og aabner ingen faner, saa den forstyrrer mindst muligt.
    const { spawn: spawn2 } = await import('node:child_process');
    const srv = spawn2(process.execPath, [join(rod, 'mcp-server/index.js')], {
      env: { ...process.env, BROWSER_MCP_EXTENSION_ID: id }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let fejl = '';
    srv.stderr.on('data', (d) => { fejl += d.toString(); });
    const skriv = (o) => srv.stdin.write(JSON.stringify(o) + '\n');
    skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } });
    await new Promise((ok) => srv.stdout.once('data', ok));
    skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
    skriv({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });
    await new Promise((r) => setTimeout(r, 40000));
    srv.kill();
    const forbandt = /extension connected/.test(fejl);
    log(forbandt ? '✓ udvidelsen FORBANDT i den isolerede profil' : '✗ udvidelsen forbandt IKKE');
    const afvist = (fejl.match(/Afviser udvidelse (\S+)/g) || []);
    if (afvist.length) log('  (og din egen udvidelse blev lukket ude: ' + afvist[0] + ')');
    kode = forbandt ? 0 : 3;
    throw { stille: true };
  }

  log('→ koerer flow-spaerren mod den isolerede Chrome\n');
  const r = spawnSync('npm', ['--prefix', join(rod, 'mcp-server'), 'run', 'flow'], {
    stdio: 'inherit',
    env: { ...process.env, BROWSER_MCP_EXTENSION_ID: id },
  });
  kode = r.status ?? 1;
} catch (e) {
  if (!e?.stille) log('✗ ' + (e?.message || e));
} finally {
  try { chrome.kill(); } catch { /* allerede vaek */ }
  try { rmSync(profil, { recursive: true, force: true }); } catch { /* ligeglad */ }
  log('\n→ test-Chrome lukket, profilen slettet. Din egen browser er uroert.');
}
process.exit(kode);
