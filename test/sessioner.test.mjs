/**
 * Adfaerdstests for sessions-modellen — svaret paa "smelter chats sammen?".
 *
 * MAALT 22/8, og det er derfor filen findes: min egen live-maaling af det her
 * spoergsmaal var VAERDILOES. Jeg spurgte ti porte uden pid og uden faner, fik
 * "10/10 unikke sessioner" og kaldte det et bevis. Men adoptOrphanedSession
 * returnerer null paa foerste linje naar pid mangler, og springer enhver session
 * over der ikke ejer faner. Testen kunne matematisk ikke give andet end 10/10 —
 * ogsaa hvis hele gaten var pillet ud. En maaling der ikke kan fejle maaler intet.
 *
 * Her koeres den AEGTE adoptOrphanedSession mod stubbede chrome-API'er, med faner,
 * med pid, og med en donor der enten arbejder eller er doed.
 *
 * Hver test er mutations-verificeret: gaten braekket, testen set blive roed, gaten
 * sat tilbage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

function udklip(navn) {
  const start = kilde.search(new RegExp(`(async )?function ${navn}\\s*\\(`));
  assert.ok(start > -1, `${navn} findes ikke i background.js`);
  let dybde = 0;
  for (let j = kilde.indexOf('{', start); j < kilde.length; j++) {
    if (kilde[j] === '{') dybde++;
    else if (kilde[j] === '}' && --dybde === 0) return kilde.slice(start, j + 1);
  }
  throw new Error(`kunne ikke afgraense ${navn}`);
}

/**
 * @param sessioner  [[port, {pid, tabIds:[...], activeTabId}]]
 * @param levende    porte broen melder som stadig forbundet (mcpPorts)
 * @param doedeFaner fane-id'er chrome.tabs.get skal afvise
 */
async function adoptér({ port, pid, sessioner = [], levende = [], doedeFaner = [] }) {
  const sessions = new Map(
    sessioner.map(([p, s]) => [p, { ...s, tabIds: new Set(s.tabIds) }]),
  );
  const chrome = {
    storage: { local: { get: async () => ({ mcpPorts: levende }) } },
    tabs: { get: async (id) => { if (doedeFaner.includes(id)) throw new Error('no tab'); return { id }; } },
  };
  const src = [
    udklip('adoptOrphanedSession'),
    'return adoptOrphanedSession(port, pid);',
  ].join('\n');
  const fn = new Function('chrome', 'sessions', 'persistSessions', 'port', 'pid',
    `return (async () => { ${src} })()`);
  const res = await fn(chrome, sessions, () => {}, port, pid);
  return { resultat: res, sessions };
}

const S = (pid, faner) => ({ pid, tabIds: faner, activeTabId: faner[0] ?? null });

// ── Mutations-verificeret: `if (typeof pid !== 'number') return null;` fjernet gav roed.
//    FOERSTE UDGAVE AF DENNE TEST KUNNE IKKE FANGE DET: donoren havde pid 4242, saa
//    `session.pid !== pid` filtrerede den fra alligevel, og resultatet blev null med
//    ELLER uden gaten. Testen maalte altsaa ikke gaten. Nu er donorens pid ogsaa null,
//    saa gaten er det eneste der staar mellem en pid-loes server og en andens faner.
test('uden pid adopteres der ALDRIG — hellere en frisk session end en stjaalet', async () => {
  const medFremmedDonor = await adoptér({
    port: 9880, pid: undefined,
    sessioner: [[9877, S(4242, [11, 12])]],
  });
  assert.equal(medFremmedDonor.resultat, null, 'en gammel server uden pid maa ikke overtage faner');

  // Den afgoerende opstilling: donoren har heller ingen pid, og porten er doed.
  // Uden gaten ville `session.pid !== pid` vaere null !== undefined... altsaa sandt,
  // saa vi bruger null begge veje for at ramme praecis gaten og intet andet.
  const medPidLoesDonor = await adoptér({
    port: 9880, pid: undefined,
    sessioner: [[9877, { pid: undefined, tabIds: [11, 12], activeTabId: 11 }]],
    levende: [9880],
  });
  assert.equal(medPidLoesDonor.resultat, null,
    'uden pid-gaten ville to pid-loese sessioner adoptere hinandens faner paa stribe — ' +
    'det var praecis den fejl der gjorde at alt hed "Claude 1"');
});

// ── Mutations-verificeret: `if (session.pid !== pid) continue;` fjernet gav roed.
test('en ANDEN chats faner roeres ikke, selv om den ligner en forældreloes', async () => {
  const { resultat, sessions } = await adoptér({
    port: 9880, pid: 4242,
    sessioner: [[9877, S(9999, [11, 12])]],       // anden pid = anden Claude Code
  });
  assert.equal(resultat, null, 'det var netop den her fejl der gjorde at alt hed "Claude 1"');
  assert.ok(sessions.has(9877), 'donoren skal stadig findes');
});

