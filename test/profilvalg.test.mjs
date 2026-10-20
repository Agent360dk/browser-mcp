/**
 * 1.31 skive S3 (#58): BROWSER_MCP_PROFILE, valget af installation og laasen til den.
 *
 * Reglerne (DESIGN-1.30.3-og-1.31-SAMLET.md, «1.31», godkendt af begge bedoemmere i R107):
 *  - BROWSER_MCP_PROFILE ugyldig -> profile-invalid, intet sendt.
 *  - Med vaelger: 0 match -> vent inden for genforsoegsbudgettet -> profile-not-connected (profile-routing-unsupported hvis
 *    kun udvidelser fra foer 1.31 er forbundet); 1 -> laas til INSTANSEN; 2+ -> profile-ambiguous, intet sendt.
 *  - Uden vaelger: dagens foerste valg, en note ved flere installationer, derefter laas til instansen.
 *  - Laast instans afbryder -> igangvaerende afvises straks; naeste kald profile-disconnected, sent:false; foerst kaldet
 *    derefter vaelger paa ny; kommer samme instans tilbage, fortsaettes uden fejl. Aldrig et stille skift.
 * Proeverne koerer den AEGTE bro (test/hjaelp/bro-model.mjs) med falske udvidelser paa rigtige porte; genforsoeget er kortet
 * fra 1500 til 100 ms, saa et udtoemt budget tager ~1 s.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { broModel, falskUdvidelse, vent, venteTil, proeve as test, sporProces } from './hjaelp/bro-model.mjs';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const ID = 'a'.repeat(32);
const I1 = '1111111111111111', I2 = '2222222222222222', I3 = '3333333333333333';

async function bro(env = {}, { foersteValgMs = 0 } = {}) {
  const base = await ledigtSpaend(5);
  const m = broModel({ BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 4), ...env }, { genforsoegMs: 100, foersteValgMs });
  return m;
}
async function port(m) {
  assert.equal(await m.k('sikrePort(standardBane)'), true);
  return m.k('standardBane.activePort');
}

let n = 0;
/** Et vaerktoejskald paa standardbanen, som det gaar gennem sendToExtension. Svaret er { ok } eller { fejl, svar }. */
function kald(m) {
  const id = '__k' + (++n);
  return new Promise((ok) => {
    m.ctx[id] = (r) => ok(JSON.parse(JSON.stringify(r)));
    m.k(`sendToExtension('list_tabs', {}, 5000).then((r) => ${id}({ ok: r }), (e) => ${id}({ fejl: e.message, svar: e.svar || null }))`);
  });
}

/** En 1.31-udvidelse, der svarer paa hver kommando med sit eget navn. */
async function installation(p, navn, { instance = null, profile = null, version = '1.31.0', id = ID } = {}) {
  const hello = { type: 'hello', extensionId: id, version, name: null };
  if (instance !== undefined) hello.instance = instance;
  if (profile !== undefined) hello.profile = profile;
  const e = await falskUdvidelse(p, { id, hello });
  e.navn = navn;
  e.ws.on('message', (d) => { const msg = JSON.parse(String(d)); if (msg.method && !e.stum) e.svar(msg.id, { fra: navn }); });
  return e;
}
const hilst = (m, antal) => venteTil(() => m.k('liveConnections(standardBane).filter((c) => c.harHilst).length') === antal);

test('BROWSER_MCP_PROFILE ugyldig: profile-invalid, sent:false - intet sendes, heller ikke til en forbundet udvidelse', async () => {
  for (const vaerdi of ['har mellemrum', 'x'.repeat(33), 'æøå', 'a/b']) {
    const m = await bro({ BROWSER_MCP_PROFILE: vaerdi });
    try {
      const p = await port(m);
      const e = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
      assert.ok(await hilst(m, 1));
      const r = await kald(m);
      assert.equal(r.svar?.error, 'profile-invalid', `${vaerdi}: ${JSON.stringify(r)}`);
      assert.equal(r.svar.sent, false);
      assert.equal(e.kom.length, 0, 'kommandoen blev sendt trods en ugyldig vaelger');
      assert.doesNotMatch(JSON.stringify(r.svar), new RegExp(vaerdi.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')), 'den ugyldige vaerdi gentages i svaret');
    } finally { m.luk(); }
  }
});

test('vaelger med ét match: kommandoen gaar til den installation - ikke til den nyeste eller den sidst forbundne', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde', version: '1.31.0' });
    const b = await installation(p, 'B', { instance: I2, profile: 'hjem', version: '9.9.9' });
    const c = await installation(p, 'C', { instance: null, profile: null, version: '1.30.2' });
    assert.ok(await hilst(m, 3));
    const r = await kald(m);
    assert.deepEqual(r.ok, { fra: 'A' }, JSON.stringify(r));
    assert.deepEqual([b.kom.length, c.kom.length], [0, 0]);
    assert.equal(m.k('standardBane.laas.instans'), I1, 'banen blev ikke laast til instansen');
    a.luk(); b.luk(); c.luk();
  } finally { m.luk(); }
});

