/**
 * Hvem maa forbinde til serveren, og hvem maa lukke den ned?
 *
 * MAALT 23/8 mod en AEGTE server med en raa WebSocket-klient. Tre angreb lykkedes:
 *
 *   1. En klient der simpelthen UDELOD Origin-headeren blev accepteret.
 *   2. Med `hello version 99.0.0` vandt den rollen som aktiv udvidelse og fik
 *      `browser_get_cookies` leveret — den kunne baade laese hvad agenten spurgte om
 *      og svare med opdigtet indhold.
 *   3. Den kunne lukke serveren med `terminate` (exit 0).
 *
 * Serveren lytter kun paa 127.0.0.1, saa angriberen skal koere lokalt — men det goer
 * enhver anden app og ethvert npm-postinstall-script. Og hvad den kan er ikke
 * smaating: laese alt agenten sender til browseren (kodeord fra ask_user, cookies,
 * sidetekst), fodre agenten med opdigtet sideindhold, og slukke browser-adgangen i
 * alle aabne chats paa én gang.
 *
 * Ikke en regression mod 1.25.0 — den havde slet ingen gate. Men koden HAR nu en
 * Origin at validere paa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');

// Brug kildens EGET moenster, saa testen ikke gentager det og dermed kunne bestaa
// selv hvis serveren brugte et andet.
const iVerify = srv.indexOf('verifyClient:');
assert.ok(iVerify > -1, 'verifyClient findes ikke i index.js');
// Byg moenstret af kildens EGEN tekst, saa testen ikke gentager det og dermed kunne
// bestaa selv hvis serveren brugte et andet. Slicen gaar fra "^chrome-extension" til
// "$" — kan ikke bruge [^/]+, for moenstret indeholder selv escapede skraastreger.
const blokV = srv.slice(iVerify, iVerify + 900);
const fra = blokV.indexOf('^chrome-extension');
const til = blokV.indexOf('$', fra);
assert.ok(fra > -1 && til > fra, 'fandt ikke Origin-moenstret inde i verifyClient');
const moenster = new RegExp(blokV.slice(fra, til + 1).replace(/\\\//g, '/'));

test('kun en aegte chrome-extension-Origin slipper ind', () => {
  for (const god of [
    'chrome-extension://ddmedkniibandegeflklbmhfifbikega',
    'chrome-extension://kbdpjpbbkniolomhhddbnonpcajcpepn',
  ]) {
    assert.ok(moenster.test(god), `${god} burde vaere godkendt — det er en rigtig udvidelse`);
  }
});

test('alt andet afvises — ogsaa naar headeren helt mangler', () => {
  const onde = [
    ['ingen header', ''],
    ['ingen header (undefined)', undefined],
    ['en webside', 'http://evil.example'],
    ['localhost-side', 'http://127.0.0.1:8080'],
    ['https-side', 'https://example.com'],
    ['for kort id', 'chrome-extension://kort'],
    ['ulovlige tegn', 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
    ['moz-extension', 'moz-extension://ddmedkniibandegeflklbmhfifbikega'],
    ['suffiks-snyd', 'chrome-extension://ddmedkniibandegeflklbmhfifbikega.evil.com'],
  ];
  for (const [navn, o] of onde) {
    assert.ok(!moenster.test(o || ''), `${navn} (${o}) slipper igennem gaten`);
  }
});

// ── Mutations-verificeret: verifyClient fjernet gav roed.
test('gaten ligger i HAANDTRYKKET, ikke bagefter', () => {
  assert.match(srv, /verifyClient:/,
    'lukkes forbindelsen foerst inde i connection-handleren, naar den fremmede at faa ' +
    'en aaben socket og et 101-svar foer den smides ud. verifyClient giver 401 og ingen socket.');
  const i = srv.indexOf('verifyClient:');
  const j = srv.indexOf("server.on('connection'");
  assert.ok(i > -1 && i < j, 'verifyClient skal staa paa WebSocketServer, foer connection-handleren');
  assert.match(srv.slice(i, i + 900), /godkend\(false, 401/, 'afvisningen skal svare 401');
});

// ── Mutations-verificeret: haandtryks-gaten paa terminate fjernet gav roed.
test('terminate kraever baade haandtryk OG at afsenderen er den aktive', () => {
  const i = srv.indexOf("msg.type === 'terminate'");
  assert.ok(i > -1, 'terminate-haandteringen findes');
  const blok = srv.slice(i, srv.indexOf('gracefulShutdown', i));
  assert.match(blok, /conn\.harHilst/, 'uden haandtryks-gaten kan en forbindelse der lige har ' +
    'vundet rollen som aktiv slukke browser-adgangen med én besked');
  assert.match(blok, /conn\.helloId !== conn\.extensionId/,
    'haandtrykkets id skal stemme med Origin — ellers er identiteten selvoplyst');
  assert.match(blok, /activeConnection\(\) !== conn/, 'og afsenderen skal vaere den aktive');
});

// ── Mutations-verificeret: `conn.extensionId = msg.extensionId` genindfoert gav roed.
test('haandtrykket kan ikke overskrive afsenderens identitet', () => {
  const i = srv.indexOf("msg.type === 'hello'");
  // Kommentarer strippes foerst — ellers matcher tjekket den kommentar der FORKLARER
  // fejlen i stedet for fejlen selv. (Det gjorde det, foerste gang jeg skrev den.)
  const blok = srv.slice(i, i + 1400).split('\n')
    .filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/conn\.extensionId = msg\.extensionId/.test(blok),
    'Origin er den eneste kilde Chrome selv saetter og afsenderen ikke kan forfalske. ' +
    'Lod vi haandtrykket overskrive den, var identiteten selvoplyst igen.');
  assert.match(blok, /conn\.helloId = /, 'beskedens id skal gemmes separat, saa de kan sammenlignes');
});
