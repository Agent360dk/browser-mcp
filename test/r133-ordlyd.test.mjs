/**
 * Gennemgang 19/11-2026 (review-team 1.33, F2 + F3): to saetninger, en agent handler paa.
 * F2: field-is-empty kan i 1.33 betyde «kunne ikke maales» (keys_delivered: null, extension/background.js) - serverens
 *     vejledning maa da ikke sige «gentag», for en tag-/chip-indtastning kan have taget teksten, og den kommer to gange.
 * F3: 1.32 blev aldrig udgivet; vaerktoejsbeskrivelserne maa ikke henvise til den som en version.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../mcp-server/tools.js';

const rod = join(dirname(fileURLToPath(import.meta.url)), '..');

test('F2: vejledningen undtager field-is-empty med keys_delivered: null fra «gentag»', () => {
  const index = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');
  const linje = index.split('\n').find((l) => l.includes('is a measurement, not a guess')) ?? '';
  assert.ok(/field-is-empty with keys_delivered: null/.test(linje), 'undtagelsen mangler i maale-linjen');
  assert.ok(/read the page before typing it again/.test(linje), 'undtagelsen skal sige: laes siden foer der skrives igen');
});

test('F3: ingen vaerktoejsbeskrivelse naevner 1.32, som aldrig blev udgivet', () => {
  const med = TOOLS.filter((t) => /\b1\.32\b/.test(JSON.stringify(t))).map((t) => t.name);
  assert.deepEqual(med, []);
});

test('panel 20/11: browser_wait siger selv, at en udvidelse foer 1.33 ikke tjekker synlighed', () => {
  const w = TOOLS.find((t) => t.name === 'browser_wait');
  assert.ok(/older than 1\.33[\s\S]*visibility is not checked[\s\S]*visibility_checked:false/.test(w.description), 'beskrivelsen mangler forbeholdet for gamle udvidelser');
  assert.ok(/older than 1\.33/.test(w.inputSchema.properties.state.description), 'state-teksten mangler forbeholdet');
});
