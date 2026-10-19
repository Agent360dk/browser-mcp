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
function linjeSide(felt, { afvisLinjeskift = false, kunTastet = false, ulaeseligt = false } = {}) {
  const s = { value: '', indsat: [], taster: [], spurgt: 0 };
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
        if (x.includes('activeElement')) return svar(ulaeseligt ? null : s.value);
        return svar(null);
      }
      // kunTastet: feltet tager kun tastet input - et indsat stykke tekst uden tast foran afvises (MAALT-moenster fra R130-Chrome).
      if (metode === 'Input.insertText') { s.indsat.push(p.text); if (!kunTastet) s.value += afvisLinjeskift ? p.text.replace(/\n/g, '') : p.text; }
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyDown' && p.text) { s.taster.push(p); s.value += p.text; }
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async () => [{ frameId: 0, result: { x: 10, y: 10, tag: 'INPUT', found: true } }];
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return { u, s };
}
const LINJESKIFT = /[\r\n]/;

test('R127/R130: CSS-vejen i et enkeltlinje-input sender intet linjeskift - hvert bliver ét mellemrum, og svaret siger det', async () => {
  const { u, s } = linjeSide('linje');
  const r = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'a\r\nb\nc' });
  assert.ok(!s.indsat.some((t) => LINJESKIFT.test(t)), `et linjeskift blev sendt til et enkeltlinjefelt: ${JSON.stringify(s.indsat)}`);
  assert.equal(s.value, 'a b c', 'ordene blev limet sammen (R130, Opus): et linjeskift skal blive et mellemrum');
  assert.deepEqual([r.differs, r.actual, r.line_breaks_as_spaces], [true, 'a b c', 2], JSON.stringify(r));
  assert.match(String(r.note), /line breaks? (were|was) typed as spaces?/i, r.note);
  assert.doesNotMatch(String(r.note), /formatted/i, `noten skyder vaerktoejets egen aendring paa siden: ${r.note}`);
});

test('R127: CSS-vejen i en textarea skriver linjeskiftene (et "\\r\\n" er ét)', async () => {
  const { u, s } = linjeSide('tekst');
  const r = await u.hent('dispatch')(9876, 'fill', { selector: '#t', value: 'a\r\nb\nc' });
  assert.deepEqual(s.indsat, ['a\nb\nc'], JSON.stringify(s.indsat));
  assert.equal(r.ok, true, JSON.stringify(r));
});

// R138 (Opus, MAALT i Chrome): et mellemrum her kan vaere en mellemrumstast paa en knap, en submit eller et afkrydsningsfelt -
// kan feltet ikke laeses som et tekstfelt, udelades linjeskiftet helt (som foer R130), og svaret siger det.
test('R127/R138: kan feltet ikke laeses (fx fokus i en iframe eller paa en knap), sendes hverken linjeskift eller mellemrum, paa CSS-vejen og tegn for tegn', async () => {
  const css = linjeSide('ukendt');
  await css.u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'a\nb' });
  assert.ok(!css.s.indsat.some((t) => LINJESKIFT.test(t)), JSON.stringify(css.s.indsat));
  assert.equal(css.s.value, 'ab');
  const tegn = linjeSide('ukendt');
  await tegn.u.hent('typeCharsAttached')(1, 'a\nb');
  assert.ok(!tegn.s.indsat.some((t) => LINJESKIFT.test(t)), JSON.stringify(tegn.s.indsat));
  assert.deepEqual([tegn.s.indsat, tegn.s.value], [[], 'ab']);
  // R139 (Astra: feltet kunne omdoebes uden et roedt resultat): svaret paa fill siger, at linjeskiftet blev udeladt
  const r = await linjeSide('ukendt').u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'a\nb' });
  assert.equal(r.line_breaks_left_out, 1, `svaret siger ikke, at linjeskiftet blev udeladt: ${JSON.stringify(r)}`);
  assert.match(String(r.note), /left out/, r.note);
  assert.ok(!tegn.s.taster.some((t) => t.text === ' ' || t.code === 'Space'), `en mellemrumstast blev trykket: ${JSON.stringify(tegn.s.taster)}`);
});

