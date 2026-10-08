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
  matches() { return false; }
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

export function lavDom({ origin = 'https://bank.example' } = {}) {
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
  };
  const erISkygge = (n) => { for (let p = n.parent; p; p = p.parent) if (p.tagName === '#SHADOW-ROOT') return true; return false; };
  class MutationObserver {
    constructor(cb) { this.cb = cb; this.aktiv = false; this.planlagt = false; }
    observe() { this.aktiv = true; observatoerer.push(this); }
    disconnect() { this.aktiv = false; observatoerer = observatoerer.filter((o) => o !== this); }
  }
  const beskeder = [];
  const chrome = { runtime: { sendMessage: (m) => { beskeder.push(JSON.parse(JSON.stringify(m))); return Promise.resolve(); } } };
  const window = { innerWidth: 1280, innerHeight: 800 };
  Object.assign(dom, { document, window, chrome, MutationObserver, HTMLButtonElement, HTMLInputElement,
    beskeder, global: {}, leveringer: () => leveringer, LOEBSK, location: { origin } });
  return dom;
}

/** Goer en udtrukket funktion kaldbar med DOM'ens globale navne (globalThis er udvidelsens ISOLATED-verden). */
export function iDom(kilde, navn, dom) {
  return new Function('document', 'window', 'chrome', 'MutationObserver', 'HTMLButtonElement', 'HTMLInputElement', 'globalThis', 'location',
    `${kilde}\nreturn ${navn};`)(dom.document, dom.window, dom.chrome, dom.MutationObserver, dom.HTMLButtonElement, dom.HTMLInputElement, dom.global, dom.location);
}

export const vent = (ms = 0) => new Promise((r) => setTimeout(r, ms));
