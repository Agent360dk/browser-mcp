document.getElementById('klik').addEventListener('click', function () {
  document.getElementById('status').textContent = 'klikket';
});

// React-agtigt styret felt. React lytter paa 'input' og skriver sin egen state
// tilbage i feltet. Saetter man .value direkte, ruller den aendringen tilbage -
// medmindre man bruger den native value-setter, som er praecis hvad
// background.js goer (nativeInputValueSetter). Det efterligner vi her.
(function () {
  var felt = document.getElementById('styret');
  var state = 'laast';
  var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
  Object.defineProperty(felt, 'value', {
    get: function () { return proto.get.call(this); },
    set: function (v) { proto.set.call(this, state); },   // naiv .value = x ruller tilbage
    configurable: true,
  });
  felt.addEventListener('input', function () {
    state = proto.get.call(felt);                          // en AEGTE input-hændelse accepteres
  });
})();

for (var i = 1; i <= 40; i++) {
  var d = document.createElement('div');
  d.className = 'raekke';
  d.textContent = 'haard raekke ' + i;
  document.getElementById('liste').appendChild(d);
}
