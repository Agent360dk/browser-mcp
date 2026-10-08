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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';
const rod = dirname(dirname(fileURLToPath(import.meta.url)));

// Chrome afviser med hele CDP-fejlen som JSON (debugger_api.cc:1208-1209), ikke de to bare ord. R45 (Opus): med de bare
// ord i selen overlevede en mutant, der kraevede \`=== 'Not allowed'\` - den ville fejle i en rigtig Chrome med groenne proever.
const cdpFejl = (besked) => JSON.stringify({ code: -32000, message: besked });

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
      if (metode === 'DOM.setFileInputFiles') { if (setFilesFejl) throw new Error(cdpFejl(setFilesFejl)); return {}; }
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

// R45 (Opus): noten pegede paa kortet «Browser MCP». Vores hedder «Agent360 Browser MCP» (manifest.json), og browsermcp.io's
// udvidelse hedder «Browser MCP» og kan vaere installeret samtidig - saa kunne brugeren give filadgang til den forkerte.
// Og kontakten lader udvidelsen aabne enhver lokal fil som side: skal brugeren hoere om den, skal prisen med.
test('noten peger paa vores eget kort og siger prisen ved kontakten', async () => {
  const u = sele({ setFilesFejl: 'Not allowed', filAdgang: false });
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/tmp/a.png'] });
  const navn = JSON.parse(readFileSync(join(rod, 'extension/manifest.json'), 'utf8')).name;
  assert.ok(svar.note.includes(`for the ${navn} extension`), `noten naevner ikke kortets navn «${navn}»: ${svar.note}`);
  assert.ok(svar.note.includes(`chrome://extensions/?id=${u.ctx.chrome.runtime.id})`), 'noten linker ikke direkte til netop denne udvidelse');
  assert.match(svar.note, /Ask the user to attach the file\./, 'foerste raad skal vaere at brugeren selv vedhaefter filen');
  assert.match(svar.note, /open and read any local file/, 'noten naevner kontakten uden prisen');
  assert.match(svar.note, /their call/, 'noten lader ikke valget vaere brugerens');
  assert.doesNotMatch(svar.note, /turn it on\.|enable it|switch it on/i, 'noten raader til at slaa kontakten til');
});

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
    assert.match(d, /Not allowed" error from the handoff is reported as file-access-off unless Chrome confirms/, `${navn} lover file-access-off ubetinget - andre fejl kan komme foerst (R45)`);
    assert.match(d, /for the Agent360 Browser MCP extension/, `${navn} peger paa en udvidelse med konkurrentens navn (R45)`);
    assert.match(d, /open any local file as a page, so whether to turn it on is the user's call/, `${navn} siger at kontakten skal til, uden prisen (R45)`);
  }
});

// R45 (Astra): filvaelger-vejen havde ingen egen proeve - diagnosen kunne fjernes dér, uden at noget blev roedt.
// Elementopslaget faar lov at haenge, og saa affyres Page.fileChooserOpened, mens setFileInputFiles svarer «Not allowed».
test('drop_file via opfanget filvaelger: «Not allowed» uden filadgang giver file-access-off', async () => {
  const fane = { id: 1, url: 'https://x.example', windowId: 1, active: false };
  let opfangerFiler = false;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane,
    'debugger.sendCommand': (_m, metode) => {
      if (metode === 'Page.setInterceptFileChooserDialog') { opfangerFiler = true; return {}; }
      if (metode === 'DOM.setFileInputFiles') throw new Error(cdpFejl('Not allowed'));
      if (opfangerFiler && (metode === 'Runtime.evaluate' || metode === 'DOM.getDocument' || metode === 'DOM.querySelector')) return new Promise(() => {});
      return {};
    },
  } });
  u.ctx.chrome.extension = { isAllowedFileSchemeAccess: async () => false };
  u.ctx.chrome.scripting.executeScript = () => new Promise(() => {}); // elementopslaget haenger, saa filvaelgeren naar foerst
  const svarP = u.hent('interceptFileChooser')(1, '#zone', ['/tmp/a.png']);
  for (let i = 0; i < 400 && !(u.lyttere.get('debugger.onEvent') || []).length; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok((u.lyttere.get('debugger.onEvent') || []).length, 'filvaelger-lytteren blev aldrig sat');
  await u.fyr('debugger.onEvent', { tabId: 1 }, 'Page.fileChooserOpened', { backendNodeId: 5, mode: 'selectSingle' });
  const svar = await svarP;
  assert.equal(svar.ok, false);
  assert.equal(svar.error, 'file-access-off', `filvaelger-vejen gentager bare Chromes ord: ${JSON.stringify(svar)}`);
  assert.equal(svar.method, 'native-chooser-intercepted');
  assert.match(svar.note, /Allow access to file URLs/);
});

// R46 (Astra): README-raekken lovede «without it the answer is file-access-off» - men tom filliste, et manglende felt og en
// filvaelger uden node giver andre fejl, foer Chrome overhovedet faar filen. Hver flade, der naevner fejlkoden, skal have
// samme betingelse som koden: kun et «Not allowed» ved overleveringen, og ikke naar Chrome bekraefter adgang.
test('hver flade der naevner file-access-off, siger betingelsen', () => {
  const flader = ['README.md', 'mcp-server/README.md', 'mcp-server/tools.js', 'content/browsermcp-docs-tools.md', 'content/browsermcp-docs-capability-matrix.md'];
  let set = 0;
  for (const f of flader) {
    readFileSync(join(rod, f), 'utf8').split('\n').forEach((linje, i) => {
      if (!linje.includes('file-access-off') || /^\s*\/\//.test(linje)) return;
      set++;
      assert.match(linje, /unless Chrome confirms that file access is on/, `${f}:${i + 1} lover file-access-off uden betingelsen`);
    });
  }
  assert.ok(set >= 6, `kun ${set} linjer naevner file-access-off - vagten maaler ikke det den skal`);
});
