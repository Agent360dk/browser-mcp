// Et styret felt - af den slags en fjendtlig komponent laver - plus en protokol over hvad
// komponenten FAKTISK hoerte. Det er hele pointen: vi maaler ikke hvad DOM'en viser - det kan et
// vaerktoej saette uden at nogen hoerer det - men hvad komponentens egen tilstand blev.
//
// ⛔ DEN HER FIXTUR ER IKKE REACT. Laes det foer du drager en konklusion af et resultat.
//
// Baade tekstfeltet og selectet herunder faar en value-saetter paa INSTANSEN der ruller en
// naiv tilskrivning tilbage til komponentens tilstand. React goer ikke det. Reacts egen
// instans-saetter (react-dom 18.3.1, `trackValueOnNode`) skriver den NYE vaerdi og husker
// den - `currentValue = '' + value` - og den springer helt fra hvis nogen allerede har
// defineret `value` paa elementet. En tilbagerulning findes ikke i React.
//
// Og for <select> specifikt goer React endnu mindre: `track()` kaldes for `case 'input'` og
// `case 'textarea'`, aldrig for select. Et selects vaerdi laeses paa den native
// change-haendelse.
//
// Maalt 21/9 mod aegte React 18.3.1 i jsdom: en naiv `sel.value = x` plus change LANDER, og
// onChange fyrer. Vores egen 19/9-maaling meldte derfor et tab mod Playwright som ikke findes
// i React - og det tab blev udgivet paa /learn/tools-that-lie/ og i kapacitets-matricen, hvor
// det stod i nogle timer foer det blev trukket tilbage.
//
// Fixturen modellerer altsaa en HYPOTETISK fjendtlig komponent: en der aktivt afviser en
// tilskrivning. Det er en gyldig ting at vaere robust over for, og maalingen er en gyldig
// maaling af netop dét. Men et resultat herfra maa ALDRIG skrives som «React virker ikke».
//
// (Selve protokollen nedenfor - at maale hvad komponentens TILSTAND blev, ikke hvad DOM'en
// viser - er stadig det rigtige greb. Det er etiketten der var forkert, ikke ideen.)
//
(function () {
  var felt = document.getElementById('styret');
  var visning = document.getElementById('tilstand');
  var tilstand = 'start';
  var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');

  // En tracker i Reacts AAND (den husker hvad komponenten sidst har set) - men se hovedet:
  // Reacts egen skriver den nye vaerdi, denne ruller tilbage. Det er ikke det samme.
  var sporet = 'start';
  felt._valueTracker = {
    getValue: function () { return sporet; },
    setValue: function (v) { sporet = v; },
    stopTracking: function () {},
  };

  Object.defineProperty(felt, 'value', {
    get: function () { return proto.get.call(this); },
    // En naiv `.value = x` ruller tilbage. ⛔ React goer IKKE dette - se hovedet.
    set: function () { proto.set.call(this, tilstand); },
    configurable: true,
  });

  window.__hoert = [];
  felt.addEventListener('input', function (e) {
    window.__hoert.push({ type: 'input', isTrusted: e.isTrusted });
    tilstand = proto.get.call(felt);   // KUN her opdateres komponentens tilstand
    sporet = tilstand;                 // ... og kun her foelger trackeren med
    visning.textContent = tilstand;
  });
  felt.addEventListener('change', function (e) {
    window.__hoert.push({ type: 'change', isTrusted: e.isTrusted });
  });
  felt.addEventListener('keydown', function (e) {
    window.__hoert.push({ type: 'keydown', isTrusted: e.isTrusted, key: e.key });
  });

  window.__rapport = function () {
    return {
      dom: proto.get.call(felt),   // hvad brugeren SER
      tilstand: tilstand,          // hvad komponenten VED
      sporet: sporet,
      hoert: window.__hoert.length,
      betroet: window.__hoert.filter(function (h) { return h.isTrusted; }).length,
    };
  };
})();

// ── Styret <select> - samme spoergsmaal, anden mekanik ────────────────────────
// Selectet her ruller ogsaa en naiv tilskrivning tilbage. ⛔ React goer det IKKE - se hovedet:
// `track()` kaldes aldrig for select. Maalingen er gyldig for en fjendtlig komponent, og
// maa ikke skrives som et udsagn om React. (Issue #19's EGEN maaling paa aegte React sagde
// selv at valget lander.)
(function () {
  var s = document.getElementById('valg');
  var vis = document.getElementById('valgt');
  var tilstand = 'a';
  var proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
  var sporet = 'a';
  s._valueTracker = {
    getValue: function () { return sporet; },
    setValue: function (v) { sporet = v; },
    stopTracking: function () {},
  };
  Object.defineProperty(s, 'value', {
    get: function () { return proto.get.call(this); },
    set: function () { proto.set.call(this, tilstand); },
    configurable: true,
  });
  s.addEventListener('change', function (e) {
    window.__hoert.push({ type: 'change-select', isTrusted: e.isTrusted });
    tilstand = proto.get.call(s);
    sporet = tilstand;
    vis.textContent = tilstand;
  });
  var gammel = window.__rapport;
  window.__rapport = function () {
    var r = gammel();
    r.select_dom = proto.get.call(s);
    r.select_tilstand = tilstand;
    return r;
  };
})();

// ── Filfelt - tredje sag ──────────────────────────────────────────────────────
// Her er spoergsmaalet et andet: `DOM.setFileInputFiles` er den ANDEN af de praecis to
// CDP-kommandoer der kvitterer uden at love levering (den foerste er Input.*). Det var
// derfor upload_file og drop_file stod paa listen over de ni i 1.29.2. Siden foerer
// protokol over hvad feltet FAKTISK endte med at baere.
(function () {
  var f = document.getElementById('fil');
  var vis = document.getElementById('filnavn');
  f.addEventListener('change', function (e) {
    window.__hoert.push({ type: 'change-fil', isTrusted: e.isTrusted });
    vis.textContent = f.files && f.files.length ? f.files[0].name : 'ingen';
  });
  var gammel = window.__rapport;
  window.__rapport = function () {
    var r = gammel();
    r.fil_antal = f.files ? f.files.length : 0;
    r.fil_navn = f.files && f.files.length ? f.files[0].name : '';
    return r;
  };
})();
