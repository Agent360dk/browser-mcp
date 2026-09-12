/**
 * wait_for_network maa ikke komme over serverens 30 s - og maa ikke skaere en body over som 1.29.0 leverede.
 *
 * MAALT 11/9 af Astra (e2e-review af 1f52333): wait_for_network(timeout: 20000), svaret kommer efter 13 s, og body tager
 * 18 s mere. 1.29.0: body-kaldet blev skaaret ved 8 s, svar efter 21 s med ok:true, status 200, body:null. HEAD: body fik
 * CDP_FRIST_TUNG_MS (20 s), svaret kom efter 31 s, og serveren havde opgivet ved 30 s ("Command timed out").
 * MAALT 11/9 af Astra (efterproevning af c826f63): budgettet paa 28 s skar en body over der kom efter 27 s + 2 s. 1.29.0
 * leverede den efter 29 s. Body-kaldet faar derfor aldrig kortere tid end 1.29.0's 8 s, og aldrig mere end budgettet kraever.
 *
 * Proeverne maaler IKKE paa vaeguret. De lader body'en lande MELLEM de to mulige frister, saa svaret er et ja/nej:
 * med budgettet er body'en null, uden det kommer den med. Et ur, der skrider under belastning, kan ikke flytte det.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const FANE = { id: 1, url: 'https://x.example/', windowId: 1, active: true };

// Skaleret 1:10. Serverens loft 30 s = 3000 ms, budgettet 28 s = 2800, 1.29.0's body-frist 8 s = 800,
// den lange CDP-frist 20 s = 2000.
const BUDGET = 2800, BODY_MIN = 800, BODY_MAX = 2000;

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
  // (netvaerkBudgetMs er c826f63's navn; overskrives ogsaa, saa proeven kan blive roed paa den udgave.)
  u.ctx.netvaerkBudgetMs = () => BUDGET;
  u.ctx.netvaerkFrister = () => ({ budgetMs: BUDGET, bodyMinMs: BODY_MIN, bodyMaxMs: BODY_MAX });
  // Uret startes FOERST naar dispatch er kaldt. Ellers loeber proevens ur fra sele() mens budgettet loeber fra
  // dispatch, og forskellen (VM-opstart under belastning) flytter fristen - det gjorde proeven flaky 12/9.
  u.startSvar = () => setTimeout(() => u.fyr('debugger.onEvent', { tabId: 1 }, 'Network.responseReceived', {
    requestId: 'r1', response: { url: 'https://x.example/api/data', status: 200 },
  }), svarEfterMs);
  return u;
}

test('en body der tager for lang tid, skaeres ved budgettet - svaret naar frem foer serverens frist', { timeout: 30000 }, async () => {
  // Svar efter 15 s: der er 13 s tilbage af budgettet, og body'en kommer foerst efter 17 s.
  // Med budgettet skaeres den ved 13 s (svar i alt 28 s, under serverens 30). Uden budgettet ville den faa
  // CDP-fristen paa 20 s, naa frem - og svaret ville lande efter 35 s, hvor serveren for laengst har opgivet.
  const u = sele({ svarEfterMs: 1500, bodyEfterMs: 1700 });
  const t0 = Date.now();
  const kald = u.hent('dispatch')(9876, 'wait_for_network', { url_pattern: '/api/', timeout: BODY_MAX });
  u.startSvar();
  const svar = await kald;
  const brugt = Date.now() - t0;
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(svar.status, 200);
  assert.equal(svar.body, null, `body'en blev ikke skaaret ved budgettet: ${JSON.stringify(svar)}`);
  assert.ok(brugt < BUDGET + 1200, `svaret kom efter ${brugt} ms - budgettet blev ikke respekteret`);
});

test('en body der naar frem inden budgettet, kommer med (positiv kontrol)', { timeout: 30000 }, async () => {
  const u = sele({ svarEfterMs: 200, bodyEfterMs: 150 });
  const kald = u.hent('dispatch')(9876, 'wait_for_network', { url_pattern: '/api/', timeout: BODY_MAX });
  u.startSvar();
  const svar = await kald;
  assert.equal(svar.body, '{"ok":true}', JSON.stringify(svar));
});

test('et sent svar med en hurtig body faar stadig 1.29.0\'s body-frist - body skaeres ikke over', { timeout: 30000 }, async () => {
  // Svar efter 27 s: budgettet har kun 1 s tilbage, men body-kaldet faar aldrig mindre end 1.29.0's 8 s.
  // Body'en kommer efter 2 s og skal med - praecis som 1.29.0 leverede den efter 29 s.
  const u = sele({ svarEfterMs: 2700, bodyEfterMs: 200 });
  const kald = u.hent('dispatch')(9876, 'wait_for_network', { url_pattern: '/api/', timeout: 2900 });
  u.startSvar();
  const svar = await kald;
  assert.equal(svar.body, '{"ok":true}', `body blev skaaret over hvor 1.29.0 leverede den: ${JSON.stringify(svar)}`);
});
