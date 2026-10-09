/**
 * En lille side-model til klikMaal (R57): et elementtrae med rektangler, lag og en modal dialogs backdrop.
 *
 * Hvorfor den findes: Opus maalte i Chrome 9/10, at `click text=Add` valgte sidens knap frem for dialogens og meldte
 * ok:true, ogsaa naar klikket ramte overlayet. klikMaal skal kunne proeves paa netop de varianter uden en browser.
 * Modellen kan kun det klikMaal bruger: querySelectorAll('*'), simple selektorer (navn, [attr], [attr="v"], dialog:modal,
 * #id), closest, contains, labels, getBoundingClientRect og elementFromPoint med lag, pointer-events og backdrop.
 *
 *   const d = lavKlikDom();
 *   const knap = d.el('button', { id: 'a', tekst: 'Add', rect: [10, 10, 80, 30] }, d.body);
 *   const r = d.koer(kilde, null, 'Add', null);   // kilde = klikMaal.toString()
 */
export function lavKlikDom() {
  const alle = [];
  let raekke = 0;

  class El {
    constructor(tag, o = {}) {
      this.tagName = tag.toUpperCase();
      this.attrs = { ...(o.attrs || {}) };
      if (o.id) this.attrs.id = o.id;
      this.id = o.id || '';
      this.children = [];
      this.parentNode = null;
      this.egenTekst = o.tekst || '';
      this.rect = o.rect || null;          // [x, y, b, h]
      this.lag = o.lag || 0;               // z-index
      this.ingenPeg = !!o.ingenPeg;        // pointer-events: none
      this.stil = { visibility: o.skjult ? 'hidden' : 'visible', display: o.ingen ? 'none' : 'block', pointerEvents: o.ingenPeg ? 'none' : 'auto' };
      this.modal = !!o.modal;              // <dialog> aabnet med showModal()
      this.raekke = raekke++;
      this.labels = [];
      this.linjer = o.linjer || null;
      this.shadowRoot = null;
    }
    get textContent() { return this.egenTekst + this.children.map((c) => c.textContent).join(''); }
    getAttribute(n) { return n in this.attrs ? this.attrs[n] : null; }
    matches(sel) { return sel.split(',').some((s) => matchEn(this, s.trim())); }
    closest(sel) { for (let n = this; n && n.tagName; n = n.parentNode) if (n.matches(sel)) return n; return null; }
    contains(o) { for (let n = o; n; n = n.parentNode) if (n === this) return true; return false; }   // som i DOM: ikke gennem shadow roots
    querySelectorAll(sel) {
      const ud = [];
      const gaa = (n) => { for (const c of n.children) { if (sel === '*' || c.matches(sel)) ud.push(c); gaa(c); } };
      gaa(this);
      return ud;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    scrollIntoView() {}
    // Flere linjebokse (et link brudt over to linjer): o.linjer = [[x,y,b,h], ...]; ellers én boks.
    getClientRects() {
      return (this.linjer || [this.rect || [0, 0, 0, 0]]).map(([x, y, width, height]) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height }));
    }
    getBoundingClientRect() {
      const [x, y, width, height] = this.stil.display === 'none' ? [0, 0, 0, 0] : (this.rect || [0, 0, 0, 0]);
      return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
    }
  }

  function matchEn(el, s) {
    if (s === 'dialog:modal') return el.tagName === 'DIALOG' && el.modal;
    if (s.startsWith('#')) return el.id === s.slice(1);
    const m = s.match(/^([a-z][\w-]*)?((?:\[[^\]]+\])*)$/i);
    if (!m) throw new Error('klik-dom kan ikke selektoren ' + s);
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const a of m[2].match(/\[[^\]]+\]/g) || []) {
      const [, navn, v] = a.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (!(navn in el.attrs)) return false;
      if (v !== undefined && String(el.attrs[navn]) !== v) return false;
    }
    return !!(m[1] || m[2]);
  }

  const html = new El('html', { rect: [0, 0, 1200, 800] });
  const body = new El('body', { rect: [0, 0, 1200, 800] });
  html.children.push(body); body.parentNode = html;

  const synligKaede = (e) => { for (let n = e; n; n = n.parentNode || n.host) if (n.stil.display === 'none' || n.stil.visibility === 'hidden') return false; return true; };
  const inden = (e, x, y) => { const r = e.getBoundingClientRect(); return r.width > 0 && x >= r.left && x < r.right && y >= r.top && y < r.bottom; };

  const document = {
    documentElement: html, body, URL: 'https://x.example/side', baseURI: 'https://x.example/side',
    querySelectorAll: (s) => (s === '*' ? [body, ...body.querySelectorAll('*')] : html.querySelectorAll(s)),
    querySelector: (s) => html.querySelector(s),
    // Som i en browser: kun dokumentets eget traer, ikke shadow roots.
    getElementById: (id) => html.querySelectorAll('*').find((e) => e.id === id) || null,
    // Det oeverste element ved punktet: hoejeste lag, saa senest i DOM. En modal dialog daekker alt uden for sig selv
    // med sin backdrop - et punkt der ikke rammer noget i dialogen, rammer dialogen.
    elementFromPoint(x, y) {
      if (x < 0 || y < 0 || x >= 1200 || y >= 800) return null;   // som i en browser: uden for vinduet er der intet
      const modal = alle.find((e) => e.modal && synligKaede(e));
      const kandidater = alle.filter((e) => !e.ingenPeg && synligKaede(e) && inden(e, x, y) && (!modal || modal.contains(e)))
        .sort((a, b) => (a.lag - b.lag) || (a.raekke - b.raekke));
      return kandidater.at(-1) || modal || html;
    },
  };

  return {
    document, body,
    el(tag, o, foraelder = body) {
      const e = new El(tag, o);
      e.parentNode = foraelder; foraelder.children.push(e); alle.push(e);
      if (o?.lag === undefined && foraelder.lag) e.lag = foraelder.lag;
      return e;
    },
    label(input, o, foraelder) { const l = this.el('label', o, foraelder); input.labels.push(l); l.control = input; return l; },
    // En aaben shadow root paa `vaert`. Elementer inde i den naas fra vaerten via shadowRoot, og deres kaede op gaar
    // via roden til vaerten (`host`), som i en browser.
    skygge(vaert) {
      const r = new El('#shadow-root');
      r.host = vaert;
      vaert.shadowRoot = r;
      return r;
    },
    koer(kilde, ...args) {
      const window = { innerWidth: 1200, innerHeight: 800 };
      const getComputedStyle = (e) => e.stil;
      const fn = new Function('document', 'window', 'getComputedStyle', 'return (' + kilde + ')')(document, window, getComputedStyle);
      return { svar: fn(...args), window };
    },
  };
}
