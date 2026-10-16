/**
 * R125 (Astra og Opus, 16/10-2026) efter #76:
 *  1. browser_fill med text= i et tag-felt: tasterne naaede siden, siden gjorde teksten til et tag og tommede feltet, og
 *     svaret var field-is-empty med raadet «skift fane og proev igen». Gjorde agenten det, kom tagget to gange. Raadet om
 *     at proeve igen gives nu kun, naar intet naaede frem (leveringsbeviset, samme lytter som press_key).
 *  3b. set_date's maskerede vej: rydningen markerede ikke alt paa macOS (kun Chromes kommando selectAll goer det), og et
 *     forudfyldt felt endte som «16/10/202601/01/2000». Kalenderens klik kastede saa, og kaldet endte som en raa fejl uden
 *     at sige, at feltet var aendret.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };
const svar = (v) => ({ result: { value: v } });

// Et tag-felt (som Opus' i Chrome): keydown med keyCode 188 laver et tag af teksten, tommer feltet og forhindrer kommaet.
// `leveret`: naar tasterne siden (false = en baggrundsfane: Chrome kvitterer og leverer intet). `bevis`: kan
// leveringslytteren laeses ('ja'), eller fejler indlaesningen ('fejl').
function tagSide({ leveret = true, bevis = 'ja' } = {}) {
  const s = { value: '', tags: [], keydown: 0 };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    'debugger.sendCommand': (_m, metode, p = {}) => {
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      if (metode === 'Runtime.evaluate') {
        const x = p.expression || '';
        if (x.includes('window.__bmcpVagt = v')) return svar({ armet: true });
        if (x.includes('getBoundingClientRect')) return svar({ x: 10, y: 10, tag: 'INPUT', found: true });
        if (x.includes('isContentEditable')) return svar(false);
        if (x.includes('readOnly')) return svar(null);
        if (x.includes('activeElement')) return svar(s.value);
        return svar(null);
      }
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyDown' && leveret) {
        s.keydown++;
        if (p.windowsVirtualKeyCode === 188) { if (s.value) s.tags.push(s.value); s.value = ''; return {}; }
        if (p.text) s.value += p.text;
      }
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => {
    const kilde = String(func);
    if (kilde.includes('addEventListener') && kilde.includes('__bmcpTast')) {
      if (bevis === 'fejl') throw new Error('Cannot access contents of the page');
      return [{ frameId: 0, result: undefined }];
    }
    if (kilde.includes('__bmcpTast')) return [{ frameId: 0, result: { antal: s.keydown, traf: s.keydown > 0 } }];
    return [{ frameId: 0, result: { x: 10, y: 10, tag: 'INPUT', found: true } }];
  };
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, s };
}
const RAAD_OM_GENTAGELSE = /switch_tab|try again/i;

test('R125: fill text= i et tag-felt - teksten blev et tag, og feltet er tomt: svaret raader IKKE til at gentage', async () => {
  const { u, s } = tagSide();
  const r = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Tags', value: 'tag,' });
  assert.deepEqual([s.tags, s.value], [['tag'], ''], `modellen: ${JSON.stringify(s)}`);
  assert.notEqual(r.error, 'field-is-empty', `tasterne naaede siden, men svaret sagde field-is-empty: ${JSON.stringify(r)}`);
  assert.doesNotMatch(String(r.note), RAAD_OM_GENTAGELSE, `svaret raadede til at gentage - saa kommer tagget to gange: ${r.note}`);
  assert.match(String(r.note), /reached the page/i, r.note);
  assert.equal(r.keys_delivered, true);
});

test('R125: naar intet naaede frem (baggrundsfane), er raadet om at skifte fane og proeve igen der stadig', async () => {
  const { u } = tagSide({ leveret: false });
  const r = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Tags', value: 'tag,' });
  assert.equal(r.error, 'field-is-empty', JSON.stringify(r));
  assert.match(String(r.note), /switch_tab/, r.note);
});

test('R125: kan leveringen ikke laeses, raades der ikke direkte til at gentage - agenten tjekker siden foerst', async () => {
  const { u } = tagSide({ bevis: 'fejl' });
  const r = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Tags', value: 'tag,' });
  assert.equal(r.error, 'field-is-empty', JSON.stringify(r));
  assert.doesNotMatch(String(r.note), /switch_tab and try again/i, r.note);
  assert.match(String(r.note), /check the page/i, r.note);
});

test('R125: css-vejens svar (fyldSvar) - tomt felt efter leverede taster er ikke field-is-empty med gentagelsesraad', () => {
  const u = indlaesUdvidelse();
  const fyld = u.hent('fyldSvar');
  const leveret = fyld('', 'tag,', { method: 'debugger' }, null, true);
  assert.notEqual(leveret.error, 'field-is-empty', JSON.stringify(leveret));
  assert.doesNotMatch(String(leveret.note), RAAD_OM_GENTAGELSE, leveret.note);
  const ikke = fyld('', 'tag,', { method: 'debugger' }, null, false);
  assert.match(String(ikke.note), /switch_tab/, 'intet leveret: raadet skal staa');
  const udenSkrivning = fyld('', 'x', { method: 'debugger' }, null);
  assert.equal(udenSkrivning.error, 'field-is-empty', 'uden tegn-for-tegn-skrivning er svaret som foer');
});

// ── 3b: set_date's maskerede vej ─────────────────────────────────────────────────────────────────────────────────────
// Et maskeret datofelt (placeholder DD/MM/YYYY) som paa macOS: cmd/ctrl+a markerer kun med Chromes kommando selectAll;
// uden den sletter Backspace ét tegn. `indsaetMaks` lader feltet kun tage de foerste n tegn (en maske, der afviser resten).
// Kalenderens klik (Input.dispatchMouseEvent) faar fristen, som paa en skjult fane.
function datoSide({ vaerdi = '16/10/2026', indsaetMaks = Infinity } = {}) {
  const s = { value: vaerdi, markeret: false };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    'debugger.sendCommand': (_m, metode, p = {}) => {
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      if (metode === 'Runtime.evaluate') {
        const x = p.expression || '';
        if (x.includes('window.__bmcpVagt = v')) return svar({ armet: true });
        if (x.includes('placeholder: el.placeholder')) {
          return svar(JSON.stringify({ found: true, tag: 'INPUT', inputType: 'text', readOnly: false, disabled: false,
            placeholder: 'DD/MM/YYYY', ariaLabel: '', value: s.value }));
        }
        if (x.includes('errs.push')) return svar(JSON.stringify([]));
        if (x.includes('JSON.stringify({ value:')) return svar(JSON.stringify({ value: s.value }));
        return svar(null);
      }
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyDown') {
        if (p.key === 'a' && (p.commands || []).includes('selectAll')) s.markeret = true;
        else if (p.key === 'Backspace') { s.value = s.markeret ? '' : s.value.slice(0, -1); s.markeret = false; }
      }
      if (metode === 'Input.insertText') { s.value = (s.markeret ? '' : s.value) + String(p.text).slice(0, indsaetMaks); s.markeret = false; }
      if (metode === 'Input.dispatchMouseEvent') throw new Error('CDP did not respond within 1500 ms: Input.dispatchMouseEvent');
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async () => [{ frameId: 0, result: { x: 10, y: 10, tag: 'INPUT', found: true } }];
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, s };
}

test('R125 3b: rydningen sender Chromes selectAll (#68), saa et forudfyldt datofelt faar PRAECIS den nye dato', async () => {
  const { u, s } = datoSide();
  const r = await u.hent('dispatch')(9876, 'set_date', { selector: '#d', date: '2000-01-01', skip_picker: true });
  assert.equal(s.value, '01/01/2000', `feltet: ${JSON.stringify(s.value)} - den gamle dato blev ikke ryddet`);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('R125 3b: fejler alle veje, og feltet er aendret undervejs, siger svaret det - ingen raa fejl', async () => {
  const { u, s } = datoSide({ indsaetMaks: 5 });
  let r;
  try { r = await u.hent('dispatch')(9876, 'set_date', { selector: '#d', date: '2000-01-01' }); }
  catch (e) { assert.fail(`set_date kastede en raa fejl, mens feltet var aendret til ${JSON.stringify(s.value)}: ${e.message}`); }
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.value_before, '16/10/2026');
  assert.equal(r.current_value, s.value);
  assert.equal(r.field_changed, true, JSON.stringify(r));
  assert.match(String(r.note), /before/, r.note);
});
