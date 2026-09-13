/**
 * Beviser at broen ALTID kommer tilbage af sig selv.
 *
 * Testene her koerer den AEGTE `ensureOffscreen` fra extension/background.js mod
 * en stubbet chrome-API og maaler HVAD DER SKER - de matcher ikke paa kildetekst.
 *
 * MAALT 22/8, og det er grunden til omskrivningen: den tidligere udgave af denne
 * fil bestod af regex mod kildeteksten plus to tests der skrev deres EGEN kopi af
 * rettelsen og testede kopien. De ville have bestaaet hvis background.js var
 * slettet. Ti mutationer af produktionskoden forblev groenne i den gamle suite -
 * blandt andet at fjerne hjerteslags-alarmen og at goere broen fuldstaendig stum.
 *
 * Hver test her er mutations-verificeret: produktionskoden er braekket, testen er
 * set blive roed, og koden er sat tilbage. Det staar noteret ved hver enkelt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

/** Klipper en funktion (eller const) ud af kilden ved at matche tuborgklammer. */
function udklip(navn, erFunktion = true) {
  const start = erFunktion
    ? kilde.search(new RegExp(`(async )?function ${navn}\\s*\\(`))
    : kilde.search(new RegExp(`const ${navn}\\s*=`));
  assert.ok(start > -1, `${navn} findes ikke i background.js`);
  if (!erFunktion) return kilde.slice(start, kilde.indexOf('\n', start) + 1);
  let i = kilde.indexOf('{', start), dybde = 0;
  for (let j = i; j < kilde.length; j++) {
    if (kilde[j] === '{') dybde++;
    else if (kilde[j] === '}' && --dybde === 0) return kilde.slice(start, j + 1);
  }
  throw new Error(`kunne ikke afgraense ${navn}`);
}

/**
 * Rejser den aegte ensureOffscreen med en stubbet chrome, og rapporterer hvad
 * funktionen faktisk gjorde.
 */
async function koer({ findes = true, pingSvarer = false, lager = {}, broVersion = '9.9.9', vores = '9.9.9' } = {}) {
  const log = { lukket: 0, oprettet: 0, advarsler: [] };
  const gemt = { ...lager };

  const chrome = {
    offscreen: {
      hasDocument: async () => findes,
      closeDocument: async () => { log.lukket++; findes = false; },
      createDocument: async () => { log.oprettet++; findes = true; },
    },
    runtime: {
      sendMessage: async () => (pingSvarer
        ? { ok: true, ...(broVersion === null ? {} : { version: broVersion }) }
        : Promise.reject(new Error('ingen modtager'))),
      getManifest: () => ({ version: vores }),
    },
    storage: {
      local: {
        get: async (spec) => {
          const ud = {};
          for (const [k, v] of Object.entries(spec)) ud[k] = k in gemt ? gemt[k] : v;
          return ud;
        },
        set: async (o) => Object.assign(gemt, o),
      },
    },
  };

  const src = [
    udklip('MAX_OFFSCREEN_GENSKAB', false),
    udklip('OFFSCREEN_PAUSE_MS', false),
    // 12/9: ensureOffscreen laeser nu et alternativt portomraade fra chrome.storage, saa en testbrowser kan
    // isoleres uden at repoets filer aendrer sig. Hjaelperen skal med, ellers maaler selen en anden funktion.
    udklip('PORTE_MAX_SPAEND', false),
    udklip('portOmraadeFraLager'),
    udklip('offscreenSvarer'),
    udklip('ensureOffscreen'),
    'return ensureOffscreen();',
  ].join('\n');

  const fn = new Function('chrome', 'console', 'Date', `return (async () => { ${src} })()`);
  await fn(chrome, { warn: (m) => log.advarsler.push(String(m)), log() {} }, Date);
  return { ...log, gemt };
}

// ── Mutations-verificeret: `if (await offscreenSvarer())` -> `if (true)` gav roed.
test('en levende bro roeres ikke', async () => {
  const r = await koer({ findes: true, pingSvarer: true });
  assert.equal(r.lukket, 0, 'en bro der svarer maa aldrig rives ned');
  assert.equal(r.oprettet, 0);
  assert.equal(r.gemt.offscreenGenskabt, 0, 'taelleren skal nulstilles naar broen svarer');
});

// ── Mutations-verificeret: fjernet closeDocument-kaldet gav roed.
test('en doed bro lukkes og erstattes', async () => {
  const r = await koer({ findes: true, pingSvarer: false });
  assert.equal(r.lukket, 1, 'det doede dokument skal lukkes');
  assert.equal(r.oprettet, 1, 'et nyt skal oprettes');
  assert.equal(r.gemt.offscreenGenskabt, 1, 'forsoeget skal taelles');
});

// ── Mutations-verificeret: fjernet hele hasDocument-grenen gav roed.
test('mangler dokumentet helt, oprettes det', async () => {
  const r = await koer({ findes: false });
  assert.equal(r.lukket, 0);
  assert.equal(r.oprettet, 1);
});

// ── Mutations-verificeret: taelleren flyttet til en modul-variabel gav roed.
test('taelleren ligger i storage - ikke i en variabel der doer med service-workeren', async () => {
  const r = await koer({ findes: true, pingSvarer: false, lager: { offscreenGenskabt: 2 } });
  assert.equal(r.gemt.offscreenGenskabt, 3, 'skal taelle videre fra den gemte vaerdi, ikke fra 0');
});

