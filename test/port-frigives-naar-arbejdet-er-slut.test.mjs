/**
 * Naar arbejdet er slut, skal porten tilbage i puljen - ogsaa naar det var AGENTEN
 * der ryddede op.
 *
 * MAALT 7/9-2026: `tabs.onRemoved` sprang nedlukningen over hvis fanen var lukket af
 * agenten (`&& !lukketAfAgenten`). Undtagelsen var med vilje - en agent midt i et
 * forloeb maa ikke miste browseren. Men serverens EGEN instruks siger til hver agent:
 * "ALWAYS close tabs when done". Enhver velopdragen chat holdt derfor sin port indtil
 * 4-timers-tomgangen udloeb. Den dokumenterede god-praksis slog oprydningen ihjel.
 *
 * Rettelsen er ikke at fjerne undtagelsen, men at give den en frist: fem minutter uden
 * faner, saa slippes PORTEN - processen lever videre, saa chatten kan hente browseren
 * tilbage naar som helst.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const PORT = 9876;

function medSession(tabId) {
  const u = indlaesUdvidelse();
  const get = u.hent('getSession');
  const s = get(PORT);
  s.tabIds.add(tabId);
  u.optager.ryd();
  return { u, s };
}

const terminates = (u) =>
  u.optager.til('runtime.sendMessage').filter((b) => JSON.stringify(b.args).includes('terminate_mcp_session'));

test('agenten lukker sin sidste fane: ingen oejeblikkelig nedlukning, men en frist paa 5 min', async () => {
  const { u } = medSession(42);
  u.hent('agentLukkedeFaner').add(42);
  await u.fyr('tabs.onRemoved', 42);

  assert.equal(terminates(u).length, 0, 'agentens egen oprydning maa ikke rive browseren vaek med det samme');
  const alarmer = u.optager.til('alarms.create').filter((b) => String(b.args[0]) === `frigiv-${PORT}`);
  assert.equal(alarmer.length, 1, 'der blev ikke sat nogen frist paa porten');
  assert.equal(alarmer[0].args[1].delayInMinutes, 5, 'fristen er ikke fem minutter');
});

test('brugeren lukker den sidste fane: uaendret - serveren faar besked med det samme', async () => {
  const { u } = medSession(43);
  await u.fyr('tabs.onRemoved', 43);
  assert.equal(terminates(u).length, 1, 'brugerens lukning skal stadig virke med det samme');
});

test('faar sessionen en ny fane inden fristen, aflyses frigivelsen', async () => {
  const { u } = medSession(44);
  u.hent('agentLukkedeFaner').add(44);
  await u.fyr('tabs.onRemoved', 44);
  u.optager.ryd();

  await u.hent('addTabToSession')(PORT, 77);
  const ryd = u.optager.til('alarms.clear').filter((b) => String(b.args[0]) === `frigiv-${PORT}`);
  assert.equal(ryd.length, 1, 'en ny fane aflyste ikke fristen - porten ville forsvinde under arbejdet');
});

test('fyrer fristen mens sessionen stadig er tom, bedes serveren slippe porten', async () => {
  const { u, s } = medSession(45);
  s.tabIds.clear();
  u.optager.ryd();
  await u.fyr('alarms.onAlarm', { name: `frigiv-${PORT}` });
  await new Promise((r) => setTimeout(r, 20));   // lytteren arbejder asynkront
  assert.equal(terminates(u).length, 1, 'fristen udloeb paa en tom session uden at porten blev sluppet');
});

test('fyrer fristen mens sessionen arbejder igen, sker der ingenting', async () => {
  const { u, s } = medSession(46);
  s.tabIds.add(99);
  u.optager.ryd();
  await u.fyr('alarms.onAlarm', { name: `frigiv-${PORT}` });
  await new Promise((r) => setTimeout(r, 20));
  // Positiv kontrol (review 7/9): nul terminates er kun et bevis hvis lytteren FAKTISK
  // traf en beslutning. Uden den her kunne testen bestaa fordi sessionen var vaek, fordi
  // en afvisning blev slugt af .catch, eller fordi kaeden slet ikke naaede frem.
  assert.ok(u.hent('sessions').get(PORT)?.tabIds.size > 0,
    'sessionen var ikke arbejdende da beslutningen blev taget - testen maaler noget andet');
  assert.equal(terminates(u).length, 0, 'en arbejdende session fik sin port revet vaek');
});

test('serveren SLIPPER porten paa terminate - den lukker ikke processen ned', () => {
  const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');
  const i = srv.indexOf("msg.type === 'terminate'");
  assert.ok(i > -1, 'terminate-haandteringen findes');
  const blok = srv.slice(i, i + 2600);
  assert.match(blok, /frigivPort\(/, 'terminate slipper ikke porten');
  assert.ok(!/gracefulShutdown\(/.test(blok),
    'terminate lukker stadig processen ned - saa mister en faerdig chat browseren for altid');
});

// ── Den sti der faktisk sker i praksis ──────────────────────────────────────
//
// FUNDET AF REVIEW 7/9, EFTER at de seks tests ovenfor stod groenne: de beviser alle
// sammen alarm-MEKANIKKEN i en worker der stadig har sessionen i hukommelsen. Men en
// MV3-service-worker suspenderes efter ~30 sekunder uden arbejde, og fristen er paa
// FEM MINUTTER. Naar alarmen fyrer, er workeren derfor naesten altid frisk startet med
// et TOMT sessions-kort. Og `restoreSessions()` gendanner kun sessioner der har
// gyldige faner (`if (validTabIds.size > 0)`) - hvilket en tom session per definition
// ikke har. Alarmen fandt derfor ingen session, returnerede, og porten blev holdt
// indtil 4-timers-tomgangen. Altsaa praecis den fejl frigivelsen skulle fjerne.
//
// De to tests herunder daekker den sti. Uden dem kan feature'n vaere doed i produktion
// mens hele suiten er groen.

function friskWorkerMedGemtSession(gemt) {
  return indlaesUdvidelse({ svar: { 'storage.local.get': { sessions: { [String(PORT)]: gemt } } } });
}

test('service-workeren er genstartet naar fristen fyrer: porten slippes alligevel', async () => {
  const u = friskWorkerMedGemtSession({ tabIds: [], activeTabId: null, groupId: 7, nummer: 1 });
  assert.equal(u.hent('sessions').size, 0, 'forudsaetningen holder ikke: en frisk worker har et tomt kort');
  u.optager.ryd();
  await u.fyr('alarms.onAlarm', { name: `frigiv-${PORT}` });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(terminates(u).length, 1,
    'porten holdes til 4-timers-tomgangen efter en service-worker-genstart - frigivelsen er reelt doed');
});

test('genstartet worker, men sessionen har faaet faner igen: der sker ingenting', async () => {
  const u = friskWorkerMedGemtSession({ tabIds: [55], activeTabId: 55, groupId: 7, nummer: 1 });
  u.optager.ryd();
  await u.fyr('alarms.onAlarm', { name: `frigiv-${PORT}` });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(u.optager.antal('storage.local.get') >= 1,
    'lytteren naaede aldrig frem - nul terminates er saa intet bevis');
  assert.equal(terminates(u).length, 0, 'en arbejdende session fik sin port revet vaek');
});

// ── Race-vinduet mellem "sessionen er tom" og selve frigivelsen ─────────────
//
// FUNDET AF REVIEW 7/9. Kaeden fra beslutning til handling er lang: alarm-tjek
// (0 faner) -> sendMessage -> offscreen sender terminate + lukker WS -> ws.onclose
// -> session_disconnect -> releaseSession(port) -> chrome.tabs.remove() paa ALT i
// sessionen. `releaseSession` gen-tjekkede ikke tomhed. Aabnede agenten en fane i
// de ~50 ms undervejs, blev DEN fane lukket. Vinduet er lille, men det er praecis
// "agenten holder pause og genoptager"-scenariet frigivelsen er bygget til.
test('en fane der dukker op midt i en frivillig frigivelse bliver IKKE lukket', async () => {
  const { u, s } = medSession(70);
  s.tabIds.clear();
  u.optager.ryd();

  // Fristen fyrer paa en tom session -> terminate sendes
  await u.fyr('alarms.onAlarm', { name: `frigiv-${PORT}` });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(terminates(u).length, 1, 'forudsaetningen holder ikke: der blev ikke bedt om frigivelse');

  // ... og imens naaede agenten at aabne en ny fane
  await u.hent('addTabToSession')(PORT, 71);
  u.optager.ryd();

  // Nu lander WS-lukningen og udloeser oprydningen
  await u.fyr('runtime.onMessage', { type: 'session_disconnect', port: PORT }, {}, () => {});
  await new Promise((r) => setTimeout(r, 30));

  const lukkede = u.optager.til('tabs.remove').map((b) => b.args[0]);
  assert.ok(!lukkede.includes(71),
    'agentens nye fane blev lukket af en frigivelse der var besluttet foer den fandtes');
});

test('en UVENTET afbrydelse rydder stadig op - faner lukkes', async () => {
  // Modstykket til testen ovenfor. Skelnen mellem frivillig og uventet frigivelse maa
  // ikke goere den aegte oprydning tavs: doer chatten, skal dens faner stadig lukkes.
  const { u } = medSession(80);
  u.optager.ryd();
  await u.fyr('runtime.onMessage', { type: 'session_disconnect', port: PORT }, {}, () => {});
  await new Promise((r) => setTimeout(r, 30));
  const lukkede = u.optager.til('tabs.remove').map((b) => b.args[0]);
  assert.deepEqual(lukkede, [80], 'en doed chats faner blev efterladt aabne');
});

// ── #12: forældede frigiv-alarmer må ikke overleve portgenbrug ──────────────
test('en session der slippes rydder sin egen frist', async () => {
  const { u, s } = medSession(90);
  s.tabIds.clear();
  await u.fyr('alarms.onAlarm', { name: `frigiv-${PORT}` });   // saetter frivilligtFrigivet
  await new Promise((r) => setTimeout(r, 20));
  u.optager.ryd();
  await u.fyr('runtime.onMessage', { type: 'session_disconnect', port: PORT }, {}, () => {});
  await new Promise((r) => setTimeout(r, 20));
  const ryd = u.optager.til('alarms.clear').filter((b) => String(b.args[0]) === `frigiv-${PORT}`);
  assert.equal(ryd.length, 1, 'fristen blev efterladt og kan fyre mod den naeste chat der tager porten');
});

test('ogsaa en chat der bare DOER rydder sin frist', async () => {
  // Modstykket til testen ovenfor: dér blev porten sluppet frivilligt. Her forsvinder
  // chatten uden varsel, hvilket er praecis den vej hvor en frist ellers ville blive
  // efterladt - og senere fyre mod den naeste chat der tager porten.
  const { u } = medSession(91);
  u.optager.ryd();
  await u.fyr('runtime.onMessage', { type: 'session_disconnect', port: PORT }, {}, () => {});
  await new Promise((r) => setTimeout(r, 20));
  const ryd = u.optager.til('alarms.clear').filter((b) => String(b.args[0]) === `frigiv-${PORT}`);
  assert.equal(ryd.length, 1, 'fristen overlevede chatten og kan ramme den naeste der tager porten');
});

// ── #13: faner maa ikke strande tavst hvis lukningen fejler ─────────────────
test('fejler en fane-lukning under oprydning, beholdes sessionen i stedet for at forsvinde', async () => {
  const u = indlaesUdvidelse({ svar: { 'tabs.remove': new Error('kan ikke lukke fanen') } });
  const s = u.hent('getSession')(PORT);
  s.tabIds.add(95);
  u.optager.ryd();
  await u.fyr('runtime.onMessage', { type: 'session_disconnect', port: PORT }, {}, () => {});
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(u.hent('sessions').has(PORT),
    'sessionen blev slettet mens dens fane stadig var aaben - fanen ligger nu i en gruppe ingen ejer');
});

// ── #15: brugerens lukning naar baggrundsprocessen sover ────────────────────
//
// `tabs.onRemoved` loeb `sessions` SYNKRONT. Vaekker eventet en suspenderet
// MV3-service-worker, er kortet tomt, loekken koerer nul gange - og hverken den
// oejeblikkelige nedlukning (brugerens lukning) eller 5-minutters-fristen bliver sat.
// Porten holdes saa til 4-timers-tomgangen. Det er halvdelen af hele frigivelsens
// praemis, og den halvdel virkede kun naar workeren tilfaeldigvis var vaagen.
//
// Faelden: `restoreSessions()` kan ikke bruges her - den dropper sessioner uden
// GYLDIGE faner, og fanen vi lige har mistet er netop den der goer sessionen ugyldig.
function friskWorkerMedLager(gemt) {
  return indlaesUdvidelse({ svar: { 'storage.local.get': { sessions: { [String(PORT)]: gemt } } } });
}

test('brugeren lukker sidste fane paa en sovende worker: serveren faar stadig besked', async () => {
  const u = friskWorkerMedLager({ tabIds: [77], activeTabId: 77, groupId: 3, nummer: 1, color: 'blue', label: 'Claude 1' });
  assert.equal(u.hent('sessions').size, 0, 'forudsaetningen holder ikke: kortet skal vaere tomt');
  u.optager.ryd();
  await u.fyr('tabs.onRemoved', 77);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(terminates(u).length, 1,
    'porten holdes til 4-timers-tomgangen fordi workeren sov da brugeren lukkede fanen');
});

test('agenten lukker sidste fane paa en sovende worker: fristen saettes stadig', async () => {
  const u = friskWorkerMedLager({ tabIds: [78], activeTabId: 78, groupId: 3, nummer: 1, color: 'blue', label: 'Claude 1' });
  u.hent('agentLukkedeFaner').add(78);
  u.optager.ryd();
  await u.fyr('tabs.onRemoved', 78);
  await new Promise((r) => setTimeout(r, 40));
  const alarmer = u.optager.til('alarms.create').filter((b) => String(b.args[0]) === `frigiv-${PORT}`);
  assert.equal(alarmer.length, 1, 'fristen blev aldrig sat - porten frigives aldrig');
});
