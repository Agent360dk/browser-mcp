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

// MAALT 12/9 af Fable (e2e runde 3): WISHLIST.md og CONTRIBUTING.md stod uden for vagtens raekkevidde, og begge er
// offentlige paa GitHub. WISHLIST sagde "MIT, local, no telemetry"; CONTRIBUTING stod med tre foraeldede tal.
const STIER = ['docs', 'content', 'README.md', 'mcp-server/README.md', 'mcp-server/index.js', 'mcp-server/tools.js', 'mcp-server/bin/cli.js',
  // MAALT 13/9: cli.js laa uden for vagten, selvom den skriver installationsvejledningen til HVER ny bruger.
  // Den bar bade den falske groenne-ikon-paastand og et loefte om helt automatiske opdateringer.
  'llms-install.md', 'USE_CASES.md', 'demo-video-src/src', 'extension/popup.html', 'glama.json', 'server.json',
  'mcp-server/server.json', 'WISHLIST.md', 'CONTRIBUTING.md', 'SECURITY.md'];
// CHANGELOG.md staar bevidst UDENFOR: den CITERER de gamle formuleringer og tal for at forklare hvad der blev rettet
// ("Several pages promised that 'nothing leaves your machine'"). Samme grund som revisionsdokumentet nedenfor.
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
  // MAALT 12/9 af Fable: sammenligningstabellen sagde "Data exposure: Stays local" om lokale MCP-servere. Serveren
  // koerer lokalt, men det den returnerer gaar videre til AI-klienten og dens modeludbyder - samme loefte, nye ord.
  [/data exposure[^|\n]*\|\s*stays local/i, 'data bliver lokalt'],
  [/\bMIT, local\b/i, 'local uden at sige hvad der er lokalt'],
  // MAALT 13/9 af Astra og Fable i den faelles runde: "genstart, saa bliver ikonet groent" var falsk fra 1.29.0,
  // hvor serveren begyndte at tage sin port ved foerste browserkald i stedet for ved opstart. Jeg rettede den i
  // haanden 13 steder - og missede tre, fordi jeg soegte paa "turns green" og ikke paa "goes green". De tre stod
  // paa forsidens FAQ, paa den mest laeste installationsside og i popup'en der foelger med i butikspakken.
  // Vagten var bygget til praecis dette og manglede bare reglen.
  [/(restart|reload)[^.\n]{0,80}(turns?|goes?|go|is) green/i, 'lover groent efter en genstart'],
  [/(turns?|goes?) green[^.\n]{0,60}(after|when you|once you) (you )?(restart|reload)/i, 'lover groent efter en genstart'],
  // Ikonet skifter aldrig farve - der er ét PNG-saet og intet kald til chrome.action.setIcon. Det groenne er et
  // BADGE med antallet af forbundne agenter. En bruger der leder efter et groent ikon finder aldrig et.
  [/icon[^.\n]{0,30}(turns?|goes?|is) green/i, 'siger at ikonet bliver groent - det er badgen'],
];
const FORKERTE_TAL = [
  // 12/9: moenstret krævede flertal, saa "34 tool definitions" i CONTRIBUTING slap igennem i otte udgaver.
  [/\b(29|34) (browser )?tools?\b/i, 'gammelt vaerktoejstal'],
  [/up to 10 concurrent/i, 'gammelt sessionstal'],
  [/\d+% (pass|solve) rate/i, 'opfundet CAPTCHA-procent'],
  // MAALT 11/9 af Fable (e2e runde 2): READMEen sagde "51 checks, 0 failures" fra 1.29.0 og blev kopieret uaendret til
  // npm-siden. De seneste koersler er 46 af 51 - de fem er musehaendelser i en baggrundsfane, hvor Chrome ikke leverer dem.
  [/\b0 failures\b/i, 'paastand om nul fejl i flowtesten'],
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

// MAALT 11/9 i Chrome for Testing (Opus' backlog 10 fra e2e-reviewet): en adgangskode skrevet af 1.29.0's handlingslog laa
// stadig i profilens `Local Extension Settings/<id>/000003.log` EFTER at posterne var renset - ogsaa efter 60 nye skrivninger.
// Det er databasens skrivelog; den forsvinder foerst naar Chrome selv skriver filen om. Vores tekst maa ikke sige mere.
test('changelog lover ikke at de gamle poster er vaek fra disken', () => {
  const md = readFileSync(join(rod, 'CHANGELOG.md'), 'utf8');
  const afsnit = md.slice(md.indexOf('## 1.29.1'), md.indexOf('## 1.29.0'));
  assert.match(afsnit, /action log/i, 'afsnittet om handlingsloggen findes ikke');
  assert.match(afsnit, /Chrome('s)? own (storage|file)|storage file/i,
    'teksten siger ikke at Chromes egen lagerfil kan beholde de gamle vaerdier');
  assert.match(afsnit, /until Chrome (rewrites|compacts)/i, 'teksten siger ikke hvornaar de forsvinder');
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
