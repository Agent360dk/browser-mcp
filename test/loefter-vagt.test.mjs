/**
 * Vagt: falske loefter og forkerte tal maa ikke snige sig tilbage i det brugerne laeser.
 *
 * MAALT 10-11/9: "nothing leaves your machine" stod paa forsiden, i npm-README, i llms.txt (som
 * AI-assistenter laeser) og i FAQ-data paa fire installationssider. Det er falsk: det agenten
 * laeser gaar til brugerens AI-klient og videre til dens modeludbyder. Rettelsen 10/9 fjernede
 * én formulering, og samme loefte stod videre med andre ord paa 8 sider. Samme uge viste
 * butikken "29 tools" og to kataloger "34 tools", fordi intet vagtede tallene.
 *
 * Testen scanner de tekster der udgives (site-kilder, genererede sider, README'er, serverens
 * instruks, billedkilden) og fejler med fil:linje for hvert fund.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));

const STIER = ['docs', 'content', 'README.md', 'mcp-server/README.md', 'mcp-server/index.js', 'mcp-server/tools.js',
  'llms-install.md', 'USE_CASES.md', 'demo-video-src/src', 'extension/popup.html', 'glama.json', 'server.json', 'mcp-server/server.json'];
// Revisionsdokumentet citerer den gamle butikstekst for at forklare hvorfor den skal ud.
const UNDTAGET = new Set(['docs/CWS_LISTING_TEXT.md']);
const ENDELSER = /\.(md|html|txt|js|mjs|ts|tsx|json)$/;

const LOEFTER = [
  [/nothing[^."]{0,40}leaves (your|the) machine/i, 'intet forlader maskinen'],
  [/stays on your machine/i, 'bliver paa maskinen'],
  [/never sends your [^.]{0,30}data anywhere/i, 'sender aldrig data nogen steder'],
  [/100% local/i, '100% local'],
  [/\blocal-only\b/i, 'local-only'],
  [/everything stays local/i, 'everything stays local'],
  [/nothing is transmitted off/i, 'intet sendes ud af maskinen'],
  [/transmits nothing/i, 'sender intet'],
  [/\bNo\. The MCP server runs locally/, 'nej til at data forlader maskinen'],
];
const FORKERTE_TAL = [
  [/\b(29|34) (browser )?tools\b/i, 'gammelt vaerktoejstal'],
  [/up to 10 concurrent/i, 'gammelt sessionstal'],
  [/\d+% (pass|solve) rate/i, 'opfundet CAPTCHA-procent'],
];

function filer(sti) {
  const fuld = join(rod, sti);
  let st;
  try { st = statSync(fuld); } catch { return []; }
  if (st.isFile()) return [sti];
  return readdirSync(fuld, { withFileTypes: true }).flatMap((d) =>
    d.name === 'node_modules' || d.name.startsWith('.') ? [] : filer(join(sti, d.name)));
}

function fund(regler) {
  const ud = [];
  for (const f of STIER.flatMap(filer)) {
    const rel = relative(rod, join(rod, f));
    if (UNDTAGET.has(rel) || !ENDELSER.test(rel)) continue;
    readFileSync(join(rod, rel), 'utf8').split('\n').forEach((linje, i) => {
      if (/^\s*\/\//.test(linje)) return;   // kildekommentarer maa citere det de erstatter
      for (const [re, navn] of regler) if (re.test(linje)) ud.push(`${rel}:${i + 1} (${navn})`);
    });
  }
  return ud;
}

test('ingen udgivet tekst lover at intet forlader maskinen', () => {
  const f = fund(LOEFTER);
  assert.deepEqual(f, [], `falske loefter:\n  ${f.join('\n  ')}`);
});

test('ingen udgivet tekst bruger gamle vaerktoejs- eller sessionstal eller en opfundet procent', () => {
  const f = fund(FORKERTE_TAL);
  assert.deepEqual(f, [], `forkerte tal:\n  ${f.join('\n  ')}`);
});

test('vagten kan se: den finder et loefte i et kendt eksempel', () => {
  // Kalibrering: en vagt der aldrig kan sige nej er ikke en vagt.
  const regel = (navn) => LOEFTER.find(([, n]) => n === navn)[0];
  const eksempel = 'MIT, free, and 100% local - nothing leaves your machine.';
  assert.ok(regel('intet forlader maskinen').test(eksempel) && regel('100% local').test(eksempel));
  assert.ok(regel('bliver paa maskinen').test('Extracted — stays on your machine'));
  assert.ok(regel('intet forlader maskinen').test('the one thing that matters most: nothing it reads ever leaves your machine'), 'ord imellem maa ikke skjule loeftet');
  assert.ok(regel('sender aldrig data nogen steder').test('never sends your browsing data anywhere'));
  assert.ok(FORKERTE_TAL[0][0].test('Restart Claude Code - 29 browser tools are now available'));
});