// ── Mutations-verificeret: graensen fjernet gav roed.
test('efter graensen rives broen ikke ned igen med det samme', async () => {
  const r = await koer({ findes: true, pingSvarer: false, lager: { offscreenGenskabt: 3 } });
  assert.equal(r.lukket, 0, 'en gammel-men-fungerende bro skal have ro efter tre forsoeg');
  assert.equal(r.oprettet, 0);
  assert.ok(r.gemt.offscreenPauseTil > Date.now(), 'der skal saettes en pause');
});

// ── DEN VIGTIGE. Mutations-verificeret: `return` i stedet for pause-nulstillingen
//    (altsaa den gamle, permanente graense) gjorde denne test roed.
//    MAALT 22/8: graensen VAR permanent, og en aegte doed bro laa doed for evigt.
test('naar pausen er ovre, proeves der igen - graensen maa ALDRIG vaere endelig', async () => {
  const r = await koer({
    findes: true,
    pingSvarer: false,
    lager: { offscreenGenskabt: 3, offscreenPauseTil: Date.now() - 1000 },   // pausen udloebet
  });
  assert.equal(r.lukket, 1, 'efter pausen SKAL den doede bro erstattes');
  assert.equal(r.oprettet, 1, 'ellers ligger brugeren med en doed forbindelse for evigt');
});

// ── Mutations-verificeret: pause-tjekket fjernet gav roed.
test('midt i en pause roeres broen ikke', async () => {
  const r = await koer({
    findes: true,
    pingSvarer: false,
    lager: { offscreenGenskabt: 0, offscreenPauseTil: Date.now() + 60_000 },
  });
  assert.equal(r.lukket, 0, 'pausen skal respekteres');
  assert.equal(r.oprettet, 0);
});

// ── Alarmen: her er kilde-tjek det rigtige, fordi fejlen ER en opstartssekvens.
//    Mutations-verificeret: create flyttet ud af get-tilbagekaldet gav roed.
test('hjerteslags-alarmen nulstilles ikke ved hver opvaagning', () => {
  const iGet = kilde.indexOf("chrome.alarms.get('ensure-offscreen'");
  const iCreate = kilde.indexOf("chrome.alarms.create('ensure-offscreen'");
  assert.ok(iGet > -1 && iCreate > -1, 'baade get og create skal findes');
  assert.ok(iGet < iCreate, 'create skal ligge INDE i get-tilbagekaldet - ellers ' +
    'nulstilles nedtaellingen hver gang service-workeren vaagner, og alarmen fyrer aldrig');
  assert.equal((kilde.match(/chrome\.alarms\.create\('ensure-offscreen'/g) || []).length, 1);
});

// ── I LIVE ER IKKE DET SAMME SOM OPDATERET ────────────────────────────────────
// MAALT 22/8 mod en aegte Chrome, og det kostede en halv dag: broen svarede villigt
// paa ping, saa ensureOffscreen regnede den for rask og udskiftede den ALDRIG - selv
// om dens kode var flere udgaver gammel. Hverken "Genindlaes" paa chrome://extensions
// eller skydeknappen rev den ned. Mine kode-aendringer slog derfor slet ikke igennem
// uden en fuld genstart af Chrome, og jeg maalte i timevis paa gammel kode uden at
// vide det. For en almindelig bruger er samme fejl: opdateringen henter ny kode, men
// broen fortsaetter uaendret indtil browseren genstartes.

// ── Mutations-verificeret: versions-sammenligningen fjernet gav roed.
test('en bro der svarer, men er en gammel udgave, bliver udskiftet', async () => {
  const r = await koer({ findes: true, pingSvarer: true, broVersion: '1.26.0', vores: '1.27.1' });
  assert.equal(r.lukket, 1, 'en forældet bro skal rives ned, ogsaa naar den svarer');
  assert.equal(r.oprettet, 1);
});

// ── Mutations-verificeret: `svar.version === vores` -> `true` gav roed.
test('en bro der slet ikke oplyser sin version er fra foer 1.27.1 og udskiftes', async () => {
  const r = await koer({ findes: true, pingSvarer: true, broVersion: null, vores: '1.27.1' });
  assert.equal(r.lukket, 1, 'ingen version betyder gammel kode');
});

test('en bro med samme version faar fred', async () => {
  const r = await koer({ findes: true, pingSvarer: true, broVersion: '1.27.1', vores: '1.27.1' });
  assert.equal(r.lukket, 0, 'en frisk bro maa ikke rives ned - det var hele grunden til graensen');
  assert.equal(r.oprettet, 0);
});

// ── Mutations-verificeret: tvangs-lukningen fjernet gav roed.
test('en genindlaesning tvinger altid en frisk bro', () => {
  const i = kilde.indexOf('chrome.runtime.onInstalled.addListener');
  assert.ok(i > -1, 'onInstalled skal haandteres');
  const blok = kilde.slice(i, i + 700);
  assert.match(blok, /closeDocument\(\)/,
    'onInstalled fyrer ved installation, opdatering OG "Genindlaes" - i alle tre er koden ' +
    'aendret, saa en overlevende bro er per definition forældet, uanset hvad den svarer');
  assert.match(blok, /offscreenGenskabt: 0/, 'og taelleren skal nulstilles, ellers arver den nye bro en gammel pause');
});
