// Fane-loftet pr. session — 10 → 20 (21/8).
//
// Hver session har et loft for hvor mange faner den maa holde aabne. Naar loftet
// naas, lukker evictOldestTabs() den AELDSTE fane. Ti var for lavt til reelle
// flows: et forloeb der aabner en fane pr. udbyder ramte loftet midtvejs, og
// evictionen lukkede faner arbejdet stadig byggede paa — tavst, for eviction
// rapporterer ingenting tilbage. Nu er loftet 20, samme antal som portspaendet
// (9876-9895) tillader samtidige sessioner.
//
// Testen koerer den RIGTIGE evictOldestTabs() ud af extension/background.js mod
// stubbede chrome-API'er, saa den ogsaa daekker adfaerden — ikke kun tallet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'extension/background.js'), 'utf8');

const LOFT = Number(kilde.match(/const MAX_TABS_PER_SESSION = (\d+);/)?.[1]);

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

// levende = de fane-id'er Chrome stadig kender. lukket = dem evictionen bad om at lukke.
function byg(levende) {
  const lukket = [];
  const chrome = {
    tabs: {
      get: async (id) => {
        if (!levende.has(id)) throw new Error('No tab with id: ' + id);
        return { id };
      },
      remove: async (id) => { lukket.push(id); levende.delete(id); },
    },
  };
  const fabrik = new Function('chrome', 'MAX_TABS_PER_SESSION',
    `${udtraek('evictOldestTabs')}; return evictOldestTabs;`);
  return { evict: fabrik(chrome, LOFT), lukket };
}

const session = (ids, aktiv = null) => ({ tabIds: new Set(ids), activeTabId: aktiv });
const spænd = (n, fra = 1) => Array.from({ length: n }, (_, i) => fra + i);

test('loftet er 20', () => {
  assert.equal(LOFT, 20, 'MAX_TABS_PER_SESSION skal vaere 20 — 10 lukkede faner midt i et forloeb');
});

test('portspaendet tillader lige saa mange sessioner som loftet tillader faner', () => {
  // Ikke et krav i sig selv, men det er begrundelsen for tallet 20. Driver de fra
  // hinanden, er én af de to steder blevet aendret uden den anden.
  const off = readFileSync(join(rod, 'extension/offscreen.js'), 'utf8');
  const base = Number(off.match(/const BASE_PORT = (\d+);/)[1]);
  const maks = Number(off.match(/const MAX_PORT = (\d+);/)[1]);
  assert.equal(maks - base + 1, LOFT, `portspaend ${base}-${maks} = ${maks - base + 1} sessioner, men fane-loftet er ${LOFT}`);
});

test('serveren scanner det samme portspaend som udvidelsen', () => {
  const srv = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');
  const off = readFileSync(join(rod, 'extension/offscreen.js'), 'utf8');
  // Serveren fik 7/9 en env-override paa spaendet, saa port-testen kan koere uden at
  // beslaglaegge brugerens rigtige porte. STANDARDEN — tallet efter `||` — skal stadig
  // vaere den samme som udvidelsens, ellers findes der servere den aldrig forbinder til.
  const tal = (kilde, navn) => {
    const m = kilde.match(new RegExp(`const ${navn} = (?:[^;]*\\|\\| )?(\\d+);`));
    assert.ok(m, `${navn} kunne ikke laeses — er formen aendret?`);
    return m[1];
  };
  assert.equal(tal(srv, 'BASE_PORT'), tal(off, 'BASE_PORT'));
  assert.equal(tal(srv, 'MAX_PORT'), tal(off, 'MAX_PORT'),
    'driver spaendene fra hinanden, findes servere som udvidelsen aldrig forbinder til');
});

test('under loftet lukkes ingenting', async () => {
  const levende = new Set(spænd(LOFT));
  const { evict, lukket } = byg(levende);
  const s = session(spænd(LOFT), LOFT);
  await evict(s, LOFT);
  assert.deepEqual(lukket, [], 'praecis paa loftet er ikke over loftet');
  assert.equal(s.tabIds.size, LOFT);
});

test('over loftet lukkes de aeldste foerst, og kun ned til loftet', async () => {
  const antal = LOFT + 3;
  const levende = new Set(spænd(antal));
  const { evict, lukket } = byg(levende);
  const s = session(spænd(antal), antal);   // nyeste fane er den aktive
  await evict(s, antal);
  assert.deepEqual(lukket, [1, 2, 3], 'insertion-order: de tre aeldste');
  assert.equal(s.tabIds.size, LOFT);
});

test('den aktive fane lukkes aldrig — heller ikke naar den er den aeldste', async () => {
  const antal = LOFT + 2;
  const levende = new Set(spænd(antal));
  const { evict, lukket } = byg(levende);
  const s = session(spænd(antal), 1);       // aeldste fane ER den aktive
  await evict(s, antal);
  assert.ok(!lukket.includes(1), 'den aktive fane blev lukket — brugeren ville se sin side forsvinde');
  assert.ok(s.tabIds.has(1));
  assert.equal(s.tabIds.size, LOFT);
});

test('den netop tilfoejede fane lukkes aldrig', async () => {
  const antal = LOFT + 2;
  const levende = new Set(spænd(antal));
  const { evict, lukket } = byg(levende);
  const s = session(spænd(antal), null);    // ingen aktiv — kun just-added beskytter
  await evict(s, antal);
  assert.ok(!lukket.includes(antal), 'den fane vi lige aabnede blev lukket igen');
  assert.ok(s.tabIds.has(antal));
});

test('faner brugeren selv har lukket ryddes uden at taelle mod loftet', async () => {
  // 22 kendte id'er, men 5 af dem er doede. 17 levende < 20 → intet skal lukkes.
  const alle = spænd(LOFT + 2);
  const levende = new Set(alle.filter(id => id > 5));
  const { evict, lukket } = byg(levende);
  const s = session(alle, alle.at(-1));
  await evict(s, alle.at(-1));
  assert.deepEqual(lukket, [], 'doede id\'er er ikke aabne faner og maa ikke udloese eviction');
  assert.equal(s.tabIds.size, LOFT - 3, 'de doede id\'er skal vaere fjernet fra sessionen');
});

test('addTabToSession udloeser kun eviction over loftet', () => {
  const i = kilde.indexOf('async function addTabToSession(');
  const blok = kilde.slice(i, i + 500);
  assert.match(blok, /if \(session\.tabIds\.size > MAX_TABS_PER_SESSION\)/,
    'eviction skal vaere betinget — ellers koeres tab-oprydning ved hver eneste ny fane');
  assert.match(blok, /await evictOldestTabs\(session, tabId\)/,
    'den netop tilfoejede fane skal gives videre, ellers kan den blive lukket igen');
});
