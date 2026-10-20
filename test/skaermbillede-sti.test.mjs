/**
 * browser_screenshot({ path }) maa kun skrive inden for arbejdsmappen - ogsaa naar stien gaar gennem et symlink.
 *
 * MAALT 10/9 af Astra (anden runde): vagten var leksikalsk. "ud/x.png" med ud -> en mappe udenfor
 * passerede, fordi stien saa rigtig ud som tekst, og PNG-bytes blev skrevet udenfor. Stien kommer fra
 * en model der laeser fremmede sider.
 *
 * Testen starter en AEGTE server og en falsk udvidelse over WebSocket (samme Origin-header som Chrome
 * saetter), som svarer paa skaermbillede-kaldet med en lille PNG. Saa er det serverens egen skrivevej der proeves.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, symlinkSync, existsSync, rmSync, writeFileSync, linkSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const { WebSocket } = createRequire(new URL('../mcp-server/package.json', import.meta.url))('ws');
// ⛔ Var et FAST spaend, og to samtidige suiter ramte derfor hinanden: den ene koersels
// falske udvidelse besvarede den andens server. Se test/hjaelp/ledigt-spaend.mjs.
const BASE = await ledigtSpaend(5), MAX = BASE + 4;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const arbejd = mkdtempSync(join(tmpdir(), 'bmcp-skaerm-'));
const udenfor = mkdtempSync(join(tmpdir(), 'bmcp-skaerm-ude-'));
symlinkSync(udenfor, join(arbejd, 'ud'));                                   // mappe-link ud af arbejdsmappen
symlinkSync(join(udenfor, 'findes-ikke.png'), join(arbejd, 'dinglende.png')); // fil-link til noget der ikke findes endnu
mkdirSync(join(arbejd, 'inde'));
writeFileSync(join(udenfor, 'vigtig.png'), 'BRUGERENS-FIL');
linkSync(join(udenfor, 'vigtig.png'), join(arbejd, 'haard.png'));   // hardlink: samme fil som en udenfor

const boern = [];
const sokler = [];
after(async () => {
  for (const s of sokler) try { s.terminate(); } catch {}
  // 20/10 (GitHubs Windows-job, run 39471383314): rmSync kom foer et draebt barn havde sluppet mappen - EBUSY paa rmdir.
  // Vent paa at hvert barn er lukket (hoejst 5 s), og lad rmSync proeve igen et par gange.
  await Promise.all(boern.map((b) => new Promise((ok) => {
    if (b.exitCode !== null || b.signalCode !== null) return ok();
    b.once('exit', ok); setTimeout(ok, 5000);
    try { b.kill('SIGKILL'); } catch { ok(); }
  })));
  for (const d of [arbejd, udenfor]) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** Falsk udvidelse: ringer op til spaendet, hilser, og svarer paa hvert kald. */
function falskUdvidelse() {
  let stop = false;
  const proev = () => {
    if (stop) return;
    for (let p = BASE; p <= MAX; p++) {
      const ws = new WebSocket(`ws://127.0.0.1:${p}`, { origin: 'chrome-extension://' + 'a'.repeat(32) });
      ws.on('error', () => {});
      ws.on('open', () => {
        sokler.push(ws);
        ws.send(JSON.stringify({ type: 'hello', extensionId: 'a'.repeat(32), version: '1.29.0', name: 'falsk' }));
      });
      ws.on('message', (d) => {
        let m; try { m = JSON.parse(d); } catch { return; }
        if (m.id === undefined) return;
        const result = m.method === 'screenshot' ? { image: 'data:image/png;base64,' + PNG } : {};
        ws.send(JSON.stringify({ id: m.id, result }));
      });
    }
    setTimeout(proev, 400);
  };
  proev();
  return () => { stop = true; };
}

function skaermbillede(sti, cwd = arbejd) {
  const p = spawn(process.execPath, [SRV], { cwd, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER_MCP_BASE_PORT: String(BASE), BROWSER_MCP_MAX_PORT: String(MAX) } });
  boern.push(p); p.stderr.on('data', () => {});
  const stopUdvidelse = falskUdvidelse();
  let buf = '';
  return new Promise((res) => {
    const ur = setTimeout(() => { stopUdvidelse(); p.kill('SIGKILL'); res('TIMEOUT'); }, 40000);
    p.stdout.on('data', (d) => {
      buf += d;
      for (const l of buf.split('\n')) {
        let m; try { m = JSON.parse(l); } catch { continue; }
        if (m.id === 2) { clearTimeout(ur); stopUdvidelse(); p.kill('SIGKILL'); res(JSON.stringify(m)); }
      }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'browser_screenshot', arguments: { path: sti } } }) + '\n');
  });
}

// Positiv kontrol FOERST: bevis at den falske udvidelse faktisk leverer et billede og serveren skriver.
// Uden den ville en vagt der afviser ALT - eller en udvidelse der aldrig svarer - bestaa testene nedenfor.
test('en almindelig undermappe i arbejdsmappen virker', { timeout: 45000 }, async () => {
  const svar = await skaermbillede('inde/ok.png');
  assert.match(svar, /successfully saved/, `billedet blev ikke gemt: ${svar.slice(0, 240)}`);
  assert.ok(existsSync(join(arbejd, 'inde', 'ok.png')));
});

test('en sti gennem et mappe-symlink ud af arbejdsmappen afvises, og intet skrives udenfor', { timeout: 45000 }, async () => {
  const svar = await skaermbillede('ud/x.png');
  assert.match(svar, /points outside/, `slap forbi vagten: ${svar.slice(0, 240)}`);
  assert.ok(!existsSync(join(udenfor, 'x.png')), 'PNG-bytes blev skrevet uden for arbejdsmappen');
});

