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

// The prompt is drawn by renderAskPrompt (also on every redraw after a navigation), and
// every executeScript for it goes through drawAskPrompt / eraseAskPrompt.
function fnBlok(navn) {
  const i = kilde.indexOf(`function ${navn}(`);
  assert.ok(i > -1, `${navn} was not found`);
  return kilde.slice(i, kilde.indexOf('\n}\n', i));
}
const blok = fnBlok('renderAskPrompt');
const injektion = fnBlok('drawAskPrompt') + fnBlok('eraseAskPrompt');

test('ask_user is injected into the isolated world, not the page world', () => {
  assert.doesNotMatch(injektion, /world: 'MAIN'/, 'the prompt runs alongside page scripts again');
  assert.equal(injektion.match(/world: 'ISOLATED'/g)?.length, 2);
  assert.doesNotMatch(caseBlok(kilde, 'ask_user'), /executeScript\(/, 'ask_user injects past drawAskPrompt');
});

test('the prompt lives in a closed shadow root', () => {
  assert.match(blok, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.doesNotMatch(blok, /document\.body\.appendChild\((overlay|card)\)/, 'the card is attached to the page DOM directly');
});

test('only trusted events answer the prompt', () => {
  assert.match(blok, /doneBtn\.addEventListener\('click', \(e\) => \{ if \(e\.isTrusted\) answer\('done'\)/);
  assert.match(blok, /skipBtn\.addEventListener\('click', \(e\) => \{ if \(e\.isTrusted\) answer\('skip'\)/);
  assert.match(blok, /e\.isTrusted && e\.key === 'Enter'/);
  assert.match(blok, /if \(!e\.isTrusted \|\| e\.button !== 0\) return;/, 'a synthetic pointerdown must not drag the card');
});

test('keystrokes in the prompt do not bubble out to the page', () => {
  assert.match(blok, /\['keydown', 'keyup', 'keypress', 'input', 'beforeinput'\]/);
  assert.match(blok, /host\.addEventListener\(type, \(e\) => e\.stopPropagation\(\)\)/);
});

test('a page that wipes its body does not take the prompt with it', () => {
  // MEASURED 2026-10-08: Chrome's JSON viewer rebuilds <body> after DOMContentLoaded.
  assert.match(blok, /new MutationObserver\(/);

  // ...but an answered or erased prompt must stay gone. That is run, not read: test/ask-user-prompt.test.mjs
  // (R48 - the state lives in the extension's isolated world now, not in a data attribute the page can set).
});
