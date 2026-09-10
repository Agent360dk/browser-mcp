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
import { mkdtempSync, mkdirSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const { WebSocket } = createRequire(new URL('../mcp-server/package.json', import.meta.url))('ws');
const BASE = 19990, MAX = 19994;
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const arbejd = mkdtempSync(join(tmpdir(), 'bmcp-skaerm-'));
const udenfor = mkdtempSync(join(tmpdir(), 'bmcp-skaerm-ude-'));
symlinkSync(udenfor, join(arbejd, 'ud'));                                   // mappe-link ud af arbejdsmappen
symlinkSync(join(udenfor, 'findes-ikke.png'), join(arbejd, 'dinglende.png')); // fil-link til noget der ikke findes endnu
mkdirSync(join(arbejd, 'inde'));

const boern = [];
const sokler = [];
after(() => {
  for (const s of sokler) try { s.terminate(); } catch {}
  for (const b of boern) try { b.kill('SIGKILL'); } catch {}
  rmSync(arbejd, { recursive: true, force: true }); rmSync(udenfor, { recursive: true, force: true });
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

function skaermbillede(sti) {
  const p = spawn(process.execPath, [SRV], { cwd: arbejd, stdio: ['pipe', 'pipe', 'pipe'],
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
  assert.match(svar, /peger udenfor/, `slap forbi vagten: ${svar.slice(0, 240)}`);
  assert.ok(!existsSync(join(udenfor, 'x.png')), 'PNG-bytes blev skrevet uden for arbejdsmappen');
});

test('en sti der selv er et dinglende symlink afvises, og intet skrives udenfor', { timeout: 45000 }, async () => {
  const svar = await skaermbillede('dinglende.png');
  assert.match(svar, /peger udenfor/, `slap forbi vagten: ${svar.slice(0, 240)}`);
  assert.ok(!existsSync(join(udenfor, 'findes-ikke.png')), 'filen blev skabt gennem linket, uden for arbejdsmappen');
});
