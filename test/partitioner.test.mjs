/**
 * 1.32 skive S5 (#20, ugbodagadave): partitionsvaerktoejet - en partition er en BANE (1.31, S1a) med sin egen port.
 *
 * Designet (DESIGN-1.30.3-og-1.31-SAMLET.md, «1.31 · #58 + #20»):
 *   browser_partition({action:'new', profile?, label?} | {action:'close', partition}); id'er p1, p2, ... aldrig genbrugt;
 *   liste i browser_about; `partition` paa alle browservaerktoejer inkl. extract_token; lukning svarer port_released og
 *   tabs_closed: true|"unknown". Fejl: partition-not-found, partition-closed, partition-limit (4 pr. server),
 *   port-capacity-exhausted, profile-not-connected (banen lukkes). Partitioner sender pid:null.
 * Proever (model): fremmede svar begge veje, inaktiv terminate, samme-pid-adoption, extract_token-rute, id/port-genbrug,
 * omdoebning, fejl-én-gang ved afbrydelse. Broen er den AEGTE (test/hjaelp/bro-model.mjs); vaerktoejslaget proeves mod den
 * aegte server over stdio, med en falsk udvidelse der - som den rigtige - forbinder til hver port, der lytter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { broModel, falskUdvidelse, vent, venteTil } from './hjaelp/bro-model.mjs';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const ID = 'a'.repeat(32);
const I1 = '1111111111111111', I2 = '2222222222222222';

async function bro(env = {}, { bredde = 6 } = {}) {
  const base = await ledigtSpaend(bredde);
  return broModel({ BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + bredde - 1), ...env },
    { genforsoegMs: 100, foersteValgMs: 0 });
}

/**
 * En installation (en Chrome-profil) som den rigtige udvidelse: forbinder til hver port, der lytter (her: hver banes port),
 * hilser med sin instans og betegnelse og svarer paa kommandoer. `faner` er dens sessioner pr. port (list_tabs/close_tab).
 */
function installation(m, navn, { instance = I1, profile = 'arbejde' } = {}) {
  const inst = { navn, forbindelser: new Map(), kom: [], faner: new Map(), stum: false, stop: false };
  const forbind = async (port) => {
    const e = await falskUdvidelse(port, { id: ID, hello: { type: 'hello', extensionId: ID, version: '1.32.0', name: null, instance, profile } });
    inst.forbindelser.set(port, e);
    e.ws.on('close', () => { if (inst.forbindelser.get(port) === e) inst.forbindelser.delete(port); });
    e.ws.on('message', (d) => {
      const msg = JSON.parse(String(d));
      if (!msg.method) return;
      inst.kom.push({ port, ...msg });
      if (inst.stum) return;
      const faner = inst.faner.get(port) || [];
      if (msg.method === 'list_tabs') e.svar(msg.id, { tabs: faner.map((id) => ({ id })) });
      else if (msg.method === 'close_tab') { inst.faner.set(port, faner.filter((f) => f !== msg.params.tab_id)); e.svar(msg.id, { ok: true }); }
      else e.svar(msg.id, { fra: navn, port });
    });
  };
  // Skanneren: som offscreen.js, hvert ~50 ms (den rigtige: 2 s) - forbind til hver bundet port uden en aaben forbindelse.
  // unref + try: en proeve, der fejler (fx mod en kilde uden partitioner), maa ikke holde proeveprocessen i live.
  const skan = setInterval(() => {
    if (inst.stop) return;
    let porte = [];
    try { porte = m.k('[...baner].map((b) => b.activePort).filter((x) => x !== null)'); } catch { return; }
    for (const p of porte) {
      if (!inst.forbindelser.has(p)) { inst.forbindelser.set(p, null); forbind(p).catch(() => inst.forbindelser.delete(p)); }
    }
  }, 50);
  skan.unref();
  inst.luk = () => { clearInterval(skan); for (const e of inst.forbindelser.values()) e?.luk(); };
  inst.kommandoer = (metode) => inst.kom.filter((k) => !metode || k.method === metode);
  return inst;
}

