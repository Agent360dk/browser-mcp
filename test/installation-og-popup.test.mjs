/**
 * Installationen og popuppen skal pege paa det der virker - for alle fire klienter.
 *
 * MAALT 11/9 i e2e-reviewet (Fable): `install.sh` beder brugeren skrive serveren ind i `~/.claude/mcp.json`, en sti Claude
 * Code ikke laeser (`bin/cli.js` siger det selv). Opskriften er altsaa doed, og den staar stadig i repoet.
 * MAALT samme dag i Chrome for Testing: popuppen uden server viser kun Claude Code-kommandoen, selvom `install` nu
 * registrerer hos Codex, VS Code og Cursor, og guiderne naevner alle fire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const laes = (p) => readFileSync(join(rod, p), 'utf8');

test('install.sh peger ikke paa en fil Claude Code ikke laeser', () => {
  const sh = laes('install.sh');
  assert.doesNotMatch(sh, /\.claude\/mcp\.json/, 'opskriften skriver stadig til en sti Claude Code ikke laeser');
});

test('install.sh bruger den rigtige installation (bin/cli.js install)', () => {
  const sh = laes('install.sh');
  assert.match(sh, /bin\/cli\.js" install|bin\/cli\.js install/, 'install.sh koerer ikke pakkens egen install');
});

test('popuppen uden server naevner alle de klienter install registrerer', () => {
  const html = laes('extension/popup.html');
  assert.match(html, /claude mcp add/i, 'Claude Code-kommandoen mangler');
  for (const klient of ['codex', 'cursor', 'vs code']) {
    assert.match(html.toLowerCase(), new RegExp(klient), `popuppen naevner ikke ${klient}`);
  }
});

test('popuppens kopiknap kopierer den kommando der staar i popuppen', () => {
  const js = laes('extension/popup.js');
  assert.match(js, /setupCmd/, 'kopiknappen laeser ikke kommandoen fra popuppen');
});
