/**
 * Vogter konkurrent-vagten.
 *
 * Hvorfor: vagten blev bygget 19/9 fordi ni sider havde paastaaet noget forkert om
 * Microsoft i ti dage. Under bygningen fejlede den selv TO gange paa samme maade -
 * den svarede tomt og saa rigtig ud:
 *   1. Den pegede paa Googles README, hvor vaerktoejerne ikke staar. Svar: 0 vaerktoejer,
 *      dom: "alt uaendret".
 *   2. Den haengte et citat paa den forkerte kilde. Citatet blev pinnet som FRAVAERENDE,
 *      og et fravaerende citat vogtes aldrig.
 * Begge gange var instrumentet i stykker, ikke verden. Derfor proever denne fil at
 * vagten stadig kan opdage sin egen blindhed - offline, uden at roere nettet.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VAGT = join(ROOT, 'scripts', 'konkurrent-vagt.py');
const kilde = () => readFileSync(VAGT, 'utf8');

test('hvert citat haenger paa en kilde der findes', () => {
  const s = kilde();
  const kilder = [...s.matchAll(/^\s*'([a-z0-9-]+)':\s*\(/gm)].map((m) => m[1]);
  const citater = [...s.matchAll(/^\s*\('([a-z0-9-]+)',\s*'/gm)].map((m) => m[1]);
  assert.ok(kilder.length >= 3, 'fandt ingen kilder - er formatet aendret?');
  assert.ok(citater.length >= 2, 'fandt ingen citater - er formatet aendret?');
  for (const k of citater) {
    assert.ok(kilder.includes(k),
      `citatet er haengt paa "${k}", som ikke er en kilde. Det var fejl nr. 2 den 19/9: ` +
      'citatet blev pinnet som fravaerende og blev derfor aldrig vogtet');
  }
});

test('en kilde der SKAL have vaerktoejer, maa ikke kunne pinnes med nul', () => {
  const s = kilde();
  assert.match(s, /skal_have and not v/,
    'kalibreringen mod tomme svar er vaek - vagten kan igen pinne 0 vaerktoejer og sige "alt uaendret"');
  assert.match(s, /KALIBRERING FEJLER/, 'kalibreringen raaber ikke op');
});

// De to kalibreringer proeves ved at KOERE dem, ikke ved at laese efter en formulering.
// MAALT 19/9: foerste udgave af netop denne proeve laeste kildeteksten, og en mutation der
// erstattede `if not fandtes:` med `if False:` slap igennem - `raise SystemExit` stod der
// jo stadig. Samme fejl som husets gamle fane-vagt: den vogtede en saetning, ikke en egenskab.
const koerMaal = (tekst) => {
  const kode = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('v', ${JSON.stringify(VAGT)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.hent = lambda url: ${JSON.stringify('%TEKST%')}
try:
    m.maal(pinner=True); print('INGEN_FEJL')
except SystemExit as e:
    print('SYSTEMEXIT:' + str(e)[:60])
`.replace('%TEKST%', tekst);
  return execFileSync('python3', ['-c', kode], { encoding: 'utf8' }).trim();
};

test('et citat der ikke findes i kilden, maa ikke kunne pinnes', () => {
  // tekst MED vaerktoejer, UDEN citaterne -> skal fejle paa citatet
  const ud = koerMaal('- **browser_click**\\n- **browser_type**\\n');
  assert.match(ud, /SYSTEMEXIT/,
    'et fravaerende citat kunne pinnes - saa vogtes paastanden aldrig');
  assert.match(ud, /citatet/, 'fejlen naevner ikke citatet');
});

test('en kilde uden vaerktoejer maa ikke kunne pinnes med nul', () => {
  const ud = koerMaal('bare proesa, ingen vaerktoejer og ingen citater');
  assert.match(ud, /SYSTEMEXIT/, 'nul vaerktoejer kunne pinnes tavst');
});

test('vaerktoejs-udtraekket finder BEGGE husers navneformer', () => {
  // kalibrering mod et kendt-sandt tilfaelde: Microsoft praefikser med browser_,
  // Google lister uden praefiks som overskrifter. Et udtraek der kun kan det ene,
  // svarer nul paa det andet - og nul lignede laenge et gyldigt svar.
  const ud = execFileSync('python3', ['-c', `
import importlib.util, sys
spec = importlib.util.spec_from_file_location('v', ${JSON.stringify(VAGT)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ms = m.vaerktoejer('- **browser_click**\\n- **browser_press_key**\\n')
gg = m.vaerktoejer('## navigate_page\\n## take_screenshot\\n')
tom = m.vaerktoejer('bare proesa uden vaerktoejer overhovedet')
print(len(ms), len(gg), len(tom))
`], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
  assert.equal(ud[0], 2, 'fanger ikke Microsofts browser_-form');
  assert.equal(ud[1], 2, 'fanger ikke Googles overskrift-form - det var fejl nr. 1 den 19/9');
  assert.equal(ud[2], 0, 'finder vaerktoejer i tekst der ingen har');
});

test('udgivelsen spaerres hvis vagten er roed', () => {
  const sh = readFileSync(join(ROOT, 'runbrowsermcpupdate.sh'), 'utf8');
  assert.match(sh, /konkurrent-vagt\.py/, 'udgivelses-scriptet koerer ikke vagten');
  assert.match(sh, /gate "konkurrent-vagt roed/,
    'vagten koeres men spaerrer ikke - en udgivelse er praecis naar paastandene sendes ud');
});

test('den maanedlige koersel koerer vagten - og maa ikke melde groent naar den er roed', () => {
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'dominans-audit.yml'), 'utf8');
  // MAALT 19/9: foerste udgave matchede bare /konkurrent-vagt\.py/. Ordet staar OGSAA i
  // kommentaren over trinnet, saa en mutation der fjernede selve koerslen slap igennem.
  // Samme fejl to gange i samme fil: anker paa mekanikken, ikke paa navnet.
  assert.match(wf, /^\s+python3 scripts\/konkurrent-vagt\.py\b/m,
    'den maanedlige koersel koerer ikke vagten - saa kigger ingen efter mellem udgivelser');
  assert.match(wf, /^\s+VAGT_STATUS: \$\{\{ steps\.vagt\.outputs\.status \}\}/m,
    'mailen faar ikke vagtens status ind');
  assert.match(wf, /os\.environ\.get\("VAGT_STATUS"/,
    'mailens groenne haenger kun paa auditen. Er vagten roed og auditen groen, siger emnefeltet "OK" ' +
    'mens rapporten under er roed - et falsk groent, som er netop den fejlklasse vagten findes for');
  assert.match(wf, /steps\.vagt\.outputs\.status != '0'/, 'koerslen fejler ikke naar vagten er roed');
});

// ── main() selv: dommen, ikke bare delene ────────────────────────────────────
// MAALT 19/9 af reviewet: fire af fem mutationer overlevede, fordi INTET koerte main().
// `if nye:` -> `if False:` slaar doedsvarslet fra - vagtens hele formaal - uden at en
// eneste proeve blev roed. En vagt uden adfaerdsdaekning paa sin egen dom er pynt.
const koerDom = (foerTekst, efterTekst) => {
  const kode = `
import importlib.util, sys, tempfile, os, json
spec = importlib.util.spec_from_file_location('v', ${JSON.stringify(VAGT)})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.PIN = os.path.join(tempfile.mkdtemp(), 'pin.json')
m.EGNE_TAL = []                      # vi proever dommen om KONKURRENTEN her
m.hent = lambda url: ${JSON.stringify('%FOER%')}
sys.argv = ['v', '--pin']; m.main()
m.hent = lambda url: ${JSON.stringify('%EFTER%')}
sys.argv = ['v']
try:
    rc = m.main()
except SystemExit as e:
    rc = e.code
print('RC=' + str(rc))
`.replace('%FOER%', foerTekst).replace('%EFTER%', efterTekst);
  return execFileSync('python3', ['-c', kode], { encoding: 'utf8' });
};

// En kilde der opfylder begge kalibreringer: har vaerktoejer OG begge citater.
const BASIS = '- **browser_click**\\n- **browser_type**\\n' +
  'The extension lets you leverage your logged-in sessions.\\n' +
  'Each client gets its own tab group, colored apart.\\n';

test('main: uaendret konkurrent giver groent - kalibrering mod kendt-sandt', () => {
  assert.match(koerDom(BASIS, BASIS), /RC=0/,
    'vagten er roed paa uaendret kilde - saa siger et roedt udslag ingenting');
});

test('main: NYT vaerktoej hos dem goer runden roed - det er doedsvarslet', () => {
  const ud = koerDom(BASIS, BASIS + '- **browser_ask_user**\\n');
  assert.match(ud, /RC=1/,
    'et nyt vaerktoej hos konkurrenten blev ikke opdaget. Det er praecis doedsvarslet: ' +
    'den dag et af deres vaerktoejer kan standse og spoerge mennesket, er vores eneste ' +
    'position vaek - og vagten sagde groent');
  assert.match(ud, /NYE vaerktoejer/, 'runden er roed, men siger ikke hvad der skete');
});

test('main: FJERNET vaerktoej goer runden roed', () => {
  const ud = koerDom(BASIS, BASIS.replace('- **browser_type**\\n', ''));
  assert.match(ud, /RC=1/, 'et fjernet vaerktoej kan have gjort en af vores paastande forkert');
  assert.match(ud, /FJERNET/, 'runden siger ikke hvad der skete');
});

test('main: et forsvundet citat goer runden roed', () => {
  const ud = koerDom(BASIS, BASIS.replace('leverage your logged-in sessions', 'do something else'));
  assert.match(ud, /RC=1/, 'citatet vores side hviler paa forsvandt uden at nogen sagde noget');
});

test('main: en NEGERET saetning omkring citatet goer runden roed', () => {
  // Reviewets fund 2.1: `citat in tekst` passerer hvis saetningen negeres. Strengen staar
  // der jo stadig. Derfor pinnes konteksten, ikke strengen.
  const ud = koerDom(BASIS, BASIS.replace(
    'The extension lets you leverage your logged-in sessions.',
    'The extension does NO LONGER leverage your logged-in sessions.'));
  assert.match(ud, /RC=1/,
    'saetningen blev negeret og vagten sagde groent - citatet stod der jo stadig. ' +
    'Det er den tredje blindhed reviewet fandt');
});

test('vagten holder OGSAA vores egne sider op mod maalingen', () => {
  const s = kilde();
  assert.match(s, /def egne_paastande/,
    'vagten laeser kun konkurrenten. Reviewet maalte 19/9: den pinnede 58 vaerktoejer hos ' +
    'Google samme dag som vores egen side sagde 52, og var groen. Det ER det gab der laa i ti dage');
  assert.match(s, /fejl\.extend\(egne_paastande/, 'tjekket findes, men indgaar ikke i dommen');
});