let n = 0;
function kald(m, udtryk) {
  const id = '__k' + (++n);
  return new Promise((ok) => {
    m.ctx[id] = (r) => ok(JSON.parse(JSON.stringify(r ?? null)));
    m.k(`Promise.resolve().then(() => ${udtryk}).then((r) => ${id}({ ok: r }), (e) => ${id}({ fejl: e.message, svar: e.svar || null }))`);
  });
}
const ny = (m, a = {}) => kald(m, `nyPartition(${JSON.stringify(a)})`);
const luk = (m, id) => kald(m, `lukPartition(${JSON.stringify(id)})`);
const paa = (m, partition, metode = 'get_page_content') =>
  kald(m, `sendToExtension(${JSON.stringify(metode)}, {}, 5000, baneForKald(${JSON.stringify(partition)}))`);

// ── oprettelse, id'er, loft ──────────────────────────────────────────────────

test('new: egen bane og egen port, foerste kommando med pid null, laast til installationen; id p1', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const r = await ny(m, { label: 'kurv' });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.ok.partition, 'p1');
    assert.equal(r.ok.label, 'kurv');
    assert.deepEqual(r.ok.installation, { profile: 'arbejde', instance: I1 });
    assert.equal(m.k('partitioner.get("p1").bane.laas.instans'), I1, 'partitionens bane er ikke laast til installationen');
    const k = a.kommandoer().filter((x) => x.port === r.ok.port);
    assert.equal(k.length, 1);
    assert.equal(k[0].pid, null, 'partitionen sendte en pid - udvidelsen kan saa adoptere en anden banes faner (R106, maalt)');
    assert.equal(m.k('standardBane.activePort'), null, 'standardbanen bandt en port, selvom kun partitionen blev brugt');
    assert.equal(m.k('baner.size'), 2);
  } finally { a.luk(); m.luk(); }
});

test('id genbruges aldrig: p1 lukkes, naeste er p2, og p1 svarer partition-closed', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    assert.equal((await ny(m)).ok.partition, 'p1');
    assert.ok((await luk(m, 'p1')).ok);
    assert.equal((await ny(m)).ok.partition, 'p2', 'et lukket id blev genbrugt');
    const r = await paa(m, 'p1');
    assert.equal(r.svar?.error, 'partition-closed', JSON.stringify(r));
    assert.equal(r.svar.sent, false);
  } finally { a.luk(); m.luk(); }
});

test('partition-limit: hoejst 4 aabne pr. server - den femte sender intet og binder ingen port', async () => {
  const m = await bro({}, { bredde: 8 });
  const a = installation(m, 'A');
  try {
    for (let i = 1; i <= 4; i++) { const r = await ny(m); assert.equal(r.ok?.partition, `p${i}`, JSON.stringify(r)); }
    const foer = a.kom.length;
    const r = await ny(m);
    assert.equal(r.svar?.error, 'partition-limit', JSON.stringify(r));
    assert.equal(r.svar.limit, 4);
    assert.equal(a.kom.length, foer, 'den afviste partition sendte en kommando');
    assert.equal(m.k('baner.size'), 5, 'den afviste partition efterlod en bane');
    // Lukkes én, kan der laves en ny - med et nyt id (det afviste forsoeg fik intet id).
    assert.ok((await luk(m, 'p2')).ok);
    const r5 = await ny(m);
    assert.equal(r5.ok?.partition, 'p5', JSON.stringify(r5));
  } finally { a.luk(); m.luk(); }
});

