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
import vm from 'node:vm';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };
const svar = (v) => ({ result: { value: v } });

// Et tag-felt (som Opus' i Chrome): keydown med keyCode 188 laver et tag af teksten, tommer feltet og forhindrer kommaet.
// R126 (Astra): leveringslytteren er den RIGTIGE - armerTastBevis/laesTastBevis koeres mod et modelleret window, og
// siden kalder lytterne med de haendelser, en browser ville give (isTrusted). Ingen genvej som `traf: keydown > 0`.
//   leveret: 'alle' | 'ingen' (baggrundsfane) | 'foerste-tabt' (den foerste tast tabes, resten leveres)
//   syntetisk: siden udsender selv et keydown (isTrusted: false), uden at nogen tast er leveret
//   navigation: hoveddokumentet udskiftes ved foerste tast (lytteren forsvinder)
//   afviser: tasterne leveres, men feltet tager dem ikke (fx preventDefault, maxlength 0, kun cifre)
//   bevis: 'ja' | 'fejl' (lytteren kan ikke indlaeses)
function tagSide({ leveret = 'alle', syntetisk = false, navigation = false, afviser = false, bevis = 'ja' } = {}) {
  const s = { value: '', tags: [], keydown: 0, nr: 0 };
  const nytVindue = () => ({ lyttere: [],
    addEventListener(t, fn) { if (t === 'keydown') this.lyttere.push(fn); },
    removeEventListener(t, fn) { if (t === 'keydown') this.lyttere = this.lyttere.filter((f) => f !== fn); } });
  let vindue = nytVindue();
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
        if (x.includes('_valueTracker')) return svar({ v: s.value, ramme: null });
        if (x.includes('readOnly')) return svar(null);
        if (x.includes('activeElement')) return svar(s.value);
        return svar(null);
      }
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyDown') {
        s.nr++;
        if (s.nr === 1 && syntetisk) for (const fn of [...vindue.lyttere]) fn({ key: p.key, isTrusted: false });
        if (s.nr === 1 && navigation) vindue = nytVindue();
        const lever = leveret === 'alle' || (leveret === 'foerste-tabt' && s.nr > 1);
        if (!lever) return {};
        s.keydown++;
        for (const fn of [...vindue.lyttere]) fn({ key: p.key, isTrusted: true });
        if (afviser) return {};
        if (p.windowsVirtualKeyCode === 188) { if (s.value) s.tags.push(s.value); s.value = ''; return {}; }
        if (p.text) s.value += p.text;
      }
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async ({ func, args }) => {
    const kilde = String(func);
    if (kilde.includes('__bmcpTast')) {
      if (bevis === 'fejl' && kilde.includes('addEventListener')) throw new Error('Cannot access contents of the page');
      const f = vm.runInNewContext('(' + kilde + ')', { window: vindue });
      return [{ frameId: 0, result: f(...(args || [])) }];
    }
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
  assert.match(String(r.note), /saw keys arrive/i, r.note);   // R126: det vaerktoejet saa, ikke mere
  assert.equal(r.keys_delivered, true);
});