test('vaelger uden match: der ventes inden for budgettet, saa profile-not-connected med de forbundne - intet sendt', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const b = await installation(p, 'B', { instance: I2, profile: 'hjem' });
    assert.ok(await hilst(m, 1));
    const t0 = Date.now();
    const r = await kald(m);
    assert.ok(Date.now() - t0 >= 400, 'svarede uden at vente paa at profilen forbandt');
    assert.equal(r.svar?.error, 'profile-not-connected', JSON.stringify(r));
    assert.equal(r.svar.sent, false);
    assert.equal(r.svar.profile, 'arbejde');
    assert.deepEqual(r.svar.connected.map((x) => [x.profile, x.instance]), [['hjem', I2]]);
    assert.equal(b.kom.length, 0, 'kommandoen gik til en anden profil');
  } finally { m.luk(); }
});

test('vaelger: profilen, der forbinder mens kaldet venter, faar kommandoen', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const b = await installation(p, 'B', { instance: I2, profile: 'hjem' });
    const svar = kald(m);
    await vent(300);
    await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    const r = await svar;
    assert.deepEqual(r.ok, { fra: 'A' }, JSON.stringify(r));
    assert.equal(b.kom.length, 0);
  } finally { m.luk(); }
});

test('vaelger: kun udvidelser fra foer 1.31 forbundet -> profile-routing-unsupported', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const g = await installation(p, 'G', { instance: undefined, profile: undefined, version: '1.30.2' });
    assert.ok(await hilst(m, 1));
    const r = await kald(m);
    assert.equal(r.svar?.error, 'profile-routing-unsupported', JSON.stringify(r));
    assert.equal(r.svar.sent, false);
    assert.equal(g.kom.length, 0);
  } finally { m.luk(); }
});

test('vaelger: en forbindelse med betegnelsen men et ugyldigt installations-id kan ikke vaelges', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const x = await installation(p, 'X', { instance: 'IKKE-HEX', profile: 'arbejde' });
    assert.ok(await hilst(m, 1));
    const r = await kald(m);
    assert.equal(r.svar?.error, 'profile-routing-unsupported', JSON.stringify(r));
    assert.equal(x.kom.length, 0, 'en forbindelse uden gyldig identitet blev valgt ud fra betegnelsen alene');
  } finally { m.luk(); }
});

test('laast: den laaste installation forbundet to gange paa én gang -> profile-ambiguous, intet sendt', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
    const a2 = await installation(p, 'A2', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 2));
    m.k('standardBane.laastForbindelse = null');   // som efter en genforbindelse: valget udregnes forfra
    const r = await kald(m);
    assert.equal(r.svar?.error, 'profile-ambiguous', JSON.stringify(r));
    assert.deepEqual([a.kom.length, a2.kom.length], [1, 0]);
  } finally { m.luk(); }
});

test('vaelger: to installationer med samme betegnelse -> profile-ambiguous straks, intet sendt til nogen', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    const b = await installation(p, 'B', { instance: I2, profile: 'arbejde' });
    assert.ok(await hilst(m, 2));
    const t0 = Date.now();
    const r = await kald(m);
    assert.ok(Date.now() - t0 < 400, 'ventede foer profile-ambiguous - der er intet at vente paa');
    assert.equal(r.svar?.error, 'profile-ambiguous', JSON.stringify(r));
    assert.equal(r.svar.sent, false);
    assert.deepEqual(r.svar.candidates.map((c) => c.instance).sort(), [I1, I2]);
    assert.deepEqual([a.kom.length, b.kom.length], [0, 0]);
  } finally { m.luk(); }
});

test('vaelger: en betegnelse, der kommer til foer foerste kommando (omdoebning), giver profile-ambiguous', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    const b = await installation(p, 'B', { instance: I2, profile: 'hjem' });
    assert.ok(await hilst(m, 2));
    m.k('activeConnection(standardBane)');               // et opslag uden kommando (fx browser_provide_feedback)
    b.send({ type: 'hello', extensionId: ID, version: '1.31.0', name: null, instance: I2, profile: 'arbejde' });
    assert.ok(await venteTil(() => m.k('profilKandidater(standardBane).length') === 2));
    const r = await kald(m);
    assert.equal(r.svar?.error, 'profile-ambiguous', JSON.stringify(r));
    assert.deepEqual([a.kom.length, b.kom.length], [0, 0]);
  } finally { m.luk(); }
});

test('samme instans paa to forbindelser (kopieret profil) -> profile-ambiguous', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    await installation(p, 'A2', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 2));
    const r = await kald(m);
    assert.equal(r.svar?.error, 'profile-ambiguous', JSON.stringify(r));
  } finally { m.luk(); }
});

test('laast: en ny installation med samme betegnelse efter foerste kommando tager ikke over - og giver ingen fejl', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
    const b = await installation(p, 'B', { instance: I2, profile: 'arbejde', version: '9.9.9' });
    assert.ok(await hilst(m, 2));
    assert.deepEqual((await kald(m)).ok, { fra: 'A' }, 'banen skiftede installation');
    // Omdoebes den laaste installation, flytter laasen heller ikke.
    a.send({ type: 'hello', extensionId: ID, version: '1.31.0', name: null, instance: I1, profile: 'andet' });
    await vent(100);
    assert.deepEqual((await kald(m)).ok, { fra: 'A' }, 'en omdoebning flyttede laasen');
    assert.equal(b.kom.length, 0);
  } finally { m.luk(); }
});

