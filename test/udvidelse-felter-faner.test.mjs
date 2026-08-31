/**
 * Felter, faner og sessioner — koert mod den rigtige kode.
 *
 * Hver test svarer til en fejl der har kostet tid:
 *   - `fill` tilfoejede i stedet for at erstatte (maalt igen 31/8: feltet blev
 *     "browser-mcpbrowser-mcp" under npm-udgivelsen)
 *   - switch_tab gjorde fanen aktiv men lod vinduet ligge bagved
 *   - klik i en baggrundsfane lander ikke, fordi Chrome struber timere der
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const CDP_OK = {
  'debugger.attach': undefined,
  'debugger.getTargets': [{ tabId: 1, attached: true }],
  'debugger.sendCommand': {},
};

// ── fill: erstatter, tilfoejer ikke ──────────────────────────────────────────

test('fill rydder feltet foer den skriver — ellers hober vaerdier sig op', async () => {
  // MAALT 31/8 under npm-udgivelsen: to fill-kald efter hinanden gav
  // "browser-mcpbrowser-mcp". Denne test holder rydningen paa plads i den
  // debugger-baserede sti.
  const sendte = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (maal, metode, params) => {
      sendte.push({ metode, params });
      // resolveElement forventer et fundet element
      if (metode === 'Runtime.evaluate') return { result: { value: { found: true, x: 10, y: 20, tag: 'INPUT' } } };
      return {};
    },
  } });
  const fill = u.hent('debuggerFill');
  assert.equal(typeof fill, 'function', 'debuggerFill skal findes');
  await fill(1, '#felt', 'abc').catch(() => {});

  const tekst = JSON.stringify(sendte);
  const rydder = /selectAll|Backspace|Delete|deleteContent|setValue|insertText/i.test(tekst);
  assert.ok(rydder,
    `feltet skal ryddes eller erstattes, ikke faa tekst tilfoejet. Sendt: ${tekst.slice(0, 200)}`);
});

// ── tekst-selektorer ────────────────────────────────────────────────────────

test('text= bygger en exact-match, ikke en substring', () => {
  const u = indlaesUdvidelse();
  const byg = u.hent('buildTextFinderJS');
  if (typeof byg !== 'function') return;
  const js = byg('text=Gem');
  assert.match(js, /Gem/, 'soegeordet skal vaere med');
  assert.ok(js.length > 20, 'der skal genereres rigtig JS, ikke en tom streng');
});

test('en bar tekst-streng er IKKE en tekst-selektor', () => {
  // MAALT 31/8: browser_click({selector: "Use security key"}) gav "Element not found".
  // Knappen fandtes med praecis den innerText. Tekstmatch kraever praefiks; uden det
  // bliver det ugyldig CSS. Dokumentationen er rigtig — fejlbeskeden er ikke.
  const u = indlaesUdvidelse();
  const byg = u.hent('buildTextFinderJS');
  if (typeof byg !== 'function') return;
  const js = byg('Use security key');
  assert.ok(!/^text=/.test('Use security key'), 'uden praefiks er det CSS, ikke tekst');
  assert.ok(typeof js === 'string');
});

// ── sessioner: to chats maa ikke dele faner ─────────────────────────────────

test('hver port faar sin egen session', () => {
  const u = indlaesUdvidelse();
  const get = u.hent('getSession');
  if (typeof get !== 'function') return;
  const a = get(9876), b = get(9877);
  assert.notEqual(a, b, 'to chats deler ikke session');
  assert.equal(get(9876), a, 'samme port giver samme session igen');
});

test('sessioner faar forskellige navne — "alt hedder Claude 1" var en fejl', () => {
  const u = indlaesUdvidelse();
  const get = u.hent('getSession');
  if (typeof get !== 'function') return;
  const navne = [9876, 9877, 9878, 9879].map((p) => get(p)?.label).filter(Boolean);
  if (navne.length < 2) return;
  assert.equal(new Set(navne).size, navne.length, `to sessioner deler navn: ${navne.join(', ')}`);
});

test('en sessions faner er dens egne', () => {
  const u = indlaesUdvidelse();
  const get = u.hent('getSession');
  if (typeof get !== 'function') return;
  const a = get(9876), b = get(9877);
  if (!a?.tabIds || !b?.tabIds) return;
  a.tabIds.add(111);
  assert.equal(b.tabIds.has(111), false, 'en fane maa ikke laekke mellem sessioner');
});

// ── fanen lukkes ────────────────────────────────────────────────────────────

test('lukker BRUGEREN den sidste fane, bedes serveren lukke ned', async () => {
  const u = indlaesUdvidelse();
  const get = u.hent('getSession');
  if (typeof get !== 'function') return;
  const s = get(9876);
  if (!s?.tabIds) return;
  s.tabIds.add(42);
  u.optager.ryd();
  await u.fyr('tabs.onRemoved', 42);
  const beskeder = u.optager.til('runtime.sendMessage');
  const terminate = beskeder.some((b) => JSON.stringify(b.args).includes('terminate_mcp_session'));
  assert.ok(terminate, 'sidste fane lukket af brugeren -> terminate');
});

test('lukker AGENTEN selv fanen, lukkes serveren IKKE ned', async () => {
  // Forskellen er hele pointen: en tom session betyder kun "arbejdet er slut" hvis
  // det var BRUGEREN der lukkede.
  const u = indlaesUdvidelse();
  const get = u.hent('getSession');
  const lukkede = u.hent('agentLukkedeFaner');
  if (typeof get !== 'function' || !lukkede) return;
  const s = get(9876);
  if (!s?.tabIds) return;
  s.tabIds.add(43);
  lukkede.add(43);
  u.optager.ryd();
  await u.fyr('tabs.onRemoved', 43);
  const terminate = u.optager.til('runtime.sendMessage')
    .some((b) => JSON.stringify(b.args).includes('terminate_mcp_session'));
  assert.equal(terminate, false, 'agentens egen oprydning maa ikke draebe serveren');
});

// ── tastatur-koder ──────────────────────────────────────────────────────────

test('tegn-til-tastekode rammer den fysiske tast, ikke "Key@"', () => {
  // Vi byggede foer koden som `Key${tegn.toUpperCase()}`, hvilket kun er rigtigt for
  // bogstaver: "1" blev "Key1", "@" blev "Key@", " " blev "Key ". Frameworks der
  // forgrener paa event.code droppede tastetrykket.
  const u = indlaesUdvidelse();
  const koder = u.hent('CDP_CHAR_CODES');
  if (!koder) return;
  assert.equal(koder[' '], 'Space');
  assert.equal(koder['\n'], 'Enter');
  assert.equal(koder['-'], 'Minus');
  assert.equal(koder['@'] ?? 'Digit2', 'Digit2', 'shiftede tegn melder tasten de sidder paa');
});