// R130, MAALT i aegte headless Chrome (00ebeba): CSS-reserven i et input, der kun tager TASTET input. Mellemrummet blev
// indsat (Input.insertText) og afvist af siden ("abc"), og svaret sagde 4 mellemrum for 2 linjeskift - hurtigvejens og
// reservens tal blev lagt sammen, selvom kun reservens skrivning staar i feltet.
test('R130: CSS-reserven i et input, der kun tager tastet input - mellemrummet tastes, og svaret taeller kun det der blev skrevet', async () => {
  const { u, s } = linjeSide('linje', { kunTastet: true });
  const r = await u.hent('dispatch')(9876, 'fill', { selector: '#m', value: 'a\nb\r\nc' });
  assert.equal(s.value, 'a b c', `mellemrummene naaede ikke feltet: ${JSON.stringify(s.value)}`);
  const mellemrum = s.taster.filter((t) => t.text === ' ');
  assert.deepEqual(mellemrum.map((t) => [t.key, t.code, t.windowsVirtualKeyCode]), [[' ', 'Space', 32], [' ', 'Space', 32]], JSON.stringify(mellemrum));
  assert.ok(!s.taster.some((t) => LINJESKIFT.test(t.text) || t.key === 'Enter'), JSON.stringify(s.taster));
  assert.deepEqual([r.actual, r.line_breaks_as_spaces], ['a b c', 2], JSON.stringify(r));
  assert.doesNotMatch(String(r.note), /formatted/i, r.note);
});

