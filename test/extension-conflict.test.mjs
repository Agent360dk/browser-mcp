// To udvidelser, én server — regressionstest.
//
// MAALT 21/8 med lsof: paa hver af de fire aktive porte stod der 2 ESTABLISHED
// forbindelser. Chrome havde to Browser MCP-udvidelser indlaest samtidig (to
// "load unpacked"-kopier i ~/Downloads), og begge scanner det samme portspaend,
// saa begge forbandt til hver eneste MCP-server.
//
// Serveren havde kun én variabel — `let extensionSocket = null` — som hver ny
// forbindelse overskrev. Kommandoerne gik derfor til den udvidelse der forbandt
// SIDST, vilkaarligt hvilken, mens den anden koerte videre med sit eget sessions-
// kort og sine egne fane-grupper. Det saa ud som faner der forsvandt og sessioner
// der slog sig sammen. Værre endnu: et `terminate` fra den forkerte kopi (dens
// sidste fane lukkede) rev serveren ned under den udvidelse der loeste opgaven.
//
// Testen laeser de rigtige funktioner ud af mcp-server/index.js, saa den fanger
// det hvis nogen ruller registret tilbage til én socket.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');

function udtraek(navn) {
  const start = kilde.indexOf(`function ${navn}(`);
  if (start === -1) throw new Error(`${navn}() findes ikke i index.js`);
  let dybde = 0, i = kilde.indexOf('{', start);
  for (; i < kilde.length; i++) {
    if (kilde[i] === '{') dybde++;
    else if (kilde[i] === '}' && --dybde === 0) break;
  }
  return kilde.slice(start, i + 1);
}

function byg() {
  const connections = new Set();
  const src = ['cmpVersion', 'liveConnections', 'activeConnection', 'distinctExtensions']
    .map(udtraek).join('\n\n');
  // laastForbindelse og harSendtKommando er modul-variable i index.js. De erklaeres
  // her i den omsluttende scope, saa den udtrukne kildekode muterer PRAECIS de samme
  // variable som i produktionen — ikke en kopi.
  const fabrik = new Function('connections', `
    let laastForbindelse = null, harSendtKommando = false;
    ${src}
    return {
      cmpVersion, liveConnections, activeConnection, distinctExtensions,
      sendKommando: () => { harSendtKommando = true; },
      nyForbindelse: () => { if (!harSendtKommando) laastForbindelse = null; },
    };`);
  return { connections, ...fabrik(connections) };
}

const AABEN = 1, LUKKET = 3;
let seq = 0;
const forbind = (connections, { version = null, id = null, state = AABEN, since = ++seq } = {}) => {
  const c = { ws: { readyState: state }, seq: ++seq, extensionId: id, version, name: 'Agent360 Browser MCP', since };
  connections.add(c);
  return c;
};

// ── cmpVersion ──────────────────────────────────────────────────────────────


// Afgraenser `if (msg.type === '<type>') { ... }` med klamme-matchning i stedet for et
// fast tegnantal. MAALT 23/8: faste vinduer blev roede hver gang en kommentar voksede —
// altsaa af korrekte aendringer. Tre gange paa én aften.
function blokFor(kilde, type) {
  const i = kilde.indexOf(`msg.type === '${type}'`);
  if (i < 0) return '';
  let d = 0;
  for (let k = kilde.indexOf('{', i); k < kilde.length; k++) {
    if (kilde[k] === '{') d++;
    else if (kilde[k] === '}' && --d === 0) return kilde.slice(i, k + 1);
  }
  return kilde.slice(i);
}

test('cmpVersion sammenligner tal, ikke tekst', () => {
  const { cmpVersion } = byg();
  assert.equal(cmpVersion('1.27.1', '1.27.0'), 1);
  assert.equal(cmpVersion('1.27.0', '1.27.1'), -1);
  assert.equal(cmpVersion('1.27.0', '1.27.0'), 0);
  // Ren tekstsammenligning ville sige at 1.9.0 > 1.10.0. Det er praecis den fejl
  // der ville faa serveren til at vaelge den GAMLE udvidelse.
  assert.equal(cmpVersion('1.10.0', '1.9.0'), 1);
  assert.equal(cmpVersion('2.0.0', '1.99.99'), 1);
});

