/**
 * npm-siden viser mcp-server/README.md. Plan 7.14 (SEO-teamet, 11/9): demo-GIF'en stod som `assets/demo.gif`. Pakken har
 * ingen assets-mappe, og om npm loeser stien mod repoets rod er et gaet. En absolut adresse til en fil der findes, er ikke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const RAA = 'https://raw.githubusercontent.com/Agent360dk/browser-mcp/main/';

// Fable (e2e 11/9): udgivelsesscriptets trin 1b koerer `cp README.md mcp-server/README.md`. Rettes kun npm-READMEen,
// overskriver udgivelsen rettelsen med rodens relative sti. Begge filer skal derfor holde reglen.
for (const fil of ['mcp-server/README.md', 'README.md']) {
  test(`${fil} bruger kun absolutte billedadresser (npm-siden er en kopi af roden)`, () => {
    const md = readFileSync(join(rod, fil), 'utf8');
    const billeder = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    assert.ok(billeder.length > 0, 'ingen billeder fundet - testen maaler intet');
    assert.deepEqual(billeder.filter((u) => !/^https?:\/\//.test(u)), [], `relative billedstier i ${fil}`);
  });
}

test('udgivelsen kopierer stadig rod-READMEen til npm (ellers daekker testen ovenfor den forkerte fil)', () => {
  assert.match(readFileSync(join(rod, 'runbrowsermcpupdate.sh'), 'utf8'), /cp README\.md mcp-server\/README\.md/);
});

test('npm-READMEs billeder paa main peger paa filer der findes i repoet', () => {
  const md = readFileSync(join(rod, 'mcp-server/README.md'), 'utf8');
  const egne = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((u) => u.startsWith(RAA));
  assert.ok(egne.length > 0, 'demo-GIF\'en peger ikke paa repoets main');
  for (const u of egne) assert.ok(existsSync(join(rod, u.slice(RAA.length))), `${u} findes ikke i repoet`);
});
