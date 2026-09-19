/**
 * Ét-klik-install-linket paa /docs/install-trae er base64. Det kan ingen laese.
 *
 * Det betyder at en aendring i pakkenavnet - eller en tastefejl i kodningen - giver et
 * link der stadig VIRKER, men installerer noget andet end siden siger. Brugeren
 * bekraefter en konfiguration hun ikke kan laese, og fejlen viser sig som «serveren
 * findes ikke» dage senere.
 *
 * Samme klasse som de opfundne fejlbeskeder og det opdigtede citat, bare kodet: en
 * paastand paa siden der ikke kan efterproeves med oejnene. Derfor efterproeves den her.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const side = readFileSync(join(rod, 'content/browsermcp-docs-install-trae.md'), 'utf8');
const vscodeSide = readFileSync(join(rod, 'content/browsermcp-docs-install-vscode.md'), 'utf8');
const llms = readFileSync(join(rod, 'llms-install.md'), 'utf8');
const readmes = ['README.md', 'mcp-server/README.md'].map((f) => [f, readFileSync(join(rod, f), 'utf8')]);
const pakke = JSON.parse(readFileSync(join(rod, 'mcp-server/package.json'), 'utf8'));

function linketsConfig() {
  const m = side.match(/trae:\/\/trae\.ai-ide\/mcp-import\?type=stdio&name=browser-mcp&config=(\S+)/);
  assert.ok(m, 'install-linket findes ikke paa siden');
  return JSON.parse(Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8'));
}

test('install-linket afkoder til en konfiguration der starter VORES pakke', () => {
  const cfg = linketsConfig();
  assert.equal(cfg.command, 'npx', `linket starter ${cfg.command}, ikke npx`);
  assert.ok(Array.isArray(cfg.args), 'args mangler i linket');
  const pakkeArg = cfg.args.find((a) => a.startsWith('@'));
  assert.ok(pakkeArg, `linket naevner ingen pakke: ${JSON.stringify(cfg.args)}`);
  assert.equal(pakkeArg.split('@').slice(0, 2).join('@'), '@' + pakke.name.split('@')[1].split('/')[0] + '/' + pakke.name.split('/')[1],
    `linket installerer ${pakkeArg}, men pakken hedder ${pakke.name}`);
});

test('linket og det laesbare JSON-eksempel paa samme side er ENS', () => {
  const cfg = linketsConfig();
  const blok = side.match(/```json\n([\s\S]*?)```/);
  assert.ok(blok, 'det laesbare eksempel mangler');
  const vist = JSON.parse(blok[1]).mcpServers['browser-mcp'];
  assert.deepEqual({ command: cfg.command, args: cfg.args }, { command: vist.command, args: vist.args },
    'linket installerer noget andet end det siden viser - og brugeren kan ikke se forskel');
});

test('linket peger paa @latest, saa et klik ikke laaser brugeren til dagens udgave', () => {
  const cfg = linketsConfig();
  assert.ok(cfg.args.some((a) => a.endsWith('@latest')),
    `linket pinner en version: ${JSON.stringify(cfg.args)} - saa faar klikkeren aldrig en rettelse`);
});

// ── VS Codes eget link-format ───────────────────────────────────────────────
// Kilde: code.visualstudio.com/api/extension-guides/ai/mcp, ordret:
//   `vscode:mcp/install?${encodeURIComponent(JSON.stringify(obj))}`
// Samme fare som Traes: konfigurationen er URL-kodet og kan ikke laeses af den der klikker.
test('VS Code-linket afkoder til den samme pakke som siden viser', () => {
  const m = vscodeSide.match(/vscode:mcp\/install\?(\S+)/);
  assert.ok(m, 'ét-klik-linket findes ikke paa VS Code-siden');
  const cfg = JSON.parse(decodeURIComponent(m[1]));
  assert.equal(cfg.command, 'npx');
  assert.equal(cfg.type, 'stdio', 'VS Code kraever type paa en stdio-server');
  assert.ok(cfg.name, 'uden name faar serveren et tilfaeldigt navn i brugerens config');
  const pakkeArg = cfg.args.find((a) => a.startsWith('@'));
  assert.ok(pakkeArg && pakkeArg.startsWith(pakke.name),
    `linket installerer ${pakkeArg}, men pakken hedder ${pakke.name}`);
  assert.ok(pakkeArg.endsWith('@latest'), 'linket pinner en version - saa faar klikkeren aldrig en rettelse');
});

test('de to ét-klik-links installerer PRAECIS det samme', () => {
  const t = JSON.parse(Buffer.from(decodeURIComponent(
    side.match(/name=browser-mcp&config=(\S+)/)[1]), 'base64').toString('utf8'));
  const v = JSON.parse(decodeURIComponent(vscodeSide.match(/vscode:mcp\/install\?(\S+)/)[1]));
  assert.deepEqual({ command: t.command, args: t.args }, { command: v.command, args: v.args },
    'Trae- og VS Code-linket installerer forskellige ting - én af siderne er forkert');
});

// ── llms-install.md: den fil en AI-assistent FOELGER ────────────────────────
// Et forkert link her bliver ikke laest af et menneske foerst - det bliver udfoert.
test('begge links i llms-install.md er identiske med sidernes', () => {
  const vLlms = llms.match(/vscode:mcp\/install\?(\S+)/);
  const tLlms = llms.match(/name=browser-mcp&config=(\S+)/);
  assert.ok(vLlms && tLlms, 'et af de to links mangler i llms-install.md');
  assert.equal(vLlms[1], vscodeSide.match(/vscode:mcp\/install\?(\S+)/)[1],
    'VS Code-linket i llms-install.md er ikke det samme som paa siden');
  assert.equal(tLlms[1], side.match(/name=browser-mcp&config=(\S+)/)[1],
    'Trae-linket i llms-install.md er ikke det samme som paa siden');
});

// ── Alle fire ét-klik-veje skal kode PRAECIS den samme konfiguration ───────
// MAALT 19/9: READMEerne havde allerede to install-badges (Cursors web-endpoint og
// VS Codes redirect) som jeg ikke tjekkede for, foer jeg tilfoejede mine egne links.
// Deres konfiguration manglede `-y`, mine havde det - altsaa to forskellige
// installationer af det samme produkt, afhaengigt af hvor brugeren klikkede.
//
// Det er praecis den fejl husets regel er skrevet mod: tjek at det ikke allerede findes,
// FOER du bygger. Vagten her goer at det ikke kan ske igen uden at blive roedt.
test('alle ét-klik-veje installerer den samme konfiguration', () => {
  const facit = JSON.parse(Buffer.from(decodeURIComponent(
    side.match(/name=browser-mcp&config=(\S+)/)[1]), 'base64').toString('utf8'));
  const veje = [];
  for (const [navn, tekst] of readmes) {
    for (const m of tekst.matchAll(/cursor\.com\/install-mcp\?name=browser-mcp&config=([A-Za-z0-9+/=%]+)/g))
      veje.push([`${navn} (Cursor)`, JSON.parse(Buffer.from(decodeURIComponent(m[1]), 'base64').toString('utf8'))]);
    for (const m of tekst.matchAll(/vscode\.dev\/redirect\/mcp\/install\?name=browser-mcp&config=([A-Za-z0-9%.\-_]+)/g))
      veje.push([`${navn} (VS Code web)`, JSON.parse(decodeURIComponent(m[1]))]);
  }
  veje.push(['VS Code-siden', JSON.parse(decodeURIComponent(vscodeSide.match(/vscode:mcp\/install\?(\S+)/)[1]))]);
  veje.push(['llms-install (VS Code)', JSON.parse(decodeURIComponent(llms.match(/vscode:mcp\/install\?(\S+)/)[1]))]);
  veje.push(['llms-install (Trae)', JSON.parse(Buffer.from(decodeURIComponent(
    llms.match(/name=browser-mcp&config=(\S+)/)[1]), 'base64').toString('utf8'))]);
  assert.ok(veje.length >= 5, `fandt kun ${veje.length} ét-klik-veje - er en af dem forsvundet?`);
  for (const [navn, cfg] of veje) {
    assert.equal(cfg.command, facit.command, `${navn}: anden kommando end Trae-siden`);
    assert.deepEqual(cfg.args, facit.args, `${navn}: andre argumenter end Trae-siden`);
  }
});
