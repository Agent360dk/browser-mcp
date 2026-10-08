/**
 * ask_user's prompt must not be readable or answerable by the page it sits on.
 *
 * The prompt asks for 2FA codes and passwords. It was injected with world: 'MAIN' as plain
 * light-DOM elements, so any script on the page could read input.value as the user typed,
 * or call doneBtn.click() to answer on the user's behalf.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROD } from './hjaelp/udvidelses-sele.mjs';
import { caseBlok } from './hjaelp/kildeblok.mjs';

const kilde = readFileSync(join(ROD, 'extension/background.js'), 'utf8');
const blok = caseBlok(kilde, 'ask_user');

test('ask_user is injected into the isolated world, not the page world', () => {
  assert.doesNotMatch(blok, /world: 'MAIN'/, 'the prompt runs alongside page scripts again');
  assert.match(blok, /world: 'ISOLATED'/);
});

test('the prompt lives in a closed shadow root', () => {
  assert.match(blok, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.doesNotMatch(blok, /document\.body\.appendChild\(overlay\)/, 'the card is attached to the page DOM directly');
});

test('only trusted events answer the prompt', () => {
  assert.match(blok, /doneBtn\.addEventListener\('click', \(e\) => \{ if \(e\.isTrusted\)/);
  assert.match(blok, /skipBtn\.addEventListener\('click', \(e\) => \{ if \(!e\.isTrusted\) return;/);
  assert.match(blok, /e\.isTrusted && e\.key === 'Enter'/);
});

test('keystrokes in the prompt do not bubble out to the page', () => {
  assert.match(blok, /\['keydown', 'keyup', 'keypress', 'input', 'beforeinput'\]/);
  assert.match(blok, /host\.addEventListener\(type, \(e\) => e\.stopPropagation\(\)\)/);
});