test('R127: tegn for tegn laeses feltet ved HVERT linjeskift - et fokusskift fra textarea til input mellem to linjeskift', async () => {
  const { u, s } = linjeSide(['tekst', 'linje']);
  await u.hent('typeCharsAttached')(1, 'a\nb\nc');
  assert.deepEqual(s.indsat, ['\n'], `det andet linjeskift (efter fokusskiftet til et input) blev sendt: ${JSON.stringify(s.indsat)}`);
  assert.deepEqual(s.taster.map((t) => t.text), ['a', 'b', ' ', 'c'], 'efter fokusskiftet skal linjeskiftet tastes som et mellemrum');
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
        // Aendringsrapporten (R130: paa identitet): «foer» gemmer vaerdierne, «diff» sammenligner samme felt med sig selv.
        if (x.includes('bmcpFeltFoer')) { s.foer = { ...s.felt }; return svar(true); }
        if (x.includes('bmcpFeltDiff')) {
          return svar(Object.keys(s.felt).filter((k) => s.felt[k] !== s.foer[k]).map((k) => ({ tag: k === 'd' ? 'INPUT' : 'TEXTAREA',
            id: k, target: k === 'd', value_before: s.foer[k], value: s.felt[k] })));
        }
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

// MAALT i Chrome (R127, efter rettelsen): en vaerdi, der KUN er linjeskift, i et enkeltlinje-input gav field-is-empty med raadet
// om en baggrundsfane. R130: linjeskiftet bliver et mellemrum - feltet faar " ", og svaret siger hvorfor.
test('R127/R130: en vaerdi af kun linjeskift i et enkeltlinjefelt - et mellemrum, ikke «field-is-empty»', async () => {
  for (const sel of ['#f', 'text=Felt']) {
    const { u, s } = linjeSide('linje');
    const r = await u.hent('dispatch')(9876, 'fill', { selector: sel, value: '\r\n' });
    assert.ok(!s.indsat.some((t) => LINJESKIFT.test(t)), JSON.stringify(s.indsat));
    assert.notEqual(r.error, 'field-is-empty', `${sel}: ${JSON.stringify(r)}`);
    assert.deepEqual([r.differs, r.actual], [true, ' '], `${sel}: ${JSON.stringify(r)}`);
    assert.match(String(r.note), /typed as a space/i, `${sel}: ${r.note}`);
    assert.doesNotMatch(String(r.note), /switch_tab/, `${sel}: ${r.note}`);
  }
});

// R130 (Opus i Chrome, Astra i model): i en TEXTAREA, der ikke tager linjeskiftet, sagde noten «this field takes none ... left
// out ... Nothing was sent» - men "\n" blev sendt, og det var siden, der afviste det.
test('R130: kun linjeskift i en textarea, der afviser dem - noten siger at linjeskiftet blev sendt, ikke at det blev udeladt', async () => {
  for (const sel of ['#t', 'text=Felt']) {
    const { u, s } = linjeSide('tekst', { afvisLinjeskift: true });
    const r = await u.hent('dispatch')(9876, 'fill', { selector: sel, value: '\n' });
    assert.ok(s.indsat.includes('\n'), `${sel}: linjeskiftet blev ikke sendt: ${JSON.stringify(s.indsat)}`);
    assert.equal(s.value, '');
    assert.doesNotMatch(String(r.note), /left out|takes none|nothing was sent/i, `${sel}: falsk note: ${r.note}`);
    assert.match(String(r.note), /sent/i, `${sel}: ${r.note}`);
    assert.match(String(r.note), /did not take/i, `${sel}: ${r.note}`);
    // Et tekstfelt tager linjeskift: noten maa ikke sige at de blev til mellemrum, eller at feltet ikke tager dem.
    assert.match(String(r.note), /as line breaks/i, `${sel}: ${r.note}`);
    assert.doesNotMatch(String(r.note), /as spaces|takes no line breaks/i, `${sel}: ${r.note}`);
    assert.equal(r.line_breaks_as_spaces, undefined, JSON.stringify(r));
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
  // R130 (Opus, MAALT i Chrome): paa en XHTML-side (application/xhtml+xml) er tagName "textarea" med smaa bogstaver.
  assert.equal(await svarFor({ tagName: 'textarea', localName: 'textarea' }), 'tekst', 'en XHTML-textarea blev ikke regnet som tekst');
  assert.equal(await svarFor({ tagName: 'input', localName: 'input' }), 'linje', 'et XHTML-input blev ikke regnet som linje');
  assert.equal(await svarFor({ tagName: 'iframe', localName: 'iframe' }), 'ukendt', 'en XHTML-iframe blev regnet som et felt');
});

// R130 (Astra, model): set_date's «changed» parrede felterne efter deres plads i et snapshot. Byttede siden om paa
// raekkefoelgen undervejs, meldte svaret aendringer, der aldrig skete. Her KOERES udtrykkene mod et modelleret dokument, der
// bytter datofeltet og textareaen, naar fokus flyttes efter select-all - ingen vaerdi aendres.
test('R130: set_date\'s aendringsrapport kender felterne paa identitet - en ombytning af raekkefoelgen er ingen aendring', async () => {
  const vm = await import('node:vm');
  const d = { tagName: 'INPUT', localName: 'input', id: 'd', value: '16/10/2026' };
  const ta = { tagName: 'TEXTAREA', localName: 'textarea', id: 'ta', value: 'VIGTIG TEKST' };
  const st = { orden: [d, ta], fokus: d, markeret: null };
  const document = {
    get activeElement() { return st.fokus; },
    querySelector: (q) => (q === '#d' ? d : null),
    querySelectorAll: () => st.orden.slice(),
  };
  const sideVindue = {};
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
            placeholder: 'DD/MM/YYYY', ariaLabel: '', value: d.value }));
        }
        if (x.includes('bmcpFokusPaaMaal') || x.includes('bmcpFelt')) {
          return svar(vm.runInNewContext(x, { document, window: sideVindue, Array, String, Object, Map, WeakMap, Math }));
        }
        if (x.includes('JSON.stringify({ value:')) return svar(JSON.stringify({ value: d.value }));
        return svar(null);
      }
      if (metode === 'Input.dispatchKeyEvent' && p.type === 'keyUp' && p.key === 'a') {
        st.fokus = ta; st.orden = [ta, d];   // siden flytter fokus og bytter om paa felterne
      }
      return {};
    },
  } });
  u.ctx.chrome.scripting.executeScript = async () => [{ frameId: 0, result: { x: 10, y: 10, tag: 'INPUT', found: true } }];
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  const r = await u.hent('dispatch')(9876, 'set_date', { selector: '#d', date: '2000-01-01', skip_picker: true });
  assert.equal(r.error, 'focus-moved', JSON.stringify(r));
  assert.deepEqual([d.value, ta.value], ['16/10/2026', 'VIGTIG TEKST']);
  assert.deepEqual(JSON.parse(JSON.stringify(r.changed ?? [])), [], `svaret meldte aendringer, der aldrig skete: ${JSON.stringify(r.changed)}`);
  assert.match(String(r.note), /Nothing was (cleared or typed|changed)/i, r.note);
});

