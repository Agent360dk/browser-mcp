/**
 * 1.33-F13 (19/11-2026, kompatibilitetsgennemgangen): en 1.33-server foran en udvidelse fra foer 1.33 - browser_wait.
 *
 * 1.30.3 (v1.30.3:background.js:6191-6212) og 1.31.0 (b99362d:background.js:6421) svarer found:true, saa snart selektoren
 * matcher noget, ogsaa et display:none-element, og kender ikke state. 1.33's vaerktoejstekst lover «found is true only for a
 * match that can be seen». Serveren holder derfor loeftet ærligt, saa laenge udvidelsen ikke kan:
 *  - found:true fra en gammel udvidelse (state visible eller ingen) -> visible:'unknown', visibility_checked:false + note.
 *  - state:'attached' -> uroert (det er netop «findes», som den gamle maaler).
 *  - en ukendt state (fx 'hidden') -> afvist foer afsendelse, som 1.33-udvidelsen afviser den (R173); intet sendt.
 *  - found:false -> uroert.
 *  - en 1.33-udvidelse (evnen dialog_leave_page eller 1.33.0+) -> svaret uroert.
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

/** En udvidelse, der svarer `ventSvar` paa wait og { ok: true } paa alt andet. */
async function udvidelse(m, version, ventSvar, { evne = false } = {}) {
  assert.equal(await m.k('sikrePort(standardBane)'), true);
  const p = await m.k('standardBane.activePort');
  const hello = { type: 'hello', extensionId: ID, name: null };
  if (version !== null) hello.version = version;
  if (evne) hello.dialog_leave_page = true;
  const e = await falskUdvidelse(p, { id: ID, hello });
  e.ws.on('message', (d) => {
    const msg = JSON.parse(String(d));
    if (msg.method) e.svar(msg.id, msg.method === 'wait' ? ventSvar : { ok: true });
  });
  assert.ok(await venteTil(() => m.k(`liveConnections(standardBane).filter((c) => c.harHilst && c.version === ${JSON.stringify(version)}).length`) === 1));
  return e;
}

let n = 0;
function kald(m, method, params) {
  const id = '__k' + (++n);
  return new Promise((ok) => {
    m.ctx[id] = (r) => ok(JSON.parse(JSON.stringify(r)));
    m.k(`sendToExtension(${JSON.stringify(method)}, ${JSON.stringify(params)}, 5000, standardBane)` +
      `.then((r) => ${id}({ ok: r }), (e) => ${id}({ fejl: e.message }))`);
  });
}

async function sendteVent(m, e) {
  assert.deepEqual((await kald(m, 'list_tabs', {})).ok, { ok: true });
  return e.kom.filter((k) => k.method === 'wait');
}

for (const version of ['1.30.3', '1.31.0', null]) {
  test(`udvidelse ${version ?? 'uden version'}: found:true uden synlighedstjek siges, ikke tales op`, async () => {
    const m = await bro();
    try {
      const e = await udvidelse(m, version, { found: true });
      for (const params of [{ selector: '#x' }, { selector: '#x', state: 'visible' }]) {
        const r = await kald(m, 'wait', params);
        assert.equal(r.ok?.found, true, `${JSON.stringify(params)}: ${JSON.stringify(r)}`);
        assert.equal(r.ok.visible, 'unknown', `${JSON.stringify(params)}: ${JSON.stringify(r)}`);
        assert.equal(r.ok.visibility_checked, false);
        assert.equal(r.ok.extension_version, version);
        assert.match(r.ok.note, /not that it can be seen/);
        assert.match(r.ok.note, version ? new RegExp(`v${version.replace(/\./g, '\\.')}`) : /version not reported/);
      }
      assert.equal((await sendteVent(m, e)).length, 2);
    } finally { m.luk(); }
  });
}

test('udvidelse 1.30.3: state attached og found:false er uroerte', async () => {
  const m = await bro();
  try {
    await udvidelse(m, '1.30.3', { found: true, method: 'debugger' });
    assert.deepEqual((await kald(m, 'wait', { selector: '#x', state: 'attached' })).ok, { found: true, method: 'debugger' });
  } finally { m.luk(); }
  const m2 = await bro();
  try {
    await udvidelse(m2, '1.30.3', { found: false });
    assert.deepEqual((await kald(m2, 'wait', { selector: '#x' })).ok, { found: false });
  } finally { m2.luk(); }
});

test('udvidelse 1.31.0: en ukendt state afvises foer afsendelse, som 1.33-udvidelsen afviser den', async () => {
  const m = await bro();
  try {
    const e = await udvidelse(m, '1.31.0', { found: true });
    for (const state of ['hidden', 'detached', 'Visible']) {
      const r = await kald(m, 'wait', { selector: '#spinner', state });
      assert.match(r.fejl || '', /state must be "visible" or "attached"/, `${state}: ${JSON.stringify(r)}`);
    }
    assert.equal((await sendteVent(m, e)).length, 0, 'et afvist wait blev sendt til udvidelsen');
  } finally { m.luk(); }
});

for (const [version, evne] of [['1.33.0', false], ['1.34.0', false], ['1.31.0', true]]) {
  test(`udvidelse ${version}${evne ? ' med 1.33-evnen' : ''}: svaret er uroert`, async () => {
    const m = await bro();
    try {
      await udvidelse(m, version, { found: true, visible: true }, { evne });
      assert.deepEqual((await kald(m, 'wait', { selector: '#x' })).ok, { found: true, visible: true });
      const e2 = (await kald(m, 'wait', { selector: '#x', state: 'hidden' }));
      assert.deepEqual(e2.ok, { found: true, visible: true }, 'en 1.33-udvidelse afgoer selv en ukendt state');
    } finally { m.luk(); }
  });
}
