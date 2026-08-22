#!/usr/bin/env node
/**
 * Opstart under samtidighed — det instrument der manglede.
 *
 * MAALT 22/8: 116 gruene tests, og ingen af dem kunne se den fejl Gustav faktisk
 * meldte. De maaler at sessioner er ADSKILTE naar de foerst er der. De maaler ikke
 * hvor lang tid der gaar FOER de er der. Den maaling var hele hullet.
 *
 * Foerste maaling (gammel udvidelse, alle 19 porte levende, intet andet i vejen):
 *     efter  4s →  3/19        efter 14s → 13/19
 *     efter  8s →  8/19        efter 22s → 14/19   ← fem kom aldrig
 *
 * Chrome serialiserer WebSocket-haandtryk til samme adresse og laegger en ventetid
 * paa der vokser med antallet af nylige forsoeg. Udvidelsen scanner 20 porte hvert
 * 2. sekund, saa hvert blindt forsoeg puster den ventetid op: chat nr. 8 venter
 * laengere end nr. 2, og nr. 15 kommer maaske aldrig.
 *
 * Koeres mod en RIGTIG Chrome med udvidelsen indlaest — derfor flow-laget og ikke
 * `npm test`. Den er roed indtil fejlen er rettet. Det er meningen: en test der er
 * groen mens fejlen lever, er ikke et instrument.
 *
 *   node test/flow/samtidighed.mjs [--porte N] [--frist SEK] [--krav ANDEL]
 */
import net from 'node:net';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// `ws` bor i mcp-server/node_modules; denne fil ligger i test/flow/, saa den
// almindelige opadgaaende opløsning finder den ikke. Peg direkte paa den.
const krav = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp-server', 'package.json'));
const { WebSocketServer } = krav('ws');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const ØNSKEDE = arg('--porte', 10);
const FRIST = arg('--frist', 10);       // sekunder en ny chat maa vente
const KRAV = arg('--krav', 1.0);        // andel der skal vaere oppe inden fristen

const ledig = (p) => new Promise(r => {
  const s = net.createServer().once('error', () => r(false)).once('listening', () => s.close(() => r(true))).listen(p, '127.0.0.1');
});

const ledige = [];
for (let p = 9876; p <= 9895; p++) if (await ledig(p)) ledige.push(p);
const brug = ledige.slice(0, ØNSKEDE);

if (brug.length < 2) {
  console.error(`FEJL: kun ${brug.length} ledig port. Luk nogle chats og proev igen.`);
  process.exit(2);
}

const t0 = Date.now();
const oppe = new Map();   // port → sekunder til forbindelse
const navn = new Map();   // port → sessionsnavn

for (const port of brug) {
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  wss.on('connection', (ws) => {
    if (!oppe.has(port)) oppe.set(port, (Date.now() - t0) / 1000);
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.type === 'hello') return;
      if (m.id === 1 && m.result?.session) navn.set(port, m.result.session);
    });
    setTimeout(() => ws.send(JSON.stringify({ id: 1, method: 'list_tabs', params: {} })), 500);
  });
}

console.log(`Rejser ${brug.length} samtidige sessioner. Frist: ${FRIST}s.\n`);
for (const t of [2, 5, 10, 15, 22]) {
  await new Promise(r => setTimeout(r, Math.max(0, t * 1000 - (Date.now() - t0))));
  const pct = Math.round(oppe.size / brug.length * 100);
  console.log(`  efter ${String(t).padStart(2)}s → ${String(oppe.size).padStart(2)}/${brug.length} oppe (${pct}%)`);
}

const indenFrist = [...oppe.values()].filter(s => s <= FRIST).length;
const andel = indenFrist / brug.length;
const unikke = new Set(navn.values()).size;

console.log(`\n  oppe inden fristen: ${indenFrist}/${brug.length} (${Math.round(andel * 100)}%)`);
console.log(`  langsomste: ${oppe.size ? Math.max(...oppe.values()).toFixed(1) + 's' : '—'}`);
console.log(`  aldrig oppe: ${brug.length - oppe.size}`);
console.log(`  unikke sessioner: ${unikke}/${navn.size} svar`);

const fejl = [];
if (andel < KRAV) fejl.push(`kun ${Math.round(andel * 100)}% var oppe inden ${FRIST}s (kraevet ${Math.round(KRAV * 100)}%)`);
if (navn.size && unikke !== navn.size) fejl.push(`${navn.size - unikke} session(er) blev delt mellem chats`);

if (fejl.length) { console.log('\n❌ ' + fejl.join('\n❌ ')); process.exit(1); }
console.log('\n✅ alle sessioner oppe inden fristen, hver med sin egen identitet');
process.exit(0);
