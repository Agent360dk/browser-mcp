/**
 * En lille DOM til at koere ask_user's side-funktion (renderAskPrompt) i Node.
 *
 * R48 (Opus og Astra): proeverne af #62 koerte aldrig side-funktionen - executeScript-stubben svarede
 * undefined - saa «kortet blev fuldskaerm igen», «Submit sender tomme vaerdier», «Enter svarer skip» og
 * «en besvaret prompt saetter sig selv paa igen» overlevede alle. jsdom er ikke installeret, og en ny
 * afhaengighed for fire proever er mere end opgaven. Denne DOM kan netop det, funktionen bruger:
 * elementer, en lukket shadow root, boblende haendelser med isTrusted, og en MutationObserver der
 * leverer i en mikroopgave som browserens. Den er en model, ikke en browser: layout, fokus og
 * capture-fasen findes ikke her (de er maalt i headless Chrome i R48).
 */

let observatoerer = [];
let leveringer = 0;
const LOEBSK = 5000;   // en loekke mellem to observatoerer standses her, saa en mutant fejler i stedet for at haenge

function mutation() {
  for (const o of observatoerer) {
    if (o.planlagt) continue;
    o.planlagt = true;
    queueMicrotask(() => {
      o.planlagt = false;
      if (!o.aktiv || ++leveringer > LOEBSK) return;
      o.cb([], o);
    });
  }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.parent = null;
    this.lyttere = new Map();
    this.dataset = {};
    this.style = { cssText: '' };
    this.textContent = '';
    this.value = '';
    this.id = '';
    this.attrs = new Map();
    this.popover = null;
  }
  get parentNode() { return this.parent; }
  // Attributes, inert and the top layer: what a page's modal does to the rest of the page (2026-10-22).
  setAttribute(navn, v) { this.attrs.set(navn, String(v)); if (this.isConnected) mutation(); }
  getAttribute(navn) { return this.attrs.has(navn) ? this.attrs.get(navn) : null; }
  hasAttribute(navn) { return this.attrs.has(navn); }
  removeAttribute(navn) { if (this.attrs.delete(navn) && this.isConnected) mutation(); }
  get inert() { return this.attrs.has('inert'); }
  set inert(v) { if (v) this.setAttribute('inert', ''); else this.removeAttribute('inert'); }
  showPopover() {
    if (!this.popover || !this.isConnected) throw new Error('InvalidStateError');
    const lag = this.dom.document.topLayer;
    if (!lag.includes(this)) lag.push(this);
  }
  hidePopover() { this.forlad(); }
  forlad() {
    const lag = this.dom.document.topLayer;
    if (lag.includes(this)) lag.splice(lag.indexOf(this), 1);
  }
  showModal() {
    this.modal = true;
    this.setAttribute('open', '');
    this.dom.document.topLayer.push(this);
    this.dom.fyrVindue('toggle', this);
  }
  close() {
    this.modal = false;
    this.removeAttribute('open');
    this.forlad();
    this.dom.fyrVindue('close', this);
  }
  get isConnected() {
    let n = this;
    while (n) { if (n.erRod) return true; n = n.parent; }
    return false;
  }
  appendChild(barn) {
    if (barn.parent) barn.remove();
    barn.parent = this;
    this.children.push(barn);
    if (this.isConnected) mutation();
    return barn;
  }
  prepend(barn) {
    if (barn.parent) barn.remove();
    barn.parent = this;
    this.children.unshift(barn);
    if (this.isConnected) mutation();
  }
  remove() {
    if (!this.parent) return;
    const forbundet = this.isConnected;
    // A node leaving the document leaves the top layer too - a popover is hidden when it is removed.
    for (const n of [this, ...this.alle()]) n.forlad?.();
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
    if (forbundet) mutation();
  }
  attachShadow({ mode }) {
    const rod = new Node('#shadow-root');
    rod.mode = mode;
    rod.parent = this;   // haendelser og isConnected gaar videre til vaerten
    this.skygge = rod;
    return rod;
  }
  get shadowRoot() { return this.skygge && this.skygge.mode === 'open' ? this.skygge : null; }
  addEventListener(type, fn) {
    if (!this.lyttere.has(type)) this.lyttere.set(type, []);
    this.lyttere.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    this.lyttere.set(type, (this.lyttere.get(type) || []).filter((f) => f !== fn));
  }
  /** Boblende haendelse fra dette element og op gennem shadow root til vaerten og videre. */
  fyr(type, init = {}) {
    const sti = [];
    for (let n = this; n; n = n.parent) sti.push(n);
    let stop = false;
    const e = { type, isTrusted: true, button: 0, ...init, target: this,
      composedPath: () => sti, preventDefault() {}, stopPropagation() { stop = true; } };
    for (const n of sti) {
      for (const fn of n.lyttere.get(type) || []) fn(e);
      if (stop) break;
    }
    return e;
  }
  focus() { this.dom.document.activeElement = this; }
  matches(sel) { return sel === ':popover-open' ? this.dom.document.topLayer.includes(this) : false; }
  getBoundingClientRect() { return { left: 16, top: 600, width: 320, height: 160 }; }
  get offsetWidth() { return 320; }
  get offsetHeight() { return 160; }
  setPointerCapture() {}
  /** Alle efterkommere, ogsaa inde i shadow roots. Kun proeven maa se derind. */
  alle() {
    const ud = [];
    const gaa = (n) => { for (const c of n.children) { ud.push(c); gaa(c); } if (n.skygge) gaa(n.skygge); };
    gaa(this);
    return ud;
  }
}