test('en sti der selv er et dinglende symlink afvises, og intet skrives udenfor', { timeout: 45000 }, async () => {
  const svar = await skaermbillede('dinglende.png');
  assert.match(svar, /points outside/, `slap forbi vagten: ${svar.slice(0, 240)}`);
  assert.ok(!existsSync(join(udenfor, 'findes-ikke.png')), 'filen blev skabt gennem linket, uden for arbejdsmappen');
});

// Astra, tredje runde: en eksisterende HARDLINK er ikke et symlink, men writeFileSync trunkerer den faelles fil.
test('en hardlink til en fil udenfor overskrives ikke', { timeout: 45000 }, async () => {
  const svar = await skaermbillede('haard.png');
  assert.match(svar, /points outside/, `slap forbi vagten: ${svar.slice(0, 240)}`);
  assert.equal(readFileSync(join(udenfor, 'vigtig.png'), 'utf8'), 'BRUGERENS-FIL', 'filen udenfor blev overskrevet');
});

// MAALT 11/9 (Astra R5 F10, samme klasse): med arbejdsmappen "/" blev praefikset "//", og en sti i en
// almindelig mappe blev afvist som "udenfor".
// Platformens egen rod: "/" paa mac og Linux, "C:\\" (eller hvad drevet nu hedder) paa Windows.
// MAALT 29/9 paa GitHubs Windows-maskine: process.cwd() ligger paa D:, temp-mappen paa C:. Roden skal
// vaere roden af den sti MAALET ligger paa, ikke af den mappe proeven koeres fra.
const roden = parse(arbejd).root;

test('arbejdsmappen "/" afviser ikke en almindelig sti (F10)', { timeout: 45000 }, async () => {
  const maal = join(arbejd, 'inde', 'rod.png');
  // MAALT 19/9: proeven sendte bogstaveligt "/" som arbejdsmappe. Paa Windows er "/" ikke
  // roden af den sti maalet ligger paa (det er "C:\\"), saa vagten afviste med rette, og
  // proeven laeste det som en regression. Egenskaben den maaler - at en ROD som arbejdsmappe
  // ikke maa afvise en almindelig sti under sig - er den samme paa begge platforme; det er
  // kun tegnet for "rod" der er forskelligt.
  const svar = await skaermbillede(maal, roden);
  assert.match(svar, /successfully saved/, `afvist med arbejdsmappe "/": ${svar.slice(0, 240)}`);
  assert.ok(existsSync(maal));
});

// #70 (arasmileska): VS Code starter serveren i «c:\Projects\X», og «C:\Projects\X\shot.png» blev afvist som «points outside»,
// fordi tekst-tjekket skelnede store og smaa bogstaver. Windows' og macOS' standarddiske goer ikke. Proeven koerer kun, hvor
// disken selv er ufoelsom for store og smaa bogstaver (den samme mappe kan naas med den anden stavemaade).
const anden = (sti) => {
  const p = parse(sti);
  const rod = process.platform === 'win32' ? p.root.toLowerCase() : p.root;
  return join(rod, p.dir.slice(p.root.length), p.base.toUpperCase());
};
// Ud fra den rigtige sti (macOS' midlertidige mappe naas ellers gennem /var -> /private/var), saa kun bogstaverne er anderledes.
const arbejdReel = realpathSync.native(arbejd), udenforReel = realpathSync.native(udenfor);
const ufoelsom = existsSync(anden(arbejdReel)) && anden(arbejdReel) !== arbejdReel;
test('#70: en absolut sti med anden bogstavstoerrelse paa arbejdsmappen godtages, hvor disken er ufoelsom', { timeout: 45000, skip: !ufoelsom && 'disken skelner store og smaa bogstaver' }, async () => {
  const maal = join(anden(arbejdReel), 'inde', 'stor.png');
  const svar = await skaermbillede(maal);
  assert.match(svar, /successfully saved/, `afvist paa bogstavstoerrelsen alene: ${svar.slice(0, 240)}`);
  assert.ok(existsSync(join(arbejd, 'inde', 'stor.png')));
});
test('#70 positiv kontrol: anden bogstavstoerrelse aabner ikke for en mappe udenfor', { timeout: 45000, skip: !ufoelsom && 'disken skelner store og smaa bogstaver' }, async () => {
  const svar = await skaermbillede(join(anden(udenforReel), 'stor.png'));
  assert.match(svar, /points outside/, `slap forbi vagten: ${svar.slice(0, 240)}`);
  assert.ok(!existsSync(join(udenfor, 'stor.png')), 'PNG-bytes blev skrevet uden for arbejdsmappen');
});

// R93 (Opus, maalt paa GitHubs Windows): arbejdsmappen hed C:\Users\RUNNER~1\..., stien c:\Users\runneradmin\... - samme mappe
// gennem et 8.3-kortnavn. Paa macOS er /var et link til /private/var. En absolut sti stavet gennem et alias for SELVE
// arbejdsmappen (ikke for noget udenfor) skal godtages; afgoerelsen tages paa de kanoniske stier.
const alias = arbejd !== arbejdReel ? arbejd : null;   // mkdtemp's stavemaade, naar den ikke er den kanoniske
test('#70: en absolut sti gennem et alias for arbejdsmappen (/var, 8.3-kortnavn) godtages', { timeout: 45000, skip: !alias && 'ingen alias-stavemaade paa denne maskine' }, async () => {
  const svar = await skaermbillede(join(alias, 'inde', 'alias.png'), arbejdReel);
  assert.match(svar, /successfully saved/, `afvist paa stavemaaden alene: ${svar.slice(0, 240)}`);
  assert.ok(existsSync(join(arbejdReel, 'inde', 'alias.png')));
});
