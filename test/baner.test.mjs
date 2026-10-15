/**
 * 1.31 skive S1a: BANER i serveren - én lytterkode (createWSS) pr. bane, ét kort over ventende kald, strengt svar-tjek.
 *
 * PR #20 (ugbodagadave) tilfoejede en partition som en EKSTRA lytter med sin egen kopi af lytterkoden. R106 (Opus) MAALTE
 * fem fejl i den kopi mod falske udvidelser (pr20-proeve.mjs, head-blob 2b855053):
 *   T1  et kald paa partitionen blev besvaret af standardbanens sokkel - det forfalskede svar blev taget imod
 *   T2  omvendt: et standardkald blev besvaret af partitionens sokkel (mains svar-tjek virkede ikke laengere)
 *   T3  beskeden `null` paa en partitionssokkel draebte hele serverprocessen
 *   T4  en anden «profil», der forbandt til partitionen efter foerste kommando, fik den naeste
 *   T5  en forbindelse, der doede midt i et kald, gav foerst svar efter ~30 s, med teksten «timed out»
 * Her er de faste proever mod den AEGTE bro (test/hjaelp/bro-model.mjs), med to baner i én proces. De skal vaere groenne.
 */
import assert from 'node:assert/strict';
import { broModel, falskUdvidelse, vent, venteTil, proeve as test, sporProces } from './hjaelp/bro-model.mjs';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

// To baner: standardbanen og en ekstra (som en partition: uden pid). Begge binder i samme frie spaend.
async function toBaner() {
  const base = await ledigtSpaend(5);
  const m = broModel({ BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 4) });
  m.k("var B = lavBane('p-proeve', false); baner.add(B);");
  assert.equal(await m.k('sikrePort(standardBane)'), true, 'standardbanen fik ingen port');
  assert.equal(await m.k('sikrePort(B)'), true, 'den ekstra bane fik ingen port');
  const portA = m.k('standardBane.activePort'), portB = m.k('B.activePort');
  assert.notEqual(portA, portB, 'to baner paa samme port - proeven maaler ikke to lyttere');
  return { m, portA, portB };
}

const forbundet = (m, bane, n) => venteTil(() => m.k(`liveConnections(${bane}).filter((c) => c.harHilst).length`) >= n);

test('T1: et svar paa et kald paa den ekstra bane fra standardbanens sokkel afvises; den rigtige sokkel kan svare', async () => {
  const { m, portA, portB } = await toBaner();
  try {
    const ea = await falskUdvidelse(portA), eb = await falskUdvidelse(portB);
    assert.ok(await forbundet(m, 'standardBane', 1) && await forbundet(m, 'B', 1));
    let svar = null;
    m.ctx.__svar = (r) => { svar = r; };
    m.k("sendToExtension('list_tabs', {}, 5000, B).then((r) => __svar({ ok: r }), (e) => __svar({ fejl: e.message }))");
    assert.ok(await venteTil(() => eb.kom.length === 1), 'kaldet naaede ikke frem til den ekstra banes udvidelse');
    assert.equal(ea.kom.length, 0, 'kaldet gik ogsaa til standardbanen');
    ea.svar(eb.kom[0].id, { tabs: ['FORFALSKET af standardbanens sokkel'] });
    await vent(300);
    assert.equal(svar, null, `et svar fra en anden banes sokkel blev taget imod: ${JSON.stringify(svar)}`);
    assert.match(m.log.join(''), /Ignored a reply to command \d+ from a connection it was not sent to/);
    eb.svar(eb.kom[0].id, { tabs: ['rigtigt'] });
    assert.ok(await venteTil(() => svar));
    assert.deepEqual(svar.ok, { tabs: ['rigtigt'] });
    ea.luk(); eb.luk();
  } finally { m.luk(); }
});

test('T2: et svar paa et standardkald fra den ekstra banes sokkel afvises', async () => {
  const { m, portA, portB } = await toBaner();
  try {
    const ea = await falskUdvidelse(portA), eb = await falskUdvidelse(portB);
    assert.ok(await forbundet(m, 'standardBane', 1) && await forbundet(m, 'B', 1));
    let svar = null;
    m.ctx.__svar = (r) => { svar = r; };
    m.k("sendToExtension('list_tabs', {}, 5000).then((r) => __svar({ ok: r }), (e) => __svar({ fejl: e.message }))");
    assert.ok(await venteTil(() => ea.kom.length === 1));
    eb.svar(ea.kom[0].id, { tabs: ['FORFALSKET af den ekstra banes sokkel'] });
    await vent(300);
    assert.equal(svar, null, `standardkaldet tog imod et svar fra en anden banes sokkel: ${JSON.stringify(svar)}`);
    ea.svar(ea.kom[0].id, { tabs: [] });
    assert.ok(await venteTil(() => svar));
    assert.deepEqual(svar.ok, { tabs: [] });
    ea.luk(); eb.luk();
  } finally { m.luk(); }
});