test('port-capacity-exhausted: alle porte optaget - ingen partition, ingen bane tilbage, id ikke udleveret', async () => {
  const m = await bro({}, { bredde: 2 });
  const base = Number(m.ctx.process.env.BROWSER_MCP_BASE_PORT);
  const a = installation(m, 'A');
  const fremmed = createServer();
  try {
    assert.equal(await m.k('sikrePort(standardBane)'), true);
    const fri = m.k('standardBane.activePort') === base ? base + 1 : base;
    await new Promise((ok) => fremmed.listen(fri, '127.0.0.1', ok));   // en anden chats server
    const r = await ny(m);
    assert.equal(r.svar?.error, 'port-capacity-exhausted', JSON.stringify(r));
    assert.equal(r.svar.partition_created, false);
    assert.equal(m.k('baner.size'), 1);
    assert.equal(m.k('partitioner.size'), 0);
    const p = await paa(m, 'p1');
    assert.equal(p.svar?.error, 'partition-not-found');
  } finally { fremmed.close(); a.luk(); m.luk(); }
});

test('profile i new er banens BROWSER_MCP_PROFILE: kommandoerne gaar til den profil, standardbanen er uroert', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  const a = installation(m, 'A', { instance: I1, profile: 'arbejde' });
  const b = installation(m, 'B', { instance: I2, profile: 'hjem' });
  try {
    const r = await ny(m, { profile: 'hjem' });
    assert.deepEqual(r.ok?.installation, { profile: 'hjem', instance: I2 }, JSON.stringify(r));
    assert.deepEqual((await paa(m, 'p1')).ok, { fra: 'B', port: r.ok.port });
    assert.deepEqual((await paa(m, undefined)).ok?.fra, 'A', 'standardbanen fulgte partitionens profil');
    // Uden profile arver partitionen klientens BROWSER_MCP_PROFILE.
    const r2 = await ny(m);
    assert.deepEqual(r2.ok?.installation, { profile: 'arbejde', instance: I1 });
  } finally { a.luk(); b.luk(); m.luk(); }
});

test('profile-not-connected i new: banen lukkes - porten slippes, ingen partition, intet id udleveret', async () => {
  const m = await bro();
  const a = installation(m, 'A', { profile: 'arbejde' });
  try {
    const r = await ny(m, { profile: 'hjem' });
    assert.equal(r.svar?.error, 'profile-not-connected', JSON.stringify(r));
    assert.equal(r.svar.partition_created, false);
    assert.match(r.svar.note, /No partition was created, and its port was released/);
    assert.equal(m.k('baner.size'), 1, 'banen blev staaende');
    assert.equal(m.k('partitioner.size'), 0);
    assert.equal(a.kommandoer().length, 0, 'en kommando naaede en anden profil');
  } finally { a.luk(); m.luk(); }
});

test('profile-invalid i new: intet oprettes', async () => {
  const m = await bro();
  try {
    const r = await ny(m, { profile: 'har mellemrum' });
    assert.equal(r.svar?.error, 'profile-invalid');
    assert.equal(m.k('baner.size'), 1);
    assert.equal(m.k('partitionNr'), 0, 'et id blev brugt paa en partition, der aldrig blev til');
  } finally { m.luk(); }
});

// ── routing og vaern ──────────────────────────────────────────────────────────

test('ukendt partition: partition-not-found, og kaldet gaar IKKE til standardbanen i stedet', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    for (const p of ['p9', 19874, 'P1', '__proto__', 'constructor']) {
      const r = await paa(m, p);
      assert.equal(r.svar?.error, 'partition-not-found', `${p}: ${JSON.stringify(r)}`);
      assert.equal(r.svar.sent, false);
    }
    assert.equal(a.kom.length, 0, 'et kald med et ukendt partitions-id blev sendt');
    assert.equal(m.k('standardBane.activePort'), null);
    assert.deepEqual((await paa(m, 'default')).ok?.fra, 'A', '"default" er standardbanen');
  } finally { a.luk(); m.luk(); }
});

