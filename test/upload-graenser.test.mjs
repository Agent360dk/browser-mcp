/**
 * Upload: det der sendes til Chrome skal vaere én almindelig fil inden for arbejdsmappen.
 *
 * MAALT 10/9 af Astra (tredje runde):
 *   - en MAPPE blev godkendt ud fra mappens egen sti, men Chrome gennemloeber mappen og foelger links
 *     i den (webkitdirectory) - bundle/key -> ~/.ssh/id_rsa kom med.
 *   - en HARDLINK inde i mappen er samme fil som en fil udenfor; realpath kan ikke se forskel.
 *   - aliaserne file og file_path blev lagt SAMMEN, saa et kald med begge sendte to filer.
 *
 * En falsk udvidelse (samme Origin som Chrome) optager hvad serveren faktisk sender videre,
 * saa de positive tilfaelde beviser det der sendes - ikke blot at en fejltekst udeblev.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const { WebSocket } = createRequire(new URL('../mcp-server/package.json', import.meta.url))('ws');
const BASE = 19965, MAX = 19969;

const arbejd = mkdtempSync(join(tmpdir(), 'bmcp-up2-'));
const udenfor = mkdtempSync(join(tmpdir(), 'bmcp-up2-ude-'));
writeFileSync(join(udenfor, 'hemmelig.txt'), 'NOEGLE');
mkdirSync(join(arbejd, 'bundle'));
symlinkSync(join(udenfor, 'hemmelig.txt'), join(arbejd, 'bundle', 'key'));
linkSync(join(udenfor, 'hemmelig.txt'), join(arbejd, 'haard.txt'));
writeFileSync(join(arbejd, 'egen.txt'), 'OK');
writeFileSync(join(arbejd, 'anden.txt'), 'OK2');

const boern = [], sokler = [];
after(() => {
  for (const s of sokler) try { s.terminate(); } catch {}
  for (const b of boern) try { b.kill('SIGKILL'); } catch {}
  rmSync(arbejd, { recursive: true, force: true }); rmSync(udenfor, { recursive: true, force: true });
});

function upload(args) {
  const sendt = [];
  let stop = false;
  const ring = () => {
    if (stop) return;
    for (let p = BASE; p <= MAX; p++) {
      const ws = new WebSocket(`ws://127.0.0.1:${p}`, { origin: 'chrome-extension://' + 'b'.repeat(32) });
      ws.on('error', () => {});
      ws.on('open', () => { sokler.push(ws); ws.send(JSON.stringify({ type: 'hello', extensionId: 'b'.repeat(32), version: '1.29.0', name: 'falsk' })); });
      ws.on('message', (d) => {
        let m; try { m = JSON.parse(d); } catch { return; }
        if (m.id === undefined) return;
        if (m.method === 'upload_file') sendt.push(m.params);
        ws.send(JSON.stringify({ id: m.id, result: { ok: true } }));
      });
    }
    setTimeout(ring, 400);
  };
  const p = spawn(process.execPath, [SRV], { cwd: arbejd, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER_MCP_BASE_PORT: String(BASE), BROWSER_MCP_MAX_PORT: String(MAX) } });
  boern.push(p); p.stderr.on('data', () => {});
  ring();
  let buf = '';
  return new Promise((res) => {
    const slut = (svar) => { stop = true; p.kill('SIGKILL'); res({ svar, sendt }); };
    const ur = setTimeout(() => slut('TIMEOUT'), 40000);
    p.stdout.on('data', (d) => {
      buf += d;
      for (const l of buf.split('\n')) { let m; try { m = JSON.parse(l); } catch { continue; } if (m.id === 2) { clearTimeout(ur); slut(JSON.stringify(m)); } }
    });
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_upload_file', arguments: { selector: 'input', ...args } } }) + '\n');
  });
}

test('positiv kontrol: en almindelig fil sendes videre som sin loeste sti', { timeout: 45000 }, async () => {
  const { svar, sendt } = await upload({ files: ['egen.txt'] });
  assert.equal(sendt.length, 1, `intet naaede udvidelsen: ${svar.slice(0, 200)}`);
  assert.deepEqual(sendt[0].files, [realpathSync.native(join(arbejd, 'egen.txt'))]);
});

test('en mappe afvises - Chrome ville foelge links inde i den', { timeout: 45000 }, async () => {
  const { svar, sendt } = await upload({ files: ['bundle'] });
  assert.equal(sendt.length, 0, `mappen blev sendt videre: ${JSON.stringify(sendt)}`);
  assert.match(svar, /ikke en almindelig fil/);
});

test('en hardlink til en fil udenfor afvises', { timeout: 45000 }, async () => {
  const { svar, sendt } = await upload({ files: ['haard.txt'] });
  assert.equal(sendt.length, 0, `hardlinken blev sendt videre: ${JSON.stringify(sendt)}`);
  assert.match(svar, /hardlink/);
});

test('file og file_path laegges ikke sammen - den foerste vinder, som foer', { timeout: 45000 }, async () => {
  const { svar, sendt } = await upload({ file: 'egen.txt', file_path: 'anden.txt' });
  assert.equal(sendt.length, 1, `intet naaede udvidelsen: ${svar.slice(0, 200)}`);
  assert.equal(sendt[0].files.length, 1, `to filer blev sendt: ${JSON.stringify(sendt[0].files)}`);
  assert.equal(sendt[0].files[0], realpathSync.native(join(arbejd, 'egen.txt')));
});
