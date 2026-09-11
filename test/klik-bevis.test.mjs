/**
 * Et klik er landet naar noget viser det - ikke fordi intet viste det modsatte.
 *
 * MAALT 10/9 af Astra (anden runde). Fire veje i klik-stien sagde ja uden bevis eller klikkede to gange:
 *   1. settle-opslaget fejlede -> null -> "undefined !== false" -> ok:true. Men den HYPPIGSTE grund til
 *      at opslaget fejler er at klikket navigerede. Det er en virkning; agenten maa ikke klikke igen.
 *   2. museknappen var sendt, CDP koblede fra, og reserveloesningen klikkede EN GANG TIL (to effekter).
 *   3. React-fallbacken kaldte onClick direkte, OGSAA naar el.click() allerede havde udloest den.
 *   4. aftrykket saa ikke en afkrydsning eller en feltvaerdi, saa et klik der VIRKEDE blev meldt som fejl.
 *   5. intet element under punktet (fx uden for vinduet) blev meldt som "elementet forsvandt" = landet.
 *
 * Settle-udtrykket fanges fra en rigtig koersel og koeres mod en falsk side, saa det er udvidelsens
 * egen tekst der proeves - ikke en kopi af den.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const FANE = { id: 1, url: 'https://x.example', windowId: 1, active: true };
function sele(sendCommand, executeScript, tabsGet) {
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': tabsGet ?? FANE, 'tabs.query': [FANE],
    'debugger.sendCommand': sendCommand,
    'scripting.executeScript': executeScript ?? [{ result: { found: true, x: 10, y: 10, tag: 'BUTTON', text: 'OK', method: 'debugger' } }],
  } });
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1 });
  return u;
}
const erSettle = (p) => String(p?.expression || '').includes('foerAftryk');

// ── En fane i baggrunden ───────────────────────────────────────────────────
// MAALT 11/9 i Chrome for Testing med en raa CDP-proeve: Chrome leverer ikke Input.dispatchMouseEvent til en
// fane i baggrunden. Kaldet haenger, og efter Target.activateTarget svarer det paa 9 ms. browser_click kastede
// derfor "CDP svarede ikke inden 1500 ms" allerede ved musebevaegelsen, foer knappen var trykket. Samme i 1.29.0.
// Script-klikket virker paa en baggrundsfane og kan bruges uden risiko for to klik, fordi intet tryk er sendt.
function baggrundsSele(haengerVed, { landed = true } = {}) {
  let scriptingKlik = 0, klikFunc = null;
  const u = sele(
    (_m, metode, p) => {
      if (metode === 'Input.dispatchMouseEvent' && p?.type === haengerVed) return new Promise(() => {});   // som Chrome
      if (metode === 'Runtime.evaluate') return { result: { value: { landed: true } } };
      return {};
    },
    (o) => {
      if (String(o.func).includes("reason: 'not_found'")) {
        scriptingKlik++; klikFunc = String(o.func);
        return [{ result: { ok: true, tag: 'BUTTON', landed } }];
      }
      return [{ result: { found: true, x: 10, y: 10, tag: 'BUTTON', text: 'OK', method: 'debugger' } }];
    },
  );
  return { u, scriptKlik: () => scriptingKlik, klikFunc: () => klikFunc };
}

test('en fane i baggrunden: udloeber musebevaegelsen FOER trykket, klikkes der via script - én gang', { timeout: 20000 }, async () => {
  const { u, scriptKlik } = baggrundsSele('mouseMoved');
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' }).catch((e) => ({ kastet: e.message }));
  assert.equal(svar.ok, true, `klikket fejlede paa en baggrundsfane: ${JSON.stringify(svar)}`);
  assert.equal(svar.method, 'scripting-fallback');
  assert.equal(scriptKlik(), 1);
});

// MAALT 11/9 i sign-off (Astra og Fable, begge reproduceret): knappens handler kraever et aegte klik (isTrusted), eller
// den lytter kun paa pointerdown. Script-klikket gjorde intet, og svaret var ok:true. 1.29.0 svarede med en fejl.
test('en baggrundsfane hvor siden ikke reagerede paa script-klikket: ingen succes, men "kan vaere landet"', { timeout: 20000 }, async () => {
  const { u, scriptKlik } = baggrundsSele('mouseMoved', { landed: false });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' }).catch((e) => ({ kastet: e.message }));
  assert.equal(scriptKlik(), 1);
  assert.equal(svar.ok, false, `et script-klik uden virkning blev meldt som succes: ${JSON.stringify(svar)}`);
  assert.equal(svar.landed, false);
  assert.equal(svar.maaske_landet, true, 'klikket blev sendt - kalderen skal vide at det ikke maa gentages blindt');
  assert.match(JSON.stringify(svar), /switch_tab/, 'svaret skal give agenten en vej ud');
});

// Det injicerede script koeres mod en falsk side, saa det er udvidelsens egen tekst der proeves.
// reagererPaa: 'click' | 'pointerdown' | 'ingen' | 'senere' (siden opdaterer sig foerst efter klikket, som React 18/Vue 3)
// | 'dobbelt' (en handler paa pointerdown for ikke-mus-pointere OG en paa click - en rigtig mus udloeser kun click).
function scriptSide(reagererPaa) {
  const t = { tekst: 'Menu lukket', haendelser: [], handlinger: 0, noder: 0 };
  class Ev { constructor(type, o) { this.type = type; Object.assign(this, o || {}); } }
  const el = {
    tagName: 'BUTTON', isConnected: true, scrollIntoView() {},
    dispatchEvent(ev) {
      t.haendelser.push(ev.type);
      // 'ripple': Material/MDC laegger en node ind paa mousedown - en aendring der ikke er klikkets virkning.
      if (reagererPaa === 'ripple' && ev.type === 'mousedown') t.noder++;
      if (ev.type === reagererPaa) t.tekst = 'Menu aaben';
      if (reagererPaa === 'dobbelt' && ev.type === 'pointerdown' && ev.pointerType !== 'mouse') { t.handlinger++; t.tekst = 'aaben ' + t.handlinger; }
      return true;
    },
    click() {
      t.haendelser.push('click');
      if (reagererPaa === 'click') t.tekst = 'Menu aaben';
      if (reagererPaa === 'senere') setTimeout(() => { t.tekst = 'Menu aaben'; }, 10);
      if (reagererPaa === 'dobbelt') { t.handlinger++; t.tekst = 'aaben ' + t.handlinger; }
    },
  };
  const document = {
    querySelector: () => el,
    querySelectorAll: (s) => (s === '*' ? { length: 5 + t.noder } : s.startsWith('input,textarea') ? [] : { length: 0 }),
    body: { get innerText() { return t.tekst; } },
  };
  const koer = (kilde, sel) => new Function('window', 'document', 'location', 'MouseEvent', 'PointerEvent', 'return (' + kilde + ')')(
    {}, document, { href: 'https://x.example/' }, Ev, Ev)(sel);
  return { t, koer };
}
async function scriptKlikKilde() {
  const { u, klikFunc } = baggrundsSele('mouseMoved');
  await u.hent('dispatch')(9876, 'click', { selector: '#knap' }).catch(() => {});
  assert.ok(klikFunc(), 'script-klikket blev aldrig sendt');
  return klikFunc();
}

test('script-klikket maaler selv: en handler der kraever et aegte klik giver landed:false', { timeout: 20000 }, async () => {
  const { t, koer } = scriptSide('ingen');
  const r = await koer(await scriptKlikKilde(), '#knap');
  assert.ok(t.haendelser.includes('click'), 'klikket blev ikke sendt');
  assert.equal(r.landed, false, `siden reagerede ikke, men svaret var ${JSON.stringify(r)}`);
});

test('script-klikket maaler selv: en side der reagerede giver landed:true (positiv kontrol)', { timeout: 20000 }, async () => {
  const kilde = await scriptKlikKilde();
  assert.equal((await scriptSide('click').koer(kilde, '#knap')).landed, true, 'et klik der virkede blev ikke set');
  // Radix/shadcn aabner paa pointerdown. Pointer-haendelserne sendes stadig (en rigtig mus sender dem), men en aendring der
  // sker foer selve klikket, kan ikke skelnes fra en ripple (Astra, e2e 11/9) - saa den er ikke klikbevis. Aerligt uvist.
  const radix = scriptSide('pointerdown');
  const r = await radix.koer(kilde, '#knap');
  assert.ok(radix.t.haendelser.includes('pointerdown'), `pointerdown blev ikke sendt: ${radix.t.haendelser.join(',')}`);
  assert.equal(r.landed, false, 'en aendring foer klikket blev kaldt klikbevis');
});

// MAALT 11/9 af Astra (e2e-review af 1f52333): musebevaegelsen udloeb i en baggrundsfane, mousedown lagde en ripple ind, og
// knappen kraevede isTrusted. Script-klikkets aftryk var taget FOER mousedown, saa ripplen blev klikbevis: ok:true, landed:true
// med nul handlinger. 1.29.0: fristfejl, nul handlinger. Aftrykket tages nu lige foer el.click().
test('en ripple fra mousedown er ikke klikbevis for script-klikket', { timeout: 20000 }, async () => {
  const { t, koer } = scriptSide('ripple');
  const r = await koer(await scriptKlikKilde(), '#knap');
  assert.equal(t.noder, 1, 'ripplen blev ikke lagt ind - testen maaler intet');
  assert.equal(r.landed, false, `en ripple uden handling blev kaldt klikbevis: ${JSON.stringify(r)}`);
});

// Fable (efterproevning 11/9) foreslog at maale igen efter 200 ms, fordi React 18/Vue 3 opdaterer siden et tick efter
// klikket. MAALT af Astra (efterproevning af c1496d4), to regressioner: et uafhaengigt ur der aendrede siden i ventetiden
// blev til klikbevis (ok:true, nul handlinger; 1.29.0: fejl), og et klik der navigerede i ventetiden blev meldt som fejl
// (1.29.0: ok). En aendring efter klikket kan ikke tilskrives klikket, saa script-klikket maaler i samme oejeblik.
// Prisen er aerlig: en sen React-opdatering giver landed:false og maaske_landet - aldrig en falsk succes.
test('en aendring efter script-klikket tilskrives ikke klikket - et ur kan ikke skelnes fra en sen handler', { timeout: 20000 }, async () => {
  const { koer } = scriptSide('senere');
  const r = await koer(await scriptKlikKilde(), '#knap');
  assert.equal(r.landed, false, `en aendring der kom efter klikket blev kaldt klikbevis: ${JSON.stringify(r)}`);
  assert.equal(typeof r?.then, 'undefined', 'script-klikket maa svare i samme oejeblik, ikke med et ventende loefte');
});

// MAALT 11/9 af Astra (efterproevning af 9814636): siden handler paa pointerdown naar pointerType !== "mouse" og paa click.
// Script-klikkets PointerEvent havde ingen pointerType (""), saa handlingen skete to gange. 1.29.0: én. En rigtig mus
// sender pointerType "mouse".
test('script-klikkets pointerdown er en mus - en side med touch-handler og click-handler handler én gang', { timeout: 20000 }, async () => {
  const { t, koer } = scriptSide('dobbelt');
  await koer(await scriptKlikKilde(), '#knap');
  assert.equal(t.handlinger, 1, `handlingen skete ${t.handlinger} gange: ${t.haendelser.join(',')}`);
});

// Navigerer klikket siden bort, afvises scriptet ("Frame ... was removed") - klikket VAR sendt. At kaste den oprindelige
// fristfejl ville invitere agenten til at klikke igen paa en side der allerede har udfoert handlingen.
function navigationsSele(nyAdresse) {
  let efterKlik = false;
  const u = sele(
    (_m, metode, p) => {
      if (metode === 'Input.dispatchMouseEvent' && p?.type === 'mouseMoved') return new Promise(() => {});
      return {};
    },
    (o) => {
      if (String(o.func).includes("reason: 'not_found'")) { efterKlik = true; throw new Error('Frame with ID 0 was removed.'); }
      return [{ result: { found: true, x: 10, y: 10, tag: 'BUTTON', text: 'OK', method: 'debugger' } }];
    },
    () => (efterKlik && nyAdresse ? { ...FANE, url: nyAdresse } : FANE),
  );
  return u;
}

// MAALT af Astra (efterproevning af c1496d4): musebevaegelsen udloeb, en UAFHAENGIG navigation fjernede rammen foer scriptet
// koerte, og reglen "afvist script + ny adresse = klikket navigerede" svarede ok:true, navigerede:true med nul handlinger.
// 1.29.0: fejl. En ny adresse beviser ikke at det var klikket - og en afvisning beviser ikke at scriptet koerte.
test('afvises script-klikket og har fanen en ny adresse, er det IKKE en succes', { timeout: 20000 }, async () => {
  const u = navigationsSele('https://test.example/session-expired');
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' }).catch((e) => ({ kastet: e.message }));
  assert.notEqual(svar.ok, true, `en navigation der ikke skyldtes klikket blev kaldt klikbevis: ${JSON.stringify(svar)}`);
});

test('udloeber selve trykket, klikkes der IKKE via script - det kan vaere landet', { timeout: 20000 }, async () => {
  // Positiv kontrol mod en reserve der fyrer paa enhver frist.
  const { u, scriptKlik } = baggrundsSele('mousePressed');
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' }).catch((e) => ({ kastet: e.message }));
  assert.equal(scriptKlik(), 0, `script-klikket fyrede oveni et tryk der kan vaere landet: ${JSON.stringify(svar)}`);
  assert.equal(svar.maaske_landet, true, JSON.stringify(svar));
});

test('en frist paa input siger at fanen kan vaere i baggrunden, og hvad agenten skal goere', { timeout: 20000 }, async () => {
  const { u } = baggrundsSele('mouseMoved');
  const svar = await u.hent('dispatch')(9876, 'hover', { selector: '#knap' }).catch((e) => ({ kastet: e.message }));
  assert.match(JSON.stringify(svar), /baggrunden[^"]*switch_tab/, `fejlen giver ingen vej ud: ${JSON.stringify(svar)}`);
});

// ── select_option: det FAKTISKE svar, ikke kildeteksten ────────────────────
// MAALT 11/9 af Astra (R5 T1): vagten i vagter.test.mjs laeser kildeteksten, og mutationen
// `ok: klikLandede(valgKlik), ...{ok:true}` gav stadig 42/42 groenne. Her kaldes handleren, og klikket paa
// muligheden styres direkte, saa svaret skal foelge det klik.
async function vaelgICustomDropdown(valgKlik) {
  const u = sele(() => ({}));
  u.ctx.debuggerEval = async () => false;                   // ikke en native <select>
  u.ctx.resolveElement = async () => ({ x: 5, y: 5 });
  let klik = 0;
  u.ctx.debuggerClick = async () => (++klik === 1 ? { landed: true } : valgKlik);   // 1: aabn, 2: vaelg
  return u.hent('dispatch')(9876, 'select_option', { selector: '#dd', option: 'Roed', wait: 1 });
}

test('select_option: et valg-klik der ikke landede giver ok:false', async () => {
  const svar = await vaelgICustomDropdown({ landed: false, fallbackFired: true });
  assert.equal(svar.ok, false, `svaret sagde ok paa et klik der ikke landede: ${JSON.stringify(svar)}`);
  assert.match(String(svar.error), /ikke taget imod/);
});

test('select_option: et uvist valg-klik giver ikke ok:true', async () => {
  const svar = await vaelgICustomDropdown({ landed: null, uverificeret: true });
  assert.equal(svar.ok, false, `et uvist klik blev til succes: ${JSON.stringify(svar)}`);
});

test('select_option: et valg-klik der landede giver ok:true (positiv kontrol)', async () => {
  const svar = await vaelgICustomDropdown({ landed: true, fallbackFired: false });
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(svar.error, undefined);
});

test('et settle-opslag der fejler fordi siden NAVIGEREDE, er et landet klik', async () => {
  const u = sele((_m, metode, p) => {
    if (metode === 'Runtime.evaluate' && erSettle(p)) throw new Error('Cannot find context with specified id');
    return {};
  });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' });
  assert.equal(svar.ok, true, `et klik der navigerede blev meldt som fejl: ${JSON.stringify(svar)}`);
  assert.equal(svar.navigerede, true, 'kalderen skal kunne se hvorfor');
});

test('et settle-opslag der fejler af anden grund, er IKKE et landet klik', async () => {
  const u = sele((_m, metode, p) => {
    if (metode === 'Runtime.evaluate' && erSettle(p)) throw new Error('Internal error');
    return {};
  });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' });
  assert.equal(svar.ok, false, `intet bevis blev meldt som succes: ${JSON.stringify(svar)}`);
  assert.equal(svar.uverificeret, true);
});

test('afkobling EFTER at museknappen var sendt: der klikkes ikke en gang til', async () => {
  let scripting = 0;
  const u = sele((_m, metode, p) => {
    if (metode === 'Input.dispatchMouseEvent' && p?.type === 'mouseReleased') throw new Error('Detached while handling command');
    return {};
  }, () => { scripting++; return [{ result: { found: true, ok: true, x: 10, y: 10, tag: 'BUTTON', text: 'OK', method: 'debugger' } }]; });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' });
  assert.equal(scripting, 1, `reserveloesningen klikkede igen (${scripting - 1} ekstra): ${JSON.stringify(svar)}`);
  assert.equal(svar.ok, false);
  assert.equal(svar.maaske_landet, true, 'kalderen skal vide at klikket KAN vaere landet');
});

// ── Settle-udtrykket mod en falsk side ─────────────────────────────────────
let SETTLE = null;
async function settleUdtryk() {
  if (SETTLE) return SETTLE;
  const u = sele((_m, metode, p) => {
    if (metode === 'Runtime.evaluate' && erSettle(p)) SETTLE = p.expression;
    return metode === 'Runtime.evaluate' ? { result: { value: { landed: true } } } : {};
  });
  await u.hent('dispatch')(9876, 'click_xy', { x: 5, y: 5 });
  assert.ok(SETTLE, 'settle-udtrykket blev aldrig sendt');
  return SETTLE;
}
function side({ nativeVirker = true, effekt, react = false, maal = 'element', ripple = false, tekstStreng = null }) {
  const t = { checked: 0, tekst: 10, react: 0, native: 0, noder: 0, tekstStreng };
  class Ev { constructor(type, o) { this.type = type; Object.assign(this, o || {}); } }
  // ripple: som Material/MDC laegger en ripple-node ind paa mousedown - en aendring der ikke er klikkets virkning.
  const el = { isConnected: true, dispatchEvent: (ev) => {
      if (String(ev?.type).startsWith('pointer')) (t.pointerTyper ||= []).push(ev.pointerType);
      if (ripple && ev?.type === 'mousedown') t.noder++;
      return true;
    },
    closest: () => null, getAttribute: () => null,
    click() { t.native++; if (nativeVirker) effekt(t); } };
  if (react) el['__reactFiber$x'] = { memoizedProps: { onClick: () => { t.react++; effekt(t); } }, return: null };
  const document = {
    body: { get innerText() { return t.tekstStreng ?? 'x'.repeat(t.tekst); } },
    querySelectorAll: (s) => s === '*' ? { length: 20 + t.noder } : s.includes(':checked') ? { length: t.checked } : s.startsWith('input,textarea') ? [] : { length: 0 },
    removeEventListener() {},
  };
  const window = { __bmcpClickTarget: maal === 'intet' ? null : el, __bmcpClicked: false, __bmcpClickListener: null };
  const koer = (udtryk) => new Function('window', 'document', 'location', 'MouseEvent', 'PointerEvent', 'return ' + udtryk)(
    window, document, { href: 'https://x.example/' }, Ev, Ev);
  return { t, koer };
}

test('en afkrydsning der blev sat, er et landet klik', async () => {
  const { t, koer } = side({ effekt: (s) => { s.checked++; } });
  const r = koer(await settleUdtryk());
  assert.equal(t.native, 1, 'reserveloesningen klikkede mere end én gang - en afkrydsning ender hvor den startede');
  assert.equal(t.checked, 1);
  assert.equal(r.landed, true, `aftrykket saa ikke afkrydsningen: ${r.aftrykFoer} -> ${r.aftrykEfter}`);
});

// Samme moenster som Astras dobbelt-effekt i script-klikket (11/9): en PointerEvent uden pointerType er ikke en mus.
test('debuggerens reserve sender pointer-haendelser som en mus', async () => {
  const { t, koer } = side({ effekt: (s) => { s.checked++; } });
  koer(await settleUdtryk());
  assert.ok((t.pointerTyper || []).length > 0, 'reserven sendte ingen pointer-haendelser - testen maaler intet');
  assert.ok(t.pointerTyper.every((p) => p === 'mouse'), `pointerType var ${JSON.stringify(t.pointerTyper)}`);
});

test('virkede el.click(), kaldes Reacts onClick IKKE en gang til', async () => {
  const { t, koer } = side({ react: true, effekt: (s) => { s.tekst++; } });
  const r = koer(await settleUdtryk());
  assert.equal(t.react, 0, `onClick koerte ${t.react} gang(e) oveni et klik der allerede virkede`);
  assert.equal(r.landed, true);
});

test('virkede el.click() IKKE, faar React-fallbacken sin chance', async () => {
  // Positiv kontrol: ellers ville en fallback der aldrig fyrer bestaa testen ovenfor.
  const { t, koer } = side({ react: true, nativeVirker: false, effekt: (s) => { s.tekst++; } });
  const r = koer(await settleUdtryk());
  assert.equal(t.react, 1);
  assert.equal(r.landed, true);
});

// MAALT 11/9 af Astra (R5 F5), reproduceret: mousedown laegger en ripple-node ind, el.click() udfoerer
// ikke handlingen, og React-fallbacken er noedvendig. Aftrykket blev taget FOER mousedown, saa ripplen
// lignede en virkning af el.click(), React blev sprunget over, og svaret var landed:true med nul handling.
test('en ripple fra mousedown skjuler ikke at el.click() intet gjorde - React faar sin chance', async () => {
  const { t, koer } = side({ react: true, nativeVirker: false, ripple: true, effekt: (s) => { s.checked++; } });
  const r = koer(await settleUdtryk());
  assert.equal(t.react, 1, `React-handleren blev ${t.react ? 'kaldt ' + t.react + ' gange' : 'sprunget over'} - handlingen skete ${t.checked} gang(e)`);
  assert.equal(t.checked, 1);
  assert.equal(r.landed, true);
});

test('ripple + et el.click() der VIRKEDE: React kaldes stadig ikke en gang til', async () => {
  // Positiv kontrol mod en rettelse der bare altid kalder React.
  const { t, koer } = side({ react: true, ripple: true, effekt: (s) => { s.checked++; } });
  koer(await settleUdtryk());
  assert.equal(t.react, 0, `onClick koerte oveni et klik der allerede virkede (${t.checked} handlinger)`);
  assert.equal(t.checked, 1);
});

// MAALT 11/9 af Astra (R5 F6), reproduceret: ét virkende klik aendrer teksten AAAA -> BBBB. Aftrykket
// talte kun tekstens LAENGDE, saa aendringen var usynlig og click_xy svarede ok:false paa et klik der virkede.
test('tekst der skifter indhold men ikke laengde, er en virkning', async () => {
  const { koer } = side({ tekstStreng: 'AAAA', effekt: (s) => { s.tekstStreng = 'BBBB'; } });
  const r = koer(await settleUdtryk());
  assert.equal(r.landed, true, `aftrykket saa ikke AAAA -> BBBB: ${r.aftrykFoer} -> ${r.aftrykEfter}`);
});

test('intet element under punktet er ikke "elementet forsvandt"', async () => {
  const { koer } = side({ maal: 'intet', effekt: () => {} });
  const r = koer(await settleUdtryk());
  assert.notEqual(r.detached, true, 'et klik ved siden af alt blev meldt som landet');
  assert.equal(r.intetMaal, true);
});

// ── Tredje runde (Astra) ────────────────────────────────────────────────────
test('"not attached" paa samme adresse er IKKE en navigation', async () => {
  // Afkobling sker ogsaa naar nogen aabner DevTools eller annullerer debuggeren - siden er uaendret.
  const u = sele((_m, metode, p) => {
    if (metode === 'Runtime.evaluate' && erSettle(p)) throw new Error('Debugger is not attached to the tab with id: 1.');
    return {};
  });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' });
  assert.notEqual(svar.navigerede, true, `en afkobling blev kaldt navigation: ${JSON.stringify(svar)}`);
  assert.equal(svar.ok, false);
  assert.equal(svar.uverificeret, true);
});

test('en adresse der skiftede efter klikket, er bevis for en virkning', async () => {
  let efterKlik = false;
  const u = sele((_m, metode, p) => {
    if (metode === 'Runtime.evaluate' && erSettle(p)) { efterKlik = true; throw new Error('Internal error'); }
    return {};
  }, undefined, () => (efterKlik ? { ...FANE, url: 'https://x.example/kvittering' } : FANE));
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' });
  assert.equal(svar.navigerede, true, `siden skiftede adresse, men klikket blev ikke kaldt landet: ${JSON.stringify(svar)}`);
  assert.equal(svar.ok, true);
});

test('fejler mousePressed efter levering, slippes museknappen alligevel', async () => {
  const typer = [];
  const u = sele((_m, metode, p) => {
    if (metode === 'Input.dispatchMouseEvent') {
      typer.push(p.type);
      if (p.type === 'mousePressed') throw new Error('Detached while handling command');
    }
    return {};
  });
  const svar = await u.hent('dispatch')(9876, 'click', { selector: '#knap' });
  assert.ok(typer.includes('mouseReleased'), `museknappen blev aldrig sluppet: ${typer.join(',')}`);
  assert.equal(svar.maaske_landet, true);
});

test('click_xy: afkobling efter at museknappen var sendt giver maaske_landet, ikke en kastet fejl', async () => {
  const u = sele((_m, metode, p) => {
    if (metode === 'Input.dispatchMouseEvent' && p?.type === 'mouseReleased') throw new Error('Detached while handling command');
    return {};
  });
  const svar = await u.hent('dispatch')(9876, 'click_xy', { x: 5, y: 5 }).catch((e) => ({ kastet: e.message }));
  assert.equal(svar.kastet, undefined, `fejlen slap ud, og markeringen gik tabt over forbindelsen: ${svar.kastet}`);
  assert.equal(svar.maaske_landet, true);
  assert.equal(svar.ok, false);
});

test('click, click_xy og select_option bruger SAMME regel for et landet klik', () => {
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  // select_option havde stadig den gamle regel, saa "uverificeret" (landed:null) blev til ok:true.
  assert.equal((kilde.match(/\?\.landed !== false/g) || []).length, 0, 'den gamle regel ("ikke falsk" = landet) findes stadig');
  for (const navn of ["case 'click': {", "case 'click_xy': {", "case 'select_option': {"]) {
    const i = kilde.indexOf(navn);
    assert.ok(i > -1, `${navn} findes ikke`);
    const blok = kilde.slice(i, kilde.indexOf("\n    case '", i + 10));
    assert.match(blok, /klikLandede\(/, `${navn} bruger ikke den faelles regel`);
  }
  const landede = indlaesUdvidelse({ svar: {} }).hent('klikLandede');
  assert.equal(landede({ landed: null, uverificeret: true }), false, 'uvist er ikke landet');
  assert.equal(landede({ landed: false, detached: true }), true, 'et element der forsvandt er en virkning');
  assert.equal(landede({ landed: true }), true);
  assert.equal(landede(null), false);
});

test('select_option giver ikke baade succes og fejl - fejlteksten foelger samme regel', () => {
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const i = kilde.indexOf("case 'select_option': {");
  const blok = kilde.slice(i, kilde.indexOf("\n    case '", i + 10));
  assert.doesNotMatch(blok, /valgKlik\?\.landed === false/, 'fejlteksten bruger stadig den gamle regel');
  assert.match(blok, /!klikLandede\(valgKlik\)/);
});
