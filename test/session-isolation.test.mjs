#!/usr/bin/env node
/**
 * Session-isolation - regressionstest for browser-mcp
 *
 * BAGGRUND (16/8-2026)
 * Parallelle Claude-chats endte alle sammen som "Claude 1", og kun én kunne
 * bruge browseren ad gangen. Aarsagen laa i adoptOrphanedSession(): den
 * adopterede den STOERSTE session uanset hvem den tilhoerte. En helt ny chat
 * ejer ingenting - saa den stjal den aktive chats faner OG dens identitet,
 * hvorefter donorens port blev slettet. Donoren adopterede saa tilbage ved
 * naeste kald. To chats byttede den samme ene session i det uendelige.
 *
 * Rettelsen: adoptér kun fra en session med samme pid (Claude Code-processen).
 *
 * Testen laeser den RIGTIGE funktion ud af extension/background.js og koerer
 * den mod stubbede chrome-API'er. Den tester altsaa kildekoden, ikke en kopi -
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

let sessions, levendeFaner, gemtKald, levendePorte;

function byg() {
  const src = udtraek('adoptOrphanedSession');
  const fabrik = new Function(
    'sessions', 'chrome', 'persistSessions',
    `${src}; return adoptOrphanedSession;`,
  );
  return fabrik(
    sessions,
    {
      tabs: { get: async (id) => { if (!levendeFaner.has(id)) throw new Error('vaek'); return { id }; } },
      // mcpPorts = de porte broen har forbindelse til lige nu. Den liste er anden
      // halvdel af gaten: er donorens port stadig i live, er det en ANDEN chat der
      // arbejder - ikke en genstartet server.
      storage: { local: { get: async (d) => ({ ...d, mcpPorts: [...levendePorte] }) } },
    },
    () => { gemtKald++; },
  );
}

function nulstil() {
  sessions = new Map();
  levendeFaner = new Set();
  levendePorte = new Set();
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


// ── ANDEN HALVDEL AF GATEN: donorens port skal vaere doed ────────────────────
//
// MAALT 21/8 med seks samtidige sessioner: foraelder-processen er IKKE en unik
// identitet. Starter en klient flere MCP-servere fra den samme proces, deler de
// pid - og saa adopterede de hinandens faner paa stribe. Alle fik navnet
// "Claude 3", de aeldste mistede deres fane, og en session kunne skifte til en
// andens. Altsaa "alt hedder Claude 1", med kun én udvidelse indlaest.
//
// Pid'en siger "samme klient". Den doede port siger "og den gamle er faktisk vaek".
// Der skal to ting til.

await test('en donor hvis port stadig er forbundet roeres ikke', async () => {
  sessions.set(9876, session([1, 2], 4242, 'Claude 1'));
  levendePorte.add(9876);                     // den gamle chat arbejder lige nu
  const r = await byg()(9877, 4242);          // samme pid, ny port
  skalVaere(r, null, 'adoptionen burde vaere afvist');
  skalVaere(sessions.has(9876), true, 'donoren skal stadig findes');
  skalVaere([...sessions.get(9876).tabIds], [1, 2], 'donoren skal beholde sine faner');
});

await test('er donorens port vaek, adopteres der som foer', async () => {
  sessions.set(9876, session([1, 2], 4242, 'Claude 1'));
  levendePorte.add(9877);                     // kun den NYE port er forbundet
  const r = await byg()(9877, 4242);
  skalVaere(r !== null, true, 'en genstartet server skal genfinde sine faner');
  skalVaere([...sessions.get(9877).tabIds], [1, 2], 'fanerne skal foelge med');
  skalVaere(sessions.has(9876), false, 'den gamle port skal vaere ryddet');
});

await test('flere levende sessioner med samme pid roerer ikke hinanden', async () => {
  // Praecis situationen fra maalingen: seks servere, samme foraelder, alle i live.
  for (let i = 0; i < 6; i++) {
    sessions.set(9876 + i, session([10 + i], 4242, `Claude ${i + 1}`));
    levendePorte.add(9876 + i);
  }
  const r = await byg()(9890, 4242);          // en syvende starter op
  skalVaere(r, null, 'den syvende maa ikke stjaele fra nogen af de seks');
  for (let i = 0; i < 6; i++) {
    skalVaere([...sessions.get(9876 + i).tabIds], [10 + i], `session ${i} skal beholde sin fane`);
  }
});

await test('en doed donor blandt levende soeskende er den eneste der adopteres fra', async () => {
  sessions.set(9876, session([1], 4242, 'Claude 1'));
  sessions.set(9877, session([2], 4242, 'Claude 2'));
  sessions.set(9878, session([3], 4242, 'Claude 3'));
  levendePorte.add(9876);
  levendePorte.add(9878);                     // 9877 er den doede
  const r = await byg()(9890, 4242);
  skalVaere(r !== null, true, 'den doede donor skulle vaere adopteret');
  skalVaere([...sessions.get(9890).tabIds], [2], 'kun den doede donors fane maa foelge med');
  skalVaere(sessions.has(9876) && sessions.has(9878), true, 'de levende skal vaere uroerte');
});

console.log(`\n${bestaaet} bestaaet, ${fejlet} fejlet\n`);
process.exit(fejlet ? 1 : 0);