test('fremmede svar begge veje: standardbanens sokkel kan ikke besvare et partitionskald, og omvendt', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    assert.deepEqual((await paa(m, undefined)).ok?.fra, 'A');
    a.stum = true;
    const fraP = paa(m, 'p1'), fraS = paa(m, undefined);
    assert.ok(await venteTil(() => a.kom.filter((k) => k.method === 'get_page_content').length >= 2));
    const kP = a.kom.filter((k) => k.port === p1.port).at(-1), kS = a.kom.filter((k) => k.port !== p1.port).at(-1);
    const sokP = a.forbindelser.get(p1.port), sokS = a.forbindelser.get(kS.port);
    sokS.svar(kP.id, { FORFALSKET: 'fra standardbanen' });
    sokP.svar(kS.id, { FORFALSKET: 'fra partitionen' });
    await vent(200);
    assert.equal((m.log.join('').match(/Ignored a reply to command \d+ from a connection it was not sent to/g) || []).length, 2);
    sokP.svar(kP.id, { rigtigt: 'p' }); sokS.svar(kS.id, { rigtigt: 's' });
    assert.deepEqual((await fraP).ok, { rigtigt: 'p' });
    assert.deepEqual((await fraS).ok, { rigtigt: 's' });
  } finally { a.luk(); m.luk(); }
});

test('inaktiv terminate paa partitionen ignoreres; den aktive slipper kun partitionens port, og partitionen bliver aaben', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  const b = installation(m, 'B', { instance: I2, profile: 'hjem' });
  try {
    const r = await ny(m, { profile: 'arbejde' });
    assert.ok(await venteTil(() => b.forbindelser.get(r.ok.port)));
    b.forbindelser.get(r.ok.port).send({ type: 'terminate' });
    await vent(150);
    assert.equal(m.k('partitioner.get("p1").bane.activePort'), r.ok.port, 'en inaktiv forbindelses terminate slap partitionens port');
    assert.ok((await paa(m, undefined)).ok?.fra, 'standardbanen fik ingen forbindelse');   // binder standardbanens port
    const standardPort = m.k('standardBane.activePort');
    a.forbindelser.get(r.ok.port).send({ type: 'terminate' });
    assert.ok(await venteTil(() => m.k('partitioner.get("p1").bane.activePort') === null), 'den aktive forbindelses terminate slap ikke porten');
    assert.equal(m.k('standardBane.activePort'), standardPort, 'terminate paa partitionen slap standardbanens port');
    assert.equal(m.k('partitioner.get("p1").lukket'), false, 'en sluppet port lukkede partitionen');
    // Naeste kald binder en port igen og fortsaetter i samme installation (laasen overlever en sluppet port).
    const igen = await paa(m, 'p1');
    assert.equal(igen.ok?.fra, 'A', JSON.stringify(igen));
  } finally { a.luk(); b.luk(); m.luk(); }
});

test('samme-pid-adoption: alle partitionens kommandoer - new, kald og close - sender pid null; standardbanen sin pid', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    a.faner.set(p1.port, [5]);
    await paa(m, 'p1');
    await paa(m, undefined);
    await luk(m, 'p1');
    const partition = a.kom.filter((k) => k.port === p1.port);
    assert.ok(partition.length >= 4, `for faa partitionskommandoer at maale paa: ${partition.length}`);
    assert.deepEqual([...new Set(partition.map((k) => k.pid))], [null]);
    assert.deepEqual([...new Set(a.kom.filter((k) => k.port !== p1.port).map((k) => k.pid))], [4242]);
  } finally { a.luk(); m.luk(); }
});

test('id/port-genbrug: en ny partition paa den lukkede partitions port faar sine egne kald - den gamle forbliver lukket', async () => {
  const m = await bro({}, { bredde: 2 });
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    assert.ok((await luk(m, 'p1')).ok);
    const p2 = (await ny(m)).ok;
    assert.equal(p2.port, p1.port, 'proeven maaler ikke portgenbrug: p2 fik en anden port');
    assert.deepEqual((await paa(m, 'p2')).ok, { fra: 'A', port: p2.port });
    assert.equal((await paa(m, 'p1')).svar?.error, 'partition-closed');
  } finally { a.luk(); m.luk(); }
});

