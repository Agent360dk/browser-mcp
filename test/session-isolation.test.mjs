#!/usr/bin/env node
/**
 * Session-isolation — regressionstest for browser-mcp
 *
 * BAGGRUND (16/8-2026)
 * Parallelle Claude-chats endte alle sammen som "Claude 1", og kun én kunne
 * bruge browseren ad gangen. Aarsagen laa i adoptOrphanedSession(): den
 * adopterede den STOERSTE session uanset hvem den tilhoerte. En helt ny chat
 * ejer ingenting — saa den stjal den aktive chats faner OG dens identitet,
 * hvorefter donorens port blev slettet. Donoren adopterede saa tilbage ved
 * naeste kald. To chats byttede den samme ene session i det uendelige.
 *
 * Rettelsen: adoptér kun fra en session med samme pid (Claude Code-processen).
 *
 * Testen laeser den RIGTIGE funktion ud af extension/background.js og koerer
 * den mod stubbede chrome-API'er. Den tester altsaa kildekoden, ikke en kopi —
 * hvis nogen fjerner pid-gaten igen, fejler den her.
 *
 * Kør:  node test/session-isolation.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = join(dirname(fileURLToPath(import.meta.url)), '..');
const kilde = readFileSync(join(rod, 'extension/background.js'), 'utf8');

// ── Hent den rigtige funktion ud af kilden ──────────────────────────────────
function udtraek(navn) {
  const start = kilde.indexOf(`async function ${navn}(`);
  if (start === -1) throw new Error(`${navn}() findes ikke i background.js`);
  let dybde = 0, i = kilde.indexOf('{', start);
  for (; i < kilde.length; i++) {
    if (kilde[i] === '{') dybde++;
    else if (kilde[i] === '}' && --dybde === 0) break;
  }
  return kilde.slice(start, i + 1);
}

let sessions, levendeFaner, gemtKald;

function byg() {
  const src = udtraek('adoptOrphanedSession');
  const fabrik = new Function(
    'sessions', 'chrome', 'persistSessions',
    `${src}; return adoptOrphanedSession;`,
  );
  return fabrik(
    sessions,
    { tabs: { get: async (id) => { if (!levendeFaner.has(id)) throw new Error('vaek'); return { id }; } } },
    () => { gemtKald++; },
  );
}

function nulstil() {
  sessions = new Map();
  levendeFaner = new Set();
  gemtKald = 0;
}

function session(faner, pid, label) {
  faner.forEach((f) => levendeFaner.add(f));
  return { tabIds: new Set(faner), activeTabId: faner[0] ?? null, groupId: null,
           color: 'blue', label, pid };
}

// ── Testramme ───────────────────────────────────────────────────────────────
let bestaaet = 0, fejlet = 0;
async function test(navn, fn) {
  nulstil();
  try { await fn(); console.log(`  ok  ${navn}`); bestaaet++; }
  catch (e) { console.log(`  FEJL ${navn}\n       ${e.message}`); fejlet++; }
}
function skalVaere(faktisk, forventet, hvad) {
  const a = JSON.stringify(faktisk), b = JSON.stringify(forventet);
  if (a !== b) throw new Error(`${hvad}: fik ${a}, forventede ${b}`);
}

console.log('\nsession-isolation - adoptOrphanedSession()\n');

// ── DEN FEJL DER FAKTISK SKETE ──────────────────────────────────────────────
await test('to forskellige chats stjaeler IKKE hinandens session', async () => {
  const adopter = byg();
  sessions.set(9876, session([101, 102], 4242, 'Claude 1'));   // chat A, arbejder
  const r = await adopter(9877, 9999);                          // chat B, ny, anden proces
  skalVaere(r, null, 'chat B maa ikke adoptere');
  skalVaere(sessions.has(9876), true, 'chat A skal stadig eksistere');
  skalVaere(sessions.get(9876).label, 'Claude 1', 'chat A beholder sit label');
});

await test('donorens port slettes ikke naar adoption afvises', async () => {
  const adopter = byg();
  sessions.set(9876, session([101], 4242, 'Claude 1'));
  await adopter(9877, 9999);
  skalVaere([...sessions.keys()], [9876], 'kun donoren i kortet');
  skalVaere(gemtKald, 0, 'ingen unoedig persistering');
});

// ── DET AEGTE BEHOV: samme chat, genstartet server ──────────────────────────
await test('samme chat paa ny port genfinder sine egne faner', async () => {
  const adopter = byg();
  sessions.set(9876, session([101, 102], 4242, 'Claude 1'));   // gammel port
  const r = await adopter(9880, 4242);                          // samme proces, ny port
  if (!r) throw new Error('samme chat SKAL adoptere');
  skalVaere([...r.tabIds], [101, 102], 'fanerne foelger med');
  skalVaere(r.label, 'Claude 1', 'identiteten foelger med');
  skalVaere(sessions.has(9876), false, 'den gamle port ryddes');
});

// ── AFLEDTE KRAV ────────────────────────────────────────────────────────────
await test('uden pid adopteres der aldrig', async () => {
  const adopter = byg();
  sessions.set(9876, session([101], 4242, 'Claude 1'));
  skalVaere(await adopter(9877, undefined), null, 'manglende pid = ingen adoption');
});

await test('en session der ejer faner adopterer ikke', async () => {
  const adopter = byg();
  sessions.set(9876, session([101], 4242, 'Claude 1'));
  sessions.set(9877, session([201], 4242, 'Claude 2'));         // samme pid, men ejer noget
  skalVaere(await adopter(9877, 4242), null, 'ejer allerede faner');
});

await test('donor med lukkede faner ryddes i stedet for at adopteres', async () => {
  const adopter = byg();
  const s = session([101, 102], 4242, 'Claude 1');
  levendeFaner.delete(101); levendeFaner.delete(102);           // brugeren lukkede dem
  sessions.set(9876, s);
  skalVaere(await adopter(9880, 4242), null, 'intet at adoptere');
  skalVaere(sessions.has(9876), false, 'doed session ryddes');
});

await test('kun delvist doede faner: de levende foelger med', async () => {
  const adopter = byg();
  sessions.set(9876, session([101, 102], 4242, 'Claude 1'));
  levendeFaner.delete(102);
  const r = await adopter(9880, 4242);
  skalVaere([...r.tabIds], [101], 'kun den levende fane');
});

await test('tre chats: kun den med matchende pid roeres', async () => {
  const adopter = byg();
  sessions.set(9876, session([101, 102, 103], 1111, 'Claude 1')); // stoerst, anden proces
  sessions.set(9877, session([201], 4242, 'Claude 2'));           // vores egen, mindre
  const r = await adopter(9880, 4242);
  skalVaere([...r.tabIds], [201], 'stoerrelse slaar ikke ejerskab');
  skalVaere(sessions.has(9876), true, 'den fremmede chat er uroert');
});

console.log(`\n${bestaaet} bestaaet, ${fejlet} fejlet\n`);
process.exit(fejlet ? 1 : 0);