test('T3: beskeden null paa den ekstra banes sokkel ignoreres - broen lever og svarer videre', async () => {
  const { m, portB } = await toBaner();
  const fanget = [];
  const fang = (e) => fanget.push(e);
  process.on('uncaughtException', fang);
  try {
    const eb = await falskUdvidelse(portB);
    assert.ok(await forbundet(m, 'B', 1));
    for (const raa of ['null', '[]', '7', '"x"']) eb.send(raa);
    await vent(200);
    assert.deepEqual(fanget.map((e) => e.message), [], 'en besked der ikke er et objekt kastede i lytteren');
    let svar = null;
    m.ctx.__svar = (r) => { svar = r; };
    m.k("sendToExtension('list_tabs', {}, 5000, B).then((r) => __svar({ ok: r }), (e) => __svar({ fejl: e.message }))");
    assert.ok(await venteTil(() => eb.kom.length === 1));
    eb.svar(eb.kom[0].id, { tabs: [] });
    assert.ok(await venteTil(() => svar));
    assert.ok(svar.ok, 'broen svarede ikke efter null-beskederne');
    eb.luk();
  } finally { process.off('uncaughtException', fang); m.luk(); }
});

test('T4: en ny forbindelse paa den ekstra bane efter foerste kommando overtager ikke - naeste kommando gaar til den foerste', async () => {
  const { m, portB } = await toBaner();
  try {
    const e1 = await falskUdvidelse(portB);
    assert.ok(await forbundet(m, 'B', 1));
    let svar = null;
    m.ctx.__svar = (r) => { svar = r; };
    m.k("sendToExtension('list_tabs', {}, 5000, B).then((r) => __svar({ ok: r }), (e) => __svar({ fejl: e.message }))");
    assert.ok(await venteTil(() => e1.kom.length === 1));
    e1.svar(e1.kom[0].id, { tabs: [] });
    assert.ok(await venteTil(() => svar));
    // E3: samme udvidelse, nyere version, forbinder senere - ville vinde valget, hvis banen ikke var laast.
    const e3 = await falskUdvidelse(portB, { hello: { type: 'hello', extensionId: 'a'.repeat(32), version: '9.9.9', name: null } });
    assert.ok(await forbundet(m, 'B', 2));
    svar = null;
    m.k("sendToExtension('list_tabs', {}, 5000, B).then((r) => __svar({ ok: r }), (e) => __svar({ fejl: e.message }))");
    assert.ok(await venteTil(() => e1.kom.length === 2 || e3.kom.length > 0));
    assert.deepEqual({ E1: e1.kom.length, E3: e3.kom.length }, { E1: 2, E3: 0 }, 'banen skiftede forbindelse midt i sessionen');
    e1.svar(e1.kom[1].id, { tabs: [] });
    assert.ok(await venteTil(() => svar));
    e1.luk(); e3.luk();
  } finally { m.luk(); }
});

test('T5: doer forbindelsen midt i et kald paa den ekstra bane, afvises kaldet straks med den rigtige forklaring', async () => {
  const { m, portA, portB } = await toBaner();
  try {
    const ea = await falskUdvidelse(portA), eb = await falskUdvidelse(portB);
    assert.ok(await forbundet(m, 'standardBane', 1) && await forbundet(m, 'B', 1));
    let svar = null, standard = null;
    m.ctx.__svar = (r) => { svar = r; };
    m.ctx.__standard = (r) => { standard = r; };
    m.k("sendToExtension('list_tabs', {}, 30000, B).then((r) => __svar({ ok: r }), (e) => __svar({ fejl: e.message }))");
    m.k("sendToExtension('list_tabs', {}, 30000).then((r) => __standard({ ok: r }), (e) => __standard({ fejl: e.message }))");
    assert.ok(await venteTil(() => eb.kom.length === 1 && ea.kom.length === 1));
    const t0 = Date.now();
    eb.luk();
    assert.ok(await venteTil(() => svar, 2000), 'kaldet blev ikke afvist inden for 2 s - det venter til sin frist');
    assert.ok(Date.now() - t0 < 2000);
    assert.match(svar.fejl, /disappeared while the command was running/);
    assert.doesNotMatch(svar.fejl, /timed out/);
    assert.equal(standard, null, 'et kald paa en ANDEN bane blev afvist, fordi den ekstra banes forbindelse doede');
    ea.svar(ea.kom[0].id, { tabs: [] });
    assert.ok(await venteTil(() => standard));
    assert.ok(standard.ok);
    ea.luk();
  } finally { m.luk(); }
});