test('R125: naar intet naaede frem (baggrundsfane), er raadet om at skifte fane og proeve igen der stadig', async () => {
  const { u } = tagSide({ leveret: 'ingen' });
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

test('R125: css-vejen i et tag-felt (setteren tages ikke, saa der skrives tegn for tegn) - heller ikke her et gentagelsesraad', async () => {
  const { u, s } = tagSide();
  const r = await u.hent('dispatch')(9876, 'fill', { selector: '#tags', value: 'tag,' });
  assert.deepEqual([s.tags, s.value], [['tag'], ''], `modellen: ${JSON.stringify(s)}`);
  assert.notEqual(r.error, 'field-is-empty', JSON.stringify(r));
  assert.equal(r.keys_delivered, true, JSON.stringify(r));
  assert.doesNotMatch(String(r.note), RAAD_OM_GENTAGELSE, r.note);
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

// ── R126: leveringsbeviset i fill skal vaere sandt (Astra i model, Opus i Chrome) ───────────────────────────────────────
test('R126: tabes den foerste tast, men resten leveres, er svaret IKKE «ingen tast» med gentagelsesraad', async () => {
  for (const sel of ['text=Tags', '#tags']) {
    const { u, s } = tagSide({ leveret: 'foerste-tabt' });
    const r = await u.hent('dispatch')(9876, 'fill', { selector: sel, value: 'tag,' });
    assert.deepEqual(s.tags, ['ag'], JSON.stringify(s));
    assert.equal(r.keys_delivered, true, `${sel}: taster blev leveret, men svaret sagde ellers: ${JSON.stringify(r)}`);
    assert.doesNotMatch(String(r.note), RAAD_OM_GENTAGELSE, `${sel}: ${r.note}`);
  }
});

test('R126: et syntetisk keydown fra siden (isTrusted: false) taeller ikke som levering', async () => {
  const { u, s } = tagSide({ leveret: 'ingen', syntetisk: true });
  const r = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Tags', value: 'tag,' });
  assert.deepEqual(s.tags, []);
  assert.notEqual(r.keys_delivered, true, `en sidens egen haendelse blev meldt som leveret: ${JSON.stringify(r)}`);
});

test('R126: en navigation under skrivningen er «uvist» - aldrig «leveret» og aldrig et direkte «proev igen»', async () => {
  for (const sel of ['text=Tags', '#tags']) {
    const { u } = tagSide({ leveret: 'ingen', navigation: true });
    const r = await u.hent('dispatch')(9876, 'fill', { selector: sel, value: 'tag,' });
    assert.equal(r.keys_delivered, null, `${sel}: ${JSON.stringify(r)}`);
    assert.doesNotMatch(String(r.note), /switch_tab and try again/i, `${sel}: ${r.note}`);
    assert.match(String(r.note), /check the page/i, `${sel}: ${r.note}`);
  }
});

test('R126: et felt, der afviser tasterne (tomt bagefter), faar ikke at vide, at «siden har haandteret teksten» alene', async () => {
  const { u, s } = tagSide({ afviser: true });
  const r = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Tags', value: 'abc' });
  assert.equal(s.value, '');
  assert.equal(r.keys_delivered, true, JSON.stringify(r));
  assert.match(String(r.note), /rejected/i, `noten naevner ikke, at siden kan have afvist tasterne: ${r.note}`);
  assert.match(String(r.note), /tag/i, r.note);
});

test('R126: ingen tast set - ordlyden er «the tool saw no key arrive», og raadet er at tjekke siden foer gentagelse', async () => {
  const { u } = tagSide({ leveret: 'ingen' });
  const r = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Tags', value: 'tag,' });
  assert.equal(r.keys_delivered, false, JSON.stringify(r));
  assert.match(String(r.note), /saw no key arrive/i, r.note);
  assert.doesNotMatch(String(r.note), /no key reached the page/i, r.note);
  assert.match(String(r.note), /check the page/i, r.note);
});

// ── 3b: set_date's maskerede vej ─────────────────────────────────────────────────────────────────────────────────────
// Et maskeret datofelt (placeholder DD/MM/YYYY) som paa macOS: cmd/ctrl+a markerer kun med Chromes kommando selectAll;
// uden den sletter Backspace ét tegn. `indsaetMaks` lader feltet kun tage de foerste n tegn (en maske, der afviser resten).
// Kalenderens klik (Input.dispatchMouseEvent) faar fristen, som paa en skjult fane.
function datoSide({ vaerdi = '16/10/2026', indsaetMaks = Infinity, fokusFlyttet = false } = {}) {
  const s = { value: vaerdi, markeret: false, sendt: [] };
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
        if (x.includes('bmcpFokusPaaMaal')) return svar(fokusFlyttet ? { paaMaal: false, tag: 'TEXTAREA', id: 'ta' } : { paaMaal: true });
        if (x.includes('JSON.stringify({ value:')) return svar(JSON.stringify({ value: s.value }));
        return svar(null);
      }
      if (metode === 'Input.dispatchKeyEvent' || metode === 'Input.insertText') s.sendt.push(metode + ':' + (p.key || p.text || ''));
      if (fokusFlyttet && (metode === 'Input.dispatchKeyEvent' || metode === 'Input.insertText')) return {};   // det rammer textareaen
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

test('R126: flytter feltets fokus-haandtering fokus til et andet felt, ryddes og skrives der INTET - og svaret siger hvorfor', async () => {
  const { u, s } = datoSide({ fokusFlyttet: true });
  const r = await u.hent('dispatch')(9876, 'set_date', { selector: '#d', date: '2000-01-01', skip_picker: true });
  assert.deepEqual(s.sendt.filter((x) => !x.startsWith('Input.dispatchKeyEvent:Tab')), [],
    `der blev ryddet eller skrevet, mens fokus stod paa et andet felt: ${JSON.stringify(s.sendt)}`);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error, 'focus-moved', JSON.stringify(r));
  assert.match(String(r.note), /nothing was (cleared|typed)/i, r.note);
});