test('cmpVersion behandler manglende version som aeldst', () => {
  const { cmpVersion } = byg();
  assert.equal(cmpVersion(null, '0.0.1'), -1);
  assert.equal(cmpVersion(null, null), 0);
  assert.equal(cmpVersion('1.0.0', undefined), 1);
});

// ── activeConnection ────────────────────────────────────────────────────────

test('med to udvidelser vinder den nyeste — uanset hvem der forbandt sidst', () => {
  const { connections, activeConnection } = byg();
  const gammel = forbind(connections, { version: '1.27.0', id: 'kmbhc' });
  const ny = forbind(connections, { version: '1.27.1', id: 'hajof' });
  assert.equal(activeConnection(), ny, 'nyeste udgave skal vinde');
  // Og den maa ikke skifte fordi den gamle genforbinder bagefter.
  forbind(connections, { version: '1.27.0', id: 'kmbhc', since: 9999 });
  assert.equal(activeConnection().version, '1.27.1');
  assert.notEqual(activeConnection(), gammel);
});

test('en udvidelse uden haandtryk taber til en der har ét', () => {
  const { connections, activeConnection } = byg();
  forbind(connections, { version: null, id: null });          // fra foer v1.28
  const ny = forbind(connections, { version: '1.28.0', id: 'hajof' });
  assert.equal(activeConnection(), ny);
});

test('er der kun en gammel udvidelse, bruges den — ellers virker intet', () => {
  const { connections, activeConnection } = byg();
  const kun = forbind(connections, { version: null, id: null });
  assert.equal(activeConnection(), kun);
});

test('ved samme version vinder den der forbandt sidst', () => {
  const { connections, activeConnection } = byg();
  forbind(connections, { version: '1.28.0', id: 'a', since: 100 });
  const nyere = forbind(connections, { version: '1.28.0', id: 'b', since: 200 });
  assert.equal(activeConnection(), nyere);
});

test('lukkede sockets vaelges aldrig', () => {
  const { connections, activeConnection } = byg();
  forbind(connections, { version: '9.9.9', id: 'doed', state: LUKKET });
  const levende = forbind(connections, { version: '1.0.0', id: 'levende' });
  assert.equal(activeConnection(), levende, 'en doed socket med hoejere version maa ikke vinde');
});

test('uden forbindelser er der ingen aktiv — og det maa ikke kaste', () => {
  const { activeConnection } = byg();
  assert.equal(activeConnection(), null);
});

// ── distinctExtensions ──────────────────────────────────────────────────────

test('distinctExtensions ser to udvidelser som to', () => {
  const { connections, distinctExtensions } = byg();
  forbind(connections, { version: '1.27.0', id: 'kmbhc' });
  forbind(connections, { version: '1.27.1', id: 'hajof' });
  assert.equal(distinctExtensions().length, 2, 'konflikten skal kunne ses');
});

test('samme udvidelse der genforbinder taelles som én', () => {
  const { connections, distinctExtensions } = byg();
  forbind(connections, { version: '1.28.0', id: 'hajof' });
  forbind(connections, { version: '1.28.0', id: 'hajof' });
  assert.equal(distinctExtensions().length, 1, 'samme extensionId er samme udvidelse');
});

test('to gamle udvidelser uden id taelles stadig som to', () => {
  const { connections, distinctExtensions } = byg();
  forbind(connections, { version: null, id: null });
  forbind(connections, { version: null, id: null });
  assert.equal(distinctExtensions().length, 2, 'manglende id maa ikke skjule en konflikt');
});

test('doede forbindelser taeller ikke med i konflikten', () => {
  const { connections, distinctExtensions } = byg();
  forbind(connections, { version: '1.27.0', id: 'gammel', state: LUKKET });
  forbind(connections, { version: '1.28.0', id: 'ny' });
  assert.equal(distinctExtensions().length, 1, 'en afsluttet forbindelse er ikke en konflikt');
});

// ── kilde-kontrakter (fanger tilbagerulning) ────────────────────────────────

test('serveren holder ikke laengere én enkelt socket-variabel', () => {
  assert.ok(!/^let extensionSocket = null;$/m.test(kilde),
    'extensionSocket er tilbage — hver ny forbindelse overskriver den igen');
  assert.match(kilde, /const connections = new Set\(\)/, 'forbindelses-registret mangler');
});

