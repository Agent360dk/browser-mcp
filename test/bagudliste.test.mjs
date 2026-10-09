/**
 * Bagudlisten (1.30.2 skive 12): aeldre sider der lovede mere, end koden goer.
 *
 * Kilden er INDHOLDS-BAGUDLISTE.md (Astra runde 2, 2/10-2026, 19 raekker; numrene er hans). Raekkerne 4, 5, 36, 37, 40, 44,
 * 45 og popup-linjen var rettet foer; her vogtes de der blev rettet i skive 12, saa paastandene ikke kommer tilbage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const laes = (f) => readFileSync(join(rod, f), 'utf8');
const indhold = readdirSync(join(rod, 'content')).filter((f) => f.endsWith('.md')).map((f) => ['content/' + f, laes('content/' + f)]);
// R62 (Astra, MAALT): vagten laeste kun kilderne, saa en paastand genindsat i den PUBLICEREDE html gik igennem. De udgivne
// sider laeses nu ogsaa - som tekst, med entiteter afkodet og tags fjernet.
// R63 (Astra, maalt): tags blev fjernet MED deres attributter, saa <meta content> og alt-tekster blev ikke laest. Nu bliver
// attributvaerdierne staaende som tekst.
// R64 (Astra, maalt): kun name="value" blev laest. R65 (Astra, maalt): ogsaa `&#x27`/`&#39` uden semikolon og et `>` inde i
// en citeret vaerdi slap igennem. Siderne laeses nu af en HTML-parser (test/hjaelp/side-tekst.py): tekst, attributvaerdier
// og kommentarer, med tegnreferencer afkodet efter HTML5-reglerne.
const SIDE_TEKST = join(rod, 'test/hjaelp/side-tekst.py');
const html = (s) => JSON.parse(execFileSync('python3', ['-I', SIDE_TEKST, '-'], { input: JSON.stringify([s]), encoding: 'utf8' }))[0];
const sider = Object.entries(JSON.parse(execFileSync('python3', ['-I', SIDE_TEKST, join(rod, 'docs')], { encoding: 'utf8' })))
  .map(([f, tekst]) => [join('docs', f), tekst]);
const flader = [...indhold, ['README.md', laes('README.md')], ['mcp-server/README.md', laes('mcp-server/README.md')],
  ['llms-install.md', laes('llms-install.md')], ...sider];

const FORBUDT = [
  [7, /a headless browser fundamentally can't|the move headless browsers can(?:'t|not) make|Headless automation cannot do this|the thing headless tools can't do|\| Headless automation \|/i, 'kategorisk om headless; en frisk profil uden dit login er det praecise'],
  [9, /is complete removal/i, 'npx har en kopi i ~/.npm/_npx'],
  [13, /the entire point|Cookies are how you stay logged in/i, 'cookies-tilladelsen bruges kun af cookie-vaerktoejerne'],
  [14, /Twenty-one conversations|idle conversations do not consume|Yes - up to 20, each in its own colou?r-coded tab group/i, 'adskillelsen foelger MCP-serveren, ikke samtalen'],
  [15, /\(~?\d+ seconds\)/i, 'tidsloefter uden maaling'],
  [38, /Fresh by default|That is the whole difference/, 'Playwright MCP har en dedikeret profil som standard og en extension-mode'],
  [63, /Read every row of a long/i, 'extract_list: raekker med samme tekst kommer en gang, og en baggrundsfane stopper tidligt (PR63 R3 Astra)'],
  [43, /Every other client (?:on this site )?(?:uses|takes)|Every other client uses the other one|Any other client - write this into that client's MCP config|For any other client, add this block/, 'Zed, opencode og Codex bruger hver sin noegle (PR63 R2 Astra: ogsaa Claude Code-guidens FAQ)'],
];

// R65 (Opus, maalt): `&rsquo;` bliver til ’ og `&nbsp;` til et haardt mellemrum, saa «can’t» og «fundamentally can't» med
// et haardt mellemrum slap forbi moenstrene. Typografiske anfoerselstegn og alle slags mellemrum laeses som de almindelige.
// R66 (Opus, maalt): en blod bindestreg (&shy;) eller et nulbredde-tegn (&zwj;) inde i et ord brod moenstret.
// R67 (Astra, maalt): U+200B og U+FEFF blev til mellemrum og broed ordet; de fjernes nu som de andre nulbredde-tegn.
// R68 (Opus, maalt): 13 andre usynlige formattegn (&lrm;, &InvisibleTimes;, U+180E, U+FE0F ...) slap igennem. Alle tegn i
// Unicode-kategorien Cf fjernes nu, og de faa usynlige tegn uden for den (variationsvaelgere, U+034F, Hangul-fyldtegn).
// R69 (Astra, maalt): de supplerende variationsvaelgere U+E0100-U+E01EF (kategori Mn) slap igennem; alle variationsvaelgere
// fjernes nu, ogsaa de mongolske (U+180B-U+180D, U+180F).
// R70 (Opus, vurderet): de usynlige khmer-vokaler U+17B4 og U+17B5 (Mn, Default_Ignorable) fjernes ogsaa.
const norm = (s) => s.replace(/[\p{Cf}\u034F\u115F\u1160\u3164\uFFA0\uFE00-\uFE0F\u180B-\u180D\u180F\u17B4\u17B5\u{E0100}-\u{E01EF}]/gu, '').replace(/[\u2018\u2019\u201B\u02BC\u2032]/g, "'").replace(/[\u201C\u201D\u201F]/g, '"')
  .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ').replace(/\s+/g, ' ');
// R66: en udgivet side er delt i synlig tekst, attributter og kommentarer (side-tekst.py); hver del proeves for sig.
const rammer = (tekst, moenster) => tekst.split('\u241e').some((del) => moenster.test(norm(del)));
for (const [nr, moenster, hvorfor] of FORBUDT) {
  test(`bagudliste #${nr} kommer ikke tilbage: ${hvorfor}`, () => {
    for (const [f, t] of flader) assert.ok(!rammer(t, moenster), `${f}: ${hvorfor}`);
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

test('normaliseringen laeser enkelte anfoerselstegn, mellemrum om = og hexadecimale tegnreferencer (R64)', () => {
  assert.match(html("<meta content='kun-enkelte'>"), /kun-enkelte/);
  assert.match(html('<meta content = "med-mellemrum">'), /med-mellemrum/);
  assert.match(html('<meta content="can&#x27;t">'), /can't/);
});

test('normaliseringen laeser tegnreferencer uden semikolon og et > inde i en citeret vaerdi (R65)', () => {
  assert.match(html('<meta content="can&#x27t">'), /can't/);
  assert.match(html('<meta content="can&#39t">'), /can't/);
  assert.match(html('<meta content="a > b fundamentally can\'t">'), /a > b fundamentally can't/);
  assert.match(html('<!-- en kommentar -->'), /en kommentar/);
});

test('typografiske anfoerselstegn og haarde mellemrum snyder ikke moenstrene (R65)', () => {
  const m = FORBUDT.find(([nr]) => nr === 7)[1];
  for (const s of ['<p>a headless browser fundamentally can&rsquo;t</p>', '<p>a headless&nbsp;browser fundamentally can&#39t</p>',
    '<meta content="a headless browser fundamentally can\u2019t">']) assert.ok(rammer(html(s), m), s);
});

test('synlig tekst er én stroem: attributter, inline-tags og kommentarer bryder ikke en saetning (R66)', () => {
  const m = FORBUDT.find(([nr]) => nr === 7)[1];
  for (const s of ['<p>A headless <em class="emphasis">browser</em> fundamentally can\'t read Gmail.</p>',
    '<p>A headless brow<b>ser</b> fundamentally can\'t</p>', '<p>A headless browser fundamentally can<span>\'</span>t</p>',
    '<p>A headless brow<!-- x -->ser fundamentally can\'t</p>']) assert.ok(rammer(html(s), m), s);
  assert.ok(!rammer(html('<p>a headless</p><p>browser fundamentally can\'t</p>'.replace('can\'t', 'cannot')), m));
});

test('en blod bindestreg eller et nulbredde-tegn inde i et ord snyder ikke moenstrene (R66)', () => {
  const m = FORBUDT.find(([nr]) => nr === 7)[1];
  for (const s of ['<p>a headless browser funda&shy;mentally can\'t</p>', '<p>a headless browser fundamen&zwj;tally can\'t</p>'])
    assert.ok(rammer(html(s), m), s);
});

test('U+200B og U+FEFF inde i et ord snyder ikke moenstrene (R67)', () => {
  const m = FORBUDT.find(([nr]) => nr === 7)[1];
  for (const s of ['<p>A headless browser funda&#8203;mentally can\'t read Gmail.</p>', '<p>A headless browser funda&#65279;mentally can\'t read Gmail.</p>'])
    assert.ok(rammer(html(s), m), s);
});

test('alle usynlige formattegn inde i et ord fjernes (R68)', () => {
  const m = FORBUDT.find(([nr]) => nr === 7)[1];
  for (const ref of ['&lrm;', '&rlm;', '&InvisibleTimes;', '&af;', '&ic;', '&#x2064;', '&#x180E;', '&#x34F;', '&#xFE0F;', '&#xE0020;', '&#x2066;', '&#x202A;', '&#x115F;'])
    assert.ok(rammer(html(`<p>A headless browser funda${ref}mentally can't</p>`), m), ref);
});

test('alle variationsvaelgere inde i et ord fjernes, ogsaa de supplerende og de mongolske (R69)', () => {
  const m = FORBUDT.find(([nr]) => nr === 7)[1];
  for (const ref of ['&#xE0100;', '&#xE01EF;', '&#x180B;', '&#x180D;', '&#x180F;'])
    assert.ok(rammer(html(`<p>A headless browser funda${ref}mentally can't</p>`), m), ref);
});

test('de usynlige khmer-vokaler inde i et ord fjernes (R70)', () => {
  const m = FORBUDT.find(([nr]) => nr === 7)[1];
  for (const ref of ['&#x17B4;', '&#x17B5;']) assert.ok(rammer(html(`<p>A headless browser funda${ref}mentally can't</p>`), m), ref);
});
