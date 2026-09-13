/**
 * `upload_file` og `drop_file` maa ikke svare ja, fordi CDP KVITTEREDE for
 * `DOM.setFileInputFiles`. Kun fordi filen faktisk sidder paa feltet.
 *
 * MAALT 13/9, efter at de seks muse- og taste-vaerktoejer var lukket: en gennemgang
 * af HVER CDP-kommando i `background.js` der kvitterer uden at love levering fandt to
 * tilbage. Begge er filupload:
 *
 *   upload_file  ->  `return { ok: true, files, input }` lige efter setFileInputFiles
 *   drop_file    ->  `result = { ok: true, method: 'hidden-input', files }` samme sted
 *
 * Ingen af dem saa nogensinde paa feltet bagefter. Det er praecis den samme fejl som
 * press_key gjorde paa Enter, bare paa en anden kommando: en sti der ikke findes, et
 * `accept`-filter der afviser filtypen, eller sidens egen change-lytter der rydder
 * feltet, giver alle en tom FileList - og et svar der siger at uploaden lykkedes.
 *
 * Sandheden er billig at laese: `el.files.length` og navnene. Vi har ingen undskyldning
 * for at gaette, naar svaret staar i feltet.
 *
 * Tre-vejs som resten af klassen: sidder filen der -> ja. Er feltet tomt -> nej, med
 * grunden. Kan feltet ikke laeses -> uvist, aldrig et falskt ja eller nej.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

/**
 * Rejser udvidelsen med et filfelt der enten tog imod filen eller ikke gjorde.
 * `vedhaeftet` er de navne feltet staar med BAGEFTER - det som browseren ville vise.
 */
function sele({ vedhaeftet, laesningFejler = false }) {
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
      if (metode === 'DOM.setFileInputFiles') return {};        // CDP kvitterer. Altid.
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
    if (laesningFejler) throw new Error('kunne ikke injicere');
    const kilde = String(func);
    if (kilde.includes('.files')) return [{ result: { antal: vedhaeftet.length, navne: vedhaeftet } }];
    return [{ result: null }];
  };
  return u;
}

test('upload_file melder ikke succes paa en fil der aldrig kom paa feltet', async () => {
  const u = sele({ vedhaeftet: [] });
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/tmp/a.png'] });
  assert.equal(svar.ok, false,
    'upload_file svarede ja fordi CDP kvitterede. Feltet stod tomt bagefter - ingen fil blev vedhaeftet');
  assert.match(String(svar.error), /vedhaeftet|tom/i, 'svaret siger ikke hvad der var galt');
});

test('upload_file melder succes naar filen FAKTISK sidder paa feltet', async () => {
  const u = sele({ vedhaeftet: ['a.png'] });
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/tmp/a.png'] });
  assert.equal(svar.ok, true, 'upload_file meldte fejl paa en fil der sad paa feltet');
  assert.deepEqual(svar.vedhaeftet, ['a.png'], 'svaret oplyser ikke hvad feltet faktisk staar med');
});

test('upload_file siger til naar feltet tog FAERRE filer end der blev sendt', async () => {
  // Et `accept`-filter eller `multiple=false` tager den foerste og kasserer resten.
  // Det er ikke en fejl, men det er heller ikke det agenten bad om - saa det skal staa.
  const u = sele({ vedhaeftet: ['a.png'] });
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/tmp/a.png', '/tmp/b.png'] });
  assert.equal(svar.ok, true, 'en delvis vedhaeftning er ikke en fejl');
  assert.equal(svar.afviger, true,
    'svaret skjuler at feltet kun tog 1 af 2 filer - agenten tror begge kom med');
});

test('kan feltet ikke laeses, er svaret UVIST - aldrig et falskt ja eller nej', async () => {
  const u = sele({ vedhaeftet: [], laesningFejler: true });
  const svar = await u.hent('dispatch')(9876, 'upload_file', { selector: '#f', files: ['/tmp/a.png'] });
  assert.equal(svar.ok, true, 'uvist er ikke det samme som mislykket - filen kan sagtens sidde der');
  assert.equal(svar.uvist, true, 'svaret paastaar at vide noget det ikke ved');
});

// FUNDET 13/9 af Fable: uden en POSITIV drop_file-sag overlever mutationen "svar altid
// ok:false". En proeve der kun kan se den ene retning, vogter kun den ene retning.
test('drop_file melder succes naar filen FAKTISK sidder paa det skjulte felt', async () => {
  const u = sele({ vedhaeftet: ['a.png'] });
  const svar = await u.hent('dispatch')(9876, 'drop_file', { selector: '#zone', files: ['/tmp/a.png'] });
  assert.equal(svar.ok, true, `drop_file meldte fejl paa en fil der sad paa feltet: ${JSON.stringify(svar)}`);
  assert.deepEqual(svar.vedhaeftet, ['a.png'], 'svaret oplyser ikke hvad feltet faktisk staar med');
});

test('drop_file melder ikke succes paa en fil der aldrig kom paa det skjulte felt', async () => {
  const u = sele({ vedhaeftet: [] });
  const svar = await u.hent('dispatch')(9876, 'drop_file', { selector: '#zone', files: ['/tmp/a.png'] });
  assert.notEqual(svar.ok, true,
    'drop_file svarede ja fordi CDP kvitterede for setFileInputFiles. Det skjulte felt stod tomt bagefter');
});