test('terminate fra en inaktiv forbindelse lukker ikke serveren', () => {
  const blok = blokFor(kilde, 'terminate');
  assert.ok(blok, 'terminate-haandteringen findes');
  assert.match(blok, /activeConnection\(\) !== conn/,
    'uden denne gate kan en sidelaebende gammel udvidelse rive serveren ned');
  const gateIdx = blok.indexOf('activeConnection() !== conn');
  const shutIdx = blok.indexOf('gracefulShutdown');
  assert.ok(gateIdx < shutIdx, 'gaten skal ligge FOER nedlukningen');
});

test('haandtrykket sendes rent faktisk fra udvidelsen', () => {
  const off = readFileSync(join(rod, 'extension/offscreen.js'), 'utf8');
  assert.match(off, /type: 'hello'/, 'offscreen.js sender ikke hello');
  assert.match(off, /chrome\.runtime\.getManifest\(\)/, 'hello baerer ingen version');
  assert.match(off, /extensionId: chrome\.runtime\.id/, 'hello baerer ingen identitet');
  // Skal ligge i onopen, ellers naar det aldrig frem foer foerste kommando.
  const i = off.indexOf('ws.onopen');
  const j = off.indexOf("type: 'hello'");
  assert.ok(i > -1 && j > i && j < off.indexOf('ws.onmessage'), 'hello skal sendes i onopen');
});

test('serveren laeser haandtrykket og tjekker for konflikt bagefter', () => {
  assert.match(kilde, /msg\.type === 'hello'/, 'serveren laeser ikke hello');
  const i = kilde.indexOf("msg.type === 'hello'");
  const blok = kilde.slice(i, i + 1400);
  assert.match(blok, /advarOmKonflikt\(conn\)/, 'konflikten tjekkes ikke naar versionen bliver kendt');
});

test('konflikten opdages allerede ved opkoblingen — uden haandtryk', () => {
  // Alle udgivne udgaver af udvidelsen er fra foer haandtrykket. Ventede serveren
  // paa hello, ville konflikten foerst kunne ses efter at brugeren havde opdateret —
  // altsaa aldrig, for det er netop det de ikke har gjort.
  // Vinduet afgraenses af handleren selv, ikke af et fast tegnantal. MAALT 23/8:
  // med slice(i, i + 2400) blev testen roed saa snart Origin-gaten blev tilfoejet —
  // altsaa af en KORREKT sikkerhedsrettelse.
  const i = kilde.indexOf("server.on('connection'");
  let d = 0, slut = i;
  for (let k = kilde.indexOf('{', i); k < kilde.length; k++) {
    if (kilde[k] === '{') d++;
    else if (kilde[k] === '}' && --d === 0) { slut = k + 1; break; }
  }
  const blok = kilde.slice(i, slut);
  assert.match(blok, /req\?\.headers\?\.origin/, 'Origin laeses ikke ved opkobling');
  assert.match(blok, /chrome-extension/, 'Origin-moenstret mangler');
  assert.match(blok, /advarOmKonflikt\(conn\)/, 'der advares ikke ved opkobling');
});

test('Origin-moenstret accepterer et aegte udvidelses-id og afviser skrald', () => {
  // Bruger kildens EGEN linje, saa testen ikke gentager moenstret og dermed
  // kunne bestaa selv hvis kilden brugte et andet.
  const linje = kilde.split('\n').find(l => l.includes('const fraOrigin ='));
  assert.ok(linje, 'fandt ikke fraOrigin-linjen i index.js');
  const f = new Function('origin', `${linje.trim()} return fraOrigin;`);
  assert.equal(f('chrome-extension://kmbhcaepmhecgjelbdlminacenpgfhdn'), 'kmbhcaepmhecgjelbdlminacenpgfhdn');
  assert.equal(f('chrome-extension://hajoflaeddibfgccjbenalpbflamonpn'), 'hajoflaeddibfgccjbenalpbflamonpn');
  assert.equal(f('http://evil.example'), null, 'kun chrome-extension-origins maa give et id');
  assert.equal(f(''), null, 'ingen origin → intet id');
  assert.equal(f('chrome-extension://forkort'), null, 'et id er 32 tegn');
  assert.equal(f('chrome-extension://KMBHCAEPMHECGJELBDLMINACENPGFHDN'), null, 'udvidelses-id er altid smaa bogstaver a-p');
});

