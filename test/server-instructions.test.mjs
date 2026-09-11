// Naar serverens instruktioner rent faktisk naar frem til agenten.
//
// MAALT 21/8 ved at laese initialize-svaret fra den koerende server: det indeholdt
// protocolVersion, capabilities og serverInfo — og INGEN instructions. Blokken paa
// 7.000 tegn i index.js var doed vaegt.
//
// Aarsagen: `instructions` blev givet som et TREDJE argument til Server-konstruktoeren.
// Den tager kun to (serverInfo, options), saa JavaScript smed objektet vaek i tavshed.
// Ingen fejl, ingen advarsel — bare en agent der aldrig fik at vide at den skal lukke
// sine faner, hvordan CAPTCHA loeses, eller hvornaar tekst-selektorer slaar CSS.
//
// Testen bygger konstruktoerkaldet af den RIGTIGE kilde og kalder den RIGTIGE SDK-klasse,
// saa den maaler leveringen — ikke bare at ordet "instructions" staar et sted i filen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');

// node_modules ligger i mcp-server/, ikke i roden, saa et bart pakkenavn ikke kan
// resolves herfra. Vi importerer den SAMME SDK som serveren selv bruger.
const { Server } = await import(join(rod, 'mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js'));

// Klip 'new Server(...)'-kaldet ud med balancerede parenteser.
function konstruktoerKald() {
  const start = kilde.indexOf('new Server(');
  assert.ok(start > -1, 'fandt ikke new Server( i index.js');
  let dybde = 0, i = kilde.indexOf('(', start);
  for (; i < kilde.length; i++) {
    if (kilde[i] === '(') dybde++;
    else if (kilde[i] === ')' && --dybde === 0) break;
  }
  return kilde.slice(start, i + 1);
}

test('instructions leveres til klienten via SDK-serveren', () => {
  const src = konstruktoerKald();
  const INSTRUCTIONS = 'PROEVE-INSTRUKTIONER';
  const srv = new Function('Server', 'PKG_VERSION', 'INSTRUCTIONS', `return ${src};`)(
    Server, '0.0.0-test', INSTRUCTIONS,
  );
  // _instructions er det felt SDK'en laeser naar den bygger initialize-svaret.
  assert.equal(srv._instructions, INSTRUCTIONS,
    'instructions naaede ikke ind i serveren — ligger den i et tredje argument igen?');
});

test('instructions ligger i samme options-objekt som capabilities', () => {
  const src = konstruktoerKald();
  // Tael argumenter, ikke kommaer: en afsluttende komma foer ')' er lovlig JS og
  // maa ikke tælle som et ekstra argument.
  const argumenter = (() => {
    let dybde = 0, nu = '', ud = [];
    for (const c of src.slice(src.indexOf('(') + 1, src.length - 1)) {
      if ('({['.includes(c)) { dybde++; nu += c; }
      else if (')}]'.includes(c)) { dybde--; nu += c; }
      else if (c === ',' && dybde === 0) { ud.push(nu); nu = ''; }
      else nu += c;
    }
    ud.push(nu);
    return ud.map(x => x.trim()).filter(Boolean);
  })();
  assert.equal(argumenter.length, 2,
    `new Server() kaldes med ${argumenter.length} argumenter — konstruktoeren tager to, resten smides tavst vaek`);
  assert.match(src, /capabilities:[\s\S]*instructions:|instructions:[\s\S]*capabilities:/,
    'capabilities og instructions skal ligge i det SAMME objekt');
});

test('instruktionerne indeholder faktisk det agenten skal styres af', () => {
  const i = kilde.indexOf('const INSTRUCTIONS = `');
  const blok = kilde.slice(i, kilde.indexOf('`;', i));
  assert.ok(blok.length > 2000, `INSTRUCTIONS er kun ${blok.length} tegn — er blokken blevet toemt?`);
  for (const emne of ['browser_ask_user', 'browser_close_tab', 'browser_provide_feedback', 'browser_solve_captcha']) {
    assert.ok(blok.includes(emne), `INSTRUCTIONS naevner ikke ${emne}`);
  }
});

// MAALT 11/9 (Fable, bekraeftet i den udgivne 1.29.0-pakke): instruksen sagde til hver agent
// "The MCP server auto-pulls the latest code from git on every new session startup". Det
// blev fjernet 22/8; serveren opdateres via npm (@latest) og kopierer selv nye udvidelsesfiler.
// En agent der tror paa git-saetningen, forklarer brugeren noget der ikke sker.
test('instruktionerne lover ikke at serveren henter kode fra git', () => {
  const i = kilde.indexOf('const INSTRUCTIONS = `');
  const blok = kilde.slice(i, kilde.indexOf('`;', i));
  assert.doesNotMatch(blok, /auto-pulls?|from git|git pull/i,
    'INSTRUCTIONS paastaar igen at serveren henter kode fra git');
  assert.match(blok, /## Extension updates[\s\S]*npm[\s\S]*chrome:\/\/extensions/,
    'afsnittet om opdateringer skal forklare den rigtige vej: npm-versionen og genindlaesning i chrome://extensions');
});
