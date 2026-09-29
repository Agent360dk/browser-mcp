/**
 * select_option maa ikke kalde et valg «rullet tilbage», fordi siden gemmer det asynkront.
 *
 * MAALT 28/9 paa Railway (backlog 1.30.2 #11): en native <select> styret af React. Svaret var
 * ok:false · landed:false · «the field is on NONE, and nothing else on the page changed» - men en frisk
 * indlaesning viste den nye vaerdi GEMT. Tjekket kiggede efter 150 ms, foer siden havde gemt og tegnet
 * igen. Den farlige retning: agenten tror valget fejlede og proever igen eller goer noget andet.
 * Den modsatte retning skal staa: et felt der VIRKELIG afviser valget, er stadig «rullet tilbage».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/** En native select der svarer NONE, indtil `gemmerEfter` ms er gaaet; derefter `derefter`. */
function seleMedSelect({ gemmerEfter = Infinity, derefter = { value: 'b', aftryk: '3|222' } } = {}) {
  let valgtKl = null;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://railway.example', windowId: 1 },
    'tabs.query': [{ id: 1, url: 'https://railway.example', windowId: 1, active: true }],
    'debugger.sendCommand': (_maal, metode, p) => {
      if (metode !== 'Runtime.evaluate') return {};
      const udtryk = String(p?.expression || '');
      if (udtryk.includes("tagName === 'SELECT'")) return { result: { value: true } };
      if (udtryk.includes("dispatchEvent(new Event('change'")) {
        valgtKl = Date.now();
        return { result: { value: JSON.stringify({ found: true, wanted: 'b', actual: 'NONE', text: 'B', foer: '3|111' }) } };
      }
      if (udtryk.includes('aftryk:')) {
        const gemt = valgtKl !== null && Date.now() - valgtKl >= gemmerEfter;
        return { result: { value: JSON.stringify(gemt ? derefter : { value: 'NONE', aftryk: '3|111' }) } };
      }
      return { result: { value: null } };
    },
  } });
  u.hent('sessions').set(9876, { label: 'Claude 1', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1, pid: 'p1' });
  return u;
}

test('et valg siden gemmer efter 600 ms, meldes som landet - ikke som rullet tilbage', async () => {
  const svar = await seleMedSelect({ gemmerEfter: 600 }).hent('dispatch')(9876, 'select_option', { selector: '#region', option: 'b' });
  assert.equal(svar.type, 'native_select', `proeven naaede ikke native-stien: ${JSON.stringify(svar)}`);
  assert.equal(svar.ok, true, `et gemt valg blev meldt som fejl: ${JSON.stringify(svar)}`);
  assert.equal(svar.value, 'b');
});

test('siden aendrer sig foerst efter 600 ms: uvist, ikke en skarp benaegtelse', async () => {
  const svar = await seleMedSelect({ gemmerEfter: 600, derefter: { value: 'NONE', aftryk: '3|999' } })
    .hent('dispatch')(9876, 'select_option', { selector: '#region', option: 'b' });
  assert.equal(svar.landed, null, `en sen reaktion blev til «rullet tilbage»: ${JSON.stringify(svar)}`);
  assert.doesNotMatch(String(svar.error || ''), /rolled back/);
});

test('et felt der VIRKELIG afviser valget, er stadig rullet tilbage (ingen falsk ja)', async () => {
  const svar = await seleMedSelect().hent('dispatch')(9876, 'select_option', { selector: '#region', option: 'b' });
  assert.equal(svar.ok, false, `en afvisning blev til succes: ${JSON.stringify(svar)}`);
  assert.equal(svar.landed, false);
  assert.match(String(svar.error || ''), /rolled back/);
});
