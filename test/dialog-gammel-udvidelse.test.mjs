/**
 * R189 (Astra + Opus, 1/11-2026): en 1.33-server foran en udvidelse fra foer 1.33.
 *
 * Butikken er dage bagud, npm minutter. Imens taler en 1.33-server med en 1.30.3- eller 1.31.0-udvidelse, og den haandhaever
 * ikke leave_page: en accept kan ogsaa svare «Leave site?», og en armering lever 60 s, ogsaa hen over et sideskift
 * (v1.30.3:background.js:6846-6849). 1.33's vaerktoejstekst lover det modsatte. Serveren holder derfor loeftet, saa laenge
 * udvidelsen ikke kan:
 *  - handle_dialog med accept (ogsaa standarden: alt andet end dismiss) og uden leave_page:true -> extension-too-old-for-
 *    leave-page, sent:false, intet sendt - naar udvidelsen ikke melder evnen (dialog_leave_page) og ikke er 1.33.0+.
 *  - med leave_page:true eller dismiss sendes den, men armeringen er hoejst 30 s (standard 30 s, ikke den gamle 60 s).
 *  - en udvidelse, der melder evnen (R190: grenens 1.33 hedder 1.31.0 til --prepare), eller er 1.33.0+, faar kaldet uroert.
 * Proeverne koerer den AEGTE bro (test/hjaelp/bro-model.mjs) med falske udvidelser paa rigtige porte.
 */
import assert from 'node:assert/strict';
import { broModel, falskUdvidelse, venteTil, proeve as test } from './hjaelp/bro-model.mjs';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

const ID = 'a'.repeat(32);
const I1 = '1111111111111111';

async function bro() {
  const base = await ledigtSpaend(5);
  return broModel({ BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 4) }, { genforsoegMs: 100 });
}

/**
 * En udvidelse paa banen med den givne version (null = melder ingen), der svarer ok paa hver kommando.
 * `evne` = hilsenens dialog_leave_page (1.33-udvidelsens), `instance` = installationens id (1.31+).
 */
async function udvidelse(m, version, { bane = 'standardBane', evne = false, instance = null } = {}) {
  assert.equal(await m.k(`sikrePort(${bane})`), true);
  const p = await m.k(`${bane}.activePort`);
  const hello = { type: 'hello', extensionId: ID, name: null };
  if (version !== null) hello.version = version;
  if (evne) hello.dialog_leave_page = true;
  if (instance) hello.instance = instance;
  const e = await falskUdvidelse(p, { id: ID, hello });
  e.ws.on('message', (d) => { const msg = JSON.parse(String(d)); if (msg.method) e.svar(msg.id, { ok: true }); });
  assert.ok(await venteTil(() => m.k(`liveConnections(${bane}).filter((c) => c.harHilst && c.version === ${JSON.stringify(version)}).length`) === 1));
  return e;
}

let n = 0;
function kald(m, method, params, bane = 'standardBane') {
  const id = '__k' + (++n);
  return new Promise((ok) => {
    m.ctx[id] = (r) => ok(JSON.parse(JSON.stringify(r)));
    m.k(`sendToExtension(${JSON.stringify(method)}, ${JSON.stringify(params)}, 5000, ${bane})` +
      `.then((r) => ${id}({ ok: r }), (e) => ${id}({ fejl: e.message, svar: e.svar || null }))`);
  });
}

/** Antal handle_dialog, udvidelsen har modtaget - efter et svar paa list_tabs, saa tidligere beskeder er naaet frem (R190). */
async function sendteDialoger(m, e, bane = 'standardBane') {
  assert.deepEqual((await kald(m, 'list_tabs', {}, bane)).ok, { ok: true });
  return e.kom.filter((k) => k.method === 'handle_dialog');
}

async function afvist(m, params, version, bane = 'standardBane') {
  const r = await kald(m, 'handle_dialog', params, bane);
  assert.equal(r.svar?.error, 'extension-too-old-for-leave-page', `${JSON.stringify(params)}: ${JSON.stringify(r)}`);
  assert.equal(r.svar.sent, false);
  assert.equal(r.svar.extension_version, version);
  assert.match(r.svar.note, /leave_page: ?true/);
  assert.match(r.svar.note, version ? new RegExp(`v${version.replace(/\./g, '\\.')}`) : /version not reported/);
}

async function uroert(m, e, params, bane = 'standardBane') {
  const foer = e.kom.length;
  const r = await kald(m, 'handle_dialog', params, bane);
  assert.deepEqual(r.ok, { ok: true }, `${JSON.stringify(params)}: ${JSON.stringify(r)}`);
  const sendt = e.kom.slice(foer).find((k) => k.method === 'handle_dialog');
  assert.deepEqual(sendt?.params, params, 'serveren aendrede kaldet til en udvidelse, der selv har vaernet');
}