test('laast instans afbryder: igangvaerende afvises straks; naeste kald profile-disconnected uden at sende; kaldet derefter vaelger paa ny', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
    // A svarer ikke paa det naeste kald og forsvinder midt i det.
    a.stum = true;
    const igang = kald(m);
    assert.ok(await venteTil(() => a.kom.length === 2), 'det andet kald naaede ikke frem til A');
    const t0 = Date.now();
    a.luk();
    const r0 = await igang;
    assert.ok(Date.now() - t0 < 1000);
    assert.match(r0.fejl, /disappeared while the command was running/);
    // En anden installation med samme betegnelse er forbundet nu.
    const b = await installation(p, 'B', { instance: I2, profile: 'arbejde' });
    assert.ok(await hilst(m, 1));
    const r1 = await kald(m);
    assert.equal(r1.svar?.error, 'profile-disconnected', JSON.stringify(r1));
    assert.equal(r1.svar.sent, false);
    assert.deepEqual(r1.svar.lost, { profile: 'arbejde', instance: I1 });
    assert.deepEqual(r1.svar.connected.map((x) => x.instance), [I2]);
    assert.equal(b.kom.length, 0, 'kommandoen gik stille til en anden installation');
    const r2 = await kald(m);
    assert.deepEqual(r2.ok, { fra: 'B' }, 'kaldet efter fejlen valgte ikke paa ny');
    // Fejlen kommer én gang: naeste kald fortsaetter med B.
    assert.deepEqual((await kald(m)).ok, { fra: 'B' });
  } finally { m.luk(); }
});

test('samme instans tilbage paa en ny forbindelse: kaldet fortsaetter uden fejl', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
    a.luk();
    assert.ok(await hilst(m, 0));
    const svar = kald(m);
    await vent(250);
    await installation(p, 'A-igen', { instance: I1, profile: 'arbejde' });
    const r = await svar;
    assert.deepEqual(r.ok, { fra: 'A-igen' }, JSON.stringify(r));
  } finally { m.luk(); }
});

test('uden vaelger: dagens foerste valg, én note ved flere installationer, og laasen holder ved afbrydelse', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde', version: '1.31.0' });
    const b = await installation(p, 'B', { instance: I2, profile: 'hjem', version: '1.31.1' });
    assert.ok(await hilst(m, 2));
    assert.deepEqual((await kald(m)).ok, { fra: 'B' }, 'dagens regel (nyeste version) skal gaelde foerste valg');
    const note = () => m.k("medForbindelsesNote({ content: [] })").content.map((c) => c.text).join('');
    assert.match(note(), /2 Browser MCP installations are connected to this chat .* It now drives profile "hjem" \(instance 2222222222222222\) and stays with it/);
    assert.equal(note(), '', 'noten gentages');
    b.luk();
    assert.ok(await hilst(m, 1));
    const r1 = await kald(m);
    assert.equal(r1.svar?.error, 'profile-disconnected', JSON.stringify(r1));
    assert.equal(a.kom.length, 0, 'uden vaelger gik kommandoen stille til den anden profil');
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
  } finally { m.luk(); }
});

test('uden vaelger og kun én installation: ingen note', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
    assert.equal(m.k("medForbindelsesNote({ content: [] })").content.length, 0);
  } finally { m.luk(); }
});

test('en laast udvidelse fra foer 1.31 kan ikke genkendes: naeste kald profile-disconnected straks, saa vaelges der paa ny', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    const g = await installation(p, 'G', { instance: undefined, profile: undefined, version: '1.30.2' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'G' });
    g.luk();
    const h = await installation(p, 'H', { instance: undefined, profile: undefined, version: '1.30.2' });
    assert.ok(await hilst(m, 1));
    const t0 = Date.now();
    const r1 = await kald(m);
    assert.ok(Date.now() - t0 < 400, 'ventede paa en forbindelse, der aldrig kan komme tilbage');
    assert.equal(r1.svar?.error, 'profile-disconnected', JSON.stringify(r1));
    assert.match(r1.svar.note, /before 1\.31 cannot be recognised/);
    assert.equal(h.kom.length, 0);
    assert.deepEqual((await kald(m)).ok, { fra: 'H' });
  } finally { m.luk(); }
});

test('naar porten slippes (sidste fane lukket), holder laasen til installationen - en udvidelse fra foer 1.31 vaelges forfra', async () => {
  const m = await bro({});
  try {
    let p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde', version: '1.31.0' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
    m.k("frigivPort(standardBane, 'proeve: sidste fane lukket')");
    a.luk();
    p = await port(m);
    const b = await installation(p, 'B', { instance: I2, profile: 'hjem', version: '9.9.9' });
    await installation(p, 'A-igen', { instance: I1, profile: 'arbejde', version: '1.31.0' });
    assert.ok(await hilst(m, 2));
    assert.deepEqual((await kald(m)).ok, { fra: 'A-igen' }, 'efter en ny port tog banen en anden profil');
    assert.equal(b.kom.length, 0);
    // Foer 1.31: laasen slippes, som i 1.30.2.
    m.k('standardBane.laas = { instans: null, conn: standardBane.laastForbindelse }');
    m.k("frigivPort(standardBane, 'proeve')");
    assert.equal(m.k('standardBane.laas'), null);
  } finally { m.luk(); }
});

