/**
 * R127 (Astra, 18/10-2026, model) paa bb31909:
 *  1. Linjeskift: den almindelige CSS-vej i fill sendte hele vaerdien med Input.insertText - ogsaa "\n" til et
 *     enkeltlinjefelt (som sender formularen, MAALT i Chrome i R126). Tegn-for-tegn-vagten sendte "\n", naar fokus stod i en
 *     iframe, og laeste felttypen kun én gang. Reglen gaelder nu hver vej og hvert linjeskift, i det felt der er aktivt
 *     lige nu: som tekst kun i en textarea eller et contenteditable-felt; ellers (enkeltlinje-input, ukendt, iframe) udelades det.
 *  2. set_date's fokusvagt gjaldt kun foer selectAll. Fokus flyttet ved keyup efter selectAll, eller efter rydningen,
 *     ramte et andet felt; en fejl ved aflaesningen blev meldt som focus-moved.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };
const svar = (v) => ({ result: { value: v } });

// ── 1. linjeskift ─────────────────────────────────────────────────────────────────────────────────────────────────────
// `felt`: hvad det aktive felt er, hver gang det spoerges: 'tekst' (textarea/contenteditable), 'linje' (enkeltlinje-input)
// eller 'ukendt' (fx en iframe). En liste giver svarene i raekkefoelge (fokus skifter undervejs).
function linjeSide(felt) {
  const s = { value: '', indsat: [], spurgt: 0 };
  const naeste = () => (Array.isArray(felt) ? felt[Math.min(s.spurgt++, felt.length - 1)] : felt);
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
        if (x.includes('bmcpLinjeFelt')) return svar(naeste());
        if (x.includes('getBoundingClientRect')) return svar({ x: 10, y: 10, tag: 'INPUT', found: true });
        if (x.includes('isContentEditable')) return svar(false);
        if (x.includes('_valueTracker')) return svar({ v: s.value, ramme: null });
        if (x.includes('readOnly')) return svar(null);
        if (x.includes('activeElement')) return svar(s.value);
        return svar(null);
      }
      if (metode === 'Input.insertText') { s.indsat.push(p.text); s.value += p.text; }
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyDown' && p.text) s.value += p.text;
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async () => [{ frameId: 0, result: { x: 10, y: 10, tag: 'INPUT', found: true } }];
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, s };
}
const LINJESKIFT = /[\r\n]/;

test('R127: CSS-vejen i fill sender intet linjeskift til et enkeltlinje-input - svaret viser det med differs/actual', async () => {
  const { u, s } = linjeSide('linje');
  const r = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'a\r\nb\nc' });
  assert.ok(!s.indsat.some((t) => LINJESKIFT.test(t)), `et linjeskift blev sendt til et enkeltlinjefelt: ${JSON.stringify(s.indsat)}`);
  assert.equal(s.value, 'abc');
  assert.deepEqual([r.differs, r.actual], [true, 'abc'], JSON.stringify(r));
});

test('R127: CSS-vejen i en textarea skriver linjeskiftene (et "\\r\\n" er ét)', async () => {
  const { u, s } = linjeSide('tekst');
  const r = await u.hent('dispatch')(9876, 'fill', { selector: '#t', value: 'a\r\nb\nc' });
  assert.deepEqual(s.indsat, ['a\nb\nc'], JSON.stringify(s.indsat));
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('R127: kan feltet ikke laeses (fx fokus i en iframe), udelades linjeskiftet - paa CSS-vejen og tegn for tegn', async () => {
  const css = linjeSide('ukendt');
  await css.u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'a\nb' });
  assert.ok(!css.s.indsat.some((t) => LINJESKIFT.test(t)), JSON.stringify(css.s.indsat));
  const tegn = linjeSide('ukendt');
  await tegn.u.hent('typeCharsAttached')(1, 'a\nb');
  assert.ok(!tegn.s.indsat.some((t) => LINJESKIFT.test(t)), JSON.stringify(tegn.s.indsat));
});

test('R127: tegn for tegn laeses feltet ved HVERT linjeskift - et fokusskift fra textarea til input mellem to linjeskift', async () => {
  const { u, s } = linjeSide(['tekst', 'linje']);
  await u.hent('typeCharsAttached')(1, 'a\nb\nc');
  assert.deepEqual(s.indsat, ['\n'], `det andet linjeskift (efter fokusskiftet til et input) blev sendt: ${JSON.stringify(s.indsat)}`);
});

// ── 2. set_date's fokusvagt gennem hele skrivningen ───────────────────────────────────────────────────────────────────
// To felter: datofeltet #d og en textarea #ta med «VIGTIG TEKST». Taster og indsaettelser rammer det felt, der har fokus.
//   flyt: 'keyup-a' (fokus flyttes til #ta ved keyup efter selectAll) | 'keyup-bs' (efter rydningen) | null
//   fokusFejl: aflaesningen af fokus fejler, mens fokus staar rigtigt
function datoSide({ flyt = null, fokusFejl = false } = {}) {
  const s = { felt: { d: '16/10/2026', ta: 'VIGTIG TEKST' }, fokus: 'd', markeret: null, sendt: [] };
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
            placeholder: 'DD/MM/YYYY', ariaLabel: '', value: s.felt.d }));
        }
        if (x.includes('errs.push')) return svar(JSON.stringify([]));
        if (x.includes('bmcpFokusPaaMaal')) {
          if (fokusFejl) return { exceptionDetails: { text: 'Execution context was destroyed.' } };
          return svar({ paaMaal: s.fokus === 'd', tag: s.fokus === 'd' ? 'INPUT' : 'TEXTAREA', id: s.fokus });
        }
        if (x.includes('bmcpFeltSnapshot')) return svar([{ tag: 'INPUT', id: 'd', value: s.felt.d, maal: true }, { tag: 'TEXTAREA', id: 'ta', value: s.felt.ta, maal: false }]);
        if (x.includes('JSON.stringify({ value:')) return svar(JSON.stringify({ value: s.felt.d }));
        return svar(null);
      }
      if (metode === 'Input.dispatchKeyEvent' || metode === 'Input.insertText') s.sendt.push(`${metode}:${p.type || ''}:${p.key || p.text || ''}`);
      const f = s.fokus;
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyDown') {
        if (p.key === 'a' && (p.commands || []).includes('selectAll')) s.markeret = f;
        else if (p.key === 'Backspace') { s.felt[f] = s.markeret === f ? '' : s.felt[f].slice(0, -1); s.markeret = null; }
      }
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyUp') {
        if (p.key === 'a' && flyt === 'keyup-a') s.fokus = 'ta';
        if (p.key === 'Backspace' && flyt === 'keyup-bs') s.fokus = 'ta';
      }
      if (metode === 'Input.insertText') { s.felt[f] = (s.markeret === f ? '' : s.felt[f]) + p.text; s.markeret = null; }
      if (metode === 'Input.dispatchMouseEvent') throw new Error('CDP did not respond within 1500 ms: Input.dispatchMouseEvent');
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async () => [{ frameId: 0, result: { x: 10, y: 10, tag: 'INPUT', found: true } }];
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, s };
}
const datoKald = (u) => u.hent('dispatch')(9876, 'set_date', { selector: '#d', date: '2000-01-01', skip_picker: true });

test('R127: stabilt fokus - datoen skrives som foer', async () => {
  const { u, s } = datoSide();
  const r = await datoKald(u);
  assert.deepEqual([s.felt.d, s.felt.ta, r.ok], ['01/01/2000', 'VIGTIG TEKST', true], JSON.stringify({ s, r }));
});

test('R127: fokus flyttes ved keyup efter selectAll - intet slettes eller skrives i det andet felt, og svaret siger hvor', async () => {
  const { u, s } = datoSide({ flyt: 'keyup-a' });
  const r = await datoKald(u);
  assert.equal(s.felt.ta, 'VIGTIG TEKST', `det andet felt blev aendret: ${JSON.stringify(s.felt)} - sendt ${JSON.stringify(s.sendt)}`);
  assert.equal(s.felt.d, '16/10/2026');
  assert.equal(r.error, 'focus-moved', JSON.stringify(r));
  assert.deepEqual(JSON.parse(JSON.stringify(r.focused)), { tag: 'TEXTAREA', id: 'ta' });
  assert.match(String(r.note), /nothing was (cleared|typed|changed)/i, r.note);
});

test('R127: fokus flyttes efter rydningen - datoen skrives IKKE i det andet felt, og svaret siger at datofeltet er tomt', async () => {
  const { u, s } = datoSide({ flyt: 'keyup-bs' });
  const r = await datoKald(u);
  assert.equal(s.felt.ta, 'VIGTIG TEKST', `datoen blev skrevet i det andet felt: ${JSON.stringify(s.felt)}`);
  assert.equal(r.error, 'focus-moved', JSON.stringify(r));
  assert.deepEqual([r.value_before, r.current_value, r.field_changed], ['16/10/2026', '', true], JSON.stringify(r));
  assert.match(String(r.note), /16\/10\/2026/, r.note);
});

test('R127: kan fokus ikke aflaeses, er svaret focus-unknown - ikke focus-moved - og intet skrives', async () => {
  const { u, s } = datoSide({ fokusFejl: true });
  const r = await datoKald(u);
  assert.equal(r.error, 'focus-unknown', JSON.stringify(r));
  assert.deepEqual(s.sendt, [], JSON.stringify(s.sendt));
  assert.equal(s.felt.d, '16/10/2026');
});

// MAALT i Chrome (R127, efter rettelsen): en vaerdi, der KUN er linjeskift, i et enkeltlinje-input - linjeskiftene udelades,
// feltet er tomt, og svaret var field-is-empty med raadet om en baggrundsfane. Det er ikke sandt: intet kunne skrives.
test('R127: en vaerdi af kun linjeskift i et enkeltlinjefelt - svaret siger at de blev udeladt, ikke «field-is-empty»', async () => {
  for (const sel of ['#f', 'text=Felt']) {
    const { u, s } = linjeSide('linje');
    const r = await u.hent('dispatch')(9876, 'fill', { selector: sel, value: '\r\n' });
    assert.ok(!s.indsat.some((t) => LINJESKIFT.test(t)), JSON.stringify(s.indsat));
    assert.notEqual(r.error, 'field-is-empty', `${sel}: ${JSON.stringify(r)}`);
    assert.deepEqual([r.differs, r.actual], [true, ''], `${sel}: ${JSON.stringify(r)}`);
    assert.match(String(r.note), /line break/i, `${sel}: ${r.note}`);
    assert.doesNotMatch(String(r.note), /switch_tab/, `${sel}: ${r.note}`);
  }
});

// Udtrykket i linjeFelt KOERES mod et modelleret dokument (ikke et svar, proeven selv vaelger): iframe, intet fokus, input,
// textarea, contenteditable og et felt inde i en aaben shadow root.
test('R127: linjeFelt laeser det aktive felt - textarea og contenteditable er tekst, input er linje, iframe er ukendt', async () => {
  const vm = await import('node:vm');
  const svarFor = async (aktiv) => {
    const u = indlaesUdvidelse();
    let udtryk = null;
    u.ctx.cdpSend = async (_t, metode, p) => {
      if (metode === 'Runtime.evaluate') { udtryk = p.expression; return { result: { value: vm.runInNewContext(udtryk, { document: { activeElement: aktiv } }) } }; }
      return {};
    };
    return u.hent('linjeFelt')(1);
  };
  assert.equal(await svarFor({ tagName: 'IFRAME' }), 'ukendt', 'en iframe blev regnet som et felt');
  assert.equal(await svarFor(null), 'ukendt');
  assert.equal(await svarFor({ tagName: 'INPUT' }), 'linje');
  assert.equal(await svarFor({ tagName: 'TEXTAREA' }), 'tekst');
  assert.equal(await svarFor({ tagName: 'DIV', isContentEditable: true }), 'tekst', 'et contenteditable-felt blev ikke regnet som tekst');
  assert.equal(await svarFor({ tagName: 'BODY' }), 'ukendt');
  assert.equal(await svarFor({ tagName: 'MY-EDITOR', shadowRoot: { activeElement: { tagName: 'TEXTAREA' } } }), 'tekst', 'shadow root blev ikke fulgt');
  assert.equal(await svarFor({ tagName: 'MY-FIELD', shadowRoot: { activeElement: { tagName: 'INPUT' } } }), 'linje');
});