test('omdoebning paa partitionens forbindelse flytter ikke laasen: partitionen styrer samme installation', async () => {
  const m = await bro();
  const a = installation(m, 'A', { profile: 'arbejde' });
  try {
    const p1 = (await ny(m, { profile: 'arbejde' })).ok;
    a.forbindelser.get(p1.port).send({ type: 'hello', extensionId: ID, version: '1.32.0', name: null, instance: I1, profile: 'nyt-navn' });
    await vent(100);
    const r = await paa(m, 'p1');
    assert.deepEqual(r.ok, { fra: 'A', port: p1.port }, `omdoebningen afbroed partitionen: ${JSON.stringify(r)}`);
    assert.equal(m.k('partitionsListe()[0].installation.profile'), 'nyt-navn', 'listen viser ikke det nye navn');
  } finally { a.luk(); m.luk(); }
});

test('fejl én gang ved afbrydelse: partitionens installation forsvinder - igangvaerende afvises, naeste profile-disconnected, saa nyt valg', async () => {
  const m = await bro();
  const a = installation(m, 'A', { instance: I1, profile: 'arbejde' });
  try {
    const p1 = (await ny(m)).ok;
    a.stum = true;
    const ventende = paa(m, 'p1');
    assert.ok(await venteTil(() => a.kom.filter((k) => k.port === p1.port).length === 2));
    a.stop = true; a.luk();
    const r0 = await ventende;
    assert.match(r0.fejl || '', /disappeared while the command was running/);
    const b = installation(m, 'B', { instance: I2, profile: 'hjem' });
    try {
      assert.ok(await venteTil(() => b.forbindelser.get(p1.port)));
      const r1 = await paa(m, 'p1');
      assert.equal(r1.svar?.error, 'profile-disconnected', JSON.stringify(r1));
      assert.equal(b.kom.filter((k) => k.port === p1.port).length, 0, 'partitionen skiftede stille til en anden profil');
      const r2 = await paa(m, 'p1');
      assert.deepEqual(r2.ok, { fra: 'B', port: p1.port }, 'kaldet efter fejlen valgte ikke paa ny');
    } finally { b.luk(); }
  } finally { m.luk(); }
});

// ── lukning ────────────────────────────────────────────────────────────────────

test('close: fanerne lukkes gennem partitionens forbindelse (tabs_closed: true), porten slippes, ventende kald afvises', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    a.faner.set(p1.port, [11, 12]);
    assert.ok((await paa(m, 'p1')).ok);   // agenten har brugt partitionen (og «aabnet» fanerne 11 og 12)
    const r = await luk(m, 'p1');
    assert.deepEqual(r.ok && { port_released: r.ok.port_released, tabs_closed: r.ok.tabs_closed }, { port_released: true, tabs_closed: true }, JSON.stringify(r));
    assert.deepEqual(a.kommandoer('close_tab').map((k) => k.params.tab_id).sort(), [11, 12]);
    assert.equal(m.k('baner.size'), 1);
    // Porten er fri: intet lytter der laengere.
    const fri = await new Promise((ok) => { const s = createServer(); s.once('error', () => ok(false)); s.listen(p1.port, '127.0.0.1', () => s.close(() => ok(true))); });
    assert.ok(fri, 'partitionens port blev ikke sluppet');
    assert.equal((await luk(m, 'p1')).svar?.error, 'partition-closed');
    assert.equal((await luk(m, 'p7')).svar?.error, 'partition-not-found');
    assert.equal((await luk(m, 'default')).svar?.error, 'partition-not-found', 'standardpartitionen kan lukkes');
  } finally { a.luk(); m.luk(); }
});

test('close mens et kald venter paa partitionen: kaldet afvises straks, ikke efter sin frist', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    a.stum = true;
    const t0 = Date.now();
    const ventende = kald(m, 'sendToExtension("list_tabs", {}, 30000, baneForKald("p1"))');
    assert.ok(await venteTil(() => a.kom.filter((k) => k.port === p1.port).length === 2));
    const r = await luk(m, 'p1');
    assert.equal(r.ok?.tabs_closed, 'unknown', 'en udvidelse, der ikke svarede, gav tabs_closed: true');
    assert.equal(r.ok.port_released, true);
    const v = await ventende;
    assert.ok(v.fejl && Date.now() - t0 < 15000, `det ventende kald blev ikke afvist: ${JSON.stringify(v)}`);
  } finally { a.luk(); m.luk(); }
});