test('advarslen om samme udvidelse flere gange gaelder kun forbindelser, der ikke melder en installation', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    await installation(p, 'B', { instance: I2, profile: 'hjem' });
    assert.ok(await hilst(m, 2));
    assert.equal(m.k('forbindelsesAdvarsel(standardBane)'), null, '1.31-installationer kan skelnes - ingen grund til at advare');
    await installation(p, 'G', { instance: undefined, profile: undefined, version: '1.30.2' });
    assert.ok(await hilst(m, 3));
    assert.match(m.k('forbindelsesAdvarsel(standardBane)'), /cannot tell which profile/);
  } finally { m.luk(); }
});

test('BROWSER_MCP_EXTENSION_ID og BROWSER_MCP_PROFILE gaelder sammen: en anden udvidelse med samme betegnelse kommer ikke i betragtning', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde', BROWSER_MCP_EXTENSION_ID: ID });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    try { await installation(p, 'X', { instance: I3, profile: 'arbejde', id: 'b'.repeat(32) }); } catch { /* afvist ved opkobling */ }
    assert.ok(await hilst(m, 1));
    await vent(100);
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
    assert.equal(a.kom.length, 1);
  } finally { m.luk(); }
});

// Fejlsvaret naar agenten som JSON med isError - mod den aegte server over stdio.
test('den aegte server svarer valgets fejl som JSON med isError (profile-invalid og profile-ambiguous)', async () => {
  for (const [env, forventet, udvidelser] of [
    [{ BROWSER_MCP_PROFILE: 'ikke gyldig' }, 'profile-invalid', 0],
    [{ BROWSER_MCP_PROFILE: 'arbejde' }, 'profile-ambiguous', 2],
  ]) {
    const base = await ledigtSpaend(5);
    const srv = sporProces(spawn(process.execPath, [join(rod, 'mcp-server', 'index.js')], {
      env: { ...process.env, BROWSER_MCP_TOKEN: '', BROWSER_MCP_EXTENSION_ID: '', ...env,
        BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 4) },
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
    try {
      let fejl = ''; const ud = []; let rest = '';
      srv.stderr.on('data', (d) => { fejl += d; });
      srv.stdout.on('data', (d) => { rest += d; let i; while ((i = rest.indexOf('\n')) > -1) { const l = rest.slice(0, i); rest = rest.slice(i + 1); try { ud.push(JSON.parse(l)); } catch {} } });
      const skriv = (o) => srv.stdin.write(JSON.stringify(o) + '\n');
      skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '0' } } });
      assert.ok(await venteTil(() => ud.find((x) => x.id === 1), 5000));
      skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
      // Kaldet binder porten og venter inden for budgettet; de to installationer forbinder imens, og saa er svaret
      // profile-ambiguous straks.
      skriv({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'browser_list_tabs', arguments: {} } });
      if (udvidelser) {
        const p = Number((await venteTil(() => /listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(fejl), 5000))[1]);
        await installation(p, 'A', { instance: I1, profile: 'arbejde' });
        await installation(p, 'B', { instance: I2, profile: 'arbejde' });
      }
      const r = await venteTil(() => ud.find((x) => x.id === 2), 20000);
      assert.ok(r, 'intet svar');
      assert.equal(r.result.isError, true, JSON.stringify(r));
      const j = JSON.parse(r.result.content[0].text);
      assert.equal(j.error, forventet);
      assert.equal(j.sent, false);
      if (udvidelser) assert.match(fejl, /listening/);
      else assert.match(fejl, /BROWSER_MCP_PROFILE is not a valid profile name/);
    } finally { srv.kill(); }
  }
});

// ── R115: modforloeb fra Astra og Opus (5cfc6f6 IKKE GODKENDT) ───────────────

test('R115 Opus 1: en anden profil med samme navn, der forbinder lidt efter porten aabnede, giver profile-ambiguous - ikke et stille valg', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' }, { foersteValgMs: 600 });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    const svar = kald(m);
    await vent(350);                          // B skanner senere end A, men inden for ét skanningsinterval
    const b = await installation(p, 'B', { instance: I2, profile: 'arbejde' });
    const r = await svar;
    assert.equal(r.svar?.error, 'profile-ambiguous', `kaldet laaste sig stille til den foerste profil: ${JSON.stringify(r)}`);
    assert.deepEqual([a.kom.length, b.kom.length], [0, 0]);
  } finally { m.luk(); }
});

test('R115 Opus 1: uden vaelger ses en sen anden installation ogsaa - noten om flere kommer med', async () => {
  const m = await bro({}, { foersteValgMs: 600 });
  try {
    const p = await port(m);
    await installation(p, 'A', { instance: I1, profile: 'arbejde', version: '1.31.0' });
    const svar = kald(m);
    await vent(350);
    await installation(p, 'B', { instance: I2, profile: 'hjem', version: '1.31.0' });
    const r = await svar;
    assert.ok(r.ok, JSON.stringify(r));
    assert.match(m.k('medForbindelsesNote({ content: [] })').content.map((c) => c.text).join(''), /2 Browser MCP installations are connected/);
  } finally { m.luk(); }
});

