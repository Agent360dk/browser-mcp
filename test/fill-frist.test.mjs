/**
 * fill maa ikke skrive oveni et forsinket tastetryk — og maa ikke kalde en fordobling succes.
 *
 * MAALT 10/9 af Astra: debugger-vejen timede ud, reserveloesningen skrev hele vaerdien med den
 * native setter, og tastetrykkene fra debugger-forsoeget landede bagefter. "X" blev "XX", og
 * kaldet svarede ok:true. Promise.race afbryder ikke; en frist betyder "vi ved det ikke".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };
function sele(laesninger, saetKald, naaedeTaster = []) {
  let i = 0;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    // DOM-kaldene svarer som en rigtig side, saa debuggerFill naar helt frem til tastetrykkene.
    // Tastetrykkene kvitteres aldrig -> cdpSend giver op med "svarede ikke inden".
    'debugger.sendCommand': (_m, metode) => {
      if (metode.startsWith('Input.')) { naaedeTaster.push(metode); return new Promise(() => {}); }
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      if (metode === 'Runtime.evaluate') return { result: { value: false } };
      return {};
    },
    'scripting.executeScript': ({ args }) => {
      if (args.length === 1) return [{ result: laesninger[Math.min(i++, laesninger.length - 1)] }];
      saetKald.push(args[1]);
      return [{ result: { ok: true } }];
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('en fordobling efter reserveloesningen meldes — den kaldes ikke succes', async () => {
  const saet = [], taster = [];
  const u = sele(['gammel', 'XX'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'X' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.equal(svar.ok, false, `"X" blev til "XX", og vaerktoejet sagde ${JSON.stringify(svar)}`);
  assert.equal(svar.error, 'feltet-fordoblet');
  assert.equal(svar.faktisk, 'XX', 'kalderen skal se hvad der faktisk staar i feltet');
});

test('staar vaerdien der allerede efter fristen, skrives den ikke en gang til', async () => {
  const saet = [], taster = [];
  const u = sele(['X'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'X' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.equal(svar.ok, true);
  assert.equal(saet.length, 0, `reserveloesningen skrev ${saet.length} gang(e) oveni en vaerdi der allerede var landet`);
});

test('et felt der formaterer vaerdien, meldes ikke som fejl', async () => {
  const saet = [], taster = [];
  const u = sele(['', '+45 12 34 56 78'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: '12345678' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.equal(svar.ok, true, 'formatering er ikke en fordobling — kun gentagelsen af vaerdien er');
});

test('en formatering der tilfoejer tegn ("5" -> "5,00 kr") er ikke en fordobling', async () => {
  const saet = [], taster = [];
  const u = sele(['', '5,00 kr'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: '5' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.equal(svar.ok, true, `et beloebsfelt der formaterer blev meldt som fejl: ${JSON.stringify(svar)}`);
});

test('et felt der blev toemt igen af et forsinket Cmd+A/Backspace meldes', async () => {
  const saet = [], taster = [];
  const u = sele(['', ''], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'abc' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.equal(svar.ok, false, `feltet endte tomt og vaerktoejet sagde ${JSON.stringify(svar)}`);
  assert.equal(svar.error, 'feltet-toemt');
});
