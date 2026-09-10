/**
 * En handling der MAASKE er sket, maa ikke gentages — og en halv handling maa ikke efterlades.
 *
 * MAALT 10/9 af Astra, tredje review-runde. Promise.race afbryder ikke det kald den opgiver,
 * saa en frist betyder "vi ved det ikke", ikke "det skete ikke". Tre steder handlede som om:
 *
 *   press_key     keyDown og keyUp i samme try. Timede keyDown ud, blev keyUp aldrig sendt —
 *                 en tast der haenger. Reproduceret: Enter sendte formularen, kaldet fejlede.
 *   execute_script  faldt debuggeren af EFTER afsendelsen, koerte loekken BRUGERENS kode igen,
 *                 op til fire gange.
 *   set_date      timede den maskerede indtastning ud, gik koden videre til kalender-vejen og
 *                 satte datoen en gang til.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };

function sele(sendCommand, ekstra = {}) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    'debugger.sendCommand': sendCommand,
    ...ekstra,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('press_key sender keyUp selv naar keyDown ikke kvitteres', async () => {
  const typer = [];
  const u = sele((_m, metode, params) => {
    if (metode === 'Input.dispatchKeyEvent') {
      typer.push(params.type);
      if (params.type === 'keyDown') return new Promise(() => {});   // Chrome kvitterer aldrig
    }
    return {};
  });
  const svar = await u.hent('dispatch')(9876, 'press_key', { key: 'Enter' });
  assert.ok(typer.includes('keyUp'), `keyUp blev aldrig sendt — tasten haenger. Sendt: ${typer.join(',')}`);
  assert.equal(svar.ok, false, 'et nedtryk der ikke blev kvitteret, er ikke en bekraeftet succes');
  assert.equal(svar.maaske_landet, true, 'kalderen skal vide at tasten KAN have virket');
});

test('execute_script koerer ikke brugerens kode igen efter at den er sendt', async () => {
  let evalueringer = 0;
  const u = sele((_m, metode, params) => {
    if (metode === 'Runtime.evaluate' && String(params?.expression || '').includes('__BRUGERKODE__')) {
      evalueringer++;
      throw new Error('Debugger detached');
    }
    return {};
  }, { 'scripting.executeScript': () => { throw new Error('blokeret af CSP'); } });
  const svar = await u.hent('dispatch')(9876, 'execute_script', { code: '(() => { window.__BRUGERKODE__ = 1; })()' })
    .then((r) => ({ r }), (e) => ({ fejl: e.message }));
  assert.equal(evalueringer, 1, `brugerens kode blev koert ${evalueringer} gange — et muterende script maa koere én gang`);
  assert.match(svar.fejl || '', /KAN allerede have koert/, 'fejlen skal sige at scriptet maaske er koert');
});

test('set_date laeser feltet foer den proever kalender-vejen efter en fejl', () => {
  const i = kilde.indexOf("case 'set_date'");
  const blok = kilde.slice(i, kilde.indexOf('// Path C: calendar-picker navigation', i));
  const fang = blok.slice(blok.lastIndexOf('} catch (e) {'));
  assert.match(fang, /readBackValue\(tab\.id, params\.selector\)/,
    'efter en fejl i den maskerede indtastning skal feltet laeses — tastetrykkene kan staa der allerede');
  assert.match(fang, /if \(valueLooksLikeIso\(v, iso\)\) \{\s*\n\s*return \{ ok: true, method: 'masked'/,
    'staar datoen der, skal kaldet slutte — ellers saetter kalender-vejen den en gang til');
});
