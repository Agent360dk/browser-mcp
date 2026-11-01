/**
 * R189 (Astra + Opus, 1/11-2026): en 1.33-server foran en udvidelse fra foer 1.33.
 *
 * Butikken er dage bagud, npm minutter. Imens taler en 1.33-server med en 1.30.3- eller 1.31.0-udvidelse, og den svarer
 * accept paa ENHVER dialog - ogsaa «Leave site?» - og holder en armering 60 s (v1.30.3:background.js:6846-6848). 1.33's
 * vaerktoejstekst lover agenten det modsatte: en armeret accept svarer aldrig «Leave site?» uden leave_page, hoejst 30 s.
 * Serveren holder derfor loeftet, saa laenge udvidelsen ikke kan:
 *  - handle_dialog med accept (ogsaa standarden: alt andet end dismiss) og uden leave_page:true -> extension-too-old-for-
 *    leave-page, sent:false, intet sendt - naar udvidelsens version er ukendt eller under 1.33.0.
 *  - med leave_page:true eller dismiss sendes den, men armeringen er hoejst 30 s (standard 30 s, ikke den gamle 60 s).
 *  - en udvidelse paa 1.33.0 eller nyere faar kaldet uroert; andre vaerktoejer er uroerte.
 * Proeverne koerer den AEGTE bro (test/hjaelp/bro-model.mjs) med falske udvidelser paa rigtige porte.
 */
import assert from 'node:assert/strict';
import { broModel, falskUdvidelse, venteTil, proeve as test } from './hjaelp/bro-model.mjs';
import { ledigtSpaend } from './hjaelp/ledigt-spaend.mjs';

const ID = 'a'.repeat(32);

async function bro() {
  const base = await ledigtSpaend(5);
  return broModel({ BROWSER_MCP_BASE_PORT: String(base), BROWSER_MCP_MAX_PORT: String(base + 4) }, { genforsoegMs: 100 });
}

/** En udvidelse med den givne version (null = for gammel til at oplyse den), der svarer ok paa hver kommando. */
async function udvidelse(m, version) {
  assert.equal(await m.k('sikrePort(standardBane)'), true);
  const p = await m.k('standardBane.activePort');
  const hello = { type: 'hello', extensionId: ID, name: null };
  if (version !== null) hello.version = version;
  const e = await falskUdvidelse(p, { id: ID, hello });
  e.ws.on('message', (d) => { const msg = JSON.parse(String(d)); if (msg.method) e.svar(msg.id, { ok: true }); });
  assert.ok(await venteTil(() => m.k('liveConnections(standardBane).filter((c) => c.harHilst).length') === 1));
  return e;
}

let n = 0;
function kald(m, method, params) {
  const id = '__k' + (++n);
  return new Promise((ok) => {
    m.ctx[id] = (r) => ok(JSON.parse(JSON.stringify(r)));
    m.k(`sendToExtension(${JSON.stringify(method)}, ${JSON.stringify(params)}, 5000)` +
      `.then((r) => ${id}({ ok: r }), (e) => ${id}({ fejl: e.message, svar: e.svar || null }))`);
  });
}

for (const version of ['1.30.3', '1.31.0', null]) {
  test(`udvidelse ${version ?? 'uden version'}: accept uden leave_page afvises, intet sendes`, async () => {
    const m = await bro();
    try {
      const e = await udvidelse(m, version);
      for (const params of [{}, { action: 'accept' }, { action: 'accept', leave_page: false }, { action: 'noget-andet' }]) {
        const r = await kald(m, 'handle_dialog', params);
        assert.equal(r.svar?.error, 'extension-too-old-for-leave-page', `${JSON.stringify(params)}: ${JSON.stringify(r)}`);
        assert.equal(r.svar.sent, false);
        assert.equal(r.svar.extension_version, version);
        assert.match(r.svar.note, /leave_page: ?true/);
      }
      assert.equal(e.kom.filter((k) => k.method === 'handle_dialog').length, 0, 'en afvist accept blev sendt til udvidelsen');
    } finally { m.luk(); }
  });
}

test('udvidelse 1.31.0: accept med leave_page:true og dismiss sendes, armeringen hoejst 30 s', async () => {
  const m = await bro();
  try {
    const e = await udvidelse(m, '1.31.0');
    const tilfaelde = [
      [{ action: 'accept', leave_page: true }, 30000],
      [{ leave_page: true, timeout: 60000 }, 30000],
      [{ action: 'dismiss' }, 30000],
      [{ action: 'dismiss', timeout: 5000 }, 5000],
    ];
    for (const [params, forventet] of tilfaelde) {
      const foer = e.kom.length;
      const r = await kald(m, 'handle_dialog', params);
      assert.deepEqual(r.ok, { ok: true }, `${JSON.stringify(params)}: ${JSON.stringify(r)}`);
      const sendt = e.kom.slice(foer).find((k) => k.method === 'handle_dialog');
      assert.ok(sendt, `${JSON.stringify(params)} blev ikke sendt`);
      assert.equal(sendt.params.timeout, forventet, `${JSON.stringify(params)}: armeringen sendt med ${sendt.params.timeout}`);
    }
  } finally { m.luk(); }
});

for (const version of ['1.33.0', '1.34.0']) test(`udvidelse ${version}: accept uden leave_page sendes uroert - udvidelsen holder selv loeftet`, async () => {
  const m = await bro();
  try {
    const e = await udvidelse(m, version);
    const r = await kald(m, 'handle_dialog', {});
    assert.deepEqual(r.ok, { ok: true }, JSON.stringify(r));
    const sendt = e.kom.find((k) => k.method === 'handle_dialog');
    assert.deepEqual(sendt.params, {}, 'serveren aendrede kaldet til en udvidelse, der selv har vaernet');
  } finally { m.luk(); }
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
