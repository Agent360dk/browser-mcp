/**
 * execute_script koerer brugerens kode HOEJST én gang - og venter paa et Promise.
 *
 * MAALT 10/9 af Astra (anden runde), reproduceret med en taeller: kode der udfoerte en effekt og
 * SAA kastede, gav i MAIN-verdenen __scriptingError, og handleren gik videre til debuggeren, som
 * koerte koden igen. To effekter. `sendt`-flaget fra foerste runde beskyttede kun debugger-loekken.
 * Samme runde: scripting-stierne afventede ikke et Promise, saa "Promise.resolve(42)" gav {}.
 *
 * Stubben koerer den RIGTIGE injicerede funktion (o.func), saa det er udvidelsens kode der proeves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele() {
  const taeller = { main: 0, cdp: 0 };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'scripting.executeScript': async (o) => {
      // ISOLATED: udvidelsens egen CSP blokerer new Function - saadan ser det ud i Chrome.
      if (o.world === 'ISOLATED') throw new Error("Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source");
      taeller.main++;
      return [{ result: await o.func(...o.args) }];
    },
    'debugger.sendCommand': (_m, metode) => {
      if (metode === 'Runtime.evaluate') { taeller.cdp++; return { result: { type: 'string', value: 'fra-cdp' } }; }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, taeller };
}

test('kode der koerte og kastede, koeres ikke igen via debuggeren', async () => {
  const { u, taeller } = sele();
  const svar = await u.hent('dispatch')(9876, 'execute_script', { code: "(() => { throw new Error('boom efter effekt'); })()" });
  assert.equal(taeller.main, 1);
  assert.equal(taeller.cdp, 0, `koden blev koert ${1 + taeller.cdp} gange: ${JSON.stringify(svar)}`);
  assert.equal(svar.ok, false);
  assert.match(String(svar.error), /boom efter effekt/, 'kalderen skal se kodens egen fejl');
});

test('et Promise afventes - Promise.resolve(42) giver 42', async () => {
  const { u } = sele();
  const svar = await u.hent('dispatch')(9876, 'execute_script', { code: 'Promise.resolve(42)' });
  assert.equal(svar.result, 42, `fik ${String(svar.result)} i stedet for 42`);
});

test('kode der ikke kan oversaettes (sidens CSP, syntaks) naar stadig debuggeren', async () => {
  // Positiv kontrol: oversaettelsen koerer INTET, saa her maa debuggeren gerne proeve.
  const { u, taeller } = sele();
  await u.hent('dispatch')(9876, 'execute_script', { code: '(((' });
  assert.equal(taeller.cdp > 0, true, 'en oversaettelsesfejl skal stadig give debuggeren en chance');
});
