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
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));

// MAALT 12/9 af Fable (e2e runde 3): WISHLIST.md og CONTRIBUTING.md stod uden for vagtens raekkevidde, og begge er
// offentlige paa GitHub. WISHLIST sagde "MIT, local, no telemetry"; CONTRIBUTING stod med tre foraeldede tal.
const STIER = ['docs', 'content', 'README.md', 'mcp-server/README.md', 'mcp-server/index.js', 'mcp-server/tools.js', 'mcp-server/bin/cli.js',
  // MAALT 13/9: cli.js laa uden for vagten, selvom den skriver installationsvejledningen til HVER ny bruger.
  // Den bar bade den falske groenne-ikon-paastand og et loefte om helt automatiske opdateringer.
  'llms-install.md', 'USE_CASES.md', 'demo-video-src/src', 'extension/popup.html', 'glama.json', 'server.json',
  'mcp-server/server.json', 'WISHLIST.md', 'CONTRIBUTING.md', 'SECURITY.md',
  // MAALT 13/9 af Astra: begge laa uden for vagten og bar hver sin streg. install.sh er det foerste en
  // klon-bruger koerer; package.json's beskrivelse ER npm-sidens undertekst.
  'install.sh', 'mcp-server/package.json'];
// CHANGELOG.md staar bevidst UDENFOR: den CITERER de gamle formuleringer og tal for at forklare hvad der blev rettet
// ("Several pages promised that 'nothing leaves your machine'"). Samme grund som revisionsdokumentet nedenfor.
// Revisionsdokumentet citerer den gamle butikstekst for at forklare hvorfor den skal ud.
const UNDTAGET = new Set(['docs/CWS_LISTING_TEXT.md']);
const ENDELSER = /\.(md|html|txt|js|mjs|ts|tsx|json)$/;

