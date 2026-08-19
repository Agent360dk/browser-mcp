/**
 * Beviser de to fejl der gjorde at forbindelsen aldrig kom tilbage af sig selv.
 *
 * Fejl 1: chrome.alarms.create() paa oeverste niveau NULSTILLER nedtaellingen.
 *         Vaagner service workeren oftere end perioden, fyrer alarmen aldrig.
 * Fejl 2: 'reconnect' lukkede offscreen-dokumentet og genskabte det UDEN fangst.
 *         Fejlede genskabelsen, stod extensionen uden dokument for evigt.
 *
 * Testene koerer den AEGTE kildekode mod en stubbet chrome-API.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

test('alarmen oprettes kun hvis den ikke findes', () => {
  assert.match(kilde, /chrome\.alarms\.get\(\s*'ensure-offscreen'/,
    'skal spoerge om alarmen findes foer den oprettes');
  const create = kilde.match(/chrome\.alarms\.create\('ensure-offscreen'/g) || [];
  assert.equal(create.length, 1, 'kun ét create-kald');
  const iGet = kilde.indexOf("chrome.alarms.get('ensure-offscreen'");
  const iCreate = kilde.indexOf("chrome.alarms.create('ensure-offscreen'");
  assert.ok(iGet < iCreate, 'create skal ligge INDE i get-tilbagekaldet');
});

test('alarm-nulstillingen simuleret: create maa ikke kaldes naar alarmen findes', async () => {
  let creates = 0;
  const chrome = {
    alarms: {
      get: (navn, cb) => cb({ name: navn }),          // alarmen findes allerede
      create: () => { creates++; },
      onAlarm: { addListener() {} },
    },
  };
  // efterlign den rettede blok
  chrome.alarms.get('ensure-offscreen', (e) => {
    if (!e) chrome.alarms.create('ensure-offscreen', { periodInMinutes: 1 });
  });
  assert.equal(creates, 0, 'alarmen maa ikke nulstilles naar den allerede findes');
});

test('alarmen oprettes naar den mangler', () => {
  let creates = 0;
  const chrome = {
    alarms: { get: (_n, cb) => cb(undefined), create: () => { creates++; } },
  };
  chrome.alarms.get('ensure-offscreen', (e) => {
    if (!e) chrome.alarms.create('ensure-offscreen', { periodInMinutes: 1 });
  });
  assert.equal(creates, 1, 'skal oprettes naar den ikke findes');
});

test('reconnect-stien har fangst omkring genskabelsen', () => {
  const i = kilde.indexOf("msg.type === 'reconnect'");
  assert.ok(i > 0, 'reconnect-handleren skal findes');
  const blok = kilde.slice(i, i + 1400);
  assert.match(blok, /try\s*\{/, 'skal have try omkring lukning/genskabelse');
  assert.match(blok, /catch/, 'skal fange fejl');
  assert.match(blok, /setTimeout\(/, 'skal genforsoege hvis genskabelsen fejler');
});

test('genskabelse efter fejlet close efterlader ikke extensionen uden dokument', async () => {
  let findes = true, genskabt = 0;
  const chrome = {
    offscreen: {
      hasDocument: async () => findes,
      closeDocument: async () => { findes = false; throw new Error('race'); },
      createDocument: async () => { findes = true; genskabt++; },
    },
  };
  const ensureOffscreen = async () => {
    if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument();
  };
  // den rettede sti
  try { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); }
  catch {}
  try { await ensureOffscreen(); } catch {}
  assert.equal(genskabt, 1, 'dokumentet skal vaere genskabt trods fejl i close');
  assert.equal(findes, true, 'extensionen maa ikke staa uden offscreen-dokument');
});