for (const version of ['1.30.3', '1.31.0', null]) {
  test(`udvidelse ${version ?? 'uden version'}: accept uden leave_page afvises, intet sendes`, async () => {
    const m = await bro();
    try {
      const e = await udvidelse(m, version);
      for (const params of [{}, { action: 'accept' }, { action: 'accept', leave_page: false }, { action: 'noget-andet' },
        { leave_page: 'true' }, { wait: true }]) {
        await afvist(m, params, version);
      }
      assert.equal((await sendteDialoger(m, e)).length, 0, 'en afvist accept blev sendt til udvidelsen');
    } finally { m.luk(); }
  });
}

test('udvidelse 1.31.0: accept med leave_page:true og dismiss sendes, armeringen hoejst 30 s, wait bevares', async () => {
  const m = await bro();
  try {
    const e = await udvidelse(m, '1.31.0', { instance: I1 });
    const tilfaelde = [
      [{ action: 'accept', leave_page: true }, 30000],
      [{ leave_page: true, timeout: 60000 }, 30000],
      [{ action: 'dismiss' }, 30000],
      [{ action: 'dismiss', timeout: 5000 }, 5000],
      [{ action: 'dismiss', timeout: 0 }, 30000],
      [{ action: 'dismiss', wait: true, timeout: 120000 }, 30000],
    ];
    for (const [params, forventet] of tilfaelde) {
      const foer = e.kom.length;
      const r = await kald(m, 'handle_dialog', params);
      assert.deepEqual(r.ok, { ok: true }, `${JSON.stringify(params)}: ${JSON.stringify(r)}`);
      const sendt = e.kom.slice(foer).find((k) => k.method === 'handle_dialog');
      assert.ok(sendt, `${JSON.stringify(params)} blev ikke sendt`);
      assert.deepEqual(sendt.params, { ...params, timeout: forventet }, `${JSON.stringify(params)}: sendt som ${JSON.stringify(sendt.params)}`);
    }
  } finally { m.luk(); }
});

for (const [version, evne] of [['1.33.0', true], ['1.34.0', true], ['1.33.0', false], ['1.31.0', true]]) {
  test(`udvidelse ${version}${evne ? ' med evnen' : ' uden evnen'}: accept uden leave_page sendes uroert`, async () => {
    const m = await bro();
    try {
      const e = await udvidelse(m, version, { evne, instance: I1 });
      await uroert(m, e, {});
      await uroert(m, e, { action: 'accept', wait: true, timeout: 60000 });
    } finally { m.luk(); }
  });
}

test('samme installation opdateres og nedgraderes: afgoerelsen foelger forbindelsen, ikke banen', async () => {
  const m = await bro();
  try {
    const gammel = await udvidelse(m, '1.31.0', { instance: I1 });
    await afvist(m, {}, '1.31.0');
    gammel.luk();
    assert.ok(await venteTil(() => m.k('liveConnections(standardBane).length') === 0));
    const ny = await udvidelse(m, '1.33.0', { evne: true, instance: I1 });
    await uroert(m, ny, {});
    ny.luk();
    assert.ok(await venteTil(() => m.k('liveConnections(standardBane).length') === 0));
    const igen = await udvidelse(m, '1.31.0', { instance: I1 });
    await afvist(m, {}, '1.31.0');
    assert.equal((await sendteDialoger(m, igen)).length, 0);
  } finally { m.luk(); }
});

test('partition: vagten bruger banens egen forbindelse - en gammel paa partitionen, en ny paa standardbanen, og omvendt', async () => {
  for (const [gammelBane, nyBane] of [['B', 'standardBane'], ['standardBane', 'B']]) {
    const m = await bro();
    try {
      m.k("var B = lavBane('p-proeve', false); baner.add(B);");
      const ny = await udvidelse(m, '1.33.0', { bane: nyBane, evne: true, instance: I1 });
      const gammel = await udvidelse(m, '1.31.0', { bane: gammelBane, instance: '2222222222222222' });
      await afvist(m, {}, '1.31.0', gammelBane);
      assert.equal((await sendteDialoger(m, gammel, gammelBane)).length, 0, `${gammelBane}: en afvist accept blev sendt`);
      await uroert(m, ny, {}, nyBane);
      assert.equal(gammel.kom.filter((k) => k.method === 'handle_dialog').length, 0, 'den nye banes kald naaede den gamle');
    } finally { m.luk(); }
  }
});

test('udvidelse 1.30.3: andre vaerktoejer er uroerte af vagten', async () => {
  const m = await bro();
  try {
    const e = await udvidelse(m, '1.30.3');
    const r = await kald(m, 'list_tabs', {});
    assert.deepEqual(r.ok, { ok: true }, JSON.stringify(r));
    assert.equal(e.kom.filter((k) => k.method === 'list_tabs').length, 1);
  } finally { m.luk(); }
});
