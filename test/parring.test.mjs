/**
 * Parringsnoeglen (issue #10): én Chrome-profil, én server.
 *
 * Det oenskede er hverdagsagtigt: har man Arbejde og Privat aabne samtidig, skal
 * agenten i den ene ikke kunne styre den anden. Broen er lokal og tager i dag imod
 * den udvidelse der melder sig - det er nul opsaetning, og det er stadig standarden.
 * Saetter man en noegle, bliver parringen striks, og samtidig lukkes et hul vi selv
 * har skrevet ned: broen lytter uden autentificering, saa ethvert program paa
 * maskinen kan melde sig som udvidelse.
 *
 * Noeglen gaelder BEGGE veje. En server uden den rigtige noegle kommer ikke ind, og
 * en udvidelse med en noegle udfoerer intet foer serveren har kvitteret med den samme.
 *
 * Testene her koerer den AEGTE server som proces og den AEGTE offscreen.js i en vm.
 * Kildetekst-matchning kunne ikke se forskel paa "afviser" og "skriver om at afvise".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { createRequire } from 'node:module';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const krav = createRequire(join(rod, 'mcp-server', 'index.js'));
const WebSocket = krav('ws');

/** Starter den aegte server, faar den til at binde en port, og giver porten tilbage. */
async function serverMedNoegle(noegle) {
  const p = spawn(process.execPath, [join(rod, 'mcp-server', 'index.js')], {
    env: { ...process.env, ...(noegle ? { BROWSER_MCP_TOKEN: noegle } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let fejl = '';
  p.stderr.on('data', (d) => { fejl += d.toString(); });
  const skriv = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'proeve', version: '0' } } });
  await new Promise((ok) => p.stdout.once('data', ok));
  skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
  // Porten bindes foerst naar browseren faktisk skal bruges - derfor et vaerktoejskald.
  // Svaret ventes ikke: uden udvidelse proever det i flere sekunder, og det er porten vi vil have.
  skriv({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });

  // Porten LAESES af serverens egen log. En skanning af spaendet ville finde den foerste
  // levende browser-mcp paa maskinen - og paa denne maskine koerer der altid nogle - saa
  // testen ville maale en HELT anden proces uden noegle og alligevel se groen ud.
  for (let i = 0; i < 200; i++) {
    const m = fejl.match(/listening on ws:\/\/127\.0\.0\.1:(\d+)/);
    if (m) return { proces: p, port: Number(m[1]), fejl: () => fejl };
    await new Promise((ok) => setTimeout(ok, 50));
  }
  p.kill();
  throw new Error('serveren bandt aldrig en port: ' + fejl);
}

/** Melder sig som udvidelse med et givet haandtryk og rapporterer hvad der skete. */
function udvidelseHilser(port, hilsen) {
  return new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    const svar = [];
    let lukket = null;
    ws.on('open', () => ws.send(JSON.stringify(hilsen)));
    ws.on('message', (d) => { try { svar.push(JSON.parse(d.toString())); } catch { /* ikke json */ } });
    ws.on('close', (kode) => { lukket = kode; });
    ws.on('error', () => {});
    setTimeout(() => { try { ws.close(); } catch { /* lukket */ } ok({ svar, lukket }); }, 900);
  });
}

