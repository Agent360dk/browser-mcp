/**
 * Porten tages ved BRUG - ikke ved opstart. Og en sultet server proever igen.
 *
 * MAALT 7/9-2026 paa Gustavs maskine: 37 koerende servere, alle 20 porte i spaendet
 * optaget, 17 chats helt uden browser. Aarsagen var to ting der forstaerkede hinanden:
 *
 *   1. `createWSS()` stod paa modul-niveau, saa HVER chat tog en port ved opstart -
 *      ogsaa de mange chats der aldrig roerte browseren.
 *   2. Naar spaendet var fuldt, satte serveren `alleePorteOptaget = true` ÉN gang og
 *      proevede aldrig igen. Chattens browser var doed hele dens levetid.
 *
 * Denne test starter AEGTE serverprocesser. De oevrige tests i mappen laeser kildeteksten,
 * og det kan ikke skelne "porten bindes ikke ved opstart" fra "linjen er flyttet".
 *
 * Testen bruger sit EGET portspaend via env, saa den ikke beslaglaegger de rigtige porte
 * og sulter brugerens oevrige chats mens den koerer.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const SRV = fileURLToPath(new URL('../mcp-server/index.js', import.meta.url));
const BASE = 19876, MAX = 19880;          // 5 porte - nok til at fylde spaendet hurtigt
const ENV = { ...process.env, BROWSER_MCP_BASE_PORT: String(BASE), BROWSER_MCP_MAX_PORT: String(MAX) };

const boerneprocesser = [];
const blokke = [];
after(() => {
  for (const p of boerneprocesser) { try { p.kill('SIGKILL'); } catch {} }
  for (const b of blokke) { try { b.close(); } catch {} }
});

const vent = (ms) => new Promise((r) => setTimeout(r, ms));

function lytter(port) {
  return new Promise((res, rej) => {
    const s = net.createServer(() => {});
    s.once('error', rej);
    s.listen(port, '127.0.0.1', () => res(s));
  });
}

function erOptaget(port) {
  return new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => res(false));
  });
}

async function optagne() {
  const ude = [];
  for (let p = BASE; p <= MAX; p++) if (await erOptaget(p)) ude.push(p);
  return ude;
}

function start() {
  const p = spawn(process.execPath, [SRV], { stdio: ['pipe', 'pipe', 'pipe'], env: ENV });
  p.stderr.on('data', () => {});   // serveren skriver diagnostik; testen laeser svarene paa stdout
  boerneprocesser.push(p);
  return p;
}

let n = 0;
function send(p, method, params) {
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) + '\n');
  return n;
}

/** Kalder et browser-vaerktoej og returnerer svarteksten (fejl ELLER resultat). */
function browserKald(p, timeoutMs = 20000) {
  const id = send(p, 'tools/call', { name: 'browser_list_tabs', arguments: {} });
  return new Promise((res) => {
    let buf = '';
    const ur = setTimeout(() => res('TIMEOUT'), timeoutMs);
    p.stdout.on('data', (d) => {
      buf += d;
      for (const linje of buf.split('\n')) {
        if (!linje.trim()) continue;
        let m; try { m = JSON.parse(linje); } catch { continue; }
        if (m.id !== id) continue;
        clearTimeout(ur);
        res(JSON.stringify(m));
      }
    });
  });
}

async function haandtryk(p) {
  send(p, 'initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  await vent(600);
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  await vent(200);
}

test('en server der aldrig bruger browseren tager ingen port', async () => {
  const foer = await optagne();
  const p = start();
  await haandtryk(p);
  await vent(2500);                       // rigeligt: den gamle kode bandt inden for ~50 ms
  assert.deepEqual(await optagne(), foer,
    'serveren tog en port uden at et eneste browser-vaerktoej var kaldt');
});

test('foerste browser-kald tager porten', async () => {
  const foer = await optagne();
  const p = start();
  await haandtryk(p);
  // Skal stadig staa uden port PAA DETTE TIDSPUNKT - ellers maaler resten ingenting.
  await vent(1500);
  assert.deepEqual(await optagne(), foer, 'porten var taget allerede foer kaldet');

  browserKald(p);                         // svaret er ligegyldigt - der er ingen udvidelse
  let efter = foer;
  for (let i = 0; i < 30 && efter.length === foer.length; i++) { await vent(200); efter = await optagne(); }
  assert.equal(efter.length, foer.length + 1, 'foerste browser-kald bandt ingen port');
});

test('en sultet server faar en port naar en bliver fri - uden genstart', async () => {
  for (let port = BASE; port <= MAX; port++) {
    if (!(await erOptaget(port))) blokke.push(await lytter(port));
  }
  assert.equal((await optagne()).length, MAX - BASE + 1, 'spaendet blev ikke fyldt');

  const p = start();
  await haandtryk(p);

  const svar = browserKald(p, 25000);
  await vent(2000);                       // serveren har nu proevet og fejlet mindst én gang
  const frigivet = blokke.pop();
  const friPort = frigivet.address().port;
  await new Promise((r) => frigivet.close(r));

  const tekst = await svar;
  assert.ok(!/Alle porte/.test(tekst),
    'serveren gav op paa portene i stedet for at proeve igen da en blev fri: ' + tekst.slice(0, 300));
  assert.ok(await erOptaget(friPort),
    'den frigivne port blev ikke taget af den ventende server');
});

// ── Bind-fejl der IKKE er "porten er optaget" ───────────────────────────────
//
// FUNDET AF REVIEW 7/9. Da porten blev doven, blev en gammel harmloes stderr-linje
// til en permanent deadlock: `createWSS`s error-handler loeste kun port-loeftet i
// EADDRINUSE-grenen. Enhver anden bind-fejl (EACCES paa en privilegeret port,
// EADDRNOTAVAIL, en firewall) efterlod loeftet pending - og `sendToExtension` venter
// paa det UDEN timeout. Resultatet var at hvert eneste browser-kald haengte tavst,
// uden fejlbesked, indtil agenten selv gav op. At haenge uden besked er vaerre end
// den fejl vi rettede.
test('bind-fejl der ikke er "optaget" giver en FEJL, ikke en evig venten', async () => {
  const p = spawn(process.execPath, [SRV], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // Port 80 kraever root. Som almindelig bruger giver bind EACCES - ikke EADDRINUSE.
    env: { ...process.env, BROWSER_MCP_BASE_PORT: '80', BROWSER_MCP_MAX_PORT: '80' },
  });
  p.stderr.on('data', () => {});
  boerneprocesser.push(p);
  await haandtryk(p);

  // Budgettet er rundhaandet med vilje. Testen beviser at kaldet SVARER - ikke at det
  // svarer hurtigt. Seks bindeforsoeg med 1500 ms mellem kan lovligt tage over 15 s, og
  // en test der ogsaa maalte hastigheden ville falde roed paa en travl maskine uden at
  // noget var i stykker. Deadlocken den vogter var uendelig; 30 s adskiller de to fint.
  const svar = await browserKald(p, 30000);
  assert.notEqual(svar, 'TIMEOUT', 'kaldet haengte i stedet for at fejle - det er deadlocken');
  assert.match(svar, /kunne ikke aabne en port|Alle porte/,
    'kaldet svarede, men ikke med en forklaring paa at bindingen fejlede: ' + svar.slice(0, 200));
});

