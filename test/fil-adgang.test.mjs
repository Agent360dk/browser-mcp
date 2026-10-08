/**
 * Upload med en butiksinstallation: Chrome svarer «Not allowed» paa DOM.setFileInputFiles, naar
 * udvidelsen ikke har «Allow access to file URLs» - og den kontakt er slaaet fra som standard for
 * Chrome Web Store-installationer (Chromium: content/browser/devtools/protocol/dom_handler.cc og
 * chrome/browser/extensions/api/debugger/debugger_api.cc, MayReadLocalFiles = AllowFileAccess).
 *
 * MAALT 2/10 og 4/10 paa Gustavs egen maskine: upload_file og drop_file svarede bare «Not allowed»,
 * og agenten proevede igen. 1.30.2 skive 6: svaret skal naevne kontakten (error file-access-off),
 * og kun naar det er den, der er grunden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele({ setFilesFejl = null, filAdgang }) {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane,
    'tabs.query': [fane],
    'tabs.update': undefined,
    'windows.update': undefined,
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      if (metode === 'DOM.setFileInputFiles') { if (setFilesFejl) throw new Error(setFilesFejl); return {}; }
      if (metode === 'Runtime.evaluate') {
        const udtryk = String(p?.expression || '');
        if (udtryk.includes('found:')) {
          return { result: { value: JSON.stringify({ found: true, tag: 'INPUT', type: 'file', accept: '', multiple: false }) } };
        }
        return { result: { value: null } };
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => {
    const kilde = String(func);
    if (kilde.includes('.files')) return [{ result: { antal: 1, navne: ['a.png'] } }];
    return [{ result: null }];
  };
  if (filAdgang === 'mangler') delete u.ctx.chrome.extension;
  else u.ctx.chrome.extension = { isAllowedFileSchemeAccess: async () => filAdgang };
  return u;
}

for (const vaerktoej of ['upload_file', 'drop_file']) {
  test(`${vaerktoej}: «Not allowed» uden filadgang giver file-access-off med kontaktens navn`, async () => {
    const u = sele({ setFilesFejl: 'Not allowed', filAdgang: false });
    const svar = await u.hent('dispatch')(9876, vaerktoej, { selector: '#f', files: ['/tmp/a.png'] });
    assert.equal(svar.ok, false);
    assert.equal(svar.error, 'file-access-off', `svaret gentager bare Chromes ord: ${JSON.stringify(svar)}`);
    assert.match(svar.note, /Allow access to file URLs/, 'svaret naevner ikke kontakten');
    assert.match(svar.note, /because/, 'Chrome bekraeftede at adgangen er slaaet fra - saa er det en kendsgerning, ikke et gaet');
    assert.equal(svar.file_access, false);
  });
}

test('upload_file: kan Chrome ikke svare paa adgangen, siges det som sandsynligt, ikke som sikkert', async () => {
  const u = sele({ setFilesFejl: 'Not allowed', filAdgang: 'mangler' });
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/tmp/a.png'] });
  assert.equal(svar.error, 'file-access-off');
  assert.match(svar.note, /usually means/, 'uden Chromes bekraeftelse maa svaret ikke paastaa aarsagen');
  assert.equal(svar.file_access, null);
});

test('upload_file: har udvidelsen filadgang, er «Not allowed» noget andet - ingen forkert forklaring', async () => {
  const u = sele({ setFilesFejl: 'Not allowed', filAdgang: true });
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/tmp/a.png'] });
  assert.equal(svar.ok, false);
  assert.notEqual(svar.error, 'file-access-off', 'svaret skyder skylden paa en kontakt der er slaaet til');
});

test('upload_file: en anden CDP-fejl beholder sin egen tekst', async () => {
  const u = sele({ setFilesFejl: 'No node with given id found', filAdgang: false });
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/tmp/a.png'] });
  assert.equal(svar.ok, false);
  assert.match(String(svar.error), /No node with given id/, 'en anden fejl blev omdoebt til filadgang');
});

test('upload_file og drop_file siger paa forhaand at kontakten skal vaere slaaet til', async () => {
  const { TOOLS } = await import('../mcp-server/tools.js');
  for (const navn of ['browser_upload_file', 'browser_drop_file']) {
    const d = TOOLS.find(t => t.name === navn).description;
    assert.match(d, /Allow access to file URLs/, `${navn} naevner ikke kontakten`);
    assert.match(d, /file-access-off/, `${navn} naevner ikke fejlkoden agenten vil se`);
  }
});