// ── DEN AFGOERENDE. Mutations-verificeret: `if (levendePorte.has(...)) continue;`
//    fjernet gav roed. MAALT 21/8: uden den her linje fik fire samtidige sessioner
//    alle navnet "Claude 3", og de tre aeldste mistede deres faner.
test('samme pid, men donoren ARBEJDER stadig → haenderne vaek', async () => {
  const { resultat, sessions } = await adoptér({
    port: 9880, pid: 4242,
    sessioner: [[9877, S(4242, [11, 12])]],
    levende: [9877, 9880],                        // donorens port er stadig forbundet
  });
  assert.equal(resultat, null,
    'to chats fra samme Claude Code-proces har samme pid — pid alene er ikke identitet');
  assert.ok(sessions.has(9877), 'donoren maa ikke miste sin session');
  assert.equal(sessions.get(9877).tabIds.size, 2, 'og heller ikke sine faner');
});

// ── Det legitime tilfaelde. Mutations-verificeret: hele adoptionen fjernet gav roed.
test('samme pid, og donorens port er DOED → sessionen genfindes', async () => {
  const { resultat, sessions } = await adoptér({
    port: 9880, pid: 4242,
    sessioner: [[9877, S(4242, [11, 12])]],
    levende: [9880],                              // 9877 er vaek — serveren er genstartet
  });
  assert.ok(resultat, 'en genstartet server SKAL kunne genfinde sine egne faner');
  assert.ok(!sessions.has(9877), 'den doede port ryddes');
  assert.ok(sessions.has(9880), 'sessionen flytter med til den nye port');
  assert.equal(sessions.get(9880).tabIds.size, 2);
});

// ── Mutations-verificeret: `if (sessions.has(port) && ...tabIds.size) return null;`
//    fjernet gav roed.
test('en session der allerede EJER faner adopterer ikke oveni', async () => {
  const { resultat } = await adoptér({
    port: 9880, pid: 4242,
    sessioner: [[9880, S(4242, [21])], [9877, S(4242, [11, 12])]],
    levende: [9880],
  });
  assert.equal(resultat, null, 'kun en session der ejer INTET maa adoptere');
});

// ── Mutations-verificeret: `if (!alive.size)`-grenen fjernet gav roed.
test('en forældreloes hvis faner brugeren allerede har lukket, adopteres ikke', async () => {
  const { resultat, sessions } = await adoptér({
    port: 9880, pid: 4242,
    sessioner: [[9877, S(4242, [11, 12])]],
    levende: [9880],
    doedeFaner: [11, 12],
  });
  assert.equal(resultat, null, 'at adoptere en tom session ville maskere en aegte frisk start');
  assert.ok(!sessions.has(9877), 'den tomme session ryddes i stedet');
});

// ── Mutations-verificeret: alive-filtreringen fjernet gav roed.
test('kun de faner der stadig findes foelger med over', async () => {
  const { resultat } = await adoptér({
    port: 9880, pid: 4242,
    sessioner: [[9877, S(4242, [11, 12, 13])]],
    levende: [9880],
    doedeFaner: [12],
  });
  assert.deepEqual([...resultat.tabIds].sort(), [11, 13], 'en lukket fane maa ikke slaebes med');
});

test('den stoerste kandidat vinder naar flere er gyldige', async () => {
  const { resultat } = await adoptér({
    port: 9880, pid: 4242,
    sessioner: [[9877, S(4242, [11])], [9878, S(4242, [21, 22, 23])]],
    levende: [9880],
  });
  assert.equal(resultat.tabIds.size, 3, 'den med flest levende faner er den rigtige at genfinde');
});

// ── Fane-loftet. Mutations-verificeret: 20 -> 1 gav roed (allerede daekket i
//    tab-cap.test.mjs, gentages ikke her).
test('loftet matcher portspaendet — en session kan holde lige saa mange faner som der kan koere chats', () => {
  const loft = Number(kilde.match(/const MAX_TABS_PER_SESSION = (\d+);/)[1]);
  const porte = 9895 - 9876 + 1;
  assert.equal(loft, porte, `loftet (${loft}) skal matche antallet af porte (${porte})`);
});

