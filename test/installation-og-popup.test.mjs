/**
 * Installationen og popuppen skal pege paa det der virker - for alle fire klienter.
 *
 * MAALT 11/9 i e2e-reviewet (Fable): `install.sh` beder brugeren skrive serveren ind i `~/.claude/mcp.json`, en sti Claude
 * Code ikke laeser (`bin/cli.js` siger det selv). Opskriften er altsaa doed, og den staar stadig i repoet.
 * MAALT samme dag i Chrome for Testing: popuppen uden server viser kun Claude Code-kommandoen, selvom `install` nu
 * registrerer hos Codex, VS Code og Cursor, og guiderne naevner alle fire.
 */
import vm from 'node:vm';
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

// R186 (#91): sessionens navn er agentens tekst, og fanernes titler kommer fra websider - popuppen maa aldrig tolke dem som HTML.
test('popuppen tolker aldrig sessionens navn, en fanetitel eller loggen som HTML', () => {
  const js = laes('extension/popup.js');
  assert.doesNotMatch(js, /\$\{\s*session\.label\s*\}/, 'session.label indsaettes raat i innerHTML');
  assert.doesNotMatch(js, /\$\{\s*entry\.(session|method)\b/, 'handlingslogens felter indsaettes raat i innerHTML');
  assert.doesNotMatch(js, /\$\{\s*u\s*\}/, 'fanernes adresser indsaettes raat i innerHTML');
  assert.match(js, /const esc = /, 'popuppen har ingen escape-funktion');
});

// R187: proeven ovenfor laeser kun kildeteksten - en esc der intet goer, eller `${(session.label)}`, slap igennem. Her koeres popuppen.
test('popuppen viser sessionens navn, fanens adresse og loggen som tekst - koert, ikke kun laest', async () => {
  const ondt = '<img src=//x.example/p>';
  const el = {};
  const node = (id) => (el[id] ??= { innerHTML: '', textContent: '', className: '', value: '', classList: { toggle() {} }, addEventListener() {} });
  const chrome = {
    storage: { local: { get: (d, cb) => cb({ ...d, sessions: { 9876: { label: ondt, color: 'blue"><style>', tabIds: [1] } },
      actionLog: [{ time: 0, method: ondt, session: ondt }] }) } },
    tabs: { get: async () => ({ url: 'data:text/html,<style>' }) },
    runtime: { sendMessage: () => Promise.resolve() },
  };
  vm.runInNewContext(laes('extension/popup.js'), { chrome, document: { getElementById: node }, setTimeout });
  await new Promise((r) => setTimeout(r, 20));
  for (const id of ['sessions', 'log']) {
    assert.doesNotMatch(el[id].innerHTML, /<img|<style/, `${id} indsaetter agentens eller sidens tekst som HTML: ${el[id].innerHTML}`);
    assert.match(el[id].innerHTML, /&lt;img src=\/\/x\.example\/p&gt;/, `${id} viser ikke teksten`);
  }
});
