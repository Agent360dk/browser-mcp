/**
 * wait_for_network maa ikke komme over serverens 30 s - og maa ikke skaere en body over som 1.29.0 leverede.
 *
 * MAALT 11/9 af Astra (e2e-review af 1f52333): wait_for_network(timeout: 20000), svaret kommer efter 13 s, og body tager
 * 18 s mere. 1.29.0: body-kaldet blev skaaret ved 8 s, svar efter 21 s med ok:true, status 200, body:null. HEAD: body fik
 * CDP_FRIST_TUNG_MS (20 s), svaret kom efter 31 s, og serveren havde opgivet ved 30 s ("Command timed out").
 * MAALT 11/9 af Astra (efterproevning af c826f63): budgettet paa 28 s skar en body over der kom efter 27 s + 2 s. 1.29.0
 * leverede den efter 29 s. Body-kaldet faar derfor aldrig kortere tid end 1.29.0's 8 s, og aldrig mere end budgettet kraever.
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
  // Skaleret ca. 1:30 (ikke 1:100): under belastning skred de smaa tal, og en proeve der falder tilfaeldigt spaerrer en
  // udgivelse uden grund (Fable, e2e runde 2). Serverens loft 30 s = 1000 ms, budgettet 28 s = 930, 1.29.0's body-frist
  // 8 s = 270, den lange frist 20 s = 670.
  // (netvaerkBudgetMs er c826f63's navn; overskrives ogsaa, saa testen kan blive roed paa den udgave.)
  u.ctx.netvaerkBudgetMs = () => 930;
  u.ctx.netvaerkFrister = () => ({ budgetMs: 930, bodyMinMs: 270, bodyMaxMs: 670 });
  setTimeout(() => u.fyr('debugger.onEvent', { tabId: 1 }, 'Network.responseReceived', {
    requestId: 'r1', response: { url: 'https://x.example/api/data', status: 200 },
  }), svarEfterMs);
  return u;
}

test('en body der tager for lang tid, skaeres ved budgettet - svaret naar frem foer serverens frist', { timeout: 20000 }, async () => {
  const u = sele({ svarEfterMs: 430, bodyEfterMs: 830 });   // svar efter 13 s, body 25 s senere
  const t0 = Date.now();
  const svar = await u.hent('dispatch')(9876, 'wait_for_network', { url_pattern: '/api/', timeout: 670 });
  const brugt = Date.now() - t0;
  assert.ok(brugt < 1000, `svaret kom efter ${brugt} ms (skaleret) - serveren opgiver ved 1000`);
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(svar.status, 200);
  assert.equal(svar.body, null, 'en body der ikke naaede frem inden budgettet er null, som i 1.29.0');
});

test('en body der naar frem inden budgettet, kommer med (positiv kontrol)', { timeout: 20000 }, async () => {
  const u = sele({ svarEfterMs: 100, bodyEfterMs: 70 });
  const svar = await u.hent('dispatch')(9876, 'wait_for_network', { url_pattern: '/api/', timeout: 670 });
  assert.equal(svar.body, '{"ok":true}', JSON.stringify(svar));
});

test('et sent svar med en hurtig body faar stadig 1.29.0\'s body-frist - body skaeres ikke over', { timeout: 20000 }, async () => {
  const u = sele({ svarEfterMs: 900, bodyEfterMs: 70 });   // svar efter 27 s, body 2 s senere (1.29.0: leveret efter 29 s)
  const svar = await u.hent('dispatch')(9876, 'wait_for_network', { url_pattern: '/api/', timeout: 980 });
  assert.equal(svar.body, '{"ok":true}', `body blev skaaret over hvor 1.29.0 leverede den: ${JSON.stringify(svar)}`);
});
