/**
 * getSessionTab - hvilken fane rammer et kald? Koert, ikke grepped.
 *
 * MAALT 22/8: fem mutationer af den her funktion slap igennem hele suiten. Den er
 * det led hvert eneste vaerktoej gaar igennem, saa en fejl her rammer alt paa én gang:
 *   · chrome://-gaten fjernet → vaerktoejer forsoeger at arbejde paa Chromes egne sider
 *   · about:blank-genbruget (FIX-4) fjernet → en ny tom fane pr. laesekald
 *   · FIX-17 fjernet → en doed fane slettes ikke, og sessionen fyldes med spoegelser
 *   · `activate = false` -> `true` → fokus stjaeles fra brugeren ved hvert skaermbillede
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

function udklip(navn) {
  const start = kilde.search(new RegExp(`(async )?function ${navn}\\s*\\(`));
  assert.ok(start > -1, `${navn} findes ikke`);
  let d = 0;
  for (let j = kilde.indexOf('{', start); j < kilde.length; j++) {
    if (kilde[j] === '{') d++;
    else if (kilde[j] === '}' && --d === 0) return kilde.slice(start, j + 1);
  }
  throw new Error(`kunne ikke afgraense ${navn}`);
}

/**
 * @param faner    { id: url } - faner der findes i browseren
 * @param session  { activeTabId, tabIds }
 */
async function vaelg({ faner = {}, session = {}, aktivér = undefined } = {}) {
  const s = { activeTabId: null, tabIds: new Set(), ...session };
  if (Array.isArray(s.tabIds)) s.tabIds = new Set(s.tabIds);
  const log = { oprettet: [], aktiveret: [], tilfoejet: [] };
  let naesteId = 900;

  const chrome = {
    tabs: {
      get: async (id) => { if (!(id in faner)) throw new Error('no tab'); return { id, url: faner[id], windowId: 1 }; },
      create: async ({ url }) => { const id = naesteId++; faner[id] = url; log.oprettet.push(url); return { id, url, windowId: 1 }; },
      update: async (id, o) => { if (o?.active) log.aktiveret.push(id); },
    },
    windows: { get: async () => ({ state: 'normal', focused: true }), update: async () => {} },
  };

  const src = [
    udklip('getSessionTab'),
    aktivér === undefined ? 'return getSessionTab(9877);' : `return getSessionTab(9877, ${aktivér});`,
  ].join('\n');

  const fn = new Function('chrome', 'getSession', 'addTabToSession', 'persistSessions', 'console',
    `return (async () => { ${src} })()`);
  const tab = await fn(
    chrome,
    () => s,
    async (_p, id) => { s.tabIds.add(id); log.tilfoejet.push(id); },
    () => {},
    { log() {}, warn() {} },
  );
  return { tab, session: s, log, faner };
}

// ── Mutations-verificeret: chrome://-gaten fjernet gav roed.
test('en chrome://-side vaelges ALDRIG som arbejdsfane', async () => {
  const { tab, log } = await vaelg({
    faner: { 11: 'chrome://extensions/' },
    session: { activeTabId: 11, tabIds: [11] },
  });
  assert.ok(!tab.url.startsWith('chrome://'),
    'ingen udvidelse kan koere script paa Chromes egne sider - vaelges en, fejler ' +
    'hvert eneste vaerktoej med "Cannot interact with chrome:// pages"');
  assert.equal(log.oprettet.length, 1, 'der skal laves en brugbar fane i stedet');
});

// ── Mutations-verificeret: blankFallback-grenen fjernet gav roed (FIX-4).
test('vores egen tomme fane genbruges - ikke én ny pr. kald', async () => {
  const foerste = await vaelg({ faner: {}, session: {} });
  assert.equal(foerste.log.oprettet.length, 1, 'foerste kald laver én');

  // Andet kald med samme tilstand: den tomme fane er nu i sessionen.
  const andet = await vaelg({
    faner: { 11: 'about:blank' },
    session: { activeTabId: 11, tabIds: [11] },
  });
  assert.equal(andet.log.oprettet.length, 0,
    'uden genbruget faar brugeren en ny tom fane for HVERT laesekald foer foerste navigate');
  assert.equal(andet.tab.id, 11);
});