test('R115 Astra 1: to kald, der venter samtidig, da den laaste installation forsvandt, faar begge profile-disconnected', async () => {
  for (const env of [{}, { BROWSER_MCP_PROFILE: 'arbejde' }]) {
    const m = await bro(env);
    try {
      const p = await port(m);
      const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
      assert.ok(await hilst(m, 1));
      assert.deepEqual((await kald(m)).ok, { fra: 'A' });
      a.luk();
      const b = await installation(p, 'B', { instance: I2, profile: 'arbejde' });
      assert.ok(await hilst(m, 1));
      const [r1, r2] = await Promise.all([kald(m), kald(m)]);
      assert.equal(r1.svar?.error, 'profile-disconnected', `${JSON.stringify(env)} ${JSON.stringify(r1)}`);
      assert.equal(r2.svar?.error, 'profile-disconnected', `${JSON.stringify(env)}: et allerede ventende kald skiftede installation: ${JSON.stringify(r2)}`);
      assert.equal(b.kom.length, 0, 'en kommando gik til en anden installation, foer klienten havde set fejlen');
      assert.deepEqual((await kald(m)).ok, { fra: 'B' }, 'kaldet efter fejlen valgte ikke paa ny');
    } finally { m.luk(); }
  }
});

test('R115 Astra 2: valgt foer sin hilsen - den foerste hilsen faerdiggoer laasen til installationen', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    a.ws.removeAllListeners('message');                         // ingen automatik: hilsen og svar styres her
    const tidlig = await falskUdvidelse(p, { hello: null });     // forbinder, men har ikke hilst endnu
    a.luk();
    assert.ok(await venteTil(() => m.k('liveConnections(standardBane).length') === 1));
    const svar = kald(m);
    assert.ok(await venteTil(() => tidlig.kom.length === 1), 'kaldet gik ikke til forbindelsen uden hilsen');
    tidlig.send({ type: 'hello', extensionId: ID, version: '1.31.0', name: null, instance: I3, profile: 'arbejde' });
    await vent(50);
    tidlig.svar(tidlig.kom[0].id, { fra: 'tidlig' });
    assert.deepEqual((await svar).ok, { fra: 'tidlig' });
    assert.equal(m.k('standardBane.laas.instans'), I3, 'laasen blev staaende uden instans efter hilsenen');
    tidlig.luk();
    assert.ok(await hilst(m, 0));
    const igen = kald(m);
    await vent(250);
    await installation(p, 'samme-igen', { instance: I3, profile: 'arbejde' });
    const r = await igen;
    assert.deepEqual(r.ok, { fra: 'samme-igen' }, `samme installation blev ikke genkendt: ${JSON.stringify(r)}`);
  } finally { m.luk(); }
});

test('R115 Astra 3: samme instans to gange FOER foerste kommando og uden vaelger -> profile-ambiguous, intet sendt', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    const a2 = await installation(p, 'A2', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 2));
    const r = await kald(m);
    assert.equal(r.svar?.error, 'profile-ambiguous', JSON.stringify(r));
    assert.match(r.svar.note, /copied Chrome profile/);
    assert.deepEqual([a.kom.length, a2.kom.length], [0, 0]);
  } finally { m.luk(); }
});

test('R115 Astra 4: browser_about markerer den styrede installation, ogsaa naar en ny profil forbinder bagefter', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'A' });
    await installation(p, 'B', { instance: I2, profile: 'hjem' });
    assert.ok(await hilst(m, 2));
    const vist = JSON.parse(JSON.stringify(m.k('installationer(standardBane)')));
    assert.deepEqual(vist.map((x) => [x.instance, x.driven]), [[I1, true], [I2, false]]);
  } finally { m.luk(); }
});

test('R115 Opus 2: ingen falsk «samme udvidelse flere gange» i stderr foer hilsenen; en udvidelse uden installation advares stadig', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    await installation(p, 'B', { instance: I2, profile: 'hjem' });
    assert.ok(await hilst(m, 2));
    await vent(50);
    assert.doesNotMatch(m.log.join(''), /same extension is connected more than once/, 'falsk advarsel foer hilsenen');
    await installation(p, 'G', { instance: undefined, profile: undefined, version: '1.30.2' });
    assert.ok(await hilst(m, 3));
    await vent(50);
    assert.match(m.log.join(''), /WARNING: .*same extension is connected more than once/);
  } finally { m.luk(); }
});