// ── R138 (Astra, mutant «nu = x.v» overlevede): set_date's ændringsrapport skal kunne melde en ÆGTE ændring. Prøverne maalte
//    kun, at en ombytning ikke blev meldt; en rapport, der aldrig melder noget, bestod. Siden-koden koeres her i en lille DOM.
test('set_date: feltAendringer melder en aegte aendring og ikke en ombytning (R138)', async () => {
  const { runInNewContext } = await import('node:vm');
  const u = indlaesUdvidelse();
  const d = { tagName: 'INPUT', id: 'd', value: 'gammel' };
  const andet = { tagName: 'TEXTAREA', id: 'ta', value: 'VIGTIG' };
  let felter = [d, andet];
  const doc = { querySelectorAll: () => felter, querySelector: () => d };
  const vindue = {};
  u.ctx.cdpSend = async (_t, metode, p) => (metode === 'Runtime.evaluate'
    ? { result: { value: runInNewContext(p.expression, { document: doc, window: vindue }) } } : {});
  // kun ombytning: intet meldes
  let noegle = await u.hent('feltFoer')(1);
  assert.ok(noegle, 'feltFoer gav ingen noegle - proeven kan ikke maale noget');
  felter = [andet, d];
  const json = (x) => JSON.parse(JSON.stringify(x));   // svaret kommer fra en anden vm-kontekst (andre prototyper)
  assert.deepEqual(json(await u.hent('feltAendringer')(1, '#d', noegle)), [], 'en ombytning blev meldt som en aendring');
  // aegte aendring i maalfeltet: meldes med foer og efter
  noegle = await u.hent('feltFoer')(1);
  d.value = '';
  const r = await u.hent('feltAendringer')(1, '#d', noegle);
  assert.deepEqual(json(r), [{ tag: 'INPUT', id: 'd', target: true, value_before: 'gammel', value: '' }], 'en aegte aendring blev ikke meldt');
});

// ── R138 (Opus, MAALT i Chrome paa e2ec519): fokus hoppede midt i fill til en knap, en submit-knap eller et afkrydsningsfelt, og
//    linjeskiftet blev en mellemrumstast DER: 1 klik, 1 sendt formular, 1 kryds (0/0/0 paa 37ced8f). linjeFelt koeres her i en
//    lille DOM: kun et tekst-input giver 'linje'; alt andet, der ikke er et tekstfelt, giver 'ukendt'.
test('linjeFelt: kun tekst-input faar mellemrum - knap, submit, afkrydsning, radio og fil giver ukendt (R138)', async () => {
  const { runInNewContext } = await import('node:vm');
  const u = indlaesUdvidelse();
  let aktiv = null;
  u.ctx.cdpSend = async (_t, metode, p) => (metode === 'Runtime.evaluate'
    ? { result: { value: runInNewContext(p.expression, { document: { activeElement: aktiv } }) } } : {});
  const input = (type) => ({ localName: 'input', tagName: 'INPUT', type, isContentEditable: false });
  const forventet = [
    [input('text'), 'linje'], [input('search'), 'linje'], [input('email'), 'linje'], [input('password'), 'linje'],
    // R139 (Astra: «number» kunne fjernes uden et roedt resultat): hver type i listen, og et input uden type
    [input('url'), 'linje'], [input('tel'), 'linje'], [input('number'), 'linje'], [input(undefined), 'linje'],
    [input('submit'), 'ukendt'], [input('checkbox'), 'ukendt'], [input('radio'), 'ukendt'], [input('button'), 'ukendt'],
    [input('file'), 'ukendt'], [{ localName: 'button', tagName: 'BUTTON', isContentEditable: false }, 'ukendt'],
    [{ localName: 'textarea', tagName: 'TEXTAREA', isContentEditable: false }, 'tekst'],
  ];
  const faktisk = [];
  for (const [el] of forventet) { aktiv = el; faktisk.push(await u.hent('linjeFelt')(1)); }
  assert.deepEqual(faktisk, forventet.map((x) => x[1]), forventet.map((x, i) => `${x[0].type || x[0].localName}: ${faktisk[i]}`).join(', '));
});

// R139 (Opus, MAALT i Chrome J5-J8): paa text=-vejen hoppede fokus til en ramme, <summary> eller role=button, feltet kunne ikke
// laeses bagefter, og svaret (unknown) sagde intet om det udeladte linjeskift - CHANGELOG lover, at svaret siger det.
test('text=-vejen: kan feltet ikke laeses bagefter, siger svaret stadig, at linjeskiftet blev udeladt (R139)', async () => {
  const { u } = linjeSide('ukendt', { ulaeseligt: true });
  const r = await u.hent('dispatch')(9876, 'fill', { selector: 'text=Felt', value: 'a\nb' });
  assert.equal(r.unknown, true, `proeven naaede ikke unknown-grenen: ${JSON.stringify(r)}`);
  assert.equal(r.line_breaks_left_out, 1, `unknown-svaret siger ikke, at linjeskiftet blev udeladt: ${JSON.stringify(r)}`);
});
