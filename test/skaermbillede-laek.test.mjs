/**
 * Et skaermbillede maa aldrig vaere af en ANDEN fane end agentens.
 *
 * MAALT 9/9-2026 (Astra, reproduceret): naar CDP-optagelsen fejlede, faldt koden tilbage paa
 * chrome.tabs.captureVisibleTab(windowId). Den fotograferer den SYNLIGE fane, ikke agentens -
 * og brugerens egen side (bank, mail) blev leveret uden at svaret afsloerede det.
 *
 * 10/9, anden runde: et tjek foer og et efter optagelsen blev omgaaet af A->B->A. Et tjek paa to
 * tidspunkter beviser ikke hvad der skete imellem. Reserveloesningen er derfor fjernet helt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele({ agentFaneAktiv, cdp } = {}) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': { id: 1, url: 'https://agent.example', active: agentFaneAktiv, windowId: 9 },
    'tabs.query': agentFaneAktiv
      ? [{ id: 1, url: 'https://agent.example', active: true, windowId: 9 }]
      : [{ id: 2, url: 'https://brugerens-bank.example', active: true, windowId: 9 }],
    // Laekken afhaenger ikke af HVORFOR CDP fejler, kun af AT den gjorde.
    'debugger.sendCommand': cdp ?? (() => { throw new Error('CDP nede'); }),
    'tabs.captureVisibleTab': 'data:image/png;base64,BRUGERENS_AKTIVE_FANE',
    'windows.getLastFocused': { id: 9 },
    'windows.update': undefined,
    'tabs.update': undefined,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('agentens fane er ikke synlig - der leveres INTET billede af en anden fane', async () => {
  const u = sele({ agentFaneAktiv: false });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, 'der skal kastes, ikke returneres et billede');
  assert.doesNotMatch(JSON.stringify(svar), /BRUGERENS_AKTIVE_FANE/, 'en anden fanes pixels maa aldrig naa kalderen');
  assert.equal(u.optager.antal('tabs.captureVisibleTab'), 0);
});

test('heller ikke naar agentens fane ER den synlige - et skift imellem kan ikke udelukkes', async () => {
  const u = sele({ agentFaneAktiv: true });
  await u.hent('dispatch')(9876, 'screenshot', {}).catch(() => {});
  assert.equal(u.optager.antal('tabs.captureVisibleTab'), 0,
    'captureVisibleTab maa ikke bruges: to tjek beviser ikke hvilken fane der var synlig ved optagelsen');
});

// MAALT 11/9 af Fable (e2e-review): haenger BEGGE optagelser, haevede 1.29.0 vinduet og leverede et billede efter 16,7 s.
// HEAD gav op efter 26 s uden at proeve, fordi en frist afskar den sidste udvej. Budgettet reserverer nu plads til én
// haevet runde (haevMs), saa den kan naa at levere inden for serverens 30 s.
test('haenger begge optagelser: vinduet haeves som sidste udvej, og billedet naar frem', async () => {
  let haevet = false;
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode) => {
    if (metode !== 'Page.captureScreenshot') return {};
    // Kompositoren svarer foerst naar vinduet er haevet - som paa en tildaekket skaerm.
    return haevet ? { data: 'HAEVET' } : new Promise(() => {});
  } });
  // Proeverne her haenger paa HAENDELSER (hvornaar vinduet haeves), ikke paa millisekunder: en tidligere udgave kapløb med
  // rigtige ure og faldt skiftevis naar suiten koerte mange filer samtidig. Budgettet er saa stort at kun raekkefoelgen
  // afgoer udfaldet - i rigtige tal er det 10 s + 8 s + 0,25 s + optagelsen, altsaa under serverens 30 s.
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 150, samletMs: 4000, haevMs: 1500 });
  const opdater = u.chrome.windows.update;
  u.chrome.windows.update = (...a) => { haevet = true; return opdater(...a); };
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.match(String(svar.image), /HAEVET/, `intet billede fra den haevede runde: ${JSON.stringify(svar).slice(0, 160)}`);
  assert.ok(u.optager.antal('windows.update') >= 1, 'vinduet blev aldrig haevet');
});

// MAALT 11/9 af Astra (e2e runde 2), tre fejl i den haevede runde:
//  1. Reservationen (haevMs) blev trukket fra IGEN i den haevede runde, saa reserven dér fik 0 ms.
//  2. `debuggerAttach` laa uden for fristloebet: en gentilslutning paa 12,5 s bar kaeden over serverens 30 s.
//  3. Haevningen startede NYE optagelser og smed de igangværende vaek - 1.29.0 fik svar fra dem der allerede loeb.
test('den haevede runde: reserven faar den tid der er tilbage, ikke nul', async () => {
  let haevet = false;
  const kald = [];
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode !== 'Page.captureScreenshot') return {};
    const reserve = p?.fromSurface === false;
    kald.push((haevet ? 'haevet-' : '') + (reserve ? 'reserve' : 'standard'));
    if (!haevet) return new Promise(() => {});                       // foer haevningen haenger begge
    if (!reserve) throw new Error('Unable to capture screenshot: image readback failed');   // efter: standard fejler straks
    // Reserven bruger et kort oejeblik: uden det ville et vindue paa NUL millisekunder ogsaa kunne "naa" at svare, og saa
    // kunne proeven ikke se forskel paa "tid nok" og "ingen tid".
    return new Promise((ok) => setTimeout(() => ok({ data: 'RESERVE-EFTER-HAEVNING' }), 150));
  } });
  // Budgettet er stramt nok til at det GOER en forskel om reservationen traekkes fra én eller to gange: efter foerste runde
  // og pausen er der ca. 1,2 s tilbage - mere end nok til reserven, men mindre end haevMs.
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 150, samletMs: 2500, haevMs: 1500 });
  const opdater = u.chrome.windows.update;
  u.chrome.windows.update = (...a) => { haevet = true; return opdater(...a); };
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.match(String(svar.image), /RESERVE-EFTER-HAEVNING/, `reserven i den haevede runde fik ingen tid: ${JSON.stringify(svar).slice(0, 200)} (${kald.join(', ')})`);
});

test('den haevede runde: en gentilslutning der aldrig svarer, maa ikke haenge kaldet', { timeout: 20000 }, async () => {
  let haevet = false;
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode) => {
    if (metode !== 'Page.captureScreenshot') return {};
    return new Promise(() => {});   // ingen optagelse svarer nogensinde
  } });
  // Gentilslutningen efter haevningen svarer ALDRIG. Ligger den uden for budgettet, haenger vaerktoejet til serverens frist.
  u.ctx.debuggerAttach = () => (haevet ? new Promise(() => {}) : Promise.resolve());
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 150, samletMs: 3000, haevMs: 1000 });
  const opdater = u.chrome.windows.update;
  u.chrome.windows.update = (...a) => { haevet = true; return opdater(...a); };
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, `vaerktoejet svarede ikke med en fejl: ${JSON.stringify(svar).slice(0, 160)}`);
});

test('den haevede runde: en optagelse der allerede loeb, taeller stadig med', async () => {
  let haevet = false;
  const svarPaaFoerste = [];   // de foerste optagelser svarer FOERST naar vinduet haeves - som paa en tung, tildaekket side
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode !== 'Page.captureScreenshot') return {};
    if (haevet) return new Promise(() => {});   // nye optagelser efter haevningen svarer aldrig
    return new Promise((ok) => svarPaaFoerste.push(() => ok({ data: p?.fromSurface === false ? 'FOERSTE-RESERVE' : 'FOERSTE-STANDARD' })));
  } });
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 150, samletMs: 4000, haevMs: 1500 });
  const opdater = u.chrome.windows.update;
  u.chrome.windows.update = (...a) => { haevet = true; svarPaaFoerste.forEach((f) => f()); return opdater(...a); };
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.match(String(svar.image), /FOERSTE-(STANDARD|RESERVE)/, `billedet fra de igangvaerende optagelser blev smidt vaek: ${JSON.stringify(svar).slice(0, 200)}`);
});

// MAALT 12/9 af Astra (efterproevning af 19d036a): de igangvaerende optagelser blev baaret med over i den HAEVEDE runde,
// og Promise.any tog den foerste der svarede. Aendrede siden sig ved haevningen, vandt det gamle, forsinkede billede:
// baseline leverede sidens nye indhold efter 17,2 s, kandidaten det gamle efter 18,4 s. Et forældet skaermbillede er
// vaerre end ingen: agenten handler paa noget der ikke staar der mere.
// De igangvaerende taeller stadig med (proeven ovenfor) - men kun som reserve, hvis den friske optagelse ikke naar frem.
test('den haevede runde: et frisk billede slaar et gammelt, forsinket et', async () => {
  let haevet = false;
  const svarPaaFoerste = [];
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode) => {
    if (metode !== 'Page.captureScreenshot') return {};
    if (haevet) return new Promise((ok) => setTimeout(() => ok({ data: 'EFTER-HAEVNINGEN' }), 200));
    return new Promise((ok) => svarPaaFoerste.push(() => ok({ data: 'FOER-HAEVNINGEN' })));
  } });
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 150, samletMs: 4000, haevMs: 1500 });
  const opdater = u.chrome.windows.update;
  // Haevningen aendrer hvad der staar paa skaermen - og lige dér svarer de gamle optagelser med det GAMLE indhold.
  u.chrome.windows.update = (...a) => { haevet = true; svarPaaFoerste.forEach((f) => f()); return opdater(...a); };
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.match(String(svar.image), /EFTER-HAEVNINGEN/,
    `et forældet billede fra foer haevningen blev leveret: ${JSON.stringify(svar).slice(0, 200)}`);
});

test('en frist paa standardoptagelsen giver 1.29.0-reserven en chance - og hoejst én runde med haevet vindue', async () => {
  // Sign-off 11/9 (Astra, R5 F8): HEAD sprang fromSurface:false over efter en frist. I 1.29.0 var det netop fristen
  // der sendte kaldet videre til den, og den leverede billedet. Reserven proeves; en ny runde med haevet vindue ikke.
  const kald = [];
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode === 'Page.captureScreenshot') {
      kald.push(p?.fromSurface === false ? 'reserve' : 'standard');
      throw new Error('CDP svarede ikke inden 20000 ms: Page.captureScreenshot');
    }
    return {};
  } });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, `en frist er ingen succes: ${JSON.stringify(svar).slice(0, 120)}`);
  assert.deepEqual(kald.slice(0, 2), ['standard', 'reserve'], 'efter en frist skal fromSurface:false proeves');
  // 11/9 (Fable): den haevede runde er sidste udvej og gav i 1.29.0 et billede paa en tildaekket skaerm. Den maa koere
  // ÉN gang inden for budgettet - ikke flere.
  assert.ok(kald.length <= 4, `for mange optagelser: ${kald.join(', ')}`);
  assert.ok(u.optager.antal('windows.update') <= 2, 'hoejst én haevning (plus gendannelsen af brugerens vindue)');
});

// 10/9 (Astra, R2) stod her at vinduet ALDRIG maatte haeves efter en frist. MAALT 11/9 af Fable: paa en tildaekket skaerm er
// haevningen netop den vej der virker (1.29.0 leverede dér efter 16,7 s). Nu er det budgettet der holder kaeden under
// serverens 30 s - og den haevede runde koerer ÉN gang, ikke flere.
test('efter en frist koeres den haevede runde én gang - og ikke flere', async () => {
  const kald = [];
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode !== 'Page.captureScreenshot') return {};
    kald.push(p?.fromSurface === false ? 'reserve' : 'standard');
    if (p?.fromSurface === false) throw new Error('Unable to capture screenshot: image readback failed');
    throw new Error('CDP svarede ikke inden 10000 ms: Page.captureScreenshot');
  } });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl, 'alle veje fejlede - der er intet billede');
  assert.deepEqual(kald, ['standard', 'reserve', 'standard', 'reserve'], `optagelserne var: ${kald.join(', ')}`);
  assert.ok(u.optager.antal('windows.update') <= 2, 'hoejst én haevning plus gendannelsen af brugerens vindue');
});

// MAALT 11/9 af Astra (efterproevning af f084d1b): standardoptagelsen lykkes efter 11 s, reserven fejler. Foer budgettet:
// standardbilledet efter 11 s. Med budgettet: fristen paa 10 s kasserede den, og svaret var "image readback failed".
// Standardoptagelsen maa loebe videre mens reserven proeves - den der lykkes foerst inden for budgettet, vinder.
test('en langsom standardoptagelse kasseres ikke ved fristen, naar reserven fejler', async () => {
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode !== 'Page.captureScreenshot') return {};
    if (p?.fromSurface === false) throw new Error('Unable to capture screenshot: image readback failed');
    return new Promise((ok) => setTimeout(() => ok({ data: 'STANDARD' }), 110));
  } });
  // Skaleret 1:100 - standardbilledet kommer efter 11 s, fristen er 10 s, budgettet 26 s.
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 100, samletMs: 260 });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.match(String(svar.image), /STANDARD/, `standardbilledet blev kasseret: ${JSON.stringify(svar).slice(0, 160)}`);
});

test('er budgettet naesten brugt, startes runden med haevet vindue ikke', async () => {
  // Begge optagelser fejler af en anden grund end en frist, men foerst naar tiden er ved at vaere gaaet.
  // En runde mere ville bringe kaeden over serverens 30 s.
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode) => {
    if (metode !== 'Page.captureScreenshot') return {};
    return new Promise((_, afvis) => setTimeout(() => afvis(new Error('Unable to capture screenshot: image readback failed')), 60));
  } });
  // Budgettet er saa lille at der intet er tilbage naar begge optagelser har fejlet.
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 100, samletMs: 110, haevMs: 0 });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.ok(svar.fejl);
  assert.equal(u.optager.antal('windows.update'), 0, 'vinduet blev haevet uden tid tilbage til en optagelse');
});

// MAALT 11/9 af Astra (sign-off, skalerede timere): standardoptagelsen hang og koblede foerst fra efter 19 s. cdpSend
// gentog den (den staar som sikker at gentage), saa billedet kom efter ca. 38 s - serveren havde opgivet ved 30 s.
// 1.29.0: fristen paa 8 s sendte kaldet videre til fromSurface:false, som svarede paa et halvt sekund.
test('haenger standardoptagelsen og kobler foerst fra sent, naar reserven frem foer serverens 30 s', async () => {
  const u = sele({ agentFaneAktiv: true, cdp: (_m, metode, p) => {
    if (metode !== 'Page.captureScreenshot') return {};
    if (p?.fromSurface === false) return { data: 'RESERVE' };
    // Standardoptagelsen svarer aldrig af sig selv; den kobler foerst fra langt efter fristen (som i maalingen 19 s).
    return new Promise((_, afvis) => setTimeout(() => afvis(new Error('Debugger is detached')), 1500));
  } });
  // Skaleret med rigelig margin: fristen (400) rammer laenge foer afkoblingen (1500), og budgettet (3000) er stort nok
  // til at kun raekkefoelgen afgoer udfaldet - ikke hvor travlt maskinen har.
  u.ctx.skaermbilledeFrister = () => ({ foersteMs: 400, samletMs: 3000, haevMs: 1000 });
  const svar = await u.hent('dispatch')(9876, 'screenshot', {}).catch((e) => ({ fejl: e.message }));
  assert.match(String(svar.image), /RESERVE/, `intet billede fra reserven: ${JSON.stringify(svar).slice(0, 160)}`);
  assert.equal(u.optager.antal('windows.update'), 0, 'reserven svarede - der er ingen grund til at haeve vinduet');
});

// MAALT 12/9 af Astra, TREDJE runde paa samme sted: en gentilslutning paa 12,5 s fik kandidaten til at opgive efter
// 26,9 s, hvor 1.29.0 leverede et billede efter 29,2 s. De to foregaaende runder fandt hver sit scenarie i netop de
// sekunder budgettet gav bort - fordi 26 s var et frit valgt tal. Reglen der lukkes her: budgettet maa aldrig vaere
// aarsagen til at vi leverer mindre end 1.29.0. Det er serverens egen frist minus svarets hjemrejse, intet andet.
test('budgettet er udledt af serverens frist - ikke et frit valgt tal', () => {
  const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

  const serverensFrist = Number(/sendToExtension\([^)]*timeoutMs = (\d+)/.exec(srv)?.[1]);
  assert.ok(serverensFrist > 0, 'serverens frist pr. kald kunne ikke laeses');

  const udvidelsensTal = Number(/const SERVER_FRIST_MS = (\d+)/.exec(kilde)?.[1]);
  assert.equal(udvidelsensTal, serverensFrist,
    `udvidelsen tror serveren venter ${udvidelsensTal} ms, men den venter ${serverensFrist} ms`);

  assert.match(kilde, /samletMs: SERVER_FRIST_MS - SVARETS_HJEMREJSE_MS/,
    'budgettet er ikke udledt af serverens frist - saa kan det igen glide vaek fra den uden at nogen opdager det');

  const hjemrejse = Number(/const SVARETS_HJEMREJSE_MS = (\d+)/.exec(kilde)?.[1]);
  const { samletMs, haevMs, foersteMs } = ctxFrister();
  assert.equal(samletMs, serverensFrist - hjemrejse);
  assert.ok(samletMs < serverensFrist, 'budgettet er ikke under serverens frist - svaret kan naa frem for sent');
  assert.ok(hjemrejse <= 2000, `${hjemrejse} ms sat af til et lokalt hop er for meget - det er tid vi giver bort`);
  assert.ok(haevMs < samletMs - foersteMs, 'reserven til den haevede runde aeder foerste rundes egen frist');
});

/** Laeser de AEGTE frister ud af udvidelsen (ikke en kopi af tallene her i proeven). */
function ctxFrister() {
  const u = sele({ agentFaneAktiv: true });
  return u.ctx.skaermbilledeFrister();
}

test('fristen rammer ikke kald der lovligt tager tid', async () => {
  const u = sele({ agentFaneAktiv: true });
  assert.equal(u.hent('cdpFrist')('Input.dispatchMouseEvent'), 1500, 'input-kald er dem der blev maalt til at haenge');
  assert.ok(u.hent('cdpFrist')('Page.captureScreenshot') >= 5000, 'et skaermbillede paa en tung side skal have lov at tage tid');
  assert.ok(u.hent('cdpFrist')('Runtime.evaluate') >= 5000, 'dialog-ventetider bruger 3.000 ms og maa ikke skaeres over');
});