// Mod den aegte server: den rigtige ventetid (2,5 s) og browser_provide_feedback.
async function aegteServer(env) {
  const base = await ledigtSpaend(5);
  const srv = sporProces(spawn(process.execPath, [join(rod, 'mcp-server', 'index.js')], {
    env: { ...process.env, BROWSER_MCP_TOKEN: '', BROWSER_MCP_EXTENSION_ID: '', BROWSER_MCP_PROFILE: '', ...env,
      BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 4) },
    stdio: ['pipe', 'pipe', 'pipe'],
  }));
  let fejl = ''; const ud = []; let rest = '';
  srv.stderr.on('data', (d) => { fejl += d; });
  srv.stdout.on('data', (d) => { rest += d; let i; while ((i = rest.indexOf('\n')) > -1) { const l = rest.slice(0, i); rest = rest.slice(i + 1); try { ud.push(JSON.parse(l)); } catch {} } });
  const skriv = (o) => srv.stdin.write(JSON.stringify(o) + '\n');
  skriv({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '0' } } });
  assert.ok(await venteTil(() => ud.find((x) => x.id === 1), 5000));
  skriv({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let n = 10;
  const send = (name, args = {}) => { const id = ++n; skriv({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }); return id; };
  const svar = (id, ms = 25000) => venteTil(() => ud.find((x) => x.id === id), ms);
  const lytter = async () => Number((await venteTil(() => /listening on ws:\/\/127\.0\.0\.1:(\d+)/.exec(fejl), 5000))[1]);
  return { srv, send, svar, lytter, fejl: () => fejl };
}

test('R115 Opus 1 (aegte server): anden profil med samme navn hilser ~1,5 s efter listening -> profile-ambiguous', async () => {
  const s = await aegteServer({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const id = s.send('browser_list_tabs');
    const p = await s.lytter();
    const t0 = Date.now();
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    // R118: i den fulde suite (belastning ~6) naaede B af og til foerst frem efter vinduet paa 2,5 s med maalet 1,8 s - det
    // er den dokumenterede graense, ikke en fejl. 1,5 s efter `listening` er stadig senere end A og laeser det samme kapløb.
    // 20/10 (D19): ogsaa 1,5 s blev roed under fuld belastning. 1,0 s er stadig efter A og giver 1,5 s margen til vinduet paa 2,5 s.
    await vent(Math.max(0, 1000 - (Date.now() - t0)));
    const b = await installation(p, 'B', { instance: I2, profile: 'arbejde' });
    const r = await s.svar(id);
    assert.ok(r, 'intet svar');
    const j = JSON.parse(r.result.content[0].text);
    assert.equal(j.error, 'profile-ambiguous', `foerste kald laaste sig stille: ${r.result.content[0].text.slice(0, 200)}`);
    assert.deepEqual([a.kom.length, b.kom.length], [0, 0]);
  } finally { s.srv.kill(); }
});

test('R115 Astra 4 (aegte server): browser_provide_feedback kalder to profiler med samme navn en konflikt - ikke «no extension connected»', async () => {
  // Logbogen (~/.browser-mcp/feedback.jsonl) skrives i en midlertidig HOME, ikke i brugerens (Opus R115 punkt 5).
  const hjem = mkdtempSync(join(tmpdir(), 'bmcp-r115-'));
  const s = await aegteServer({ BROWSER_MCP_PROFILE: 'arbejde', HOME: hjem, USERPROFILE: hjem });
  try {
    const id = s.send('browser_list_tabs');
    const p = await s.lytter();
    await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    await installation(p, 'B', { instance: I2, profile: 'arbejde' });
    await s.svar(id);
    const fb = await s.svar(s.send('browser_provide_feedback', { what_happened: 'proeve' }));
    const j = JSON.parse(fb.result.content[0].text);
    assert.equal(j.verdict, 'conflict', JSON.stringify(j.findings));
    assert.ok(j.findings.some((f) => /carry the profile name "arbejde"/.test(f)), JSON.stringify(j.findings));
    assert.ok(!j.findings.some((f) => /No Chrome extension is connected/.test(f)), 'diagnosen siger stadig at ingen udvidelse er forbundet');
    assert.equal(j.environment.extension_connections, 2);
  } finally { s.srv.kill(); rmSync(hjem, { recursive: true, force: true }); }
});

test('R115: foer foerste kommando kommer en nyere udvidelse, der forbinder bagefter, i betragtning (den foreloebige laas nulstilles)', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde', version: '1.31.0' });
    assert.ok(await hilst(m, 1));
    assert.equal(m.k('activeConnection(standardBane).instance'), I1);   // fx et diagnoseopslag, foer noget er sendt
    await installation(p, 'B', { instance: I2, profile: 'hjem', version: '1.31.1' });
    assert.ok(await hilst(m, 2));
    assert.deepEqual((await kald(m)).ok, { fra: 'B' }, 'den foreloebige laas fra foer foerste kommando holdt den nyere ude');
    assert.equal(a.kom.length, 0);
  } finally { m.luk(); }
});

// ── R117: Astras tre og Opus A-C (bc8c6d6) ───────────────────────────────────

test('R117 Astra 1: laast udvidelse fra foer 1.31 forsvinder, to samtidige kald - begge profile-disconnected, intet til den nye', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    const g = await installation(p, 'G', { instance: undefined, profile: undefined, version: '1.30.2' });
    assert.ok(await hilst(m, 1));
    assert.deepEqual((await kald(m)).ok, { fra: 'G' });
    g.luk();
    const b = await installation(p, 'B', { instance: I2, profile: 'hjem' });
    assert.ok(await hilst(m, 1));
    const [r1, r2] = await Promise.all([kald(m), kald(m)]);
    assert.equal(r1.svar?.error, 'profile-disconnected', JSON.stringify(r1));
    assert.equal(r2.svar?.error, 'profile-disconnected', `det andet ventende kald valgte en ny installation: ${JSON.stringify(r2)}`);
    assert.equal(b.kom.length, 0, 'en kommando naaede den nye installation, foer klienten havde set fejlen');
    assert.deepEqual((await kald(m)).ok, { fra: 'B' });
  } finally { m.luk(); }
});

test('R117 Opus B: en afvist kopi vises ikke som styret i browser_about', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    await installation(p, 'A2', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 2));
    assert.equal((await kald(m)).svar?.error, 'profile-ambiguous');
    assert.equal(m.k('standardBane.laastForbindelse'), null, 'den afviste kopi blev staaende som valgt');
    m.k('activeConnection(standardBane)');   // fx et diagnoseopslag: vaelger en foreloebig kandidat
    const vist = JSON.parse(JSON.stringify(m.k('installationer(standardBane)')));
    assert.deepEqual(vist.map((x) => x.driven), [false, false], 'en kopi blev vist som styret, selv om intet er valgt');
  } finally { m.luk(); }
});

