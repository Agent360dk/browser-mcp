/**
 * En testbrowser skal kunne koere paa sine EGNE porte uden at repoets filer aendrer sig.
 *
 * MAALT 12/9 af Astra: serveren sender kun til den NYESTE forbundne udvidelse (mcp-server/index.js:95/124/1077).
 * En agent-browser paa 9876-9895 bliver derfor "nyeste" for hver eneste koerende chats server - og en vilkaarlig af
 * Gustavs 5-12 chats kunne komme til at handle inde i den profil. Portisolation er forudsaetningen for overhovedet at
 * have en agent-browser.
 *
 * Mit foerste forslag var at flytte portene til manifestet. Astra maalte at det var forkert: konstanterne ligger i
 * `offscreen.js`, som ER i kode-aftrykket (KODEFILER), saa flytningen ville FJERNE dem fra udgivelsens spaerre.
 * Vejen her er hendes: omraadet kommer fra `chrome.storage.local` via dokumentets adresse - praecis som versionen
 * allerede goer. Repoets filer er byte-identiske, og aftrykket er uroert.
 *
 * Og det er samtidig den eneste maade at faa spaerren til at koere GROENT i en isoleret browser: i alle seks
 * flow-koersler 12/9 var den sjette "fejl" netop at portene var lappet i kopien.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const offKilde = readFileSync(new URL('../extension/offscreen.js', import.meta.url), 'utf8');

/** Klipper en funktion (eller const) ud af kilden ved at matche tuborgklammer. Samme greb som offscreen-recovery. */
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

/** Rejser den AEGTE ensureOffscreen og rapporterer hvilken adresse dokumentet blev oprettet med. */
async function opretMed(lagerVaerdi) {
  const gemt = lagerVaerdi === undefined ? {} : { bmcpPorte: lagerVaerdi };
  let url = null;
  const chrome = {
    offscreen: {
      hasDocument: async () => false,
      closeDocument: async () => {},
      createDocument: async (o) => { url = o.url; },
    },
    runtime: {
      sendMessage: async () => Promise.reject(new Error('ingen modtager')),
      getManifest: () => ({ version: '1.29.1' }),
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
    udklip('PORTE_MAX_SPAEND', false),
    udklip('portOmraadeFraLager'),
    udklip('offscreenSvarer'),
    udklip('ensureOffscreen'),
    'return ensureOffscreen();',
  ].join('\n');
  const fn = new Function('chrome', 'console', 'Date', `return (async () => { ${src} })()`);
  await fn(chrome, { warn() {}, log() {} }, Date);
  return url;
}

test('uden en gemt vaerdi er adressen praecis som foer - standarden er uaendret', async () => {
  const url = await opretMed(undefined);
  assert.match(String(url), /^offscreen\.html\?v=1\.29\.1$/, `adressen aendrede sig for en almindelig bruger: ${url}`);
});

test('en gyldig vaerdi foelger med dokumentet, saa en testbrowser kan isoleres', async () => {
  const url = await opretMed('19970-19974');
  assert.match(String(url), /[?&]porte=19970-19974(&|$)/, `portomraadet naaede ikke dokumentet: ${url}`);
  assert.match(String(url), /v=1\.29\.1/, 'versionen maa ikke forsvinde');
});

// En vaerdi i chrome.storage kan kun saettes af udvidelsen selv eller af nogen med devtools-adgang til den - altsaa
// nogen der allerede ejer udvidelsen. Men vagten skal alligevel vaere staerk: et vildt spaend ville faa HVER brugers
// browser til at probe tusindvis af porte hvert andet sekund.
for (const [navn, vaerdi] of [
  ['bogstaver', 'abc-def'],
  ['omvendt raekkefoelge', '19974-19970'],
  ['under 1024', '80-90'],
  ['over 65535', '60000-70000'],
  ['alt for bredt spaend', '10000-60000'],
  ['tom streng', ''],
  ['tal uden bindestreg', '19970'],
  ['indsprojtning', '19970-19974&v=0.0.1'],
]) {
  test(`en ugyldig vaerdi ignoreres: ${navn}`, async () => {
    const url = await opretMed(vaerdi);
    assert.doesNotMatch(String(url), /porte=/, `en ugyldig vaerdi slap igennem (${navn}): ${url}`);
  });
}

// ── offscreen-siden: laeser den omraadet, og falder den tilbage? ──────────────
function portomraadeFor(soegning) {
  const m = /function portOmraade\s*\(\)[\s\S]*?\n\}/.exec(offKilde);
  assert.ok(m, 'portOmraade findes ikke i offscreen.js');
  const fn = new Function('location', 'URLSearchParams', `${m[0]}; return portOmraade();`);
  return fn({ search: soegning }, URLSearchParams);
}

