/**
 * wait_for_network maa ikke komme over serverens 30 s, fordi body-hentningen faar sin egen lange frist.
 *
 * MAALT 11/9 af Astra (e2e-review af 1f52333): wait_for_network(timeout: 20000), svaret kommer efter 13 s, og body tager
 * 18 s mere. 1.29.0: body-kaldet blev skaaret ved 8 s, svar efter 21 s med ok:true, status 200, body:null. HEAD: body fik
 * CDP_FRIST_TUNG_MS (20 s), svaret kom efter 31 s, og serveren havde opgivet ved 30 s ("Command timed out").
 * Body-hentningen maa kun bruge den tid der er tilbage af vaerktoejets budget; ellers er svaret body:null som i 1.29.0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const FANE = { id: 1, url: 'https://x.example/', windowId: 1, active: true };

function sele({ svarEfterMs, bodyEfterMs }) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': FANE, 'tabs.query': [FANE],
    'debugger.sendCommand': (_m, metode) => {
      if (metode === 'Network.getResponseBody') {
        return new Promise((ok) => setTimeout(() => ok({ body: '{"ok":true}' }), bodyEfterMs));
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  // Svaret paa den ventede forespoergsel kommer efter svarEfterMs.
  setTimeout(() => u.fyr('debugger.onEvent', { tabId: 1 }, 'Network.responseReceived', {
    requestId: 'r1', response: { url: 'https://x.example/api/data', status: 200 },
  }), svarEfterMs);
  return u;
}

test('en body der tager for lang tid, skaeres ved budgettet - svaret naar frem foer serverens frist', { timeout: 20000 }, async () => {
  // Skaleret 1:100: svaret efter 13 s, body efter 18 s mere, serverens loft 30 s, budgettet 28 s.
  const u = sele({ svarEfterMs: 130, bodyEfterMs: 250 });
  u.ctx.netvaerkBudgetMs = () => 280;
  const t0 = Date.now();
  const svar = await u.hent('dispatch')(9876, 'wait_for_network', { url_pattern: '/api/', timeout: 200 });
  const brugt = Date.now() - t0;
  assert.ok(brugt < 300, `svaret kom efter ${brugt} ms (skaleret) - serveren opgiver ved 300`);
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(svar.status, 200);
  assert.equal(svar.body, null, 'en body der ikke naaede frem inden budgettet er null, som i 1.29.0');
});

test('en body der naar frem inden budgettet, kommer med (positiv kontrol)', { timeout: 20000 }, async () => {
  const u = sele({ svarEfterMs: 30, bodyEfterMs: 20 });
  u.ctx.netvaerkBudgetMs = () => 280;
  const svar = await u.hent('dispatch')(9876, 'wait_for_network', { url_pattern: '/api/', timeout: 200 });
  assert.equal(svar.body, '{"ok":true}', JSON.stringify(svar));
});