test('samme konflikt gentages ikke ved hvert hello', () => {
  const i = kilde.indexOf('function advarOmKonflikt(');
  const blok = kilde.slice(i, i + 900);
  assert.match(blok, /sidsteKonfliktNoegle/, 'uden en noegle skriges der ved hver eneste besked');
  assert.match(blok, /if \(alle\.length < 2\) return/, 'der maa ikke advares naar der kun er én udvidelse');
  assert.match(blok, /ADVARSEL/, 'konflikten siges ikke hoejt');
});

// ── laasen: valget maa ikke skifte midt i et forloeb ────────────────────────
//
// MAALT 21/8 i flow-harnessen mod aegte Chrome: uden laas skiftede den aktive
// udvidelse EFTER foerste kommando. navigate aabnede en fane hos udvidelse A;
// et oejeblik senere overtog B, som ikke kendte fanen og lavede en about:blank.
// 21 af 43 vaerktoejer faldt med "Cannot access contents of url about:blank".
// Faner hoerer til den udvidelse der aabnede dem — skifter man, strander de.

test('den aktive udvidelse skifter ikke naar en anden forbinder bagefter', () => {
  const b = byg();
  const foerste = forbind(b.connections, { version: null, id: 'A' });
  assert.equal(b.activeConnection(), foerste, 'foerste forbindelse vaelges');
  b.sendKommando();                                   // navigate → fane aabnet hos A
  forbind(b.connections, { version: '9.9.9', id: 'B' }); // B forbinder og er "nyere"
  assert.equal(b.activeConnection(), foerste,
    'B overtog efter at A havde aabnet en fane — fanen strander og alt derefter rammer about:blank');
});

test('foer foerste kommando maa en bedre udvidelse godt komme til', () => {
  const b = byg();
  forbind(b.connections, { version: null, id: 'A' });
  b.activeConnection();          // laasen saettes
  b.nyForbindelse();               // ny forbindelse, ingen kommando sendt endnu
  const bedre = forbind(b.connections, { version: '1.28.0', id: 'B' });
  assert.equal(b.activeConnection(), bedre, 'ingen faner i spil endnu — den bedre skal vinde');
});

test('doer den laaste forbindelse, vaelges der forfra', () => {
  const b = byg();
  const foerste = forbind(b.connections, { version: null, id: 'A' });
  b.activeConnection(); b.sendKommando();
  foerste.ws.readyState = LUKKET;                     // udvidelsen forsvandt
  const ny = forbind(b.connections, { version: '1.28.0', id: 'B' });
  assert.equal(b.activeConnection(), ny, 'en doed laas maa ikke blokere genopretning');
});

test('laasen findes i kilden og er ikke bare en kommentar', () => {
  assert.match(kilde, /let laastForbindelse = null;/, 'laas-variablen mangler');
  const i = kilde.indexOf('function activeConnection(');
  const blok = kilde.slice(i, i + 900);
  assert.match(blok, /if \(laastForbindelse && laastForbindelse\.ws\.readyState === 1\) return laastForbindelse;/,
    'laasen tjekkes ikke foerst i activeConnection');
  assert.match(blok, /laastForbindelse = best;/, 'valget gemmes ikke');
  assert.match(kilde, /harSendtKommando = true;[\s\S]{0,120}conn\.ws\.send/,
    'flaget saettes ikke naar en kommando faktisk sendes');
});


// ── pin: noedudgang naar to udvidelser ikke kan slaas fra ───────────────────