const HILSEN = { type: 'hello', extensionId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', version: '1.29.2', kode: 'abcdef012345' };

test('uden noegle er intet aendret - udvidelsen kommer ind som i dag', async () => {
  const s = await serverMedNoegle(null);
  try {
    const r = await udvidelseHilser(s.port, HILSEN);
    assert.equal(r.lukket, null, 'serveren lukkede en helt almindelig udvidelse ude');
    assert.equal(r.svar.find((m) => m.type === 'parring'), undefined, 'der blev sendt en parringskvittering uden at nogen har bedt om parring');
  } finally { s.proces.kill(); }
});

test('med noegle afvises en udvidelse der ikke kender den', async () => {
  const s = await serverMedNoegle('arbejde');
  try {
    const r = await udvidelseHilser(s.port, { ...HILSEN, noegle: 'privat' });
    assert.equal(r.lukket, 4003, `en udvidelse med forkert noegle blev IKKE lukket ude (kode ${r.lukket})`);
    const kvit = r.svar.find((m) => m.type === 'parring');
    assert.equal(kvit?.ok, false);
    assert.equal(kvit?.noegle, undefined, 'afvisningen roebede serverens noegle');
  } finally { s.proces.kill(); }
});

test('med noegle afvises ogsaa en udvidelse der slet ingen sender', async () => {
  const s = await serverMedNoegle('arbejde');
  try {
    const r = await udvidelseHilser(s.port, HILSEN);
    assert.equal(r.lukket, 4003, 'en udvidelse uden noegle slap ind paa en parret server');
  } finally { s.proces.kill(); }
});

test('med den rigtige noegle kommer udvidelsen ind og faar serverens kvittering', async () => {
  const s = await serverMedNoegle('arbejde');
  try {
    const r = await udvidelseHilser(s.port, { ...HILSEN, noegle: 'arbejde' });
    assert.equal(r.lukket, null, `den rigtige noegle blev afvist (kode ${r.lukket})`);
    const kvit = r.svar.find((m) => m.type === 'parring');
    assert.equal(kvit?.ok, true, 'serveren kvitterede ikke, saa udvidelsen kan ikke se hvem den taler med');
    assert.equal(kvit?.noegle, 'arbejde');
  } finally { s.proces.kill(); }
});

// ── Udvidelsens side ────────────────────────────────────────────────────────

/** Koerer den aegte offscreen.js med en gemt noegle og rapporterer hvad broen gjorde. */
function broen(gemtNoegle) {
  const sendt = [];
  let lukket = false;
  const ws = {
    readyState: 0, OPEN: 1,
    send: (d) => sendt.push(JSON.parse(d)),
    close: () => { lukket = true; },
  };
  const lyttere = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, URLSearchParams, JSON, Promise, Uint8Array, Array, Error, String, Boolean, WeakSet, Map, Set, Object,
    location: { search: '?v=1.29.2' },
    WebSocket: Object.assign(function () { return ws; }, { OPEN: 1, CONNECTING: 0 }),
    fetch: async () => { throw new Error('ingen server'); },
    crypto: { subtle: { digest: async () => new Uint8Array([0xab, 0xcd, 0xef, 0x01, 0x23, 0x45]).buffer } },
    chrome: {
      // ⛔ KUN runtime. Chromes dokumentation siger ordret at runtime er den ENESTE
      // udvidelses-API et offscreen-dokument har. Selen gav tidligere ogsaa `storage`, og
      // derfor kunne de fire proever herunder ikke se at offscreen.js laeste et lager der
      // ikke findes. Fejlen naaede den udgivne 1.30.0 og gjorde parringen ubrugelig.
      // En sele der er rundhaandet med API'er, maaler et produkt der ikke findes.
      runtime: {
        id: 'proeve-id',
        getURL: (f) => 'chrome-extension://proeve-id/' + f,
        // Baggrunden svarer paa noegle-hentningen. Alt andet kvitterer bare.
        sendMessage: async (m) => (m && m.type === 'bmcp_hent_parringsnoegle'
          ? { noegle: gemtNoegle || null }
          : { ok: true }),
        onMessage: { addListener: (f) => lyttere.push(f) },
      },
    },
  };
  ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(readFileSync(join(rod, 'extension/offscreen.js'), 'utf8'), ctx, { filename: 'offscreen.js' });
  return {
    ctx, ws, sendt, lyttere,
    erLukket: () => lukket,
    aabn: async () => { ws.readyState = 1; await ws.onopen(); },
    modtag: async (o) => { await ws.onmessage({ data: JSON.stringify(o) }); },
  };
}

// Noeglen laeses asynkront, men haandtrykket bygges synkront - derfor caches den ved opstart,
// samme moenster som kodeaftrykket. Uden ventetiden her ville testen maale cachen foer den var fyldt.
const pust = () => new Promise((ok) => setTimeout(ok, 20));

test('udvidelsen sender sin noegle med i haandtrykket', async () => {
  const b = broen('arbejde');
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  assert.equal(b.sendt[0]?.type, 'hello');
  assert.equal(b.sendt[0]?.noegle, 'arbejde', `noeglen kom ikke med: ${JSON.stringify(b.sendt[0])}`);
});

