/**
 * CAPTCHA-finderen skelner et usynligt reCAPTCHA fra noget, der skal loeses (1.33, privat rapport 2.2).
 *
 * MAALT af to bedoemmere: paa en side med kun det usynlige reCAPTCHA-maerke (en anchor-ramme med size=invisible, det meste
 * uden for skaermen) svarede browser_navigate captcha_detected: recaptcha_v2_checkbox, og browser_solve_captcha detect det
 * samme. Grenen for det usynlige maerke blev aldrig naaet. En agent, der stopper og spoerger et menneske ved en CAPTCHA,
 * stoppede for ingenting. MAALT af koordinatoren i headless Chrome 21/10 (plans/browsermcp-133/maal-21/captcha-*): den gamle
 * kode meldte paa samme side ogsaa recaptcha_v2_challenge_visible for udfordringens ramme, der var indlaest skjult paa y=-10000.
 *
 * Proeverne koerer captchaFund (siden-funktionen) mod en lille side-model, og fanen gennem udvidelsens egen kode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const ANKER = 'https://www.google.com/recaptcha/api2/anchor?k=x&co=y';
const BRAMME = 'https://www.google.com/recaptcha/api2/bframe?k=x';

function lavSide() {
  const alle = [];
  class El {
    constructor(tag, o = {}) {
      this.tagName = tag.toUpperCase(); this.nodeType = 1;
      this.id = o.id || ''; this.cls = o.cls || ''; this.attrs = { ...(o.attrs || {}) };
      this.r = o.rect || [10, 10, 304, 78]; this.stil = { visibility: 'visible', opacity: '1', ...(o.stil || {}) };
      this.parentElement = o.i || null;
      alle.push(this);
    }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    getBoundingClientRect() { const [x, y, width, height] = this.r; return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }; }
  }
  // Kun de selektorer finderen bruger: tag[attr*="v"], .klasse og #id, adskilt af komma.
  const passer = (el, sel) => sel.split(',').some((s) => {
    s = s.trim();
    const m = s.match(/^(\w+)\[(\w+)\*="([^"]+)"\]$/);
    if (m) return el.tagName === m[1].toUpperCase() && String(el.getAttribute(m[2]) || '').includes(m[3]);
    if (s.startsWith('.')) return el.cls.split(' ').includes(s.slice(1));
    if (s.startsWith('#')) return el.id === s.slice(1);
    return false;
  });
  const document = {
    title: 'Side',
    querySelectorAll: (sel) => alle.filter((e) => passer(e, sel)),
    querySelector: (sel) => alle.find((e) => passer(e, sel)) || null,
  };
  const window = { scrollX: 0, scrollY: 0, location: { href: 'https://side.example/' } };
  const koer = (kilde) => new Function('document', 'window', 'getComputedStyle', `return (${kilde})();`)(document, window, (e) => e.stil);
  return { El, koer };
}

const u0 = indlaesUdvidelse({ svar: {} });
const FUND = u0.hent('captchaFund').toString();
const side = (byg) => { const s = lavSide(); byg(s.El); return s.koer(FUND); };

test('2.2: kun det usynlige maerke (anchor med size=invisible, skjult udfordring) - intet fund, men meldt som usynligt', () => {
  const r = side((El) => {
    const maerke = new El('div', { cls: 'grecaptcha-badge', rect: [1210, 726, 256, 60] });
    new El('iframe', { attrs: { src: ANKER + '&size=invisible' }, rect: [1210, 726, 256, 60], i: maerke });
    const skjul = new El('div', { stil: { visibility: 'hidden' }, rect: [8, -10000, 404, 584] });
    new El('iframe', { attrs: { src: BRAMME }, rect: [8, -10000, 404, 584], i: skjul });
  });
  assert.equal(r.found, false, JSON.stringify(r));
  assert.deepEqual(r.types, []);
  assert.deepEqual(r.invisible, ['recaptcha']);
});

test('2.2: et synligt afkrydsningsfelt er et fund', () => {
  const r = side((El) => {
    const c = new El('div', { cls: 'g-recaptcha', attrs: { 'data-sitekey': 'abc' } });
    new El('iframe', { attrs: { src: ANKER + '&size=normal' }, i: c });
  });
  assert.equal(r.found, true);
  assert.deepEqual(r.types, ['recaptcha_v2_checkbox']);
  assert.equal(r.sitekey, 'abc');
  assert.equal(r.invisible, undefined);
});

test('2.2: en synlig billedudfordring er et fund - en skjult forudindlaest er ikke', () => {
  const synlig = side((El) => {
    new El('iframe', { attrs: { src: ANKER + '&size=normal' } });
    new El('iframe', { attrs: { src: BRAMME }, rect: [50, 50, 400, 580] });
  });
  assert.deepEqual(synlig.types, ['recaptcha_v2_checkbox', 'recaptcha_v2_challenge_visible']);
  const skjult = side((El) => new El('iframe', { attrs: { src: BRAMME }, rect: [8, -10000, 404, 584] }));
  assert.equal(skjult.found, false, JSON.stringify(skjult));
});

test('2.2: et afkrydsningsfelt, der ikke kan ses, er intet fund (visibility, opacity, 0 px)', () => {
  for (const o of [{ stil: { visibility: 'hidden' } }, { stil: { opacity: '0' } }, { rect: [10, 10, 0, 0] }]) {
    const r = side((El) => { const f = new El('div', o); new El('iframe', { attrs: { src: ANKER + '&size=normal' }, i: f, rect: o.rect }); });
    assert.equal(r.found, false, `${JSON.stringify(o)}: ${JSON.stringify(r)}`);
  }
});

test('2.2: kun maerket uden ramme, og en side uden noget', () => {
  assert.deepEqual(side((El) => new El('div', { cls: 'grecaptcha-badge' })).invisible, ['recaptcha']);
  const intet = side(() => {});
  assert.equal(intet.found, false);
  assert.equal(intet.invisible, undefined);
});

test('2.2: hCaptcha og Turnstile meldes som foer', () => {
  assert.deepEqual(side((El) => new El('div', { cls: 'h-captcha' })).types, ['hcaptcha']);
  assert.deepEqual(side((El) => new El('div', { cls: 'cf-turnstile' })).types, ['cloudflare_turnstile']);
});

test('2.2: click_checkbox vaelger aldrig det usynlige maerkes anchor', async () => {
  const udtryk = [];
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': () => {},
    'debugger.getTargets': () => [{ tabId: 1, attached: true }],
    'debugger.sendCommand': (_m, metode, p = {}) => {
      if (metode === 'Runtime.evaluate') { udtryk.push(String(p.expression)); return { result: { value: JSON.stringify({ found: false }) } }; }
      return {};
    },
  } });
  await u.hent('clickRecaptchaCheckbox')(1).catch(() => {});
  const s = lavSide();
  new s.El('iframe', { attrs: { src: ANKER + '&size=invisible' }, rect: [1210, 726, 256, 60] });
  new s.El('iframe', { attrs: { src: ANKER + '&size=normal' }, rect: [20, 300, 304, 78] });
  const r = JSON.parse(s.koer(`() => ${udtryk[0]}`));
  assert.equal(r.found, true, udtryk[0].slice(0, 200));
  assert.ok(Math.abs(r.x - (20 + 27)) < 30 && r.y > 250, `klikket skal ramme det synlige felt, ikke maerket: ${JSON.stringify(r)}`);
});

test('R174 (Astra C4): et afkrydsningsfelt, som browserens checkVisibility siger ikke tegnes, er intet fund', () => {
  const r = side((El) => { const f = new El('iframe', { attrs: { src: ANKER + '&size=normal' } }); f.checkVisibility = () => false; });
  assert.equal(r.found, false, JSON.stringify(r));
});
