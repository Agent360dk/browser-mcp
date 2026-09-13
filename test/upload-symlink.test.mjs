/**
 * Upload-vagten skal se hvad en sti PEGER paa, ikke kun hvordan den ser ud.
 *
 * MAALT 10/9 af Astra: vagten var leksikalsk. Et symlink inde i arbejdsmappen der peger ud af
 * den - fx `noegle -> ~/.ssh/id_rsa` - passerede, fordi stien saa rigtig ud som tekst. Og upload
 * er netop dér hvor filen forlader maskinen. Testen starter en aegte server i en midlertidig
 * mappe; vagten svarer foer serveren overhovedet roerer en port eller en browser.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const arbejd = mkdtempSync(join(tmpdir(), 'bmcp-upload-'));
const udenfor = mkdtempSync(join(tmpdir(), 'bmcp-udenfor-'));
writeFileSync(join(udenfor, 'hemmelig.txt'), 'NOEGLE');
symlinkSync(join(udenfor, 'hemmelig.txt'), join(arbejd, 'noegle'));
// link -> <udenfor>/dir, saa link/../hemmelig.txt ER <udenfor>/hemmelig.txt for operativsystemet
mkdirSync(join(udenfor, 'dir'));
symlinkSync(join(udenfor, 'dir'), join(arbejd, 'link'));
symlinkSync(join(udenfor, 'findes-ikke-endnu.txt'), join(arbejd, 'dinglende'));
writeFileSync(join(arbejd, 'egen.txt'), 'OK');
const boern = [];
after(() => { for (const b of boern) try { b.kill('SIGKILL'); } catch {}
  rmSync(arbejd, { recursive: true, force: true }); rmSync(udenfor, { recursive: true, force: true }); });

function kald(filer, ms = 35000) {
  const p = spawn(process.execPath, [SRV], { cwd: arbejd, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER_MCP_BASE_PORT: '19960', BROWSER_MCP_MAX_PORT: '19964' } });
  boern.push(p); p.stderr.on('data', () => {});
  let buf = '';
  return new Promise((res) => {
    const ur = setTimeout(() => res('TIMEOUT'), ms);
    p.stdout.on('data', (d) => {
      buf += d;
      for (const l of buf.split('\n')) { let m; try { m = JSON.parse(l); } catch { continue; }
        if (m.id === 2) { clearTimeout(ur); res(JSON.stringify(m)); } }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'browser_upload_file', arguments: { selector: 'input', files: filer } } }) + '\n');
  });
}

test('et symlink inde i arbejdsmappen der peger ud, afvises', { timeout: 40000 }, async () => {
  const svar = await kald(['noegle']);
  assert.match(svar, /peger udenfor/, `symlinket slap forbi vagten: ${svar.slice(0, 200)}`);
});

test('en sti med ../ ud af arbejdsmappen afvises stadig', { timeout: 40000 }, async () => {
  const svar = await kald(['../../etc/hosts']);
  assert.match(svar, /peger udenfor/);
});

// MAALT 10/9 af Astra (anden runde), reproduceret paa maskinen: resolve() fjernede "link/.." som
// tekst, og Node's realpathSync gav ENOENT -> den leksikalske sti blev godkendt, mens filen der
// faktisk blev laest laa udenfor.
test('link/../fil afvises - stien loeses af operativsystemet, ikke som tekst', { timeout: 40000 }, async () => {
  const svar = await kald(['link/../hemmelig.txt']);
  assert.match(svar, /peger udenfor/, `slap forbi vagten: ${svar.slice(0, 200)}`);
});

test('et dinglende symlink ud af mappen afvises', { timeout: 40000 }, async () => {
  const svar = await kald(['dinglende']);
  assert.match(svar, /findes ikke|peger udenfor/, `slap forbi vagten: ${svar.slice(0, 200)}`);
});

// Positiv kontrol: uden den ville en vagt der afviser ALT bestaa alle testene ovenfor.
test('en rigtig fil i mappen afvises IKKE - heller ikke skrevet med store bogstaver', { timeout: 40000 }, async (t) => {
  const variant = join(dirname(arbejd), basename(arbejd).toUpperCase(), 'egen.txt');
  if (!existsSync(variant)) return t.skip('filsystemet skelner store og smaa bogstaver');
  const svar = await kald([variant], 20000);
  assert.doesNotMatch(svar, /peger udenfor|findes ikke/, `en lovlig fil blev afvist: ${svar.slice(0, 200)}`);
});