test('uden gemt noegle er haandtrykket som foer - ingen noegle', async () => {
  const b = broen(null);
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  assert.equal(b.sendt[0]?.noegle, null);
});

test('en parret udvidelse udfoerer INTET foer serveren har kvitteret', async () => {
  const b = broen('arbejde');
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  await b.modtag({ id: 7, method: 'browser_screenshot', params: {} });
  const svar = b.sendt.find((m) => m.id === 7);
  assert.match(String(svar?.error), /pairing key/, `kommandoen blev udfoert uden kvittering: ${JSON.stringify(b.sendt)}`);
});

test('efter serverens kvittering udfoeres kommandoer igen', async () => {
  const b = broen('arbejde');
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  await b.modtag({ type: 'parring', ok: true, noegle: 'arbejde' });
  await b.modtag({ id: 8, method: 'browser_screenshot', params: {} });
  const svar = b.sendt.find((m) => m.id === 8);
  assert.ok(svar && !svar.error, `den rigtige kvittering blev ikke godtaget: ${JSON.stringify(b.sendt)}`);
});

test('en server der kvitterer med en ANDEN noegle, lukkes ude af udvidelsen', async () => {
  const b = broen('arbejde');
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  await b.modtag({ type: 'parring', ok: true, noegle: 'privat' });
  assert.ok(b.erLukket(), 'udvidelsen blev hos en server der ikke kender dens noegle');
});

test('skiftes noeglen, kappes de aabne forbindelser med det samme', async () => {
  const b = broen('arbejde');
  await pust();
  b.ctx.tryConnect(9876);
  await b.aabn();
  // Offscreen kan ikke lytte paa lageret - kun paa beskeder. Baggrunden skubber aendringen.
  // Chrome leverer en besked til ALLE lyttere, saa det goer proeven ogsaa; offscreen.js har
  // flere, og at pege paa lyttere[0] ville vaere en antagelse om raekkefoelgen.
  assert.ok(b.lyttere.length >= 1, 'der lyttes ikke efter aendringer i noeglen');
  for (const l of b.lyttere) l({ type: 'bmcp_parringsnoegle_aendret', noegle: 'privat' });
  assert.ok(b.erLukket(), 'en aendret noegle fik foerst virkning ved naeste genstart');
});

test('popup\'en kan saette noeglen og viser serverkommandoen', () => {
  const html = readFileSync(join(rod, 'extension/popup.html'), 'utf8');
  const js = readFileSync(join(rod, 'extension/popup.js'), 'utf8');
  assert.match(html, /id="pairKey"/, 'der er intet felt til noeglen');
  assert.match(js, /parringsnoegle/, 'popup\'en gemmer ikke noeglen');
  assert.match(js, /BROWSER_MCP_TOKEN=/, 'popup\'en viser ikke hvordan serveren startes med samme noegle');
});

/**
 * ⛔ MAALT 21/9: noeglen holdt INGEN ude.
 *
 * De tre proever ovenfor sender alle et `hello`. Noeglen blev kun tjekket INDE i
 * hello-grenen, saa et program der forbandt og aldrig hilste, sprang tjekket over - og kom
 * alligevel i betragtning som aktiv forbindelse. Det er praecis det hul parringen blev
 * bygget for at lukke, og det stod aabent i den udgivne 1.30.0.
 *
 * Samme moenster som huset har set fire gange: vagten blev proevet ad den ene vej den blev
 * bygget til, og tvillingen stod aaben.
 */
/**
 * Forbinder TAVST (ingen hilsen) og bliver hængende, saa et kald der sendes BAGEFTER kan
 * naa den. Foerste udgave af proeven forbandt efter at kaldet var sendt, og saa kunne den
 * ikke vise forskellen: begge grene var tomme, og «med noegle»-proeven var groen uanset
 * rettelsen. Et instrument der svarer nul, proeves foerst mod et kendt-sandt tilfaelde.
 */
function tavsForbindelse(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  const modtaget = [];
  ws.on('message', (d) => { try { modtaget.push(JSON.parse(d.toString())); } catch { /* ikke json */ } });
  ws.on('error', () => {});
  const klar = new Promise((ok) => ws.on('open', ok));
  return { ws, modtaget, klar, kald: () => modtaget.filter((m) => typeof m?.method === 'string') };
}

