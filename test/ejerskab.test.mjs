/**
 * Agenten maa kun naa det den selv har aabnet, og kun det domaene den har bedt om.
 *
 * MAALT 10/9, reproduceret i selen foer rettelsen — alle tre var live i 1.29.0:
 *
 *   get_new_tab  `lastCreatedTabId` blev sat paa HVER onCreated, ogsaa naar brugeren selv
 *                trykkede Cmd+T. Reproduktion: bruger aabner brugerens-netbank.example ->
 *                get_new_tab svarer med den -> fanen staar i sessionens tabIds. Derefter er
 *                skaermbillede, sidetekst og localStorage af BRUGERENS fane lovligt.
 *
 *   get_cookies  Uden `domain` blev filteret til chrome.cookies.getAll `{}` — intet filter,
 *                altsaa hver eneste cookie i profilen, inkl. httpOnly-sessionscookies som
 *                sidens eget JS ikke maa se. Skemaet siger required:['domain'], men serveren
 *                videresender argumenter uvalideret, saa skemaet var en henstilling.
 *
 *   upload_file  Stien gik raat til DOM.setFileInputFiles. Skaermbilledets `path` fik en
 *                indeslutning 23/8 med begrundelsen "argumenterne kommer fra en model der
 *                laeser FREMMEDE websider". Upload fik den aldrig — og DER forlader filen
 *                faktisk maskinen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

function sele(faneSvar) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': faneSvar,
    'tabs.query': [faneSvar],
    'cookies.getAll': (f) => { u.__filter = JSON.stringify(f); return []; },
    'tabGroups.update': undefined,
    'tabs.group': 7,
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('en fane BRUGEREN aabnede bliver ikke agentens', async () => {
  const u = sele({ id: 99, url: 'https://brugerens-netbank.example', windowId: 1, active: true });
  await u.fyr('tabs.onCreated', { id: 99, url: 'https://brugerens-netbank.example', windowId: 1 });
  const r = await u.hent('dispatch')(9876, 'get_new_tab', {});
  assert.equal(r.error, 'not-ours', 'en fane uden opener i sessionen tilhoerer brugeren');
  assert.ok(!u.hent('sessions').get(9876).tabIds.has(99),
    'og den maa ikke ende i sessionen — saa ville skaermbillede og sidetekst vaere lovligt');
});

test('en fane vores egen side aabnede, er vores', async () => {
  const u = sele({ id: 100, url: 'https://vores.example', windowId: 1, active: true });
  await u.fyr('tabs.onCreated', { id: 100, url: 'https://vores.example', windowId: 1, openerTabId: 1 });
  const r = await u.hent('dispatch')(9876, 'get_new_tab', {});
  assert.equal(r.error, undefined, `et link med target=_blank fra vores egen fane skal virke: ${r.hint || ''}`);
});

test('get_cookies uden domaene afvises — ellers er filteret hele krukken', async () => {
  const u = sele({ id: 1, url: 'https://a.example', windowId: 1, active: true });
  const r = await u.hent('dispatch')(9876, 'get_cookies', {});
  assert.equal(r.error, 'domain-mangler');
  assert.equal(u.__filter, undefined, 'chrome.cookies.getAll maa slet ikke naas uden domaene');
});

test('get_cookies MED domaene virker uaendret', async () => {
  const u = sele({ id: 1, url: 'https://a.example', windowId: 1, active: true });
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'a.example' });
  assert.equal(r.error, undefined, 'et lovligt kald maa ikke rammes af vagten');
  assert.match(u.__filter || '', /a\.example/, 'domaenet skal naa Chrome');
});

// MAALT 11/9 af Astra (R5 F7), reproduceret: sessionen staar paa https://a.example.com/, og kaldet beder om
// domain "example.com". En cookie med Domain=.example.com; Path=/api kom med i 1.29.0 men manglede i HEAD:
// {url} giver kun cookies til sidens egen sti, og {domain: vaert} holdt kun cookies hvis domaene ER vaertsnavnet.
// Stubben filtrerer som Chrome: {url} efter vaert og sti, {domain} efter domaene og underdomaener.
function cookieSele(cookies, { url = 'https://a.example.com/', incognito = false, lagre = [] } = {}) {
  const fane = { id: 1, url, windowId: 1, active: true, incognito };
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    'cookies.getAllCookieStores': lagre,
    // Som Chrome: uden storeId laeses standardlageret ("0"); {url} udelader Secure-cookies for en http-adresse.
    'cookies.getAll': (f) => cookies.filter((c) => {
      if ((c.storeId ?? '0') !== (f.storeId ?? '0')) return false;
      const cd = c.domain.replace(/^\./, '');
      if (f.url) {
        const a = new URL(f.url);
        const vaertPasser = c.hostOnly ? a.hostname === cd : (a.hostname === cd || a.hostname.endsWith('.' + cd));
        return vaertPasser && a.pathname.startsWith(c.path) && (!c.secure || a.protocol === 'https:');
      }
      if (f.domain) return cd === f.domain || cd.endsWith('.' + f.domain);
      return true;
    }),
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('get_cookies: overdomaenets cookie paa en anden sti kommer med (F7)', async () => {
  const u = cookieSele([{ name: 'api', value: 'v', domain: '.example.com', path: '/api' }]);
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'example.com' });
  assert.deepEqual(Array.from(r.cookies || [], (c) => c.name), ['api'], `overdomaenets /api-cookie mangler: ${JSON.stringify(r)}`);
});

test('get_cookies: en soeskendevaerts cookie kommer IKKE med', async () => {
  // Positiv kontrol mod en rettelse der bare returnerer alt under det domaene der blev bedt om.
  const u = cookieSele([
    { name: 'api', value: 'v', domain: '.example.com', path: '/api' },
    { name: 'bank', value: 'hemmelig', domain: 'bank.example.com', path: '/' },
    // En host-only-cookie paa example.com sendes kun til example.com selv - aldrig til a.example.com.
    { name: 'kunVaert', value: 'hemmelig', domain: 'example.com', hostOnly: true, path: '/' },
  ]);
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'example.com' });
  assert.deepEqual(Array.from(r.cookies || [], (c) => c.name).sort(), ['api'], `en anden vaerts cookie slap med: ${JSON.stringify(r)}`);
});

// Fable (sign-off 11/9): en session paa http://a.example.com/ fik en Secure-cookie fra .example.com. Chrome sender aldrig
// en Secure-cookie til en http-side; opslaget paa {domain} kender ikke sidens protokol, saa det skal tjekkes her.
test('get_cookies: en Secure-cookie leveres ikke til en http-side', async () => {
  const u = cookieSele([{ name: 'sikker', value: 'hemmelig', domain: '.example.com', path: '/', secure: true }], { url: 'http://a.example.com/' });
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'example.com' });
  assert.deepEqual(Array.from(r.cookies || [], (c) => c.name), [], `en Secure-cookie slap igennem til http: ${JSON.stringify(r)}`);
});

// MAALT af Astra (efterproevning af c1496d4): fanen http://localhost/ og Secure-cookien sid; Path=/api. 1.29.0 leverede den,
// HEAD skjulte den. Chromium regner localhost for sikker og sender Secure-cookies dertil over http.
test('get_cookies: en Secure-cookie leveres til http://localhost, som Chromium selv goer', async () => {
  const u = cookieSele([{ name: 'sid', value: 'LOCAL', domain: 'localhost', hostOnly: true, path: '/api', secure: true }], { url: 'http://localhost/' });
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'localhost' });
  assert.deepEqual(Array.from(r.cookies || [], (c) => c.name), ['sid'], `localhost-cookien blev skjult: ${JSON.stringify(r)}`);
});

test('get_cookies: en Secure-cookie leveres til en https-side (positiv kontrol)', async () => {
  const u = cookieSele([{ name: 'sikker', value: 'v', domain: '.example.com', path: '/', secure: true }]);
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'example.com' });
  assert.deepEqual(Array.from(r.cookies || [], (c) => c.name), ['sikker']);
});

// Astra (sign-off 11/9): fejler getAllCookieStores for en inkognitofane, udelades storeId, og Chrome laeser saa den
// almindelige profils lager - samme i 1.29.0, men det er brugerens andet liv. Kan lageret ikke findes, laeses intet.
test('get_cookies: en inkognitofane hvis lager ikke kan findes, laeser ikke den almindelige profils cookies', async () => {
  const u = cookieSele([{ name: 'profil', value: 'hemmelig', domain: '.example.com', path: '/' }], { incognito: true, lagre: () => { throw new Error('lagre utilgaengelige'); } });
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'example.com' });
  assert.doesNotMatch(JSON.stringify(r), /hemmelig/, `den almindelige profils cookie blev leveret til en inkognitofane: ${JSON.stringify(r)}`);
  assert.equal(r.ok, false);
});

test('get_cookies: en inkognitofane med kendt lager laeser sit eget lager (positiv kontrol)', async () => {
  const u = cookieSele([
    { name: 'profil', value: 'hemmelig', domain: '.example.com', path: '/' },
    { name: 'inkognito', value: 'v', domain: '.example.com', path: '/', storeId: '1' },
  ], { incognito: true, lagre: [{ id: '0', tabIds: [] }, { id: '1', tabIds: [1] }] });
  const r = await u.hent('dispatch')(9876, 'get_cookies', { domain: 'example.com' });
  assert.deepEqual(Array.from(r.cookies || [], (c) => c.name), ['inkognito'], JSON.stringify(r));
});

// MAALT 11/9 af Opus og Fable (e2e-review): get_cookies er begraenset til sessionens egne sider, men set_cookies satte
// cookies paa ETHVERT domaene - ogsaa banker sessionen aldrig har aabnet. Butikkens egen begrundelse lovede det modsatte.
// Samme regel som laesningen: kun de http(s)-sider sessionen har aabne.
function saetSele(cookies = [], { url = 'https://a.example.com/', urls = null, incognito = false, lagre = [] } = {}) {
  const adresser = urls || [url];
  const faner = adresser.map((a, i) => ({ id: i + 1, url: a, windowId: 1, active: i === 0, incognito }));
  const satte = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': (id) => faner.find((f) => f.id === id) || faner[0], 'tabs.query': faner,
    'cookies.getAllCookieStores': lagre,
    'cookies.set': (c) => { satte.push(c); return { ...c }; },
    'cookies.getAll': () => cookies,
  } });
  u.hent('sessions').set(9876, {
    tabIds: new Set(faner.map((f) => f.id)), activeTabId: 1, groupId: 1, label: 't', color: 'blue',
  });
  return { u, satte };
}

test('set_cookies: en cookie til et domaene sessionen ikke har aabnet, saettes ikke', async () => {
  const { u, satte } = saetSele();
  const r = await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', domain: 'bank.example.dk' }] });
  assert.equal(satte.length, 0, `cookien blev sat paa et fremmed domaene: ${JSON.stringify(satte)}`);
  assert.match(JSON.stringify(r), /domaene-ikke-i-sessionen/, JSON.stringify(r));
});

test('set_cookies: sessionens eget domaene virker uaendret (positiv kontrol)', async () => {
  const { u, satte } = saetSele();
  const r = await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', domain: 'a.example.com' }] });
  assert.equal(satte.length, 1, `en lovlig cookie blev afvist: ${JSON.stringify(r)}`);
  assert.equal(r.results?.[0]?.ok, true, JSON.stringify(r));
});

test('set_cookies: et overdomaene sessionens side faar tilsendt, er lovligt (positiv kontrol)', async () => {
  const { u, satte } = saetSele();
  await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', domain: '.example.com' }] });
  assert.equal(satte.length, 1, 'overdomaenet til sessionens egen side blev afvist');
});

// MAALT 11/9 af Astra (e2e runde 2): sessionen har kun https://a.example.com/ aaben, men en cookie til det UAABNEDE
// underdomaene bank.example.com slap igennem, fordi slaegtskabet blev laest begge veje. get_cookies afviser netop det,
// og CHANGELOG lover "samme regel". Reglen er nu laesningens: cookiens domaene skal vaere vaerten selv eller et
// overdomaene, som sidens vaert faar cookies fra.
test('set_cookies: et underdomaene sessionen ikke har aabnet, afvises', async () => {
  const { u, satte } = saetSele([], { url: 'https://example.com/' });   // Astras scenarie: sessionen staar paa selve example.com
  const r = await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', domain: 'bank.example.com' }] });
  assert.equal(satte.length, 0, `cookien blev sat paa et uaabnet underdomaene: ${JSON.stringify(satte)}`);
  assert.match(JSON.stringify(r), /domaene-ikke-i-sessionen/, JSON.stringify(r));
});

// MAALT 12/9 af Astra (efterproevning af 19d036a): sessionen har baade a.example.com og example.com aabne. Et kald med
// url https://example.com/login og UDEN domain blev skrevet paa a.example.com - fordi slaegtskabs-tjekket tog den
// foerste fane der ENDTE paa domaenet, og adressen derefter blev bygget af netop den side. Svaret var ok:true, saa
// hverken agenten eller brugeren kunne se at cookien landede paa en anden vaert. Uden `domain` er en cookie host-only
// (Chromes cookies.set), saa vaerten ER hele betydningen.
test('set_cookies: en vaert sessionen HAR aabnet, vinder over et underdomaene der blot ender paa den', async () => {
  const { u, satte } = saetSele([], { urls: ['https://a.example.com/', 'https://example.com/'] });
  const r = await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', url: 'https://example.com/login' }] });
  assert.equal(satte.length, 1, `cookien blev ikke sat: ${JSON.stringify(r)}`);
  assert.match(String(satte[0].url), /^https:\/\/example\.com\//,
    `cookien landede paa en anden vaert end den der blev bedt om: ${satte[0].url}`);
});

// Samme fund, den anden halvdel: er den noejagtige vaert IKKE aaben, og kalderen ikke selv har sagt `domain`, saa kan
// oensket (en host-only cookie paa example.com) slet ikke opfyldes. Foer landede den paa underdomaenet med ok:true.
test('set_cookies: en host-only cookie til en vaert sessionen ikke har aabnet, afvises', async () => {
  const { u, satte } = saetSele([], { url: 'https://a.example.com/' });
  const r = await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', url: 'https://example.com/login' }] });
  assert.equal(satte.length, 0, `cookien landede paa en anden vaert: ${JSON.stringify(satte)}`);
  assert.match(JSON.stringify(r), /domaene-ikke-i-sessionen/, JSON.stringify(r));
});

// MAALT samme runde af Opus: vagten tjekkede `domain`, men sendte kalderens egen `url` videre utjekket. Adressen bygges nu
// af sessionens egen side, saa Chrome selv haandhaever sine domaeneregler (bl.a. public suffix).
test('set_cookies: adressen kommer fra sessionens side, ikke fra kalderen', async () => {
  const { u, satte } = saetSele();
  await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', domain: 'a.example.com', url: 'https://bank.example.dk/andet' }] });
  assert.equal(satte.length, 1, 'en lovlig cookie blev afvist');
  assert.match(String(satte[0].url), /^https:\/\/a\.example\.com\//, `adressen kom fra kalderen: ${satte[0].url}`);
});

// MAALT samme runde af Opus: fra en inkognitofane skrev set_cookies uden storeId - altsaa i den ALMINDELIGE profils lager.
// get_cookies blev rettet her; skrivningen skal foelge samme regel.
test('set_cookies: en inkognitofane skriver i sit eget lager', async () => {
  const { u, satte } = saetSele([], { incognito: true, lagre: [{ id: '0', tabIds: [] }, { id: '1', tabIds: [1] }] });
  await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', domain: 'a.example.com' }] });
  assert.equal(satte.length, 1, 'en lovlig cookie blev afvist');
  assert.equal(satte[0].storeId, '1', `skrev i lager ${satte[0].storeId ?? 'uden storeId'} - altsaa den almindelige profil`);
});

test('set_cookies: en inkognitofane uden kendt lager skriver ingenting', async () => {
  const { u, satte } = saetSele([], { incognito: true, lagre: () => { throw new Error('lagre utilgaengelige'); } });
  const r = await u.hent('dispatch')(9876, 'set_cookies', { cookies: [{ name: 'sid', value: 'x', domain: 'a.example.com' }] });
  assert.equal(satte.length, 0, `skrev i et ukendt lager: ${JSON.stringify(satte)}`);
  assert.match(JSON.stringify(r), /cookie-lager-ukendt|domaene-ikke-i-sessionen/, JSON.stringify(r));
});

test('upload-stien er indesluttet i arbejdsmappen — samme vagt som skaermbilledets path', () => {
  const srv = readFileSync(new URL('../mcp-server/index.js', import.meta.url), 'utf8');
  const i = srv.indexOf("if (method === 'upload_file' || method === 'drop_file')");
  assert.ok(i > -1, 'vagten mod stier uden for arbejdsmappen er vaek fra upload');
  // Astra 10/9: ordenen blev sammenlignet med methodMap, ikke med afsendelsen. Nu med afsendelsen.
  const slut = srv.indexOf('await sendToExtension(method, args || {}, timeout)');
  assert.ok(slut > i, 'vagten skal ligge FOER kaldet sendes til udvidelsen');
  const blok = srv.slice(i, slut);
  assert.match(blok, /resolve\(process\.cwd\(\)\)/, 'roden skal vaere arbejdsmappen');
  assert.match(blok, /realpathSync\.native\(raaSti\)/, 'stien skal loeses af operativsystemet (links foer ".."), ikke som tekst');
  assert.match(blok, /args\.files = kanoniske/, 'det er den LOESTE sti der sendes videre - ellers er det godkendte og det aabnede to filer');
  assert.match(blok, /homedir\(\)/, '~ skal foldes ud, ellers slipper ~/.ssh/id_rsa forbi som relativ sti');
});
