/**
 * De sidste vagter — de adfaerder ingen test kunne se braekke.
 *
 * MAALT 22/8: en systematisk mutations-gennemgang braekkede 15 aegte adfaerder én
 * ad gangen. Kun 6 blev opdaget. Denne fil lukker resten. Hver test er verificeret
 * ved at braekke praecis den kode den vogter og se den blive roed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bg = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');

// ── select_option loej paa den ene gren i maaneder: den native <select>-gren blev
//    rettet, men custom-dropdown-grenen returnerede stadig `{ ok: true }` haardkodet,
//    uanset om klikket landede. Fundet 21/8 af en agent paa tredje gennemloeb.
test('select_option melder sandt paa BEGGE grene', () => {
  const i = bg.indexOf("case 'select_option'");
  assert.ok(i > -1, 'select_option-handleren skal findes');
  const blok = bg.slice(i, bg.indexOf("case '", i + 20));

  const nativeGren = blok.match(/type: 'native_select'/g) || [];
  assert.ok(nativeGren.length >= 3,
    'den native gren skal kunne svare baade "fandt ikke", "rullet tilbage" og "ok"');
  assert.match(blok, /ok: false, type: 'native_select'/,
    'den skal kunne melde at valget IKKE lykkedes');

  // Custom-dropdown-grenen: resultatet skal afhaenge af om klikket landede.
  assert.match(blok, /ok: valgKlik\?\.landed !== false/,
    'custom-dropdown-grenen maa ikke haardkode ok:true — det var den halve rettelse ' +
    'der stod tilbage i to gennemloeb, fordi ingen test kiggede paa den anden gren');
  assert.ok(!/return \{ ok: true \};/.test(blok),
    'ingen ubetinget succes-retur i select_option');
});

// ── terminate maa kun kunne komme fra den forbindelse der faktisk arbejder.
//    Ellers kan en anden udvidelse — eller en zombie-forbindelse — lukke en session
//    der er midt i noget.
test('terminate er gated paa den aktive forbindelse', () => {
  const i = srv.indexOf("'terminate'");
  assert.ok(i > -1, 'terminate skal findes');
  const blok = srv.slice(Math.max(0, i - 600), i + 600);
  assert.match(blok, /activeConnection\(\)/,
    'terminate skal sammenholdes med den aktive forbindelse, ikke tages fra hvem som helst');
});

// ── Laasen findes for at 21 af 43 vaerktoejer ikke faldt paa at to udvidelser
//    skiftedes til at vinde serverens socket. Men laasen maa kunne gives fri igen
//    saa laenge intet arbejde er i gang — ellers kan en fejlagtig foerste-forbindelse
//    spaerre for den rigtige udvidelse resten af sessionen.
test('forbindelses-laasen gives fri saa laenge ingen kommando er sendt', () => {
  assert.match(srv, /let harSendtKommando = false;/, 'flaget skal findes');
  assert.match(srv, /if \(!harSendtKommando\) laastForbindelse = null;/,
    'uden den her linje kan en tilfaeldig foerste forbindelse spaerre for den rigtige');
  assert.match(srv, /harSendtKommando = true/,
    'flaget skal saettes naar der faktisk sendes en kommando');
});

// ── Naar udvidelsen er ny og serveren er gammel — eller omvendt i butikkens
//    1-3 dages review-vindue — skal ukendte metoder forklares, ikke bare fejle.
test('ukendte metoder forklares med en konkret erstatning', () => {
  assert.match(srv, /function forklarSkaevhed/,
    'forklaringen er det eneste der staar mellem brugeren og "Unknown method: X" ' +
    'i hele Chrome Web Stores review-vindue');
  // At funktionen FINDES er ikke nok — den skal ogsaa kaldes. Foerste udgave af denne
  // test tjekkede kun definitionen, saa en mutation der fjernede KALDET slap igennem.
  const kald = (srv.match(/forklarSkaevhed\(/g) || []).length;
  assert.ok(kald >= 2, `forklarSkaevhed defineres men kaldes kun ${kald - 1} sted(er) — ` +
    'en definition ingen bruger er ingen vagt');
  const iFejl = srv.indexOf('isError: true');
  assert.ok(iFejl > -1, 'der skal findes en fejl-sti');
  assert.match(srv, /ERSTATNINGER/, 'der skal findes en tabel over hvad man goer i stedet');
  const i = srv.indexOf('const ERSTATNINGER');
  const tabel = srv.slice(i, srv.indexOf('};', i));
  const antal = (tabel.match(/:/g) || []).length;
  assert.ok(antal >= 5, `kun ${antal} erstatninger — de 8 metoder fra v1.26 skal vaere daekket`);
});

// ── Hjerteslaget er det eneste der opdager at broen er doed. Uden alarmen sker der
//    ingenting overhovedet, og udvidelsen ligger doed indtil brugeren selv opdager det.
test('hjerteslags-alarmen oprettes faktisk', () => {
  const i = bg.indexOf("chrome.alarms.get('ensure-offscreen'");
  assert.ok(i > -1, 'alarmen skal slaas op');
  const blok = bg.slice(i, i + 400);
  assert.match(blok, /chrome\.alarms\.create\('ensure-offscreen'/,
    'uden create sker der aldrig et hjerteslag, og en doed bro opdages aldrig');
  assert.match(blok, /periodInMinutes:\s*\d/, 'den skal gentage sig');
  assert.ok(!/false\s*&&\s*chrome\.alarms\.create/.test(bg),
    'alarmen maa ikke vaere gjort uopnaaelig');
  assert.match(bg, /chrome\.alarms\.onAlarm\.addListener/, 'og der skal lyttes paa den');
});

// ── Broen skal melde fra naar en session forsvinder, ellers frigives fanerne aldrig
//    og loftet fyldes op med faner ingen ejer.
test('en lukket forbindelse frigiver sessionens faner', () => {
  assert.match(bg, /msg\.type === 'session_disconnect'/, 'beskeden skal haandteres');
  const i = bg.indexOf("msg.type === 'session_disconnect'");
  assert.match(bg.slice(i, i + 200), /releaseSession\(/,
    'uden frigivelsen hober faner sig op som ingen session ejer');
});
