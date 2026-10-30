/**
 * #91 (1.34): agenten kan give sin fanegruppe et navn (og en farve), og navnet holder ved en genstart.
 *
 * Foer 1.34 fik gruppen titlen `Claude N`, da sessionen blev oprettet, og igen ved hver gendannelse efter en genstart af service
 * workeren (restoreSessions byggede altid `Claude ${nummer}`). En omdoebning i Chrome holdt derfor ikke, og intet vaerktoej kunne
 * aendre navnet. Med flere agenter i gang kunne brugeren ikke se, hvilken gruppe der hoerte til hvilken opgave.
 * Nu: browser_set_group_label({ label, color? }) saetter sessionens navn og farve, opdaterer gruppen, hvis den findes, og gemmer
 * et maerke, saa gendannelsen beholder navnet. Et tomt navn giver `Claude N` tilbage. Standardnavne gendannes som foer (22/8).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele(groupId = 5) {
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': (id) => ({ id, url: `https://fane${id}.example`, windowId: 1 }),
    'tabs.query': [], 'tabs.group': 5, 'tabGroups.update': {}, 'tabGroups.get': { id: 5 },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId, nummer: 1, label: 'Claude 1', color: 'blue', windowId: 1 });
  return u;
}
const saet = (u, params) => u.hent('dispatch')(9876, 'set_group_label', params);

test('navnet og farven saettes paa sessionen og paa gruppen i Chrome', async () => {
  const u = sele();
  const r = await saet(u, { label: 'SARS tax - Scarlett', color: 'green' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.label, 'SARS tax - Scarlett');
  const s = u.hent('sessions').get(9876);
  assert.equal(s.label, 'SARS tax - Scarlett');
  assert.equal(s.color, 'green');
  const k = u.optager.sidste('tabGroups.update');
  assert.ok(k, 'gruppen i Chrome blev ikke opdateret');
  assert.equal(k.args[0], 5);
  assert.equal(k.args[1].title, 'SARS tax - Scarlett');
  assert.equal(k.args[1].color, 'green');
});

test('navnet renses for styretegn, trimmes og afkortes til 30 tegn', async () => {
  const u = sele();
  const r = await saet(u, { label: '  Opgave\u0007 med\nlinjeskift og et meget langt navn der fortsaetter  ' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!/[\u0000-\u001f\u007f]/.test(r.label), `styretegn i navnet: ${JSON.stringify(r.label)}`);
  assert.ok(r.label.length <= 30, `navnet er ${r.label.length} tegn`);
  assert.equal(r.label, r.label.trim());
  assert.ok(r.label.startsWith('Opgave'));
});

test('en ukendt farve afvises, og intet aendres', async () => {
  const u = sele();
  const r = await saet(u, { label: 'X', color: 'magenta' });
  assert.equal(r.error, 'bad-color', JSON.stringify(r));
  assert.ok(Array.from(r.colors).includes('green'), 'svaret naevner ikke de farver Chrome kender');
  const s = u.hent('sessions').get(9876);
  assert.equal(s.label, 'Claude 1');
  assert.equal(s.color, 'blue');
  assert.equal(u.optager.sidste('tabGroups.update'), undefined, 'gruppen blev opdateret trods afvisningen');
});

test('et tomt navn giver standardnavnet og -farven tilbage', async () => {
  const u = sele();
  await saet(u, { label: 'Min opgave', color: 'red' });
  const r = await saet(u, { label: '' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = u.hent('sessions').get(9876);
  assert.equal(s.label, 'Claude 1');
  assert.equal(s.color, 'blue');
  assert.equal(s.egetNavn, false);
});

test('uden en gruppe endnu gemmes navnet og bruges, naar gruppen oprettes', async () => {
  const u = sele(null);
  const r = await saet(u, { label: 'Fakturaer' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.applied, false, 'svaret siger at gruppen blev opdateret, foer den findes');
  assert.equal(u.hent('sessions').get(9876).label, 'Fakturaer');
});

test('et eget navn holder ved en genstart - et standardnavn gendannes som foer', async () => {
  const u = sele();
  await saet(u, { label: 'Fakturaer', color: 'cyan' });
  u.hent('persistSessions')();
  const gemt = u.optager.sidste('storage.local.set').args[0].sessions['9876'];
  assert.equal(gemt.egetNavn, true, 'maerket for et eget navn blev ikke gemt');
  const v = indlaesUdvidelse({ svar: { 'storage.local.get': { sessions: { 9876: gemt, 9877: { ...gemt, label: 'Gammelt', egetNavn: false, nummer: 1 } } }, 'tabs.get': (id) => ({ id, url: 'https://x' }) } });
  await v.hent('restoreSessions')();
  assert.equal(v.hent('sessions').get(9876).label, 'Fakturaer', 'det egne navn blev skrevet om ved gendannelsen');
  assert.equal(v.hent('sessions').get(9876).color, 'cyan');
  assert.match(v.hent('sessions').get(9877).label, /^Claude \d+$/, 'et standardnavn blev gendannet ordret fra lageret (22/8-fejlen)');
});

// R186 (Opus): navnet holdt kun, fordi prøven selv gemte og kun genstartede én gang. Her gemmer vaerktoejet selv, en fane lukkes,
// mens workeren sover (raa hydrering), og der genstartes to gange.
function husk(lager) {
  return {
    'storage.local.get': (arg) => Object.fromEntries(Object.entries(arg || {}).map(([k, v]) => [k, k in lager ? structuredClone(lager[k]) : v])),
    'storage.local.set': (o) => { Object.assign(lager, structuredClone(o)); },
    'tabs.get': (id) => ({ id, url: `https://fane${id}.example`, windowId: 1 }), 'tabs.query': [], 'tabs.group': 5, 'tabGroups.update': {},
  };
}
test('navnet holder over to genstarter og over en fane, mennesket lukker mens workeren sover', async () => {
  const lager = {};
  const u = indlaesUdvidelse({ svar: husk(lager) });
  u.hent('sessions').set(9876, { tabIds: new Set([1, 2]), activeTabId: 1, groupId: 5, nummer: 1, label: 'Claude 1', color: 'blue', pid: 111, faneGen: new Map() });
  await saet(u, { label: 'Fakturaer', color: 'cyan' });   // ingen persistSessions() her: vaerktoejet skal selv gemme
  const v = indlaesUdvidelse({ svar: husk(lager) });
  await v.fyr('tabs.onRemoved', 2);
  await new Promise((r) => setTimeout(r, 20));
  await v.hent('restoreSessions')();
  v.hent('persistSessions')();
  const w = indlaesUdvidelse({ svar: husk(lager) });
  await w.hent('restoreSessions')();
  const s = w.hent('sessions').get(9876);
  assert.equal(s?.label, 'Fakturaer'); assert.equal(s?.color, 'cyan');
});

test('formattegn forsvinder, styretegn bliver mellemrum, og der klippes efter tegn - aldrig midt i en emoji', async () => {
  const u = sele();
  const r = await saet(u, { label: 'a\u202eb\u2066c\u200bd\u0085e\u009bf\u061cg' });
  assert.equal(r.label, 'abcd e fg', JSON.stringify(r.label));
  const r2 = await saet(u, { label: 'x'.repeat(29) + '\u{1F4C4}' });
  assert.equal(Array.from(r2.label).length, 30);
  assert.ok(r2.label.isWellFormed(), 'et ensomt surrogat blev sendt til Chrome');
});

test('et eget navn maa ikke ligne en anden sessions standardnavn - intet aendres', async () => {
  const u = sele();
  const r = await saet(u, { label: 'Claude 2' });
  assert.equal(r.ok, false); assert.equal(r.error, 'reserved-label', JSON.stringify(r));
  assert.equal(u.hent('sessions').get(9876).label, 'Claude 1');
  assert.equal(u.optager.sidste('tabGroups.update'), undefined, 'gruppen blev omdoebt trods afvisningen');
  const egen = await saet(u, { label: 'Claude 1' });
  assert.equal(egen.ok, true, 'sessionens eget standardnavn blev afvist');
});

test('et tomt navn giver standardfarven tilbage, ogsaa naar der er bedt om en farve', async () => {
  const u = sele();
  await saet(u, { label: '', color: 'red' });
  assert.equal(u.hent('sessions').get(9876).color, 'blue');
});

test('en ukendt farve svarer ok:false', async () => {
  const u = sele();
  assert.equal((await saet(u, { label: 'X', color: 'magenta' })).ok, false);
});