test('offscreen laeser portomraadet fra sin egen adresse', () => {
  assert.deepEqual(portomraadeFor('?v=1.29.1&porte=19970-19974'), [19970, 19974]);
});

test('offscreen falder tilbage til 9876-9895 uden parameteren', () => {
  assert.deepEqual(portomraadeFor('?v=1.29.1'), [9876, 9895]);
  assert.deepEqual(portomraadeFor(''), [9876, 9895]);
});

test('offscreen afviser ogsaa selv en ugyldig vaerdi - vagten staar begge steder', () => {
  for (const s of ['?porte=abc', '?porte=19974-19970', '?porte=80-90', '?porte=10000-60000']) {
    assert.deepEqual(portomraadeFor(s), [9876, 9895], `slap igennem: ${s}`);
  }
});

// Hele pointen med at bruge chrome.storage frem for manifestet: filerne aendrer sig ikke, saa spaerren er uroert.
test('mekanismen svaekker IKKE udgivelsens spaerre - portene er stadig i den hashede fil', () => {
  const m = /const KODEFILER = \[([^\]]*)\]/.exec(offKilde);
  assert.ok(m, 'KODEFILER findes ikke');
  assert.match(m[1], /offscreen\.js/, 'offscreen.js er ikke laengere med i aftrykket - saa er portene uden for spaerren');
  assert.match(offKilde, /function portOmraade/, 'portomraadet laeses ikke i den hashede fil');
  // Og standarden skal stadig staa i koden, ikke i en fil uden for aftrykket.
  assert.match(offKilde, /9876/, 'standard-portomraadet staar ikke i offscreen.js');
  assert.match(offKilde, /9895/, 'standard-portomraadet staar ikke i offscreen.js');
});

test('de to kopier af udvidelsen er stadig byte-identiske', () => {
  const h = (p) => createHash('sha256').update(readFileSync(new URL(p, import.meta.url))).digest('hex');
  for (const f of ['background.js', 'offscreen.js']) {
    assert.equal(h(`../extension/${f}`), h(`../mcp-server/extension/${f}`), `${f} er ikke spejlet`);
  }
});

// MAALT 12/9 af Astra (F1): de to vagter deler en graense, men ikke en kilde. `PORTE_MAX_SPAEND` staar i background.js,
// og `200` staar haardkodet i offscreen.js' portOmraade. Hun muterede BEGGE veje (200 -> 5000) og fik 45/45 groenne:
// ingen proeve saa forskellen.
//
// Skaden ved en fremtidig divergens er den STILLE slags: background haefter et bredt spaend paa adressen, offscreen
// afviser det og falder tilbage til 9876-9895 - saa tror testbrowseren den er isoleret, mens den ligger paa praecis
// det spaend alle andre chats bruger. Det er den skade isolationen findes for.
test('de to vagter doemmer ens - ellers tror en testbrowser den er isoleret uden at vaere det', () => {
  const maksBg = Number(/const PORTE_MAX_SPAEND = (\d+);/.exec(kilde)?.[1]);
  assert.ok(maksBg > 0, 'PORTE_MAX_SPAEND kunne ikke laeses i background.js');
  const maksOff = Number(/til - fra < (\d+)\)/.exec(offKilde)?.[1]);
  assert.ok(maksOff > 0, 'graensen kunne ikke laeses i offscreen.js');
  assert.equal(maksOff, maksBg,
    `background accepterer spaend under ${maksBg}, offscreen under ${maksOff} - i forskellen falder isolationen tavst tilbage til faellesspaendet`);

  // Og ikke kun tallet: de skal doemme ens paa de samme vaerdier.
  for (const [fra, til] of [[19970, 19974], [1024, 1223], [1024, 1024 + maksBg - 1], [1024, 1024 + maksBg], [80, 90], [60000, 70000]]) {
    const bgOk = fra >= 1024 && til <= 65535 && til >= fra && til - fra < maksBg;
    const offSvar = portomraadeFor(`?porte=${fra}-${til}`);
    const offOk = offSvar[0] === fra && offSvar[1] === til;
    assert.equal(offOk, bgOk, `de to vagter er uenige om ${fra}-${til}: background=${bgOk}, offscreen=${offOk}`);
  }
});

