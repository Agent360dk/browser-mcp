// Agenten skal arbejde i baggrunden — ikke rive brugerens fane vaek.
//
// MAALT 21/8 mod aegte Chrome, med en anden fane forrest i samme vindue:
// screenshot og press_key rev fanen til sig. De oevrige lod den vaere.
//
// Begge var unoedvendige, og begge hvilede paa en antagelse der ikke holdt:
//   screenshot: kaldte getSessionTab(…, true) selv om CDP Page.captureScreenshot
//     nedenfor allerede kan fotografere en fane der ikke er forrest. Maalt:
//     116 KB PNG af en baggrundsfane, uden at fanen skiftede.
//   press_key: kommentaren sagde "activate tab so key-event lands in foreground
//     (otherwise Chrome routes to active tab)". Maalt og FALSIFICERET — et Enter
//     landede i baggrundsfanens keydown-handler mens en anden fane var forrest.
//
// Et fane-skift er ikke en kosmetisk gene: skriver brugeren i et felt i sin egen
// fane, mister feltet fokus midt i saetningen. Og skaermbilleder tages konstant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'extension/background.js'), 'utf8');

// Find hvilken case et bestemt kildeindeks hoerer til.
function caseFor(index) {
  const foer = kilde.slice(0, index);
  const traef = [...foer.matchAll(/case '([a-z_]+)':/g)];
  return traef.length ? traef[traef.length - 1][1] : null;
}

test('kun ask_user aktiverer fanen — alt andet arbejder i baggrunden', () => {
  const aktiverende = [];
  for (const m of kilde.matchAll(/getSessionTab\(port,\s*true\)/g)) {
    aktiverende.push(caseFor(m.index));
  }
  assert.deepEqual(aktiverende, ['ask_user'],
    `disse vaerktoejer river brugerens fane til sig: ${aktiverende.join(', ')}. ` +
    'Kun ask_user maa — brugeren skal kunne se det den spoerger om.');
});

// 9/9-2026, tredje gang samme faelde paa én dag: `slice(i, i + 4000)` gik i stykker fordi
// der kom en ny vagt ind i blokken. Et fast antal tegn er ikke en blok. Nu klippes ved
// case'ets EGNE graenser — samme greb som caseBlok() i tool-surface.
function caseBlok(kilde, navn) {
  const start = kilde.indexOf(`case '${navn}'`);
  if (start < 0) return '';
  const naeste = kilde.indexOf("\n      case '", start + 10);
  return kilde.slice(start, naeste > start ? naeste : start + 8000);
}

test('screenshot fotograferer uden at skifte fane', () => {
  const blok = caseBlok(kilde, 'screenshot');
  assert.ok(blok.length > 500, 'screenshot-blokken kunne ikke findes');
  assert.match(blok, /getSessionTab\(port, false\)/,
    'screenshot aktiverer fanen igen — CDP kan fotografere en baggrundsfane, det er unoedvendigt');
  // Den okkluderede sidste-udvej maa stadig loefte vinduet, ellers virker et
  // helt tildaekket vindue slet ikke.
  const helt = blok;
  assert.match(helt, /chrome\.windows\.update\(tab\.windowId, \{ focused: true/,
    'sidste-udvejen for et tildaekket vindue er vaek — saa fejler skaermbilleder helt');
  assert.match(helt, /chrome\.windows\.update\(prev\.id, \{ focused: true \}\)/,
    'fokus skal gives tilbage til brugerens vindue efter en noedloeftning');
  // MAALT 9/9: reserveloesningen captureVisibleTab fotograferer den SYNLIGE fane, ikke
  // agentens. Uden vagten leverede den brugerens egen aabne side til agenten. Adfaerden
  // proeves i skaermbillede-laek; her staar kun at vagten ikke maa forsvinde.
  assert.match(helt, /stadig\.active !== true/,
    'vagten mod at fotografere en ANDEN fane er vaek — det er en laek, ikke en unoejagtighed');
});

test('press_key sender tasten uden at hente fanen frem', () => {
  const i = kilde.indexOf("case 'press_key'");
  const blok = kilde.slice(i, i + 700);
  assert.match(blok, /getSessionTab\(port, false\)/,
    'press_key aktiverer fanen igen. Maalt 21/8: tasten lander i baggrundsfanen uden.');
});

test('getSessionTab stjaeler aldrig VINDUES-fokus', () => {
  const i = kilde.indexOf('async function getSessionTab(');
  const blok = kilde.slice(i, kilde.indexOf('\n}', i));
  assert.ok(!/focused: true/.test(blok),
    'getSessionTab loefter Chrome til forgrunden — det yankede hele browseren ved hver handling');
  assert.match(blok, /state: 'normal'/, 'et minimeret vindue skal stadig kunne foldes ud');
});

test('ask_user gemmer sig ikke — den skal frem', () => {
  const i = kilde.indexOf("case 'ask_user'");
  const blok = kilde.slice(i, i + 900);
  assert.match(blok, /getSessionTab\(port, true\)/, 'ask_user skal aktivere fanen');
  assert.match(blok, /setBadgeText/, 'og markere sig paa ikonet, saa den kan findes i et andet vindue');
});

test('getSessionTab aktiverer IKKE som standard', () => {
  // MUTATIONS-TESTET 22/8 og FALSIFICERET: testen ovenfor matcher kun de EKSPLICITTE
  // `getSessionTab(port, true)`-kaldesteder. Men 30 af 33 kaldesteder skriver bare
  // `getSessionTab(port)` og arver defaulten. Vendes defaulten fra false til true,
  // river alle 30 brugerens fane frem igen — og hele suiten forbliver groen.
  // Defaulten er den baerende kontrakt; den skal staa her.
  const m = kilde.match(/async function getSessionTab\(port,\s*activate\s*=\s*(\w+)\)/);
  assert.ok(m, 'fandt ikke getSessionTab-signaturen');
  assert.equal(m[1], 'false',
    'defaulten er vendt til true — de 30 kaldesteder der arver den river nu brugerens fane frem');
});

test('de fleste kaldesteder arver defaulten — derfor er den kontrakten', () => {
  const eksplicit = [...kilde.matchAll(/getSessionTab\(port,\s*(true|false)\)/g)].length;
  const alle = [...kilde.matchAll(/getSessionTab\(port[,)]/g)].length;
  assert.ok(alle - eksplicit > 10,
    `kun ${alle - eksplicit} kaldesteder arver defaulten — hvis det tal falder til nul, ` +
    'er defaulten ikke laengere den baerende kontrakt og denne test skal skrives om');
});
