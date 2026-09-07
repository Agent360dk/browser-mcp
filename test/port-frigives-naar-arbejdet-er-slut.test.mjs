/**
 * Naar arbejdet er slut, skal porten tilbage i puljen — ogsaa naar det var AGENTEN
 * der ryddede op.
 *
 * MAALT 7/9-2026: `tabs.onRemoved` sprang nedlukningen over hvis fanen var lukket af
 * agenten (`&& !lukketAfAgenten`). Undtagelsen var med vilje — en agent midt i et
 * forloeb maa ikke miste browseren. Men serverens EGEN instruks siger til hver agent:
 * "ALWAYS close tabs when done". Enhver velopdragen chat holdt derfor sin port indtil
 * 4-timers-tomgangen udloeb. Den dokumenterede god-praksis slog oprydningen ihjel.
 *
 * Rettelsen er ikke at fjerne undtagelsen, men at give den en frist: fem minutter uden
 * faner, saa slippes PORTEN — processen lever videre, saa chatten kan hente browseren
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

test('brugeren lukker den sidste fane: uaendret — serveren faar besked med det samme', async () => {
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
  assert.equal(ryd.length, 1, 'en ny fane aflyste ikke fristen — porten ville forsvinde under arbejdet');
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
    'sessionen var ikke arbejdende da beslutningen blev taget — testen maaler noget andet');
  assert.equal(terminates(u).length, 0, 'en arbejdende session fik sin port revet vaek');
});

test('serveren SLIPPER porten paa terminate — den lukker ikke processen ned', () => {
  const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');
  const i = srv.indexOf("msg.type === 'terminate'");
  assert.ok(i > -1, 'terminate-haandteringen findes');
  const blok = srv.slice(i, i + 2600);
  assert.match(blok, /frigivPort\(/, 'terminate slipper ikke porten');
  assert.ok(!/gracefulShutdown\(/.test(blok),
    'terminate lukker stadig processen ned — saa mister en faerdig chat browseren for altid');
});

// ── Den sti der faktisk sker i praksis ──────────────────────────────────────
//
// FUNDET AF REVIEW 7/9, EFTER at de seks tests ovenfor stod groenne: de beviser alle
// sammen alarm-MEKANIKKEN i en worker der stadig har sessionen i hukommelsen. Men en
// MV3-service-worker suspenderes efter ~30 sekunder uden arbejde, og fristen er paa
// FEM MINUTTER. Naar alarmen fyrer, er workeren derfor naesten altid frisk startet med
// et TOMT sessions-kort. Og `restoreSessions()` gendanner kun sessioner der har
// gyldige faner (`if (validTabIds.size > 0)`) — hvilket en tom session per definition
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
    'porten holdes til 4-timers-tomgangen efter en service-worker-genstart — frigivelsen er reelt doed');
});

test('genstartet worker, men sessionen har faaet faner igen: der sker ingenting', async () => {
  const u = friskWorkerMedGemtSession({ tabIds: [55], activeTabId: 55, groupId: 7, nummer: 1 });
  u.optager.ryd();
  await u.fyr('alarms.onAlarm', { name: `frigiv-${PORT}` });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(u.optager.antal('storage.local.get') >= 1,
    'lytteren naaede aldrig frem — nul terminates er saa intet bevis');
  assert.equal(terminates(u).length, 0, 'en arbejdende session fik sin port revet vaek');
});