test('R117 Astra: ingen falsk advarsel, naar to 1.31-forbindelser forbinder foer nogen af dem har hilst', async () => {
  const m = await bro({});
  try {
    const p = await port(m);
    const a = await falskUdvidelse(p, { hello: null });
    const b = await falskUdvidelse(p, { hello: null });
    assert.ok(await venteTil(() => m.k('liveConnections(standardBane).length') === 2));
    a.send({ type: 'hello', extensionId: ID, version: '1.31.0', name: null, instance: I1, profile: 'arbejde' });
    await vent(50);
    b.send({ type: 'hello', extensionId: ID, version: '1.31.0', name: null, instance: I2, profile: 'hjem' });
    assert.ok(await hilst(m, 2));
    await vent(50);
    assert.doesNotMatch(m.log.join(''), /same extension is connected more than once/);
    assert.equal(m.k('forbindelsesAdvarsel(standardBane)'), null);
  } finally { m.luk(); }
});

test('R117 Astra 3: et koldt kald uden profilmatch tager ca. 17,5 s (2,5 s + dobbelt budget) - det tal, fladerne siger', async () => {
  const base = await ledigtSpaend(5);
  // Serverens egne tider: hverken genforsoeget eller ventetiden foer foerste valg er kortet.
  const m = broModel({ BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 4), BROWSER_MCP_PROFILE: 'arbejde' },
    { foersteValgMs: null });
  try {
    const t0 = Date.now();
    const svar = kald(m);
    const p = await venteTil(() => m.k('standardBane.activePort'), 3000);
    await installation(p, 'B', { instance: I2, profile: 'hjem' });
    const r = await svar;
    const ms = Date.now() - t0;
    assert.equal(r.svar?.error, 'profile-not-connected', JSON.stringify(r));
    // R120 (maalt): nedre graense 17.000 ms fanger kun en tydeligt kortere ventetid - 1,8 og 2,0 s bestod under belastning
    // (17.016 og 17.300 ms). Den oevre graense fanger en haengning eller et fordoblet budget; 20.000 ms blev overskredet af
    // den korrekte 2,5 s under haard belastning (20.311 ms), saa den er 25.000. Selve graensen ved 2,5 s - ogsaa en fordoblet
    // ventetid (T7) - vogtes af R119-graenseproeven (>= 2450 og < 3600 ms).
    assert.ok(ms > 17000 && ms < 25000, `ventetiden var ${ms} ms`);
    for (const f of ['README.md', 'CHANGELOG.md']) {
      assert.match(readFileSync(join(rod, f), 'utf8'), /up to about 17\.5 seconds/, `${f} siger ikke den maalte ventetid`);
    }
  } finally { m.luk(); }
});

test('R117 Astra 2 / Opus A (aegte server): browser_provide_feedback ved en kopieret profil - konflikt og kopi-raadet, med og uden vaelger', async () => {
  for (const env of [{}, { BROWSER_MCP_PROFILE: 'arbejde' }]) {
    const hjem = mkdtempSync(join(tmpdir(), 'bmcp-r117-'));
    const s = await aegteServer({ ...env, HOME: hjem, USERPROFILE: hjem });
    try {
      const id = s.send('browser_list_tabs');
      const p = await s.lytter();
      await installation(p, 'A', { instance: I1, profile: 'arbejde' });
      await installation(p, 'A2', { instance: I1, profile: 'arbejde' });
      const r = await s.svar(id);
      assert.equal(JSON.parse(r.result.content[0].text).error, 'profile-ambiguous');
      const fb = await s.svar(s.send('browser_provide_feedback', { what_happened: 'proeve' }));
      const j = JSON.parse(fb.result.content[0].text);
      const hvor = JSON.stringify(env);
      assert.equal(j.verdict, 'conflict', `${hvor}: ${j.verdict} ${JSON.stringify(j.findings)}`);
      assert.ok(j.findings.some((f) => /copied Chrome profile/.test(f)), `${hvor}: ${JSON.stringify(j.findings)}`);
      assert.ok(j.fix_steps.some((f) => /Close the copied Chrome profile/.test(f)), `${hvor}: ${JSON.stringify(j.fix_steps)}`);
      assert.ok(!j.fix_steps.some((f) => /its own name/.test(f)), `${hvor}: raadet om at omdoebe hjaelper ikke en kopi`);
    } finally { s.srv.kill(); rmSync(hjem, { recursive: true, force: true }); }
  }
});

test('R118 Opus rest D: med vaelger og en kopi, der baerer navnet, giver vaerktoejet kopi-raadet - ikke «giv profilen et eget navn»', async () => {
  const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
  try {
    const p = await port(m);
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    const a2 = await installation(p, 'A2', { instance: I1, profile: 'arbejde' });
    assert.ok(await hilst(m, 2));
    const r = await kald(m);
    assert.equal(r.svar?.error, 'profile-ambiguous', JSON.stringify(r));
    assert.match(r.svar.note, /copied Chrome profile/);
    assert.doesNotMatch(r.svar.note, /its own name/, 'vaerktoejet raader til at omdoebe en kopi - det hjaelper ikke');
    assert.deepEqual([a.kom.length, a2.kom.length], [0, 0]);
  } finally { m.luk(); }
});

