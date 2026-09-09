// Er repoet overhovedet i stand til at udgive det man tror?
//
// MAALT 21/8. Fire forskellige versionsnumre laa i det samme repo samtidig:
//   extension/manifest.json 1.27.1 · mcp-server/extension 1.27.0 ·
//   mcp-server/package.json 1.26.0 · mcp-server/server.json 1.25.0 · npm 1.25.0
// Og mcp-server/extension/ — den kopi npm faktisk udgiver — var 88 linjer bagud
// for extension/. Sessions-rettelsen laa i kilden og naaede aldrig brugerne.
//
// Konsekvensen var ikke en fejlmeddelelse, men et ubesvarligt spoergsmaal: "hvilken
// version koerer jeg?" havde fire rigtige svar. Testene her holder de to ting sande
// som gjorde svaret utilgaengeligt — kopien er en kopi, og versionerne er ét tal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const json = (p) => JSON.parse(readFileSync(join(rod, p), 'utf8'));

function filer(dir, base = dir, ud = []) {
  for (const navn of readdirSync(join(rod, dir))) {
    if (navn === '.DS_Store') continue;
    const p = join(dir, navn);
    if (statSync(join(rod, p)).isDirectory()) filer(p, base, ud);
    else ud.push(relative(base, p));
  }
  return ud.sort();
}

test('mcp-server/extension/ er en tro kopi af extension/', () => {
  // Det er denne kopi npm udgiver ("files": ["extension/"] i package.json).
  // Driver den fra kilden, retter man en fejl i repoet uden at rette den for nogen.
  const kilde = filer('extension');
  const kopi = filer('mcp-server/extension');
  assert.deepEqual(kopi, kilde, 'filerne i de to mapper er ikke de samme');
  for (const f of kilde) {
    const a = readFileSync(join(rod, 'extension', f));
    const b = readFileSync(join(rod, 'mcp-server/extension', f));
    assert.ok(a.equals(b), `mcp-server/extension/${f} er ikke identisk med extension/${f} — koer: rsync -a --delete --exclude='.DS_Store' extension/ mcp-server/extension/`);
  }
});