// ── Mutations-verificeret: agentLukkedeFaner-saettet neutraliseret gav roed.
test('agentens eget close_tab draeber ikke sessionen', () => {
  // Erklaeringen skal findes med samme navn som brugen — omdoebes den ene, refererer
  // den anden til noget der ikke eksisterer, og vaernet er tavst vaek ved koersel.
  assert.match(kilde, /const agentLukkedeFaner = new Set\(\);/,
    'saettet skal erklaeres med praecis det navn brugsstederne refererer til');
  const i = kilde.indexOf("case 'close_tab'");
  assert.ok(i > -1, 'close_tab-handleren skal findes');
  const blok = kilde.slice(i, i + 700);
  assert.match(blok, /agentLukkedeFaner\.add\(/,
    'uden markeringen tolker onRemoved lukningen som at BRUGEREN lukkede fanen, ' +
    'og sessionen termineres midt i agentens eget arbejde');
  const j = kilde.indexOf('chrome.tabs.onRemoved');
  const lyt = kilde.slice(j, j + 900);
  assert.match(lyt, /agentLukkedeFaner\.(has|delete)\(/,
    'lytteren skal spoerge om det var agenten selv');
});

/**
 * getSession — pid'en SKAL stemples, ellers er hele adoptions-gaten uden virkning.
 * Uden stemplet er session.pid altid null, `session.pid !== pid` er altid sandt, og
 * en genstartet server kan aldrig genfinde sine egne faner. Fejlen ville vise sig som
 * "mine faner forsvandt efter en genstart" — ikke som noget der ligner en pid-fejl.
 */
function rejsGetSession() {
  const sessions = new Map();
  const src = [
    "const SESSION_COLORS = ['blue','green','yellow','red'];",
    udklip('getSession'),
    'return getSession;',
  ].join('\n');
  const lav = new Function('sessions', `${src}`);
  return { getSession: lav(sessions), sessions };
}

// ── Mutations-verificeret: stemplingen fjernet gav roed.
test('pid stemples paa sessionen — ellers virker adoptions-gaten aldrig', () => {
  const { getSession } = rejsGetSession();
  const s1 = getSession(9877, 4242);
  assert.equal(s1.pid, 4242, 'pid skal saettes ved oprettelsen');

  // Foerste kald kan komme uden pid (gammel server), naeste med. Den skal fanges op.
  const { getSession: g2 } = rejsGetSession();
  const uden = g2(9878, undefined);
  assert.equal(uden.pid, null, 'ingen pid endnu');
  const med = g2(9878, 7777);
  assert.equal(med.pid, 7777,
    'en session der faar sin pid sent skal stadig kunne genfindes efter en genstart');
});

// ── Mutations-verificeret: `sessions.size + 1` -> `1` gav roed.
test('hver ny port faar sit eget navn og sin egen farve', () => {
  const { getSession } = rejsGetSession();
  const navne = [9877, 9878, 9879].map((p) => getSession(p, 4242).label);
  assert.equal(new Set(navne).size, 3, 'to chats maa aldrig hedde det samme — ' +
    'det var netop symptomet: "alt hedder Claude 1"');
  assert.deepEqual(navne, ['Claude 1', 'Claude 2', 'Claude 3']);
});

// ── TO CHATS MAA ALDRIG HEDDE DET SAMME ───────────────────────────────────────
// MAALT 22/8, og det er en TREDJE mekanisme bag "alt hedder Claude 1" — uafhaengig
// af de to andre (to udvidelser om samme socket, og adoption uden live-port-gate).
// Navnet blev sat til `Claude ${sessions.size + 1}`. Lukker en chat, falder taellingen,
// og den naeste chat genbruger et nummer der allerede er i brug:
//     chat 1, 2, 3 aabner  →  chat 1 lukker  →  size = 2  →  ny chat faar "Claude 3"
// To chats deler saa baade navn og farve, og brugeren kan ikke se hvilken fanegruppe
// der hoerer til hvad. Den her rammer ogsaa naar alt andet er rigtigt.

// ── Mutations-verificeret: `while (brugte.has(nummer)) nummer++` fjernet gav roed.
test('en lukket chats plads genbruges — men aldrig et navn der er i brug', () => {
  const { getSession, sessions } = rejsGetSession();
  [9877, 9878, 9879].forEach((p) => getSession(p, 1));
  sessions.delete(9877);                       // chat 1 lukker

  const ny = getSession(9880, 1);
  assert.equal(ny.label, 'Claude 1', 'den frigivne plads skal genbruges, ikke et nyt hoejt tal');

  const navne = [...sessions.values()].map((s) => s.label);
  assert.equal(new Set(navne).size, navne.length,
    `to chats deler navn: ${navne.join(', ')} — brugeren kan ikke se hvilken fanegruppe der er hvis`);
});

// ── Mutations-verificeret: farven sat tilbage til sessions.size gav roed.
test('to samtidige sessioner kan heller ikke faa samme farve', () => {
  const { getSession, sessions } = rejsGetSession();
  [9877, 9878, 9879, 9880].forEach((p) => getSession(p, 1));
  sessions.delete(9878);
  getSession(9881, 1);

  const farver = [...sessions.values()].map((s) => s.color);
  assert.equal(new Set(farver).size, farver.length,
    `to fanegrupper har samme farve: ${farver.join(', ')}`);
});

test('numrene bliver smaa og laesbare, ogsaa efter mange aabninger og lukninger', () => {
  const { getSession, sessions } = rejsGetSession();
  for (let i = 0; i < 12; i++) {
    getSession(9876 + i, 1);
    if (i % 2 === 1) sessions.delete(9876 + i - 1);
  }
  const numre = [...sessions.values()].map((s) => s.nummer);
  assert.ok(Math.max(...numre) <= 12, `hoejeste nummer er ${Math.max(...numre)} — pladser genbruges ikke`);
  assert.equal(new Set(numre).size, numre.length, 'og ingen dubletter');
});