test('close uden forbindelse: tabs_closed "unknown" (aldrig true uden bekraeftelse), port_released true', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    assert.ok((await paa(m, 'p1')).ok);
    a.stop = true; a.luk();
    await venteTil(() => m.k(`liveConnections(partitioner.get('p1').bane).length`) === 0);
    const r = await luk(m, 'p1');
    assert.deepEqual({ t: r.ok?.tabs_closed, p: r.ok?.port_released }, { t: 'unknown', p: true }, JSON.stringify(r));
  } finally { m.luk(); }
});

test('close af en partition, intet vaerktoejskald har brugt: tabs_closed true uden at spoerge (new aabner ingen fane)', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    const foer = a.kom.length;
    const r = await luk(m, 'p1');
    assert.equal(r.ok?.tabs_closed, true, JSON.stringify(r));
    assert.equal(a.kom.length, foer, 'lukningen spurgte udvidelsen, selvom partitionen aldrig var brugt');
    void p1;
  } finally { a.luk(); m.luk(); }
});

test('en partition, der er brugt, men hvis forbindelse er vaek, kan ikke melde tabs_closed true (heller ikke efter en sluppet port)', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    assert.ok((await paa(m, 'p1')).ok);
    a.forbindelser.get(p1.port).send({ type: 'terminate' });   // sidste fane lukket af brugeren: porten slippes
    assert.ok(await venteTil(() => m.k('partitioner.get("p1").bane.activePort') === null));
    a.stop = true;
    const r = await luk(m, 'p1');
    assert.deepEqual({ t: r.ok?.tabs_closed, p: r.ok?.port_released }, { t: 'unknown', p: false }, JSON.stringify(r));
  } finally { a.luk(); m.luk(); }
});

test('new uden profil med to installationer: svaret siger hvilken partitionen nu styrer (ikke foerst ved naeste kald)', async () => {
  const m = await bro();
  const a = installation(m, 'A', { instance: I1, profile: 'arbejde' });
  const b = installation(m, 'B', { instance: I2, profile: 'hjem' });
  try {
    const r = await ny(m);
    assert.match(r.ok?.note || '', /2 Browser MCP installations are connected to this chat/, JSON.stringify(r));
    assert.equal(m.k('partitioner.get("p1").bane.valgNote'), '', 'noten blev staaende til naeste kald ogsaa');
  } finally { a.luk(); b.luk(); m.luk(); }
});

test('mens close lukker fanerne, faar et nyt kald paa partitionen partition-closed - intet sendes', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m)).ok;
    assert.ok((await paa(m, 'p1')).ok);
    a.stum = true;                                   // udvidelsen er langsom: lukningens list_tabs venter
    const lukning = luk(m, 'p1');
    assert.ok(await venteTil(() => a.kom.filter((k) => k.port === p1.port && k.method === 'list_tabs').length === 2));
    const foer = a.kom.length;
    const r = await paa(m, 'p1');
    assert.equal(r.svar?.error, 'partition-closed', `et kald midt i lukningen blev ikke afvist: ${JSON.stringify(r)}`);
    assert.equal(a.kom.length, foer, 'kaldet blev sendt til en partition, der var ved at lukke');
    const anden = await luk(m, 'p1');
    assert.equal(anden.svar?.error, 'partition-closed', 'en anden lukning midt i den foerste blev ikke afvist');
    a.stum = false;
    a.forbindelser.get(p1.port).svar(a.kom.filter((k) => k.method === 'list_tabs').at(-1).id, { tabs: [] });
    assert.ok((await lukning).ok);
  } finally { a.luk(); m.luk(); }
});