/** Starter serveren, lader en tavs forbindelse melde sig, og sender FOERST derefter et kald. */
async function tavsFaarKald(noegle) {
  const s = await serverMedNoegle(noegle);
  const t = tavsForbindelse(s.port);
  try {
    await t.klar;
    await new Promise((ok) => setTimeout(ok, 200));
    s.proces.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: { name: 'browser_list_tabs', arguments: {} } }) + '\n');
    // ⛔ Vent paa HAENDELSEN, ikke paa et ur. En fast pause paa 2,5 s fejlede 3 af 6 gange
    // under diskpres: serveren var langsommere om at binde, og proeven maalte foer kaldet var
    // sendt. En flakkende kontrol-proeve undergraver praecis det den skal sikre.
    // Den negative sag (med noegle) skal stadig bruge hele fristen, ellers maaler den for
    // tidligt og er groen uden grund - derfor loeber loekken altid tiden ud naar der intet kommer.
    for (let i = 0; i < 60 && t.kald().length === 0; i++) {
      await new Promise((ok) => setTimeout(ok, 100));
    }
    return t.kald();
  } finally { try { t.ws.close(); } catch { /* lukket */ } s.proces.kill(); }
}

test('med noegle faar en forbindelse der ALDRIG hilser intet kald udleveret', async () => {
  assert.deepEqual(await tavsFaarKald('arbejde'), [],
    'en tavs forbindelse fik et vaerktoejskald udleveret paa en parret server - noeglen holder ingen ude');
});

test('UDEN noegle slipper en uparret forbindelse stadig igennem gaten', () => {
  // ⛔ Denne kontrol var foerst en integrationsproeve der startede en rigtig server og saa om
  // en tavs forbindelse fik et kald. Den var flakkende 3 af 6 gange - og aarsagen var ikke
  // timing, men et KAPLOEB: Gustavs egen udvidelse skanner portene hvert 2. sekund, forbinder
  // til proevens server og kan vinde rollen som aktiv. Proeven maalte hvem der kom foerst.
  // En proeve hvis forudsaetning kan svigte uden at sige fra, maaler noget andet end man tror.
  //
  // Gaten selv er ren logik, saa den proeves som logik. Ingen server, intet kaploeb.
  const kilde = readFileSync(join(rod, 'mcp-server', 'index.js'), 'utf8');
  const m = kilde.match(/function liveConnections\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'liveConnections blev ikke fundet - gaten kan ikke proeves');

  const byg = (noegle) => new Function('connections', 'PARRINGSNOEGLE',
    `${m[0]}\nreturn liveConnections;`)(
    new Set([
      { ws: { readyState: 1 }, parret: false, navn: 'uparret' },
      { ws: { readyState: 1 }, parret: true, navn: 'parret' },
      { ws: { readyState: 3 }, parret: true, navn: 'doed' },
    ]), noegle);

  assert.deepEqual(byg(null)().map((c) => c.navn), ['uparret', 'parret'],
    'uden noegle blev en uparret forbindelse filtreret fra - nul-opsaetning er aendret for alle');
  assert.deepEqual(byg('arbejde')().map((c) => c.navn), ['parret'],
    'med noegle slap en uparret forbindelse igennem - noeglen holder ingen ude');
});


/**
 * ⛔ Offscreen-dokumentet maa KUN roere chrome.runtime.
 *
 * Chromes dokumentation siger ordret at runtime er den eneste udvidelses-API et
 * offscreen-dokument har. 1.30.0 blev udgivet med `chrome.storage.local.get(...)` i
 * offscreen.js; opslaget kastede, fejlen blev slugt, parringsnoeglen forblev tom, og enhver
 * der fulgte popup'ens egen instruktion var laast ude for altid.
 *
 * Vagten hviler paa MEKANIKKEN - hvilket chrome-navnerum der roeres - ikke paa et ord eller
 * et funktionsnavn. En omdoebt hjaelper aendrer ingenting. (Huset 7/9: et ord kan ikke baere
 * en regel.)
 */
