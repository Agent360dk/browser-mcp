/**
 * Bagudlisten (1.30.2 skive 12): aeldre sider der lovede mere, end koden goer.
 *
 * Kilden er INDHOLDS-BAGUDLISTE.md (Astra runde 2, 2/10-2026, 19 raekker; numrene er hans). Raekkerne 4, 5, 36, 37, 40, 44,
 * 45 og popup-linjen var rettet foer; her vogtes de der blev rettet i skive 12, saa paastandene ikke kommer tilbage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const laes = (f) => readFileSync(join(rod, f), 'utf8');
const indhold = readdirSync(join(rod, 'content')).filter((f) => f.endsWith('.md')).map((f) => ['content/' + f, laes('content/' + f)]);
const flader = [...indhold, ['README.md', laes('README.md')], ['mcp-server/README.md', laes('mcp-server/README.md')]];

const FORBUDT = [
  [7, /a headless browser fundamentally can't/i, 'kategorisk om headless; en frisk profil uden dit login er det praecise'],
  [9, /is complete removal/i, 'npx har en kopi i ~/.npm/_npx'],
  [13, /the entire point|Cookies are how you stay logged in/i, 'cookies-tilladelsen bruges kun af cookie-vaerktoejerne'],
  [14, /Twenty-one conversations|idle conversations do not consume/i, 'adskillelsen foelger MCP-serveren, ikke samtalen'],
  [15, /\(~?\d+ seconds\)/i, 'tidsloefter uden maaling'],
  [38, /Fresh by default|That is the whole difference/, 'Playwright MCP har en dedikeret profil som standard og en extension-mode'],
  [43, /Every other client (?:on this site )?(?:uses|takes)|Every other client uses the other one/, 'Zed, opencode og Codex bruger hver sin noegle'],
];

for (const [nr, moenster, hvorfor] of FORBUDT) {
  test(`bagudliste #${nr} kommer ikke tilbage: ${hvorfor}`, () => {
    for (const [f, t] of flader) assert.doesNotMatch(t, moenster, `${f}: ${hvorfor}`);
  });
}

test('bagudliste #15: hver installationsguide siger at Node.js 20 kraeves, og Claude Code-guiden naevner claude-kommandoen', () => {
  const guider = indhold.filter(([f]) => /browsermcp-docs-install-/.test(f));
  assert.ok(guider.length >= 15);
  const node = JSON.parse(laes('mcp-server/package.json')).engines.node;
  assert.equal(node, '>=20', 'pakkens krav aendrede sig - ret saetningen i guiderne');
  for (const [f, t] of guider) assert.match(t, /\*\*You need:\*\* Chrome, and Node\.js 20 or newer for `npx`/, f);
  assert.match(laes('content/browsermcp-docs-install-claude-code.md'), /and the `claude` command \(Claude Code itself\)/);
});

test('bagudliste #29: konkurrent-vagten tager vores vaerktoejstal fra tools.js, ikke et haardkodet 40', () => {
  const vagt = laes('scripts/konkurrent-vagt.py');
  assert.doesNotMatch(vagt, /tal == 40/);
  assert.match(vagt, /VORES = len\(re\.findall\(r"name: 'browser_\[a-z_\]\+'", open\(os\.path\.join\(ROOT, 'mcp-server', 'tools\.js'\)/);
  assert.match(vagt, /if tal == VORES or tal == maalt:/);
});
