/**
 * browser_extract_list paa et feed der henter flere raekker paa hjulet (#11, 1.30.2 skive 9).
 *
 * Rapporteret paa Threads: listen blev rullet med scrollTop/scrollBy, som udloeser `scroll`, aldrig `wheel`. Feedet hentede
 * intet, og reached_end blev sand efter to-tre runder ved bunden af det der allerede var tegnet - agenten konkluderede
 * at profilen «kun har N opslag». Proeven bygger et feed der KUN henter paa hjulet, og koerer udvidelsens egen rullefunktion
 * mod det: den indsatte funktion koeres mod en falsk side, og hjulet gaar gennem debuggerens Input.dispatchMouseEvent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

// Et feed i en indre rulle-container. Det henter `parti` nye raekker, naar et hjul rammer containeren taet paa bunden.
// En scrollTop-rulning flytter listen, men henter intet - som paa Threads.
function feed({ start = 10, i_alt = 40, parti = 10, hentPaa = 'wheel', raekkeHoejde = 50, hoejde = 300, pladsholdere = 0, voksFoerRul = false } = {}) {
  const s = { tegnet: start, scrollTop: 0, hjul: 0, hjulUdenfor: 0, ekstra: 0, venter: 0 };
  // En langsom loader: de foerste `pladsholdere` gange laegger den kun hoejde ind (skeletter), saa kommer raekkerne.
  const hent = () => {
    if (s.tegnet >= i_alt) return;
    if (s.venter < pladsholdere) { s.venter++; s.ekstra += 100; return; }
    s.venter = 0; s.ekstra = 0; s.tegnet = Math.min(i_alt, s.tegnet + parti);
  };
  const container = {
    get scrollHeight() { return s.tegnet * raekkeHoejde + s.ekstra; },
    clientHeight: hoejde,
    get scrollTop() { return s.scrollTop; },
    set scrollTop(v) {
      s.scrollTop = Math.max(0, Math.min(v, this.scrollHeight - hoejde));
      if (hentPaa === 'scroll' && s.scrollTop + hoejde >= this.scrollHeight - 60) hent();
    },
    parentElement: null,
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 500, bottom: 100 + hoejde, width: 400, height: hoejde }),
  };
  const raekker = () => Array.from({ length: s.tegnet }, (_, i) => ({ innerText: `opslag ${i + 1}`, parentElement: container }));
  const document = {
    querySelectorAll: () => raekker(),
    querySelector: () => container,
    documentElement: { scrollHeight: 800 },
  };
  const window = { innerWidth: 1200, innerHeight: 800, scrollY: 0, scrollBy() {} };
  const getComputedStyle = (el) => (el === container ? { overflowY: 'auto' } : { overflowY: 'visible' });
  const koer = (func, args) => new Function('document', 'window', 'getComputedStyle', 'return (' + func.toString() + ')')(document, window, getComputedStyle)(...args);
  // Et hjul over containeren ruller den og - taet paa bunden - henter et parti til.
  const hjul = ({ x, y, deltaY }) => {
    const b = container.getBoundingClientRect();
    if (x < b.left || x >= b.right || y < b.top || y >= b.bottom) { s.hjulUdenfor++; return; }
    s.hjul++;
    // voksFoerRul: loaderen lytter paa `wheel` og laegger pladsholdere ind, foer rulningen flytter listen ned i dem - saa
    // naeste laesning staar paa en NY bund, der lige er vokset.
    if (voksFoerRul && hentPaa === 'wheel' && s.scrollTop + hoejde >= container.scrollHeight - 60) hent();
    container.scrollTop = s.scrollTop + deltaY;
    if (!voksFoerRul && hentPaa === 'wheel' && s.scrollTop + hoejde >= container.scrollHeight - 60) hent();
  };
  return { s, container, koer, hjul };
}

function sele(f, { aktiv = true, aktivEfter = null, hjulFejler = false } = {}) {
  let tabsGet = 0;
  const u = indlaesUdvidelse({ svar: {
    'tabs.get': () => { tabsGet++; return { id: 1, url: 'https://www.threads.example/@profil', windowId: 1, active: aktivEfter !== null && tabsGet > aktivEfter ? false : aktiv }; },
    'tabs.query': [{ id: 1, url: 'https://www.threads.example/@profil', windowId: 1, active: aktiv }],
    'scripting.executeScript': (o) => [{ result: f.koer(o.func, o.args) }],
    'debugger.attach': undefined, 'debugger.detach': undefined, 'debugger.getTargets': [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_t, metode, p) => {
      if (metode === 'Input.dispatchMouseEvent' && p?.type === 'mouseWheel') {
        if (hjulFejler) throw new Error('Debugger is not attached to the tab with id: 1.');
        f.hjul(p);
      }
      return {};
    },
  } });
  u.hent('sessions').set(9876, { label: 'c', color: 'blue', tabIds: new Set([1]), activeTabId: 1, groupId: 1, windowId: 1 });
  return u;
}
const udtraek = (u, p = {}) => u.hent('dispatch')(9876, 'extract_list', { selector: '[data-pressable-container]', wait_ms: 1, ...p });
const hjulSendt = (u) => u.optager.til('debugger.sendCommand').filter((k) => k.args[1] === 'Input.dispatchMouseEvent' && k.args[2]?.type === 'mouseWheel');

test('aktiv fane: hjulet henter hele feedet, og reached_end er foerst sand ved den rigtige bund', async () => {
  const f = feed();
  const svar = await udtraek(sele(f));
  assert.equal(svar.count, 40, `kun ${svar.count} af 40 opslag - feedet hentede ikke paa hjulet`);
  assert.equal(svar.reached_end, true);
  assert.equal(svar.scroll_method, 'wheel');
  assert.equal(svar.note, undefined);
  assert.equal(f.s.hjulUdenfor, 0, 'hjulet blev sendt uden for listen');
});

test('foer rettelsen (#11): uden hjul henter feedet intet - og saa maa reached_end ikke komme foer bunden har staaet stille', async () => {
  // Baggrundsfane: intet hjul. Listen rulles med script til bunden af det tegnede og staar stille dér.
  const f = feed();
  const u = sele(f, { aktiv: false });
  const svar = await udtraek(u);
  assert.equal(hjulSendt(u).length, 0, 'der blev sendt hjul til en baggrundsfane - de lander senere som en ekstra rulning');
  assert.equal(svar.count, 10);
  assert.equal(svar.scroll_method, 'script');
  assert.match(svar.note, /not the active one in its window, so the list was scrolled without wheel events/);
  assert.match(svar.note, /browser_switch_tab/);
  // MAALT i Chrome: 10 af 50 med reached_end:true i en baggrundsfane - noten skal sige hvad det betyder dér.
  assert.match(svar.note, /reached_end then only means the bottom of what loaded without them/);
});

test('en liste der henter paa scroll, virker stadig i en baggrundsfane', async () => {
  const f = feed({ hentPaa: 'scroll' });
  const svar = await udtraek(sele(f, { aktiv: false }));
  assert.equal(svar.count, 40);
  assert.equal(svar.reached_end, true);
});

test('hjulet sendes ogsaa ved bunden - det er dér et feed henter', async () => {
  const f = feed({ start: 6, i_alt: 16, parti: 10 });   // 6 raekker = 300 px = praecis containerens hoejde: bunden fra start
  const svar = await udtraek(sele(f), { container: '#feed' });
  assert.equal(svar.count, 16, 'ved bunden blev der ikke sendt hjul, saa feedet hentede aldrig');
});

test('reached_end er falsk, naar listen stoppede uden at staa paa bunden', async () => {
  const f = feed({ start: 40, i_alt: 40 });
  const svar = await udtraek(sele(f), { stable_rounds: 2, scroll_step: 1, max_rows: 5000 });
  // 1 px pr. runde: listen naar ikke bunden, men der kommer heller ikke nye raekker -> stopper paa stable_rounds.
  assert.equal(svar.reached_end, false);
});

test('naar listen bunden og henter, men stopper bagefter uden at staa paa bunden, er reached_end falsk', async () => {
  // 6 raekker = containerens hoejde: bunden fra start. Hjulet dér henter 10 til, og med 1 px pr. runde naar listen aldrig
  // den nye bund. Den gamle regel kaldte det enden allerede ved den foerste bund.
  const f = feed({ start: 6, i_alt: 16, parti: 10 });
  const svar = await udtraek(sele(f), { container: '#feed', scroll_step: 1, stable_rounds: 2 });
  assert.equal(svar.count, 16);
  assert.equal(svar.reached_end, false);
});

test('en loader der foerst laegger pladsholdere ind, faar lov at blive faerdig', async () => {
  const f = feed({ pladsholdere: 2 });
  const svar = await udtraek(sele(f), { stable_rounds: 2 });
  assert.equal(svar.count, 40, `stoppede ved ${svar.count}: listen voksede, men det blev ikke regnet som fremskridt`);
  assert.equal(svar.reached_end, true);
});

test('staar listen paa en bund der lige er vokset, er det ikke enden', async () => {
  const f = feed({ pladsholdere: 2, voksFoerRul: true });
  const svar = await udtraek(sele(f), { stable_rounds: 2 });
  assert.equal(svar.count, 40, `stoppede ved ${svar.count}: en bund der lige var vokset, blev kaldt enden`);
  assert.equal(svar.reached_end, true);
});

// MAALT i Chrome 9/10 (r60-chrome/p10-feed.log): i en indre container der beholder alle raekker i DOM, stoppede
// koerslen ved 30 af 50, fordi rulningen gennem raekker der allerede var hentet, talte som «ingen nye raekker».
test('en liste der beholder sine raekker, rulles helt til bunden - rulning er fremskridt', async () => {
  const f = feed({ start: 30, i_alt: 90, parti: 30 });
  const svar = await udtraek(sele(f));
  assert.equal(svar.count, 90, `stoppede ved ${svar.count} af 90 midt i allerede hentede raekker`);
  assert.equal(svar.reached_end, true);
});

// R62 (Astra, maalt i model): to tilfaelde hvor koerslen sluttede med reached_end:true midt i et feed.
test('en kort liste i en fast boks der endnu ikke flyder over, findes som listen - uden at containeren er angivet', async () => {
  const f = feed({ start: 6, i_alt: 16, parti: 10 });   // 6 x 50 px = boksens 300 px: ingen overflow endnu
  f.container.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 });
  const svar = await udtraek(sele(f));
  assert.equal(svar.count, 16, `${svar.count} af 16 - hjulet ramte uden for listen`);
  assert.equal(f.s.hjulUdenfor, 0);
});

test('runden hvor listen naar bunden, er ikke en runde hvor den stod paa bunden', async () => {
  const f = feed();
  const svar = await udtraek(sele(f), { stable_rounds: 1 });
  assert.equal(svar.count, 40, `${svar.count} af 40 med stable_rounds 1`);
  assert.equal(svar.reached_end, true);
});

// Vaekst uden bevaegelse: hjulet ved bunden flytter intet, men loaderen laegger en pladsholder ind.
test('en liste der vokser uden at flytte sig, er stadig i gang - ogsaa med stable_rounds 1', async () => {
  const f = feed({ pladsholdere: 2 });
  const svar = await udtraek(sele(f), { stable_rounds: 1 });
  assert.equal(svar.count, 40, `stoppede ved ${svar.count}: vaekst uden bevaegelse blev ikke regnet som fremskridt`);
});

test('ruller hjulet ikke listen, rulles der med script, og svaret siger det', async () => {
  const f = feed({ hentPaa: 'scroll' });
  f.container.getBoundingClientRect = () => ({ left: 2000, top: 2000, right: 2100, bottom: 2100, width: 100, height: 100 });   // uden for vinduet
  const svar = await udtraek(sele(f));
  assert.equal(svar.scroll_method, 'wheel, then script');
  assert.match(svar.note, /Wheel events did not move the list/);
  assert.equal(svar.count, 40, 'reserven rullede ikke resten');
});

test('bliver fanen en baggrundsfane undervejs, stopper hjulet, og svaret siger det', async () => {
  const f = feed();
  const u = sele(f, { aktivEfter: 3 });
  const svar = await udtraek(u);
  assert.equal(svar.scroll_method, 'wheel, then script');
  assert.match(svar.note, /not the active one in its window/);
});

test('fejler et hjul, rulles resten med script, og svaret siger hvorfor', async () => {
  const f = feed({ hentPaa: 'scroll' });
  const svar = await udtraek(sele(f, { hjulFejler: true }));
  assert.match(svar.note, /A wheel event failed \(.*Debugger is not attached/);
  assert.equal(svar.count, 40);
});

test('hjulet rammer midten af listens synlige stykke', async () => {
  const f = feed();
  const u = sele(f);
  await udtraek(u);
  const p = hjulSendt(u)[0].args[2];
  assert.deepEqual([p.x, p.y], [300, 250]);
});

test('teksterne siger det samme som koden', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROD } = await import('./hjaelp/udvidelses-sele.mjs');
  const laes = (f) => readFileSync(join(ROD, f), 'utf8');
  assert.match(laes('mcp-server/tools.js'), /When the tab is the active one in its window, it scrolls with real wheel events, also at the bottom, so a feed that loads more rows on wheel \(Threads, X\) loads them; in a background tab it scrolls with a script, and `note` says that such a feed may have stopped early\.[^']*reached_end, which is true only when the list stood at its bottom with no new rows and no growth for stable_rounds rounds in a row/);
  for (const f of ['README.md', 'mcp-server/README.md']) assert.match(laes(f), /\| `browser_extract_list` \|[^\n]*scrolls with real wheel events in the active tab/, f);
  assert.match(laes('content/browsermcp-docs-tools.md'), /\| `browser_extract_list` \|[^\n]*In the active tab it scrolls with real wheel events, also at the bottom[^\n]*in a background tab it scrolls with a script and says so/);
});