test('browser_about-listen: aabne og lukkede partitioner med id, label, tilstand, port og installation', async () => {
  const m = await bro();
  const a = installation(m, 'A');
  try {
    const p1 = (await ny(m, { label: 'a' })).ok;
    await ny(m, { label: 'b' });
    await luk(m, 'p2');
    const l = JSON.parse(JSON.stringify(m.k('partitionsListe()')));
    assert.deepEqual(l.map((x) => [x.partition, x.label, x.state, x.port]), [['p1', 'a', 'open', p1.port], ['p2', 'b', 'closed', null]]);
    assert.deepEqual(l[0].installation, { profile: 'arbejde', instance: I1 });
  } finally { a.luk(); m.luk(); }
});

// ── vaerktoejslaget mod den aegte server ───────────────────────────────────────

async function aegteServer(env = {}) {
  const base = await ledigtSpaend(6);
  const hjem = mkdtempSync(join(tmpdir(), 'bmcp-s5-'));
  const srv = spawn(process.execPath, [join(rod, 'mcp-server', 'index.js')], {
    env: { ...process.env, BROWSER_MCP_TOKEN: '', BROWSER_MCP_EXTENSION_ID: '', BROWSER_MCP_PROFILE: '', HOME: hjem, USERPROFILE: hjem,
      ...env, BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 5) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let fejl = ''; const ud = []; let rest = '';
  srv.stderr.on('data', (d) => { fejl += d; });
  srv.stdout.on('data', (d) => { rest += d; let i; while ((i = rest.indexOf('\n')) > -1) { const l = rest.slice(0, i); rest = rest.slice(i + 1); try { ud.push(JSON.parse(l)); } catch {} } });
  const skriv = (o) => srv.stdin.write(JSON.stringify(o) + '\n');
  skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '0' } } });
  assert.ok(await venteTil(() => ud.find((x) => x.id === 1), 5000));
  skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let nr = 10;
  const raa = (method, params) => { const id = ++nr; skriv({ jsonrpc: '2.0', id, method, params }); return id; };
  const send = (name, args = {}) => raa('tools/call', { name, arguments: args });
  const svar = async (id, ms = 25000) => venteTil(() => ud.find((x) => x.id === id), ms);
  const tekst = async (id) => { const r = await svar(id); assert.ok(r, 'intet svar'); return r.result; };
  // Den falske udvidelse forbinder til hver port, serveren lytter paa (som skanneren i offscreen.js).
  const faner = new Map();
  const kom = [];
  const forbundet = new Set();
  const skan = setInterval(() => {
    for (const mm of fejl.matchAll(/listening on ws:\/\/127\.0\.0\.1:(\d+)/g)) {
      const p = Number(mm[1]);
      if (forbundet.has(p)) continue;
      forbundet.add(p);
      falskUdvidelse(p, { id: ID, hello: { type: 'hello', extensionId: ID, version: '1.32.0', name: null, instance: I1, profile: 'arbejde' } }).then((e) => {
        e.ws.on('close', () => forbundet.delete(p));
        e.ws.on('message', (d) => {
          const msg = JSON.parse(String(d));
          if (!msg.method) return;
          kom.push({ port: p, ...msg });
          const f = faner.get(p) || [];
          if (msg.method === 'list_tabs') e.svar(msg.id, { tabs: f.map((id) => ({ id })) });
          else if (msg.method === 'close_tab') { faner.set(p, f.filter((x) => x !== msg.params.tab_id)); e.svar(msg.id, { ok: true }); }
          else if (msg.method === 'navigate') e.svar(msg.id, { ok: true, title: 'side', url: msg.params.url });
          else e.svar(msg.id, { ok: true, port: p });
        });
      }).catch(() => forbundet.delete(p));
    }
  }, 100);
  skan.unref();
  const luk = () => { clearInterval(skan); srv.kill(); rmSync(hjem, { recursive: true, force: true }); };
  return { send, raa, svar, tekst, kom, faner, luk };
}
const json = (res) => JSON.parse(res.content[0].text);