// ── R119: rest E (blandet kopi + anden installation) og ventetidens graense ──

// Blandingen: kopien (I1 to gange) plus en anden installation (I2), alle med navnet. Begge raad skal staa i BAADE vaerktoejets
// svar og diagnosen - og uafhaengigt af, hvilken raekkefoelge forbindelserne kom i (Opus maalte 3/8 kopiraad, 5/8 navneraad).
for (const [navn, raekke] of [['kopien foerst', ['A', 'A2', 'B']], ['den anden foerst', ['B', 'A', 'A2']]]) {
  test(`R119 rest E (${navn}): kopi + anden installation med samme navn - vaerktoej og diagnose giver begge raad`, async () => {
    const m = await bro({ BROWSER_MCP_PROFILE: 'arbejde' });
    try {
      const p = await port(m);
      const inst = { A: I1, A2: I1, B: I2 };
      const e = [];
      for (const x of raekke) e.push(await installation(p, x, { instance: inst[x], profile: 'arbejde' }));
      assert.ok(await hilst(m, 3));
      const r = await kald(m);
      assert.equal(r.svar?.error, 'profile-ambiguous', JSON.stringify(r));
      assert.match(r.svar.note, /copied Chrome profile/, `vaerktoejet naevner ikke kopien: ${r.svar.note}`);
      assert.match(r.svar.note, /its own name/, `vaerktoejet naevner ikke navnene: ${r.svar.note}`);
      assert.match(r.svar.note, new RegExp(I1), 'vaerktoejet siger ikke, hvilken installation der er kopieret');
      const d = JSON.parse(JSON.stringify(m.k('profilDiagnose(standardBane, activeConnection(standardBane))')));
      assert.equal(d?.error, 'profile-ambiguous', JSON.stringify(d));
      assert.match(d.finding, /copied Chrome profile/, `diagnosen naevner ikke kopien: ${d.finding}`);
      assert.match(d.fix, /Close the copied Chrome profile/, `diagnosen giver ikke kopiraadet: ${d.fix}`);
      assert.match(d.fix, /its own name/, `diagnosen giver ikke navneraadet: ${d.fix}`);
      assert.deepEqual(e.map((x) => x.kom.length), [0, 0, 0]);
    } finally { m.luk(); }
  });
}

test('R119: ventetiden foer foerste valg er serverens egne ~2,5 s - hverken kortere (1,2/1,7 s) eller laengere', async () => {
  const base = await ledigtSpaend(5);
  // Kildens FOERSTE_VALG_MS (null = ikke kortet); genforsoeget er kortet, saa kun ventetiden maales.
  const m = broModel({ BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 4) }, { genforsoegMs: 100, foersteValgMs: null });
  try {
    const svar = kald(m);
    const p = await venteTil(() => m.k('standardBane.activePort'), 3000);
    const bundet = m.k('standardBane.portBundetTid');
    const a = await installation(p, 'A', { instance: I1, profile: 'arbejde' });
    let ankom = 0;
    assert.ok(await venteTil(() => { if (a.kom.length && !ankom) ankom = Date.now(); return a.kom.length; }, 8000, 5));
    await svar;
    const ms = ankom - bundet;
    // Nedre graense kan belastning ikke bryde (ventetiden er mindst resten af vinduet); oevre graense har god margen.
    assert.ok(ms >= 2450, `foerste kommando efter ${ms} ms - ventetiden er kortere end 2,5 s`);
    assert.ok(ms < 3600, `foerste kommando efter ${ms} ms - ventetiden er laengere end 2,5 s`);
  } finally { m.luk(); }
});

test('R119 rest E (aegte server): browser_list_tabs og browser_provide_feedback giver samme to raad i begge raekkefoelger', async () => {
  for (const raekke of [['A', 'A2', 'B'], ['B', 'A', 'A2']]) {
    const hjem = mkdtempSync(join(tmpdir(), 'bmcp-r119-'));
    const s = await aegteServer({ BROWSER_MCP_PROFILE: 'arbejde', HOME: hjem, USERPROFILE: hjem });
    try {
      const id = s.send('browser_list_tabs');
      const p = await s.lytter();
      const inst = { A: I1, A2: I1, B: I2 };
      for (const x of raekke) await installation(p, x, { instance: inst[x], profile: 'arbejde' });
      const r = JSON.parse((await s.svar(id)).result.content[0].text);
      const fb = JSON.parse((await s.svar(s.send('browser_provide_feedback', { what_happened: 'proeve' }))).result.content[0].text);
      const hvor = raekke.join(',');
      assert.equal(r.error, 'profile-ambiguous', hvor);
      for (const [tekst, flade] of [[r.note, 'vaerktoejet'], [fb.fix_steps.join(' '), 'diagnosen']]) {
        assert.match(tekst, /Close the copied Chrome profile/, `${hvor}: ${flade} giver ikke kopiraadet`);
        assert.match(tekst, /its own name/, `${hvor}: ${flade} giver ikke navneraadet`);
      }
      assert.equal(fb.verdict, 'conflict', hvor);
    } finally { s.srv.kill(); rmSync(hjem, { recursive: true, force: true }); }
  }
});