const LOEFTER = [
  [/nothing[^."]{0,40}leaves (your|the) machine/i, 'intet forlader maskinen'],
  // 8/10 (skive 5): «Your agent's own reports stay on your machine» slap igennem, fordi reglen kun kendte «stays» - og
  // rapporten gaar ogsaa til AI-klienten. Ental og flertal, maskine og computer.
  [/\bstays? on your (machine|computer)\b/i, 'bliver paa maskinen'],
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
  // 8/10 (skive 12): forsidens FAQ og kapabilitets-siden lovede at afkrydsningsfeltet «often enough» virker, naar man er
  // logget ind hos Google - aldrig maalt. Installationssiderne lod trinene kaede af sig selv («hands the challenge to you
  // if it cannot»); koden goer intet af sig selv - agenten vaelger hvert trin, ét kald ad gangen.
  [/often (enough|passes|clears)[^.\n]{0,60}signed in/i, 'umaalt CAPTCHA-loefte'],
  // R47 (Opus): «then hands the challenge to you.» uden «if it cannot», og «each one kicking in when the last fails» slap igennem.
  [/hands? (the challenge|it) to you if (it|they) (cannot|can't)|if the first two miss|\bthen (hands|shows) (the challenge|it) to you\b|kicking in when the last fails/i, 'CAPTCHA-trin der kaeder af sig selv'],
  // R47 (Astra): Cursor-siden sagde «The challenge stays in your browser» - et skaermbillede til grid-cellerne gaar til AI-klienten.
  [/challenge stays in your browser/i, 'CAPTCHA-billedet bliver i browseren'],
  // R52 (Opus, MAALT): installationssiderne lovede at extract_token «isn't limited to» de ni og virker for «any provider»;
  // en ukendt udbyder svarer «Unknown provider» uden at navigere.
  [/isn't limited to th(ose|em)|not a whitelist|works for any provider/i, 'extract_token lover alle udbydere'],
  // 1.30.2 skive 20: «usually with a short chime» blev aldrig maalt, og om Chrome spiller lyden, afhaenger af dens
  // autoplay-regler (brugerinteraktion, engagement, politik).
  [/usually with a (short )?chime/i, 'umaalt lyd ved ask_user'],
  // R53 (Opus, LAEST): llms.txt sagde «You approve the sensitive steps» - koden har ingen godkendelsesport; agenten bliver
  // kun bedt om at spoerge. Z Code-siden sagde «works with any» om extract_token.
  [/you approve the sensitive steps|9 common ones, works with any/i, 'godkendelse eller udbydere som koden ikke har'],
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
  // Gustav 13/9: den lange tankestreg er AI-fingeraftrykket. Kun almindelig bindestreg i det vi udgiver.
  // ⚠️ KUN U+2014 og U+2013 maa matches - ALDRIG en tegnklasse for "streg-agtige" tegn. Repoet har 8.468
  // rammetegn (U+2500) i kommentar-bannere, og en bredere regel ville rive hver eneste banner i stykker.
  // MAALT 13/9 af Astra: nul af de 1.353 streger var baerende - ingen stod i et regex, en delimiter,
  // et split eller en streng der sammenlignes. Sweepen kunne derfor koeres uden at adfaerden skiftede.
  [/[\u2014\u2013]/, 'lang tankestreg (AI-aftryk)'],
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
    // MAALT 19/9: paa Windows giver join/relative backslashes, mens UNDTAGET er skrevet
    // med skraastreger. Saa matchede ingen undtagelse, og vagten flagede sine EGNE
    // undtagne filer. Tredje sti-separator-fejl i samme jobs roede historik.
    const rel = relative(rod, join(rod, f)).split(sep).join('/');
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
  assert.ok(regel('bliver paa maskinen').test('Extracted - stays on your machine'));
  assert.ok(regel('bliver paa maskinen').test("Your agent's own reports stay on your machine."), 'ental slap igennem (skive 5)');
  assert.ok(regel('umaalt CAPTCHA-loefte').test('click a reCAPTCHA v2 checkbox, which is often enough when you are signed into Google.'));
  assert.ok(regel('umaalt CAPTCHA-loefte').test('`click_checkbox` (auto-click, often passes when signed into Google)'));
  assert.ok(regel('CAPTCHA-trin der kaeder af sig selv').test('attempts the checkbox, then hands the challenge to you if it cannot.'));
  assert.ok(regel('CAPTCHA-trin der kaeder af sig selv').test('shows you the challenge to solve by hand if the first two miss'));
  assert.ok(regel('CAPTCHA-trin der kaeder af sig selv').test('Cursor and CAPTCHAs: it tries, then hands it to you'));
  assert.ok(regel('CAPTCHA-trin der kaeder af sig selv').test('Attempts the checkbox challenge, then shows it to you to finish'));
  assert.ok(regel('CAPTCHA-trin der kaeder af sig selv').test('three layers, each one kicking in when the last fails'));
  assert.ok(regel('umaalt CAPTCHA-loefte').test('it often clears it when you are signed in to Google'));
  assert.ok(regel('CAPTCHA-billedet bliver i browseren').test('The challenge stays in your browser.'));
  assert.ok(regel('extract_token lover alle udbydere').test("the 9 are just shortcuts, not a whitelist"));
  assert.ok(regel('extract_token lover alle udbydere').test("- but it isn't limited to those."));
  assert.ok(regel('umaalt lyd ved ask_user').test('A box appears in that tab, usually with a short chime.'));
  assert.ok(regel('godkendelse eller udbydere som koden ikke har').test('- You approve the sensitive steps - the agent works'));
  assert.ok(regel('godkendelse eller udbydere som koden ikke har').test('Zero-config shortcuts for 9 common ones, works with any'));
  assert.ok(regel('intet forlader maskinen').test('the one thing that matters most: nothing it reads ever leaves your machine'), 'ord imellem maa ikke skjule loeftet');
  assert.ok(regel('sender aldrig data nogen steder').test('never sends your browsing data anywhere'));
  assert.ok(FORKERTE_TAL[0][0].test('Restart Claude Code - 29 browser tools are now available'));
  assert.ok(regel('lang tankestreg (AI-aftryk)').test('Your Chrome — driven by your agent'),
    'vagten kan ikke se en em-streg');
  assert.ok(regel('lang tankestreg (AI-aftryk)').test('ports 9876–9895'), 'vagten kan ikke se en en-streg');
  assert.ok(!regel('lang tankestreg (AI-aftryk)').test('\u2500\u2500 banner \u2500\u2500'),
    'vagten rammer rammetegn - saa river den kommentar-bannerne i stykker');
});

// ── Citerede fejlbeskeder skal findes i koden ───────────────────────────────
// MAALT 19/9: jeg skrev et samtale-eksempel paa /use-cases/vscode-concurrent-sessions/ hvor
// vaerktoejet svarede `{"ok": false, "error": "tab 481 belongs to another session"}`. Det er
// opfundet. Det aegte svar er et kast: `Tab 481 does not belong to this session (green)`
// (background.js:5132) - baade formen og ordene var forkerte. En laeser der ser efter den
// tekst i sin egen log, finder den aldrig og tror installationen er i stykker.
//
// Vagten laeser hver `Error: ...`-linje i en kodeblok paa siderne og kraever at dens faste
// del staar i den kode der udsender den. Variable stykker (id'er, navne) skaeres fra.
test('hver citeret fejlbesked paa siderne findes ogsaa i koden', () => {
  const kode = ['extension/background.js', 'extension/offscreen.js', 'mcp-server/index.js', 'mcp-server/tools.js']
    .map((f) => readFileSync(join(rod, f), 'utf8')).join('\n');
  const fund = [];
  for (const fil of readdirSync(join(rod, 'content')).filter((f) => f.endsWith('.md'))) {
    const tekst = readFileSync(join(rod, 'content', fil), 'utf8');
    tekst.split('\n').forEach((linje, i) => {
      const m = linje.match(/^\s*Error:\s*(.+?)\s*$/);
      if (!m) return;
      // Den faste del er det LAENGSTE stykke uden tal og parenteser - ikke det foerste.
      // Foerste forsoeg tog stykket foer tallet, og paa "Tab 481 does not belong..." var det
      // ordet "Tab". Mutationen med en helt opfundet tekst slap derfor igennem, og vagten
      // maalte ingenting. En vagt der ikke kan blive roed af det den er bygget imod, er pynt.
      const fast = m[1].split(/\s*\d+\s*|\([^)]*\)/).map((d) => d.trim())
        .sort((x, y) => y.length - x.length)[0] || '';
      if (fast.length < 12) return;   // for kort til at sige noget
      if (!kode.includes(fast)) fund.push(`content/${fil}:${i + 1}  "${fast}"`);
    });
  }
  assert.deepEqual(fund, [], `fejlbeskeder der ikke findes i koden:\n  ${fund.join('\n  ')}`);
});

// 6/10 (3c): vagten ovenfor skaerer parentesen fra, saa «(green)» slap igennem, selv om koden
// skriver sessionens NAVN der: `does not belong to this session (${session.label})`, og navnet er
// altid «Claude N» (background.js), uanset klient og farve.
test('en citeret sessions-fejl naevner sessionen ved dens rigtige navn, Claude N', () => {
  const fund = [];
  for (const fil of readdirSync(join(rod, 'content')).filter((f) => f.endsWith('.md'))) {
    readFileSync(join(rod, 'content', fil), 'utf8').split('\n').forEach((linje, i) => {
      const m = linje.match(/does not belong to this session \(([^)]*)\)/);
      if (m && !/^Claude \d+$/.test(m[1])) fund.push(`content/${fil}:${i + 1}  (${m[1]})`);
    });
  }
  assert.deepEqual(fund, [], `sessionen hedder Claude N i koden:\n  ${fund.join('\n  ')}`);
});

// 6/10 (3c): forsiden maa ikke love «about a minute» (forside.test), fordi installationstiden aldrig er
// maalt - men 13 installationssider lovede «about 90 seconds» og «about 60 seconds». Samme loefte,
// anden ordlyd. Vagten daekker nu alle flader, ogsaa meta-beskrivelserne i kilderne.
test('ingen flade lover en installationstid, der aldrig er maalt', () => {
  const filer = readdirSync(join(rod, 'content')).filter((f) => f.endsWith('.md')).map((f) => `content/${f}`)
    .concat(['README.md', 'mcp-server/README.md', 'llms-install.md', 'docs/index.html', 'docs/llms.txt']);
  const fund = [];
  for (const fil of filer) {
    readFileSync(join(rod, fil), 'utf8').split('\n').forEach((linje, i) => {
      // R25: «in 90 seconds» og «in under two minutes» gled igennem. Tiden taeller kun naer et ord om
      // installation/opsaetning, saa «Contribute in 30 seconds» og «takes two minutes» (en fejlrapport) er fri.
      const tid = String.raw`\b(?:in|under|takes?|within)\s+(?:about\s+|under\s+|less than\s+)?(?:\d+|a|one|two|three|a few)[- ](?:seconds?|minutes?)\b`;
      const op = String.raw`(?:install|set ?up|setup|up and running|four steps|get started)`;
      if (/about (?:60|90|a few) seconds|about a minute|(?:60|90)[- ]second (?:install|setup)/i.test(linje)
        || new RegExp(`${op}[^.\\n]{0,60}${tid}|${tid}[^.\\n]{0,40}${op}`, 'i').test(linje)) fund.push(`${fil}:${i + 1}`);
    });
  }
  assert.deepEqual(fund, [], `umaalt installationstid:\n  ${fund.join('\n  ')}`);
});

// 6/10 (3c): fem installationssider havde overskriften «40 tools» over en tabel med 34. En side der
// lister vaerktoejerne (mindst 30 forskellige navne), skal liste dem alle, og kun dem der findes.
test('en side der lister vaerktoejerne, lister alle i tools.js og intet andet', () => {
  const alle = new Set([...readFileSync(join(rod, 'mcp-server/tools.js'), 'utf8').matchAll(/name:\s*['"](browser_[a-z0-9_]+)['"]/g)].map((m) => m[1]));
  const fund = [];
  for (const fil of readdirSync(join(rod, 'content')).filter((f) => f.endsWith('.md'))) {
    const navne = new Set(readFileSync(join(rod, 'content', fil), 'utf8').match(/\bbrowser_[a-z0-9_]+\b/g) ?? []);
    if (navne.size < 30) continue;
    const mangler = [...alle].filter((n) => !navne.has(n));
    const ukendte = [...navne].filter((n) => !alle.has(n) && !/^browser_(go_|drag|wait_for$|tab_|snapshot|type$|navigate_back)/.test(n));
    if (mangler.length) fund.push(`content/${fil} mangler ${mangler.join(', ')}`);
    if (ukendte.length) fund.push(`content/${fil} naevner ${ukendte.join(', ')}, som ikke findes`);
  }
  assert.deepEqual(fund, []);
});

// ── Et citat i anfoerselstegn skal vaere et CITAT ───────────────────────────
// FUNDET 19/9 af Fable: /learn/tools-that-lie/ satte remedien i anfoerselstegn som det
// vaerktoejet svarer - «"this tab is in the background, call `browser_switch_tab`"» - mens
// koden svarer «fanen er sandsynligvis i baggrunden … kald browser_switch_tab og proev igen».
// Ordlyden var opdigtet. Det er samme klasse som den opfundne fejlbesked ovenfor, bare i
// prosa: en laeser der soeger efter den saetning i sin egen log, finder den aldrig.
//
// Reglen: staar der et vaerktoejsnavn inde i et par anfoerselstegn paa en side, skal den
// saetning findes i koden. Ellers skal den skrives som en BESKRIVELSE uden anfoerselstegn.
test('citerede vaerktoejssvar paa siderne findes ogsaa i koden', () => {
  const kode = ['extension/background.js', 'mcp-server/index.js', 'mcp-server/tools.js']
    .map((f) => readFileSync(join(rod, f), 'utf8')).join('\n');
  const fund = [];
  for (const fil of readdirSync(join(rod, 'content')).filter((f) => f.endsWith('.md'))) {
    const tekst = readFileSync(join(rod, 'content', fil), 'utf8');
    // Kun rigtige citater: dobbelte anfoerselstegn omkring en saetning der naevner et vaerktoej.
    for (const m of tekst.matchAll(/"([^"\n]{25,160}browser_[a-z_]+[^"\n]{0,80})"/g)) {
      const citat = m[1];
      // Den del foer vaerktoejsnavnet er den prosa der paastaas at staa i koden.
      const prosa = citat.split(/browser_[a-z_]+/)[0].replace(/[`*]/g, '').trim();
      if (prosa.length < 20) continue;
      if (!kode.includes(prosa)) {
        const linje = tekst.slice(0, m.index).split('\n').length;
        fund.push(`content/${fil}:${linje}  "${prosa}…"`);
      }
    }
  }
  assert.deepEqual(fund, [], `citater der ikke findes i koden:\n  ${fund.join('\n  ')}`);
});

// R47 (Opus): detect-svarene i koden lovede «Real Chrome with Google login usually passes automatically. No action needed» -
// samme umaalte loefte som siderne mistede i 538daa7, men i det agenten laeser. background.js ligger uden for STIER
// (dens danske kommentarer ville vaelte tankestregs-reglen), saa dens strenge tjekkes her for sig.
test('udvidelsens svar til agenten lover ikke at Chrome klarer en CAPTCHA af sig selv', () => {
  const bg = readFileSync(join(rod, 'extension/background.js'), 'utf8');
  const strenge = bg.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l));
  for (const re of [/usually passes/i, /passes automatically/i, /No action needed/i, /often (enough|passes|clears)[^.\n]{0,60}signed in/i]) {
    const fund = strenge.filter((l) => re.test(l));
    assert.equal(fund.length, 0, `background.js lover stadig: ${fund.join(' | ')}`);
  }
});