test('svar-tjekket er strengt: et ventende kald uden bundet forbindelse kan ingen besvare', async () => {
  const { m, portA } = await toBaner();
  try {
    const ea = await falskUdvidelse(portA);
    assert.ok(await forbundet(m, 'standardBane', 1));
    let svar = null;
    m.ctx.__svar = (r) => { svar = r; };
    // En fremtidig vej, der glemmer at binde kaldet til sin forbindelse (R106: «fejl lukket»).
    m.k('pending.set(900001, { id: 900001, bane: standardBane, conn: undefined, timer: null, resolve: (r) => __svar({ ok: r }), reject: (e) => __svar({ fejl: e.message }) })');
    ea.svar(900001, { tabs: ['FORFALSKET'] });
    await vent(300);
    assert.equal(svar, null, 'et kald uden bundet forbindelse tog imod et svar fra en vilkaarlig sokkel');
    m.k('pending.delete(900001)');
    ea.luk();
  } finally { m.luk(); }
});

test('terminate virker kun fra banens aktive forbindelse, og kun paa dens egen bane', async () => {
  const { m, portA, portB } = await toBaner();
  try {
    const ea = await falskUdvidelse(portA);
    const e1 = await falskUdvidelse(portB);
    assert.ok(await forbundet(m, 'standardBane', 1) && await forbundet(m, 'B', 1));
    let svar = null;
    m.ctx.__svar = (r) => { svar = r; };
    m.k("sendToExtension('list_tabs', {}, 5000, B).then((r) => __svar({ ok: r }), (e) => __svar({ fejl: e.message }))");
    assert.ok(await venteTil(() => e1.kom.length === 1));
    e1.svar(e1.kom[0].id, { tabs: [] });
    assert.ok(await venteTil(() => svar));
    // E3 forbinder til samme bane og hilser - men er ikke den aktive.
    const e3 = await falskUdvidelse(portB);
    assert.ok(await forbundet(m, 'B', 2));
    e3.send({ type: 'terminate' });
    await vent(300);
    assert.equal(m.k('B.activePort'), portB, 'en INAKTIV forbindelses terminate slap banens port');
    assert.match(m.log.join(''), /terminate ignoreret - kom fra en inaktiv udvidelses-forbindelse/);
    // Standardbanens aktive forbindelse kan ikke lukke den ekstra bane.
    m.ctx.__svar = () => {};
    m.k("sendToExtension('list_tabs', {}, 5000).catch(() => {})");
    assert.ok(await venteTil(() => ea.kom.length === 1));
    ea.svar(ea.kom[0].id, { tabs: [] });
    await vent(100);
    ea.send({ type: 'terminate' });
    assert.ok(await venteTil(() => m.k('standardBane.activePort') === null), 'standardbanens aktive forbindelse kunne ikke slippe sin egen port');
    assert.equal(m.k('B.activePort'), portB, 'terminate paa standardbanen slap ogsaa den ekstra banes port');
    // Den ekstra banes aktive forbindelse slipper sin port.
    e1.send({ type: 'terminate' });
    assert.ok(await venteTil(() => m.k('B.activePort') === null), 'den aktive forbindelses terminate slap ikke porten');
    e3.luk();
  } finally { m.luk(); }
});

test('kald paa en bane uden pid sender pid null; standardbanen sender processens pid', async () => {
  const { m, portA, portB } = await toBaner();
  try {
    const ea = await falskUdvidelse(portA), eb = await falskUdvidelse(portB);
    assert.ok(await forbundet(m, 'standardBane', 1) && await forbundet(m, 'B', 1));
    m.k("sendToExtension('list_tabs', {}, 3000).catch(() => {}); sendToExtension('list_tabs', {}, 3000, B).catch(() => {})");
    assert.ok(await venteTil(() => ea.kom.length === 1 && eb.kom.length === 1));
    assert.equal(ea.kom[0].pid, 4242);
    assert.equal(eb.kom[0].pid, null, 'en partition med samme pid adopterer standardbanens efterladte faner (R106, maalt)');
    assert.notEqual(ea.kom[0].id, eb.kom[0].id, 'to baner gav samme kommando-id');
    ea.svar(ea.kom[0].id, {}); eb.svar(eb.kom[0].id, {});
    ea.luk(); eb.luk();
  } finally { m.luk(); }
});

// R119: selen maa aldrig vente uden frist (mutantkoerslen 3f8d1cd: P21/P22 hang i over 2 timer). En port, der tager imod
// TCP-forbindelsen men aldrig svarer paa WebSocket-haandtrykket, skal give en fejl - ikke et loefte, der aldrig afgoeres.
test('selen: en falsk udvidelse mod en port, der aldrig svarer, fejler inden for fristen i stedet for at haenge', async () => {
  const { createServer } = await import('node:net');
  const sokler = [];
  const stum = createServer((s) => { sokler.push(s); });
  await new Promise((ok) => stum.listen(0, '127.0.0.1', ok));
  try {
    const t0 = Date.now();
    await assert.rejects(falskUdvidelse(stum.address().port), /aabnede ikke inden for 5 s/);
    assert.ok(Date.now() - t0 < 7000);
  } finally { for (const s of sokler) s.destroy(); stum.close(); }
});