test('BROWSER_MCP_EXTENSION_ID binder serveren til én bestemt udvidelse', () => {
  assert.match(kilde, /const PINNET_UDVIDELSE = \(process\.env\.BROWSER_MCP_EXTENSION_ID/,
    'pin-variablen mangler');
  const i = kilde.indexOf("server.on('connection'");
  const blok = kilde.slice(i, i + 2600);
  assert.match(blok, /if \(PINNET_UDVIDELSE && fraOrigin && fraOrigin !== PINNET_UDVIDELSE\)/,
    'pinnen tjekkes ikke ved opkobling');
  assert.match(blok, /ws\.close\(/, 'en afvist udvidelse skal lukkes ned, ikke bare ignoreres');
  // Uden pin maa INTET afvises — ellers braekker den normale enkelt-udvidelses-sti.
  const gate = blok.slice(blok.indexOf('if (PINNET_UDVIDELSE'));
  assert.ok(gate.indexOf('PINNET_UDVIDELSE &&') < gate.indexOf('!=='),
    'pin-tjekket skal kortslutte naar ingen pin er sat');
});

test('pin-gaten ligger FOER forbindelsen registreres', () => {
  // Vinduet afgraenses af handleren selv, ikke af et fast tegnantal. MAALT 23/8:
  // med slice(i, i + 2400) blev testen roed saa snart Origin-gaten blev tilfoejet —
  // altsaa af en KORREKT sikkerhedsrettelse.
  const i = kilde.indexOf("server.on('connection'");
  let d = 0, slut = i;
  for (let k = kilde.indexOf('{', i); k < kilde.length; k++) {
    if (kilde[k] === '{') d++;
    else if (kilde[k] === '}' && --d === 0) { slut = k + 1; break; }
  }
  const blok = kilde.slice(i, slut);
  assert.ok(blok.indexOf('PINNET_UDVIDELSE &&') < blok.indexOf('connections.add(conn)'),
    'en afvist udvidelse maa aldrig naa ind i registret — saa ville den taelle som en konflikt');
});

// ── Skaev-vinduet: serveren opdateres straks, udvidelsen tager 1-3 dage ──────
//
// MAALT 22/8: den nye server kan sende otte metoder en 1.25.0-udvidelse ikke kender
// (click_xy, double_click, right_click, extract_list, reattach_debugger + de tre
// udklipsholder-vaerktoejer, alle fra v1.26.0). Udvidelsen svarer `Unknown method: X`,
// og det er ALT brugeren ser. Vinduet er garanteret: npm er oejeblikkeligt, Chrome Web
// Store tager 1-3 dages review. Serveren VED at udvidelsen er gammel — den sendte intet
// haandtryk — saa den kan forklare i stedet for at forvirre.

function bygForklaring(version) {
  const a = kilde.indexOf('const ERSTATNINGER');
  const i = kilde.indexOf('function forklarSkaevhed');
  let d = 0, j = kilde.indexOf('{', i);
  for (; j < kilde.length; j++) { if (kilde[j] === '{') d++; else if (kilde[j] === '}' && --d === 0) break; }
  return new Function('activeConnection', kilde.slice(a, j + 1) + '; return forklarSkaevhed;')(
    () => (version === undefined ? null : { version }),
  );
}

test('gammel udvidelse: ukendt metode forklares, ikke bare rapporteres', () => {
  const f = bygForklaring(null);
  const svar = f('Unknown method: double_click');
  assert.match(svar, /Chrome Web Store/, 'brugeren faar ikke at vide hvorfor');
  assert.match(svar, /1-3 dage/, 'vinduets laengde naevnes ikke');
  assert.match(svar, /Indtil da: /, 'ingen erstatning tilbudt');
  assert.ok(!svar.startsWith('Error: Unknown method'), 'den gaadefulde besked staar stadig');
});

test('alle otte metoder fra v1.26.0 har en erstatning', () => {
  const f = bygForklaring(null);
  for (const m of ['double_click', 'right_click', 'click_xy', 'extract_list',
                   'reattach_debugger']) {
    assert.match(f(`Unknown method: ${m}`), /Indtil da: /, `${m} mangler en erstatning`);
  }
});

test('ny udvidelse: en ukendt metode er en AEGTE fejl og bortforklares ikke', () => {
  const f = bygForklaring('1.28.0');
  assert.equal(f('Unknown method: hokuspokus'), 'Error: Unknown method: hokuspokus');
});

test('almindelige fejl roeres ikke', () => {
  for (const v of [null, '1.28.0']) {
    assert.equal(bygForklaring(v)('Command timed out after 30000ms: click'),
      'Error: Command timed out after 30000ms: click');
  }
});
