/**
 * execute_script koerer brugerens kode HOEJST én gang - og venter paa et Promise.
 *
 * MAALT 10/9 af Astra (anden runde), reproduceret med en taeller: kode der udfoerte en effekt og SAA kastede, gav i
 * MAIN-verdenen en fejl, og handleren gik videre til debuggeren, som koerte koden igen. To effekter. MAALT 11/9 (R5 F4):
 * forsvandt siden, mens koden ventede paa et Promise, koerte debuggeren den igen - to POST'er.
 *
 * 1.31.0: agentens kode koeres KUN gennem debuggeren (Runtime.evaluate), saa der er ingen anden vej at falde videre til.
 * Proeverne fastholder de samme to regler paa den ene vej, der er tilbage: koden afventes, og den sendes én gang.
 * Den fulde daekning af den nye vej staar i test/agentkode-debugger.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele(evaluate) {
  const taeller = { scripting: 0, cdp: 0, params: [] };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'scripting.executeScript': () => { taeller.scripting++; return [{ result: { __ok: true, value: 'fra-scripting' } }]; },
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'Runtime.evaluate') { taeller.cdp++; taeller.params.push(p); return evaluate(p); }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, taeller };
}

test('kode der koerte og kastede, koeres ikke igen', async () => {
  const { u, taeller } = sele(() => ({ exceptionDetails: { text: 'Uncaught', exception: { className: 'Error', description: 'Error: boom efter effekt\n    at <anonymous>:1:16' } } }));
  const svar = await u.hent('dispatch')(9876, 'execute_script', { code: "(() => { throw new Error('boom efter effekt'); })()" });
  assert.equal(taeller.cdp, 1, `koden blev koert ${taeller.cdp} gange: ${JSON.stringify(svar)}`);
  assert.equal(taeller.scripting, 0, 'ingen anden vej efter debuggeren');
  assert.equal(svar.ok, false);
  assert.match(String(svar.error), /boom efter effekt/, 'kalderen skal se kodens egen fejl');
});

test('et Promise afventes - debuggeren faar awaitPromise, og vaerdien kommer tilbage', async () => {
  const { u, taeller } = sele(() => ({ result: { type: 'number', value: 42 } }));
  const svar = await u.hent('dispatch')(9876, 'execute_script', { code: 'Promise.resolve(42)' });
  assert.equal(taeller.params[0].awaitPromise, true, 'uden awaitPromise svarer Chrome med selve Promise-objektet');
  assert.equal(svar.result, 42, `fik ${String(svar.result)} i stedet for 42`);
});

test('kode der ikke kan oversaettes (syntaks), giver kodens egen fejl - én evaluering', async () => {
  const { u, taeller } = sele(() => ({ exceptionDetails: { text: 'Uncaught', exception: { className: 'SyntaxError', description: "SyntaxError: Unexpected token ')'" } } }));
  const svar = await u.hent('dispatch')(9876, 'execute_script', { code: '(((' });
  assert.equal(taeller.cdp, 1);
  assert.equal(svar.ok, false);
  assert.equal(svar.name, 'SyntaxError');
});

test('forsvinder siden mens koden koerer, koeres den ikke igen', async () => {
  const { u, taeller } = sele(() => { throw new Error('Execution context was destroyed.'); });
  const svar = await u.hent('dispatch')(9876, 'execute_script', { code: 'fetch("/api/ordre", { method: "POST" }).then(() => 1)' })
    .then((r) => r, (e) => ({ kastet: e.message }));
  assert.equal(taeller.cdp, 1, `koden blev sendt ${taeller.cdp} gange: ${JSON.stringify(svar)}`);
  assert.equal(taeller.scripting, 0);
  assert.match(svar.kastet || '', /MAY already have run/, 'kalderen skal have at vide at koden kan have koert');
});