// ── #16: beskeden naar vi lige selv har aabnet doeren ───────────────────────
//
// Foer porten blev doven var udvidelsen for laengst forbundet naar foerste kald kom.
// Nu starter uret VED kaldet, og loeber budgettet ud, faar brugeren den vaerst mulige
// besked: "install it from the Chrome Web Store" - om en installation der virker fint.
test('lige aabnet port uden udvidelse giver en aerlig besked, ikke "geninstaller"', async () => {
  // Sultnings-testen ovenfor fylder spaendet og frigiver kun én. Uden det her maalte
  // denne test "alle porte optaget" i stedet for beskeden efter en vellykket binding.
  while (blokke.length) await new Promise((r) => blokke.pop().close(r));
  const foer = await optagne();
  const p = start();
  await haandtryk(p);
  const svar = await browserKald(p, 60000);
  assert.notEqual(svar, 'TIMEOUT', 'kaldet svarede aldrig');
  assert.ok(!/Chrome Web Store|chromewebstore/i.test(svar),
    'brugeren sendes hen for at geninstallere en udvidelse der ikke naaede at forbinde: ' + svar.slice(0, 240));
  assert.match(svar, /ikke naaet at forbinde|scanner hvert/,
    'beskeden forklarer ikke at doeren lige er aabnet: ' + svar.slice(0, 240));
  assert.equal((await optagne()).length, foer.length + 1, 'porten blev ikke bundet');
});

// ── #14: den paastand fejlbeskeden faktisk giver ────────────────────────────
//
// Testen ovenfor beviser gentagelsen INDE i ét kald (5 x 1500 ms i sendToExtension).
// Men baade commit-beskeden og den tekst brugeren faar lover noget staerkere:
// "hvert kald proever selv at faa en port. Denne chat skal IKKE genstartes."
// Det er PAA TVAERS af kald, og det var utestet - praecis den slags hul issue #14
// handler om: en test der maaler mindre end den ser ud til.
test('kald 1 fejler paa fuldt spaend, kald 2 lykkes - uden genstart', async () => {
  while (blokke.length) await new Promise((r) => blokke.pop().close(r));
  for (let port = BASE; port <= MAX; port++) {
    if (!(await erOptaget(port))) blokke.push(await lytter(port));
  }
  assert.equal((await optagne()).length, MAX - BASE + 1, 'spaendet blev ikke fyldt');

  const p = start();
  await haandtryk(p);

  // Kald 1: spaendet er fuldt hele vejen igennem, saa det SKAL give op.
  const foerste = await browserKald(p, 25000);
  assert.match(foerste, /Alle porte/,
    'kald 1 gav ikke op paa et fuldt spaend - testen maaler saa ikke det den paastaar');

  // Nu bliver en plads fri, uden at chatten roeres.
  const frigivet = blokke.pop();
  const friPort = frigivet.address().port;
  await new Promise((r) => frigivet.close(r));
  await vent(300);

  // Kald 2 i SAMME proces skal selv tage den.
  const andet = await browserKald(p, 40000);
  assert.ok(!/Alle porte/.test(andet),
    'kald 2 gav ogsaa op - saa er "denne chat skal ikke genstartes" en tom paastand: ' + andet.slice(0, 220));
  assert.ok(await erOptaget(friPort), 'den frigivne port blev ikke taget af naeste kald');
});
