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
// R62 (Astra, MAALT): vagten laeste kun kilderne, saa en paastand genindsat i den PUBLICEREDE html gik igennem. De udgivne
// sider laeses nu ogsaa - som tekst, med entiteter afkodet og tags fjernet.
// R63 (Astra, maalt): tags blev fjernet MED deres attributter, saa <meta content> og alt-tekster blev ikke laest. Nu bliver
// attributvaerdierne staaende som tekst.
const html = (s) => s.replace(/<[^>]+>/g, (tag) => ' ' + [...tag.matchAll(/\s[\w:-]+="([^"]*)"/g)].map((m) => m[1]).join(' ') + ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, ' ');
const sider = [];
const gaa = (d) => { for (const e of readdirSync(join(rod, d), { withFileTypes: true })) {
  if (e.isDirectory()) gaa(join(d, e.name)); else if (e.name.endsWith('.html')) sider.push([join(d, e.name), html(laes(join(d, e.name)))]); } };
gaa('docs');
const flader = [...indhold, ['README.md', laes('README.md')], ['mcp-server/README.md', laes('mcp-server/README.md')],
  ['llms-install.md', laes('llms-install.md')], ...sider];

const FORBUDT = [
  [7, /a headless browser fundamentally can't|the move headless browsers can't make|\| Headless automation \|/i, 'kategorisk om headless; en frisk profil uden dit login er det praecise'],
  [9, /is complete removal/i, 'npx har en kopi i ~/.npm/_npx'],
  [13, /the entire point|Cookies are how you stay logged in/i, 'cookies-tilladelsen bruges kun af cookie-vaerktoejerne'],
  [14, /Twenty-one conversations|idle conversations do not consume|Yes - up to 20, each in its own colou?r-coded tab group/i, 'adskillelsen foelger MCP-serveren, ikke samtalen'],
  [15, /\(~?\d+ seconds\)/i, 'tidsloefter uden maaling'],
  [38, /Fresh by default|That is the whole difference/, 'Playwright MCP har en dedikeret profil som standard og en extension-mode'],
  [43, /Every other client (?:on this site )?(?:uses|takes)|Every other client uses the other one|Any other client - write this into that client's MCP config/, 'Zed, opencode og Codex bruger hver sin noegle'],
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

test('bagudlisten laeser ogsaa de udgivne sider (R62)', () => {
  assert.ok(sider.length >= 40, `kun ${sider.length} html-sider laest`);
  assert.ok(sider.some(([f, t]) => f.endsWith('docs/use-cases/read-2fa-from-gmail/index.html') && /fresh headless browser without your login/.test(t)));
});

test('bagudlisten laeser attributvaerdier i de udgivne sider, fx meta description (R63)', () => {
  const gmail = sider.find(([f]) => f.endsWith('docs/use-cases/read-2fa-from-gmail/index.html'))[1];
  assert.match(gmail, /A step-by-step walkthrough of the move a fresh headless browser without your login can't make/);
});

test('normaliseringen beholder attributvaerdier som tekst (R63)', () => {
  assert.match(html('<meta name="description" content="zzz-kun-i-attributten">'), /zzz-kun-i-attributten/);
  assert.match(html('<img alt="et alt-tekst-eksempel" src="x.png">'), /et alt-tekst-eksempel/);
});
