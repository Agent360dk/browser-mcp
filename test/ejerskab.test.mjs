/**
 * Agenten maa kun naa det den selv har aabnet, og kun det domaene den har bedt om.
 *
 * MAALT 10/9, reproduceret i selen foer rettelsen — alle tre var live i 1.29.0:
 *
 *   get_new_tab  `lastCreatedTabId` blev sat paa HVER onCreated, ogsaa naar brugeren selv
 *                trykkede Cmd+T. Reproduktion: bruger aabner brugerens-netbank.example ->
 *                get_new_tab svarer med den -> fanen staar i sessionens tabIds. Derefter er
 *                skaermbillede, sidetekst og localStorage af BRUGERENS fane lovligt.
 *
 *   get_cookies  Uden `domain` blev filteret til chrome.cookies.getAll `{}` — intet filter,
 *                altsaa hver eneste cookie i profilen, inkl. httpOnly-sessionscookies som
 *                sidens eget JS ikke maa se. Skemaet siger required:['domain'], men serveren
 *                videresender argumenter uvalideret, saa skemaet var en henstilling.
 *
 *   upload_file  Stien gik raat til DOM.setFileInputFiles. Skaermbilledets `path` fik en
 *                indeslutning 23/8 med begrundelsen "argumenterne kommer fra en model der
 *                laeser FREMMEDE websider". Upload fik den aldrig — og DER forlader filen
 *                faktisk maskinen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele(faneSvar) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': faneSvar,
    'tabs.query': [faneSvar],
    'cookies.getAll': (f) => { u.__filter = JSON.stringify(f); return []; },
    'tabGroups.update': undefined,
    'tabs.group': 7,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('en fane BRUGEREN aabnede bliver ikke agentens', async () => {
  const u = sele({ id: 99, url: 'https://brugerens-netbank.example', windowId: 1, active: true });
  await u.fyr('tabs.onCreated', { id: 99, url: 'https://brugerens-netbank.example', windowId: 1 });
  const r = await u.hent('dispatch')(9876, 'get_new_tab', {});
  assert.equal(r.error, 'not-ours', 'en fane uden opener i sessionen tilhoerer brugeren');
  assert.ok(!u.hent('sessions').get(9876).tabIds.has(99),
    'og den maa ikke ende i sessionen — saa ville skaermbillede og sidetekst vaere lovligt');
});

test('en fane vores egen side aabnede, er vores', async () => {
  const u = sele({ id: 100, url: 'https://vores.example', windowId: 1, active: true });
  await u.fyr('tabs.onCreated', { id: 100, url: 'https://vores.example', windowId: 1, openerTabId: 1 });
  const r = await u.hent('dispatch')(9876, 'get_new_tab', {});
  assert.equal(r.error, undefined, `et link med target=_blank fra vores egen fane skal virke: ${r.hint || ''}`);
});

test('get_cookies uden domaene afvises — ellers er filteret hele krukken', async () => {
  const u = sele({ id: 1, url: 'https://a.example', windowId: 1, active: true });
  const r = await u.hent('dispatch')(9876, 'get_cookies', {});
  assert.equal(r.error, 'domain-mangler');
  assert.equal(u.__filter, undefined, 'chrome.cookies.getAll maa slet ikke naas uden domaene');
});

test('get_cookies MED domaene virker uaendret', async () => {
  const u = sele({ id: 1, url: 'https://a.example', windowId: 1, active: true });
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'a.example' });
  assert.equal(r.error, undefined, 'et lovligt kald maa ikke rammes af vagten');
  assert.match(u.__filter || '', /a\.example/, 'domaenet skal naa Chrome');
});

test('upload-stien er indesluttet i arbejdsmappen — samme vagt som skaermbilledets path', () => {
  const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');
  const i = srv.indexOf("if (method === 'upload_file' || method === 'drop_file')");
  assert.ok(i > -1, 'vagten mod stier uden for arbejdsmappen er vaek fra upload');
  const blok = srv.slice(i, i + 1200);
  assert.match(blok, /resolve\(process\.cwd\(\)\)/, 'roden skal vaere arbejdsmappen');
  assert.match(blok, /startsWith\(rod \+ sep\)/, 'praefiks-tjekket er den faktiske indeslutning');
  assert.match(blok, /homedir\(\)/, '~ skal foldes ud, ellers slipper ~/.ssh/id_rsa forbi som relativ sti');
  assert.ok(srv.indexOf("const method = methodMap[name]") < i,
    'vagten skal ligge FOER kaldet sendes til udvidelsen');
});