// ── Mutations-verificeret: fallback-loekken fjernet gav roed.
//
//    MEN en aerlig note om FIX-17 (at fange id'et FOER activeTabId nulstilles):
//    jeg proevede at mutere den - `const dead = null` - og suiten forblev groen.
//    Det er ikke et hul i testen. Det er fordi FIX-17 ikke har nogen OBSERVERBAR
//    effekt: naar den aktive fane er doed, loeber fallback-loekken lige nedenfor
//    alligevel hen over tabIds, faar samme fejl paa samme id, og sletter den dér.
//    Rettelsen er defensiv redundans, ikke en adfaerdsaendring. Jeg skriver det her
//    frem for at bygge en test der lader som om den maaler noget.
test('en doed aktiv fane ryddes ud af sessionen', async () => {
  const { session } = await vaelg({
    faner: { 22: 'https://example.com/' },     // 11 findes ikke laengere
    session: { activeTabId: 11, tabIds: [11, 22] },
  });
  assert.ok(!session.tabIds.has(11),
    'nulstilles activeTabId FOER id\'et fanges, sletter koden `null` i stedet - ' +
    'og sessionen fyldes langsomt med spoegelsesfaner der taeller mod loftet');
  assert.equal(session.activeTabId, 22, 'og den skal falde tilbage paa en brugbar fane');
});

test('en levende fane i sessionen foretraekkes frem for en ny', async () => {
  const { tab, log } = await vaelg({
    faner: { 33: 'https://example.org/' },
    session: { activeTabId: null, tabIds: [33] },
  });
  assert.equal(tab.id, 33, 'den skal genbruge det den har');
  assert.equal(log.oprettet.length, 0);
});

// ── Mutations-verificeret: `activate = false` -> `true` gav roed (allerede daekket i
//    baggrundsdrift.test.mjs, men her maales ADFAERDEN og ikke signaturen).
test('uden et eksplicit oenske aktiveres fanen IKKE', async () => {
  const { log } = await vaelg({
    faner: { 44: 'https://example.net/' },
    session: { activeTabId: 44, tabIds: [44] },
  });
  assert.equal(log.aktiveret.length, 0,
    'screenshot og press_key koerer konstant. Aktiveres fanen, hopper Chrome frem ' +
    'foran brugeren ved hver eneste handling.');
});

test('bedes der eksplicit om det, aktiveres den', async () => {
  const { log } = await vaelg({
    faner: { 44: 'https://example.net/' },
    session: { activeTabId: 44, tabIds: [44] },
    aktivér: true,
  });
  assert.equal(log.aktiveret.length, 1, 'et klik skal kunne bede om fokus');
});

/**
 * switch_tab skal ogsaa goere VINDUET forrest.
 *
 * MAALT 31/8-2026: `chrome.tabs.update(id, {active:true})` alene goer fanen aktiv
 * inde i sit vindue. document.hasFocus() bliver sand - men visibilityState
 * forbliver 'hidden' saa laenge vinduet ligger bagved. Chrome struber timere i
 * skjulte faner, saa Angular-apps (Google Ads, GA4, Search Console) aldrig
 * renderer faerdigt.
 *
 * Konsekvensen var ikke "klik virker ikke". Den var VAERRE: sider blev laest
 * halvt bygget, og der blev draget forkerte konklusioner af dem - bl.a. at tre
 * GA4-ejendomme laa paa en utilgaengelig konto. De laa lige for.
 */
test('switch_tab: goer vinduet forrest, ikke kun fanen aktiv', () => {
  const i = kilde.indexOf("case 'switch_tab'");
  assert.ok(i > -1, "switch_tab findes");
  const blok = kilde.slice(i, i + 1600);

  assert.match(blok, /chrome\.tabs\.update\([^)]*active:\s*true/,
    'fanen skal stadig goeres aktiv');
  assert.match(blok, /chrome\.windows\.update\(/,
    'VINDUET skal ogsaa fokuseres - ellers forbliver siden hidden og renderer ikke');
  assert.match(blok, /focused:\s*true/,
    'vinduet skal fokuseres med focused:true');
});

test('switch_tab: et vindue der ikke kan fokuseres vaelter ikke kaldet', () => {
  const i = kilde.indexOf("case 'switch_tab'");
  const blok = kilde.slice(i, i + 1600);
  // Vinduet kan vaere lukket eller paa et andet Space. Fanen er stadig aktiv,
  // saa kaldet skal lykkes - men svaret skal sige aerligt at synligheden ikke
  // kunne sikres, i stedet for at lade kalderen tro at siden er synlig.
  assert.match(blok, /try\s*\{[\s\S]*chrome\.windows\.update[\s\S]*\}\s*catch/,
    'vinduesfokus skal vaere i try/catch');
  assert.match(blok, /windowFocused/,
    'svaret skal baere om vinduet faktisk blev forrest');
});
