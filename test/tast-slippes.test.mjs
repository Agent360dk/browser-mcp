/**
 * En tast der blev trykket ned, slippes altid - ogsaa i hjaelperne.
 *
 * MAALT 10/9 af Astra (anden runde): press_key fik keyUp-altid i foerste runde, men fill, dato og
 * skrivning bruger tre hjaelpere der sender taster selv. Timede et keyDown ud EFTER at det var
 * landet, forlod hjaelperen funktionen foer sit keyUp - og tasten sad fast for siden. Et fastsiddende
 * Cmd goer det naeste tastetryk til en genvej.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele() {
  const typer = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://x.example', windowId: 1, active: true },
    'debugger.sendCommand': (_m, metode, p) => {
      if (metode !== 'Input.dispatchKeyEvent') return {};
      typer.push(p.type);
      if (p.type === 'keyDown') throw new Error('CDP svarede ikke inden 1500 ms: Input.dispatchKeyEvent');
      return {};
    },
  } });
  return { u, typer };
}

test('rydningen (Cmd+A, Backspace) slipper tasten selv om keyDown timede ud', async () => {
  const { u, typer } = sele();
  await assert.rejects(u.hent('clearFieldAttached')(1), /svarede ikke inden/, 'fejlen skal stadig naa kalderen');
  assert.deepEqual(typer, ['keyDown', 'keyUp'], `forkert tastraekke (sluppet? dobbelt?): ${typer.join(',')}`);
});

test('skrivning tegn for tegn slipper tasten selv om keyDown timede ud', async () => {
  const { u, typer } = sele();
  await assert.rejects(u.hent('typeCharsAttached')(1, 'ab'), /svarede ikke inden/);
  assert.deepEqual(typer, ['keyDown', 'keyUp'], `forkert tastraekke (sluppet? dobbelt?): ${typer.join(',')}`);
});

test('dato-skrivningen sender ingen keyDown uden om hjaelperen', () => {
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const i = kilde.indexOf('async function setDateMaskedTyping(');
  const blok = kilde.slice(i, kilde.indexOf('\n}\n', i));
  assert.ok(i > -1 && blok.length > 100, 'setDateMaskedTyping blev ikke fundet');
  assert.doesNotMatch(blok, /type: 'keyDown'/, 'et raat keyDown her kan efterlade tasten nede');
});

test('kalenderens PageUp/PageDown sender ingen keyDown uden om hjaelperen', () => {
  // Astra, tredje runde: setDatePicker var overset i anden runde.
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const i = kilde.indexOf('async function setDatePicker(');
  const blok = kilde.slice(i, kilde.indexOf('\n}\n', i));
  assert.ok(i > -1 && blok.length > 100, 'setDatePicker blev ikke fundet');
  assert.doesNotMatch(blok, /type: 'keyDown'/, 'et raat keyDown her kan efterlade tasten nede');
  assert.match(blok, /tastParAttached\(tabId, \{ key, code: key \}/, 'PageUp/PageDown skal sendes via hjaelperen - ikke fjernes');
});
