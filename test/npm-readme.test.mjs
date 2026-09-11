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

test('npm-README bruger kun absolutte billedadresser', () => {
  const md = readFileSync(join(rod, 'mcp-server/README.md'), 'utf8');
  const billeder = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  assert.ok(billeder.length > 0, 'ingen billeder fundet - testen maaler intet');
  assert.deepEqual(billeder.filter((u) => !/^https?:\/\//.test(u)), [], 'relative billedstier paa npm-siden');
});

test('npm-READMEs billeder paa main peger paa filer der findes i repoet', () => {
  const md = readFileSync(join(rod, 'mcp-server/README.md'), 'utf8');
  const egne = [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]).filter((u) => u.startsWith(RAA));
  assert.ok(egne.length > 0, 'demo-GIF\'en peger ikke paa repoets main');
  for (const u of egne) assert.ok(existsSync(join(rod, u.slice(RAA.length))), `${u} findes ikke i repoet`);
});
