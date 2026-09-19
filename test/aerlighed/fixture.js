// Et styret felt af den slags React laver, plus en protokol over hvad komponenten
// FAKTISK hoerte. Det er hele pointen: vi maaler ikke hvad DOM'en viser - det kan et
// vaerktoej saette uden at nogen hoerer det - men hvad komponentens egen tilstand blev.
//
// Mekanikken er den samme som React's: en value-setter paa instansen der ruller en
// naiv tilskrivning tilbage, en `_valueTracker` der kun opdateres naar komponenten selv
// har behandlet aendringen, og en input-lytter der er den ENESTE vej til ny tilstand.
(function () {
  var felt = document.getElementById('styret');
  var visning = document.getElementById('tilstand');
  var tilstand = 'start';
  var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');

  // React's egen tracker: den husker hvad komponenten sidst har set.
  var sporet = 'start';
  felt._valueTracker = {
    getValue: function () { return sporet; },
    setValue: function (v) { sporet = v; },
    stopTracking: function () {},
  };

  Object.defineProperty(felt, 'value', {
    get: function () { return proto.get.call(this); },
    // En naiv `.value = x` ruller tilbage, praecis som en styret komponent goer.
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
