#!/usr/bin/env node
// optag.mjs - deterministisk billede-for-billede-optagelse af en CSS-animeret side. Alle animationer pauses og sættes til
// samme tid via Web Animations API, saa en skaerm der ikke noegensinde koerer i realtid giver et frame-noejagtigt klip.
// Brug: node optag.mjs <html> <ud-mappe> [--w 1920] [--h 1080] [--sek 16] [--fps 30] [--ved 2,5,9,13]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname, resolve } from 'node:path';
// ws kommer fra mcp-server (npm ci der); Chrome fra $CHROME eller macOS' standardplacering.
const rod = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const WebSocket = createRequire(join(rod, 'mcp-server/index.js'))('ws');
const CH = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const a = process.argv.slice(2);
const arg = (n, d) => { const i = a.indexOf(n); return i > -1 ? a[i + 1] : d; };
const [fil, ud] = a; const W = +arg('--w', 1920), H = +arg('--h', 1080), SEK = +arg('--sek', 16), FPS = +arg('--fps', 30);
mkdirSync(ud, { recursive: true });
const PORT = 19900 + Math.floor(Math.random() * 90);
const proc = spawn(CH, [/headless-shell/.test(CH) ? '--headless' : '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/optag-${PORT}`, 'about:blank'], { stdio: 'ignore' });
const vent = (ms) => new Promise((r) => setTimeout(r, ms));
let mål; for (let i = 0; i < 50 && !mål; i++) { try { mål = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch {} if (!mål) await vent(200); }
const ws = new WebSocket(mål.webSocketDebuggerUrl); await new Promise((r) => ws.on('open', r));
let id = 0; const af = new Map();
ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && af.has(d.id)) { af.get(d.id)(d); af.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; af.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const nav = await send('Page.navigate', { url: pathToFileURL(resolve(fil)).href }); await vent(1200);
if (nav.result?.errorText) throw new Error('Kunne ikke aabne ' + fil + ': ' + nav.result.errorText);
await send('Runtime.evaluate', { expression: 'document.getAnimations().forEach(x=>x.pause()); document.getAnimations().length' });
const VED = arg('--ved', null)?.split(',').map(Number);
const n = VED ? VED.length : SEK * FPS;
for (let f = 0; f < n; f++) {
  const t = VED ? VED[f] * 1000 : (f / FPS) * 1000;
  await send('Runtime.evaluate', { expression: `document.getAnimations().forEach(x=>{x.currentTime=${t}}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`, awaitPromise: true });
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
  writeFileSync(VED ? `${ud}/t${VED[f]}.jpg` : `${ud}/f${String(f).padStart(4, '0')}.jpg`, Buffer.from(r.result.data, 'base64'));
  if (f % 60 === 0) process.stdout.write(`${f}/${n} `);
}
ws.close(); proc.kill(); console.log('\nfaerdig', n, 'billeder');