test('alle versionsfelter oplyser det samme tal', () => {
  const v = {
    'extension/manifest.json': json('extension/manifest.json').version,
    'mcp-server/extension/manifest.json': json('mcp-server/extension/manifest.json').version,
    'mcp-server/package.json': json('mcp-server/package.json').version,
    'mcp-server/package-lock.json': json('mcp-server/package-lock.json').version,
    'mcp-server/package-lock.json[""]': json('mcp-server/package-lock.json').packages[''].version,
    'mcp-server/server.json': json('mcp-server/server.json').version,
  };
  for (const p of json('mcp-server/server.json').packages || []) {
    if (p?.version) v[`server.json/packages/${p.identifier || '?'}`] = p.version;
  }
  const unikke = [...new Set(Object.values(v))];
  assert.equal(unikke.length, 1,
    `versionerne driver fra hinanden:\n${Object.entries(v).map(([k, x]) => `    ${x}  ${k}`).join('\n')}`);
  assert.match(unikke[0], /^\d+\.\d+\.\d+$/);
});

  test('npm-pakken bundter HVER fil serveren faktisk importerer', () => {
    // MAALT 23/8 — og det er praecis den fejl den her test fandtes for at fange:
    // `vagt.js` blev oprettet, importeret af index.js, og glemt i `files`. Pakken var
    // DOED VED ANKOMST — hver eneste `npx @agent360/browser-mcp` fejlede med
    // ERR_MODULE_NOT_FOUND foer den naaede at sige noget. 178 tests var groenne.
    //
    // Den gamle udgave itererede over en HAANDSKREVET liste og kunne per konstruktion
    // aldrig opdage en NY fil. Nu foelges importerne rekursivt fra begge indgange.
    const pakkeRod = join(rod, 'mcp-server');
    const files = json('mcp-server/package.json').files;

    const set = new Set();
    const besoeg = (relSti) => {
      if (set.has(relSti)) return;
      set.add(relSti);
      let src;
      try { src = readFileSync(join(pakkeRod, relSti), 'utf8'); } catch { return; }
      for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        besoeg(join(dirname(relSti), m[1]).replace(/^\.\//, ''));
      }
    };
    besoeg('index.js');
    besoeg('bin/cli.js');

    const findes = (f) => { try { statSync(join(pakkeRod, f)); return true; } catch { return false; } };
    const daekket = (f) => files.some((m) => (m.endsWith('/') ? f.startsWith(m) : f === m));
    const mangler = [...set].filter((f) => findes(f) && !daekket(f));
    assert.deepEqual(mangler, [],
      `disse filer importeres men ryger IKKE med i npm-pakken: ${mangler.join(', ')} — ` +
      'pakken ville fejle med ERR_MODULE_NOT_FOUND ved foerste opstart hos hver bruger');
  });

test('server.json-beskrivelsen kan slippe gennem MCP-registret', () => {
  // Registret afviser >100 tegn med en 422. Fejler den DER, er npm allerede udgivet
  // og udgivelsen halvfaerdig — praecis den maade server.json engang sad fast paa.
  const d = json('mcp-server/server.json').description || '';
  assert.ok(d.length > 0 && d.length <= 100, `server.json description er ${d.length} tegn (maks 100)`);
});

test('manifestet peger paa de filer der findes', () => {
  const m = json('extension/manifest.json');
  const alle = new Set(filer('extension'));
  const peger = [m.background?.service_worker, m.action?.default_popup].filter(Boolean);
  for (const ikon of Object.values(m.icons || {})) peger.push(ikon);
  for (const p of peger) assert.ok(alle.has(p), `manifest.json peger paa "${p}" som ikke findes i extension/`);
  // offscreen.html/js indlaeses i koden, ikke i manifestet — tjek dem eksplicit.
  for (const p of ['offscreen.html', 'offscreen.js']) assert.ok(alle.has(p), `${p} mangler i extension/`);
});

test('release-scriptet synkroniserer kopien FOER det bumper versioner', () => {
  // Bumper man foerst og synkroniserer bagefter, overskriver synken det friske
  // versionsnummer i mcp-server/extension/manifest.json med kildens gamle.
  const s = readFileSync(join(rod, 'runbrowsermcpupdate.sh'), 'utf8');
  const synk = s.indexOf("rsync -a --delete --exclude='.DS_Store' extension/ mcp-server/extension/");
  const bump = s.indexOf('bump .version');
  assert.ok(synk > -1 && bump > -1, 'fandt ikke synk- og bump-trinnene i release-scriptet');
  assert.ok(synk < bump, 'synken skal ligge foer versions-bumpet');
});

// ── auto-opdateringen maa ikke rulle baglaens ───────────────────────────────
//
// MAALT 21/8: `if (installed.version !== source.version) cpSync(...)` kopierede naar
// versionerne var FORSKELLIGE, ikke naar pakkens var NYERE. En installation paa 1.27.1
// blev overskrevet af npm-pakkens 1.25.0 — og meldt som "auto-updated: 1.27.1 → 1.25.0".
// Det skete ved hver serveropstart. Derfor stod ~/.browser-mcp/extension paa juli-kode
// i ugevis, uanset hvor mange gange den blev opdateret i haanden.

test('auto-opdateringen kopierer kun naar pakken er nyere', () => {
  const cli = readFileSync(join(rod, 'mcp-server/bin/cli.js'), 'utf8');
  const uden = cli.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/if \(installed\.version !== source\.version\) \{\s*\n\s*cpSync/.test(uden),
    'ulighedstjekket er tilbage — en nyere lokal udgave bliver rullet baglaens');
  assert.match(uden, /if \(cmpSemver\(source\.version, installed\.version\) > 0\)/,
    'der skal sammenlignes med semver, ikke med ulighed');
});

test('semver-sammenligningen i cli.js regner med tal', () => {
  const cli = readFileSync(join(rod, 'mcp-server/bin/cli.js'), 'utf8');
  const i = cli.indexOf('function cmpSemver(');
  assert.ok(i > -1, 'cmpSemver mangler');
  let dybde = 0, j = cli.indexOf('{', i);
  for (; j < cli.length; j++) { if (cli[j] === '{') dybde++; else if (cli[j] === '}' && --dybde === 0) break; }
  const f = new Function(`${cli.slice(i, j + 1)}; return cmpSemver;`)();
  assert.equal(f('1.25.0', '1.27.1'), -1, 'pakken er aeldre — der maa ikke kopieres');
  assert.equal(f('1.28.0', '1.27.1'), 1, 'pakken er nyere — der skal kopieres');
  assert.equal(f('1.27.1', '1.27.1'), 0);
  assert.equal(f('1.10.0', '1.9.0'), 1, 'tekstsammenligning ville sige 1.9.0 var nyest');
});

// Kun selve Shipped-afsnittet, ikke resten af filen. Uden afgraensningen laeste vagterne
// ogsaa forslags-afsnittene og kaldte "Forslag: et browser_react_fill ..." for en falsk
// paastand om et shippet vaerktoej. En vagt der raaber ulv paa noget lovligt, bliver slaaet fra.
function shippedAfsnit(tekst) {
  const start = tekst.indexOf('## ✅ Shipped');
  if (start < 0) return '';
  const naeste = tekst.indexOf('\n## ', start + 5);
  return tekst.slice(start, naeste > start ? naeste : tekst.length);
}

// MAALT 9/9-2026: WISHLIST.md stod med "✅ Shipped — v1.29.1 (2026-09-08)" for en udgivelse
// der ALDRIG fandt sted. npm stod paa 1.29.0, taggen var v1.29.0, manifestet 1.29.0. Filen er
// offentlig og linket fra READMEt, saa enhver der laeste den, troede fem rettelser var
// tilgaengelige. De laa paa main.
//
// Det er samme fejlklasse som alt andet vi har jagtet: et dokument der paastaar noget der ikke
// er sandt. Vagten her er billig, fordi sandheden allerede findes — git's egne tags.
test('WISHLIST paastaar ikke en udgivelse der ikke findes', () => {
  const sti = new URL('../WISHLIST.md', import.meta.url);
  const tekst = readFileSync(sti, 'utf8');
  const i = tekst.indexOf('## ✅ Shipped');
  assert.ok(i > -1, 'Shipped-afsnittet findes ikke laengere — er filen lagt om?');
  const afsnit = shippedAfsnit(tekst);

  const tags = new Set(
    execSync('git tag', { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' })
      .split('\n').map((t) => t.trim()).filter(Boolean),
  );
  // Kun overskrifts-linjer taeller: "- **v1.29.0 (dato) — ...**". Broedtekst maa gerne
  // naevne en version uden at paastaa at den er ude.
  const paastande = [...afsnit.matchAll(/^- \*\*(v\d+\.\d+\.\d+)\b/gm)].map((m) => m[1]);
  assert.ok(paastande.length > 0, 'ingen versioner fundet under Shipped — regexet er droslet af');
  const opfundne = paastande.filter((v) => !tags.has(v));
  assert.deepEqual(opfundne, [],
    `WISHLIST siger disse er shipped, men de har ingen git-tag: ${opfundne.join(', ')}`);
});

// MAALT 9/9-2026: samme fil lovede `browser_copy_to_clipboard`,
// `browser_paste_from_clipboard` og `browser_clipboard_stats` som shipped i v1.26.0 — beskrevet
// som en "SECRET-SAFE clipboard bridge" der flytter kodeord uden om samtalen. De findes ingen
// steder: hverken i tools.js eller i udvidelsen. Det stod der fra 27/7.
//
// En version uden tag er én slags loegn; et vaerktoejsnavn uden kode er en vaerre, fordi nogen
// kan bygge oven paa den. Sandheden findes allerede i tools.js.
test('WISHLIST lover ikke vaerktoejer der ikke findes', () => {
  const rod = new URL('..', import.meta.url);
  const wish = readFileSync(new URL('WISHLIST.md', rod), 'utf8');
  const toolsSrc = readFileSync(new URL('mcp-server/tools.js', rod), 'utf8');
  const findes = new Set([...toolsSrc.matchAll(/name:\s*['"](browser_[a-z0-9_]+)['"]/g)].map((m) => m[1]));
  assert.ok(findes.size > 30, 'kunne ikke laese vaerktoejslisten — regexet er droslet af');

  const lovede = new Set([...shippedAfsnit(wish).matchAll(/`(browser_[a-z0-9_]+)`/g)].map((m) => m[1]));
  const opfundne = [...lovede].filter((t) => !findes.has(t));
  assert.deepEqual(opfundne, [],
    `WISHLIST lover disse som shipped, men de findes ikke i tools.js: ${opfundne.join(', ')}`);
});