test('aegte server: tools/list - partition paa hvert browservaerktoej inkl. extract_token, ikke paa about/feedback/partition', async () => {
  const s = await aegteServer();
  try {
    const r = await s.svar(s.raa('tools/list', {}));
    const tools = r.result.tools;
    const lokale = new Set(['browser_about', 'browser_provide_feedback', 'browser_partition']);
    const p = tools.find((t) => t.name === 'browser_partition');
    assert.ok(p, 'browser_partition findes ikke');
    assert.deepEqual(p.inputSchema.properties.action.enum, ['new', 'close']);
    for (const t of tools) {
      const har = 'partition' in (t.inputSchema.properties || {});
      if (lokale.has(t.name)) assert.ok(t.name === 'browser_partition' || !har, `${t.name} har en partition-parameter`);
      else assert.ok(har, `${t.name} mangler partition-parameteren`);
    }
    assert.ok('partition' in tools.find((t) => t.name === 'browser_extract_token').inputSchema.properties);
  } finally { s.luk(); }
});

test('aegte server: new -> kald med partition gaar til partitionens port; extract_token ogsaa; about lister; close; lukket id', async () => {
  const s = await aegteServer();
  try {
    const ny1 = json(await s.tekst(s.send('browser_partition', { action: 'new', label: 'kurv' })));
    assert.equal(ny1.ok, true, JSON.stringify(ny1));
    assert.equal(ny1.partition, 'p1');
    const port = ny1.port;
    await s.tekst(s.send('browser_list_tabs', { partition: 'p1' }));
    const lt = s.kom.filter((k) => k.method === 'list_tabs').at(-1);
    assert.equal(lt.port, port, 'browser_list_tabs med partition gik ikke til partitionens port');
    assert.ok(!('partition' in lt.params), 'partition-parameteren blev sendt videre til udvidelsen');
    await s.tekst(s.send('browser_extract_token', { provider: 'stripe', partition: 'p1' }));
    const nav = s.kom.filter((k) => k.method === 'navigate').at(-1);
    assert.equal(nav?.port, port, 'browser_extract_token med partition navigerede i standardpartitionen');
    assert.equal(nav.pid, null);
    const about = json(await s.tekst(s.send('browser_about')));
    assert.deepEqual(about.partitions.map((x) => [x.partition, x.label, x.state]), [['p1', 'kurv', 'open']]);
    s.faner.set(port, [3]);
    const lukket = json(await s.tekst(s.send('browser_partition', { action: 'close', partition: 'p1' })));
    assert.deepEqual([lukket.port_released, lukket.tabs_closed], [true, true], JSON.stringify(lukket));
    const efter = await s.tekst(s.send('browser_list_tabs', { partition: 'p1' }));
    assert.equal(efter.isError, true);
    assert.equal(json(efter).error, 'partition-closed');
    const ukendt = await s.tekst(s.send('browser_click', { selector: 'a', partition: 'p5' }));
    assert.equal(ukendt.isError, true);
    assert.equal(json(ukendt).error, 'partition-not-found');
    const fejlAction = await s.tekst(s.send('browser_partition', { action: 'list' }));
    assert.equal(fejlAction.isError, true);
  } finally { s.luk(); }
});

test('aegte server: et kald paa en partition faar partitionens egen forbindelsesadvarsel (ikke standardbanens)', async () => {
  const s = await aegteServer();
  try {
    const ny1 = json(await s.tekst(s.send('browser_partition', { action: 'new' })));
    assert.equal(ny1.partition, 'p1', JSON.stringify(ny1));
    // En gammel kopi af udvidelsen (uden installation) forbinder ogsaa til partitionens port.
    const gammel = await falskUdvidelse(ny1.port, { id: ID, hello: { type: 'hello', extensionId: ID, version: '1.30.2', name: null } });
    try {
      await vent(300);
      const r = await s.tekst(s.send('browser_list_tabs', { partition: 'p1' }));
      const alt = r.content.map((c) => c.text).join('\n');
      assert.match(alt, /2 Browser MCP extension connections are open to this server/, `partitionens advarsel kom ikke med: ${alt.slice(0, 300)}`);
      assert.equal(gammel.kom.length, 0, 'kaldet gik til den gamle kopi i stedet for partitionens installation');
    } finally { gammel.luk(); }
  } finally { s.luk(); }
});
