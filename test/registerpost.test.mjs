/**
 * De to `server.json` maa ikke drive fra hinanden.
 *
 * ⛔ MAALT 21/9, og det er den dyreste slags fejl: en commit med titlen «registret kan nu
 * vise vores logo» tilfoejede en `icons`-blok til **rod**-`server.json`. Udgivelses-scriptet
 * udgiver den ANDEN fil:
 *
 *     runbrowsermcpupdate.sh:726   ( cd mcp-server && mcp-publisher publish server.json )
 *
 * Intet synkroniserede rod → mcp-server. Scriptet synkroniserer `extension/` og `README.md`,
 * men ikke den her. Resultatet: registret svarede `icons: false` paa 1.30.0, logoet ville
 * aldrig komme, og INGEN fremtidig udgivelse ville rette det - fordi hver udgivelse ville
 * udgive den samme fil uden blokken. Commit'et saa ud som om arbejdet var gjort.
 *
 * Proeven sammenligner de felter registret faktisk laeser. `version` er undtaget: den bumpes
 * i begge filer af scriptet, men paa hver sin linje, saa et oejebliks forskel under et bump
 * ikke skal vaelte suiten.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROD = join(dirname(fileURLToPath(import.meta.url)), '..');
const laes = (p) => JSON.parse(readFileSync(join(ROD, p), 'utf8'));

test('de to server.json beskriver den SAMME post', () => {
  const rod = laes('server.json');
  const udgivet = laes('mcp-server/server.json');   // ← den scriptet faktisk udgiver

  const felter = ['name', 'title', 'description', 'websiteUrl', 'repository', 'icons', '$schema'];
  const forskelle = [];
  for (const f of felter) {
    const a = JSON.stringify(rod[f]);
    const b = JSON.stringify(udgivet[f]);
    if (a !== b) forskelle.push(`${f}: rod=${a} · udgivet=${b}`);
  }

  assert.deepEqual(forskelle, [],
    'server.json og mcp-server/server.json er ikke enige. Det er SIDSTNAEVNTE der udgives ' +
    '(runbrowsermcpupdate.sh), saa en aendring der kun staar i rod-filen naar aldrig registret');
});

test('posten der UDGIVES baerer et logo, og logoet peger paa vores eget domaene', () => {
  const udgivet = laes('mcp-server/server.json');
  assert.ok(Array.isArray(udgivet.icons) && udgivet.icons.length > 0,
    'ingen icons-blok i den fil der udgives - registret viser en tom firkant');
  for (const ikon of udgivet.icons) {
    assert.match(ikon.src, /^https:\/\/browsermcp\.dev\//,
      'logoet skal ligge paa vores eget domaene - en fremmed vaert kan forsvinde uden varsel');
  }
});