test('offscreen.js roerer kun chrome.runtime - alt andet findes ikke der', () => {
  const kilde = readFileSync(join(rod, 'extension/offscreen.js'), 'utf8');
  // Kommentarer ud foerst: filen FORKLARER fejlen, og forklaringen maa ikke udloese vagten.
  const kode = kilde.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const brugt = [...new Set([...kode.matchAll(/\bchrome\.([a-zA-Z]+)/g)].map((m) => m[1]))];

  // ⛔ Detektoren proeves mod et kendt-sandt tilfaelde, foer «ingen fund» betyder noget.
  const proeve = [...new Set([...'chrome.storage.local.get(1)'.matchAll(/\bchrome\.([a-zA-Z]+)/g)].map((m) => m[1]))];
  assert.deepEqual(proeve, ['storage'], 'detektoren finder ikke et chrome-navnerum den faar forelagt');

  assert.deepEqual(brugt, ['runtime'],
    `offscreen.js roerer ${brugt.join(', ')}. Kun runtime findes i et offscreen-dokument - `
    + 'alt andet kaster, og et slugt kast er praecis hvad der gjorde parringen ubrugelig i 1.30.0.');
});

/**
 * ⛔ MAALT 21/9: baggrundens halvdel af noegle-videresendelsen havde INGEN proeve.
 *
 * Mutationsbevis paa den foerste udgave: `if (msg.type === 'bmcp_hent_parringsnoegle')` blev
 * slaaet fra, og NUL proever blev roede. Offscreen-proeverne stubber selv `sendMessage`, saa
 * de naar aldrig background.js' svar. Halvdelen af en to-filers rettelse er vaerre end ingen:
 * den ser faerdig ud. (Huset 7/9, samme klasse.)
 */
test('baggrunden svarer offscreen med noeglen fra lageret', async () => {
  const { indlaesUdvidelse } = await import('./hjaelp/udvidelses-sele.mjs');
  const u = indlaesUdvidelse({ svar: { 'storage.local.get': { parringsnoegle: '  arbejde  ' } } });
  const svar = await new Promise((ok) => {
    const beholdt = (u.lyttere.get('runtime.onMessage') || [])
      .map((fn) => fn({ type: 'bmcp_hent_parringsnoegle' }, {}, ok))
      .some((r) => r === true);
    assert.ok(beholdt, 'ingen lytter beholdt kanalen aaben - svaret kan ikke naa offscreen');
  });
  assert.equal(svar.noegle, 'arbejde', 'baggrunden gav ikke noeglen videre (mellemrum skal trimmes)');
});

test('uden gemt noegle svarer baggrunden null - ikke undefined', async () => {
  const { indlaesUdvidelse } = await import('./hjaelp/udvidelses-sele.mjs');
  const u = indlaesUdvidelse({ svar: { 'storage.local.get': {} } });
  const svar = await new Promise((ok) => {
    for (const fn of u.lyttere.get('runtime.onMessage') || []) fn({ type: 'bmcp_hent_parringsnoegle' }, {}, ok);
  });
  assert.equal(svar.noegle, null, 'et tomt lager skal give null, saa offscreen ikke cacher undefined');
});

test('en aendret noegle skubbes videre til offscreen', async () => {
  const { indlaesUdvidelse } = await import('./hjaelp/udvidelses-sele.mjs');
  const u = indlaesUdvidelse();
  await u.fyr('storage.onChanged', { parringsnoegle: { newValue: ' privat ' } }, 'local');
  const sendt = u.optager.kald.filter((k) => k.args?.[0]?.type === 'bmcp_parringsnoegle_aendret');
  assert.equal(sendt.length, 1, 'aendringen blev ikke skubbet til offscreen - den gaelder foerst ved genstart');
  assert.equal(sendt[0].args[0].noegle, 'privat');
});

test('en aendring i et ANDET lager-felt skubbes ikke', async () => {
  const { indlaesUdvidelse } = await import('./hjaelp/udvidelses-sele.mjs');
  const u = indlaesUdvidelse();
  await u.fyr('storage.onChanged', { sessions: { newValue: {} } }, 'local');
  const sendt = u.optager.kald.filter((k) => k.args?.[0]?.type === 'bmcp_parringsnoegle_aendret');
  assert.equal(sendt.length, 0, 'enhver lager-aendring kapper forbindelserne - det er en gate paa alt');
});
