/**
 * Issue #76 (arasmileska, 1.30.3, Windows 11, Chrome 155): browser_press_key gav Enter uden keypress, og tegnsaetning (",")
 * fik keyCode 0 og en code, Chrome ikke kender. Et rigtigt tastatur giver keydown 13 / keypress 13 / keyup 13 for Enter og
 * keydown 188 "Comma" / keypress 44 / keyup 188 for ",". Tag-/chip-felter, der lytter paa keypress eller keyCode 188, fik
 * derfor aldrig deres tag. Proeverne her vogter de CDP-parametre, background.js sender; maalingen i aegte headless Chrome
 * ligger uden for repoet (~/.claude/plans/browsermcp-132/chrome-76/).
 *
 * Valget for de skiftede tegn (< > ? : " { } | _ + ~ ! @ # $ % ^ & * ( )): som et rigtigt US-tastatur - samme fysiske tast
 * (keyCode og code som det uskiftede tegn) med Shift holdt nede (modifiers har Shift, saa shiftKey er sand paa siden).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function tastSele() {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'tabs.query': [{ id: 1, url: 'https://x.example', windowId: 1, active: true }],
    'debugger.sendCommand': () => ({}),
    'tabs.update': undefined,
    'windows.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  u.ctx.chrome.scripting.executeScript = async ({ func }) => {
    const kilde = String(func);
    if (kilde.includes('addEventListener')) return [{ result: undefined }];
    if (kilde.includes('removeEventListener')) return [{ result: { antal: 1, traf: true } }];
    return [{ result: null }];
  };
  const tast = (type) => u.optager.til('debugger.sendCommand').map((k) => k.args[2]).filter((p) => p && p.type === type);
  return { u, ned: () => tast('keyDown'), op: () => tast('keyUp') };
}
async function tryk(p) {
  const s = tastSele();
  await s.u.hent('dispatch')(9876, 'press_key', p);
  return { ned: s.ned()[0], op: s.op()[0] };
}

test('#76: Enter sender text "\\r" (og unmodifiedText) ved keyDown, saa siden faar keypress 13 - som et rigtigt tastatur', async () => {
  const { ned, op } = await tryk({ key: 'Enter' });
  assert.equal(ned.text, '\r', `Enter uden text giver intet keypress (#76): ${JSON.stringify(ned)}`);
  assert.equal(ned.unmodifiedText, '\r', JSON.stringify(ned));
  assert.equal(ned.windowsVirtualKeyCode, 13);
  assert.equal(ned.code, 'Enter');
  assert.equal(op.text, undefined, 'keyUp maa ikke baere tekst');
});

test('#76: en genvej med Enter (ctrl, meta, alt) faar ingen tekst - #68-reglen gaelder stadig', async () => {
  for (const mod of ['ctrl', 'meta', 'alt']) {
    const { ned } = await tryk({ key: 'Enter', [mod]: true });
    assert.equal(ned.text, '', `${mod}+Enter skrev et linjeskift: ${JSON.stringify(ned)}`);
    assert.equal(ned.unmodifiedText, undefined, `${mod}+Enter: ${JSON.stringify(ned)}`);
    assert.equal(ned.windowsVirtualKeyCode, 13);
  }
});

const UDEN_SHIFT = [[',', 188, 'Comma'], ['.', 190, 'Period'], ['-', 189, 'Minus'], ['=', 187, 'Equal'], [';', 186, 'Semicolon'],
  ["'", 222, 'Quote'], ['/', 191, 'Slash'], ['\\', 220, 'Backslash'], ['[', 219, 'BracketLeft'], [']', 221, 'BracketRight'],
  ['`', 192, 'Backquote'], [' ', 32, 'Space']];
const MED_SHIFT = [['<', 188, 'Comma'], ['>', 190, 'Period'], ['?', 191, 'Slash'], [':', 186, 'Semicolon'], ['"', 222, 'Quote'],
  ['{', 219, 'BracketLeft'], ['}', 221, 'BracketRight'], ['|', 220, 'Backslash'], ['_', 189, 'Minus'], ['+', 187, 'Equal'],
  ['~', 192, 'Backquote'], ['!', 49, 'Digit1'], ['@', 50, 'Digit2'], ['#', 51, 'Digit3'], ['$', 52, 'Digit4'], ['%', 53, 'Digit5'],
  ['^', 54, 'Digit6'], ['&', 55, 'Digit7'], ['*', 56, 'Digit8'], ['(', 57, 'Digit9'], [')', 48, 'Digit0']];

test('#76: tegnsaetning efter US-layout faar sin tastkode og sin code - "," er 188 "Comma", ikke 0 og ","', async () => {
  for (const [tegn, vk, code] of UDEN_SHIFT) {
    const { ned, op } = await tryk({ key: tegn });
    assert.deepEqual([ned.windowsVirtualKeyCode, ned.code, ned.text, ned.modifiers], [vk, code, tegn, 0], `${JSON.stringify(tegn)}: ${JSON.stringify(ned)}`);
    assert.deepEqual([op.windowsVirtualKeyCode, op.code], [vk, code], `${JSON.stringify(tegn)} keyUp: ${JSON.stringify(op)}`);
  }
});

test('#76: de skiftede tegn er samme tast med Shift - "<" er 188 "Comma" med shift, som paa et rigtigt US-tastatur', async () => {
  for (const [tegn, vk, code] of MED_SHIFT) {
    const { ned, op } = await tryk({ key: tegn });
    assert.deepEqual([ned.windowsVirtualKeyCode, ned.code, ned.text], [vk, code, tegn], `${JSON.stringify(tegn)}: ${JSON.stringify(ned)}`);
    assert.equal(ned.modifiers & 8, 8, `${JSON.stringify(tegn)} uden Shift - et rigtigt tastatur holder Shift nede: ${JSON.stringify(ned)}`);
    assert.equal(op.modifiers & 8, 8, `${JSON.stringify(tegn)} keyUp uden Shift`);
    assert.deepEqual([op.windowsVirtualKeyCode, op.code], [vk, code]);
  }
});

test('#76: en eksplicit code vinder, men tastkoden kommer stadig fra tegnet ("," med code "Comma" er 188, ikke 0)', async () => {
  const a = await tryk({ key: ',', code: 'Comma' });
  assert.deepEqual([a.ned.windowsVirtualKeyCode, a.ned.code], [188, 'Comma'], JSON.stringify(a.ned));
  const b = await tryk({ key: ',', code: 'NumpadDecimal' });
  assert.equal(b.ned.code, 'NumpadDecimal', 'den eksplicitte code blev overskrevet');
});

test('#76: et tegn uden for tabellen faar ingen code (Chrome kender ikke "é" som code) - og a er uaendret', async () => {
  const e = await tryk({ key: 'é' });
  assert.equal(e.ned.code, '', `code faldt tilbage til selve tegnet: ${JSON.stringify(e.ned)}`);
  assert.equal(e.ned.text, 'é');
  const a = await tryk({ key: 'a' });
  assert.deepEqual([a.ned.windowsVirtualKeyCode, a.ned.code, a.ned.text, a.ned.modifiers], [65, 'KeyA', 'a', 0]);
  // Et stort bogstav faar IKKE Shift (press_key har aldrig givet det; valgt for ikke at aendre adfaerd ud over #76).
  const A = await tryk({ key: 'A' });
  assert.deepEqual([A.ned.windowsVirtualKeyCode, A.ned.code, A.ned.text, A.ned.modifiers], [65, 'KeyA', 'A', 0], JSON.stringify(A.ned));
  const c = await tryk({ key: 'a', ctrl: true });
  assert.deepEqual([c.ned.text, c.ned.windowsVirtualKeyCode, [...(c.ned.commands || [])]], ['', 65, ['selectAll']], '#68: ctrl+a aendret');
});

// ── Samme fejlklasse i browser_fill's tegn-for-tegn-skrivning (typeCharsAttached) ─────────────────────────────────────────
// browser_fill skriver tegn for tegn, naar vaerdien ikke kan saettes direkte (text=-vaelgere, felter der ikke hoerer
// setteren). Den sendte code, men ingen tastkode: et tag-felt, der lytter paa keyCode 188, fik heller ikke her sit komma.
// Teksten, der skrives ind, maa ikke aendre sig: hvert tegn sendes stadig med sig selv som text.
async function skriv(tekst) {
  const s = tastSele();
  await s.u.hent('typeCharsAttached')(1, tekst);
  return { ned: s.ned(), op: s.op() };
}

test('#76 i browser_fill: tegn-for-tegn-skrivningen giver tegnsaetning sin tastkode og de skiftede tegn Shift - teksten er den samme', async () => {
  const { ned, op } = await skriv('a,<b');
  assert.deepEqual(ned.map((n) => n.text), ['a', ',', '<', 'b'], 'teksten, der skrives ind, aendrede sig');
  assert.deepEqual(ned.map((n) => [n.key, n.windowsVirtualKeyCode, n.code, (n.modifiers || 0) & 8]),
    [['a', 65, 'KeyA', 0], [',', 188, 'Comma', 0], ['<', 188, 'Comma', 8], ['b', 66, 'KeyB', 0]], JSON.stringify(ned));
  assert.deepEqual(op.map((n) => [n.windowsVirtualKeyCode, n.code, (n.modifiers || 0) & 8]),
    [[65, 'KeyA', 0], [188, 'Comma', 0], [188, 'Comma', 8], [66, 'KeyB', 0]], JSON.stringify(op));
});

test('#76 i browser_fill: linjeskift og tabulator skrives som foer (ingen Enter- eller Tab-tast, der kan sende en formular eller flytte fokus)', async () => {
  const { ned } = await skriv('x\ny\tz');
  assert.deepEqual(ned.map((n) => [n.text, n.key, n.windowsVirtualKeyCode]),
    [['x', 'x', 88], ['\n', '\n', undefined], ['y', 'y', 89], ['\t', '\t', undefined], ['z', 'z', 90]], JSON.stringify(ned));
});

test('#76: rydningen (ctrl/cmd+a, Backspace) sender tastkoderne 65 og 8 - samme regel som press_key', async () => {
  const s = tastSele();
  await s.u.hent('clearFieldAttached')(1);
  assert.deepEqual(s.ned().map((n) => [n.key, n.code, n.windowsVirtualKeyCode]), [['a', 'KeyA', 65], ['Backspace', 'Backspace', 8]], JSON.stringify(s.ned()));
  assert.deepEqual(s.op().map((n) => n.windowsVirtualKeyCode), [65, 8]);
});

test('#76 moenstret: hvert tastetryk over CDP baerer sin tastkode - intet kald til tastParAttached eller Input.dispatchKeyEvent uden', async () => {
  const { readFileSync } = await import('node:fs');
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const kald = [...kilde.matchAll(/await tastParAttached\(tabId,/g)].map((m) => kilde.slice(m.index, kilde.indexOf(');', m.index)));
  assert.ok(kald.length >= 5, `fandt kun ${kald.length} kald til tastParAttached`);
  // Begge halvdele - ned og op - baerer tastkoden.
  for (const k of kald) assert.ok((k.match(/tastkodeFelter\(/g) || []).length >= 2, `et tastetryk uden tastkode paa ned eller op: ${k}`);
  // De raa Input.dispatchKeyEvent-kald: kun i tastParAttached og i press_key (med vkParams).
  const raa = [...kilde.matchAll(/'Input\.dispatchKeyEvent', \{/g)].map((m) => kilde.slice(m.index, kilde.indexOf('});', m.index)));
  for (const r of raa) assert.match(r, /\.\.\.ned|\.\.\.op|\.\.\.vkParams/, `et raat tastetryk uden tastkode: ${r.slice(0, 120)}`);
});