export function lavDom({ origin = 'https://bank.example', href = origin + '/side' } = {}) {
  observatoerer = [];
  leveringer = 0;
  class HTMLButtonElement extends Node {}
  class HTMLInputElement extends Node {}
  const dom = {};
  const lav = (tag) => {
    const t = String(tag).toLowerCase();
    const n = t === 'button' ? new HTMLButtonElement(t) : t === 'input' ? new HTMLInputElement(t) : new Node(t);
    n.dom = dom;
    return n;
  };
  const html = lav('html');
  html.erRod = true;
  const body = lav('body');
  html.appendChild(body);
  const document = {
    documentElement: html,
    body,
    activeElement: body,
    createElement: lav,
    getElementById: (id) => html.alle().find((n) => n.id === id && !erISkygge(n)) || null,
    // Only the one selector the prompt asks with. Document order, like the browser.
    querySelectorAll: (sel) => {
      if (sel !== 'dialog:modal') throw new Error(`the test DOM does not know ${sel}`);
      return html.alle().filter((n) => n.tagName === 'DIALOG' && n.modal && !erISkygge(n));
    },
    topLayer: [],
  };
  const erISkygge = (n) => { for (let p = n.parent; p; p = p.parent) if (p.tagName === '#SHADOW-ROOT') return true; return false; };
  class MutationObserver {
    constructor(cb) { this.cb = cb; this.aktiv = false; this.planlagt = false; }
    observe() { this.aktiv = true; observatoerer.push(this); }
    disconnect() { this.aktiv = false; observatoerer = observatoerer.filter((o) => o !== this); }
  }
  const beskeder = [];
  const chrome = { runtime: { sendMessage: (m) => { beskeder.push(JSON.parse(JSON.stringify(m))); return Promise.resolve(); } } };
  const vindueLyttere = new Map();
  const window = {
    innerWidth: 1280, innerHeight: 800,
    addEventListener: (type, fn) => { if (!vindueLyttere.has(type)) vindueLyttere.set(type, []); vindueLyttere.get(type).push(fn); },
    removeEventListener: (type, fn) => vindueLyttere.set(type, (vindueLyttere.get(type) || []).filter((f) => f !== fn)),
  };
  // A toggle or close event from the page reaches capture listeners on window, as in the browser.
  dom.fyrVindue = (type, target) => { for (const fn of vindueLyttere.get(type) || []) fn({ type, target }); };
  Object.assign(dom, { document, window, chrome, MutationObserver, HTMLButtonElement, HTMLInputElement,
    beskeder, global: {}, leveringer: () => leveringer, LOEBSK, Date,
    location: { origin, href, protocol: new URL(href).protocol, host: new URL(href).host, pathname: new URL(href).pathname } });
  return dom;
}

/** Goer en udtrukket funktion kaldbar med DOM'ens globale navne (globalThis er udvidelsens ISOLATED-verden). */
export function iDom(kilde, navn, dom) {
  // Promptens egne timere (fokus, sidefrist) maa ikke holde proeveprocessen i live: en frist paa minutter ville ellers
  // faa filen til at haenge, til den udloeb.
  const setTimeout = (fn, ms) => { const t = globalThis.setTimeout(fn, ms); t.unref?.(); return t; };
  return new Function('document', 'window', 'chrome', 'MutationObserver', 'HTMLButtonElement', 'HTMLInputElement', 'globalThis', 'location', 'Date', 'setTimeout',
    `${kilde}\nreturn ${navn};`)(dom.document, dom.window, dom.chrome, dom.MutationObserver, dom.HTMLButtonElement, dom.HTMLInputElement, dom.global, dom.location, dom.Date, setTimeout);
}

export const vent = (ms = 0) => new Promise((r) => setTimeout(r, ms));
