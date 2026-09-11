/**
 * fill maa ikke skrive oveni et forsinket tastetryk — og maa ikke kalde en fordobling succes.
 *
 * MAALT 10/9 af Astra: debugger-vejen timede ud, reserveloesningen skrev hele vaerdien med den
 * native setter, og tastetrykkene fra debugger-forsoeget landede bagefter. "X" blev "XX", og
 * kaldet svarede ok:true. Promise.race afbryder ikke; en frist betyder "vi ved det ikke".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const fane = { id: 1, url: 'https://x.example', windowId: 1, active: true };
function sele(laesninger, saetKald, naaedeTaster = []) {
  let i = 0;
  const u = indlaesUdvidelse({ svar: {
    'debugger.attach': undefined, 'debugger.detach': undefined,
    'debugger.getTargets': [{ tabId: 1, attached: true }],
    'tabs.get': fane, 'tabs.query': [fane],
    // DOM-kaldene svarer som en rigtig side, saa debuggerFill naar helt frem til tastetrykkene.
    // Tastetrykkene kvitteres aldrig -> cdpSend giver op med "svarede ikke inden".
    'debugger.sendCommand': (_m, metode) => {
      if (metode.startsWith('Input.')) { naaedeTaster.push(metode); return new Promise(() => {}); }
      if (metode === 'DOM.getDocument') return { root: { nodeId: 1 } };
      if (metode === 'DOM.querySelector') return { nodeId: 2 };
      if (metode === 'Runtime.evaluate') return { result: { value: false } };
      return {};
    },
    'scripting.executeScript': ({ args }) => {
      if (args.length === 1) return [{ result: laesninger[Math.min(i++, laesninger.length - 1)] }];
      saetKald.push(args[1]);
      return [{ result: { ok: true } }];
    },
  } });
  u.hent('sessions').set(9876, { tabIds: new Set([1]), activeTabId: 1, groupId: 1, label: 't', color: 'blue' });
  return u;
}

test('en fordobling efter reserveloesningen meldes — den kaldes ikke succes', async () => {
  const saet = [], taster = [];
  const u = sele(['gammel', 'XX'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'X' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.equal(svar.ok, false, `"X" blev til "XX", og vaerktoejet sagde ${JSON.stringify(svar)}`);
  assert.equal(svar.error, 'feltet-fordoblet');
  assert.equal(svar.faktisk, 'XX', 'kalderen skal se hvad der faktisk staar i feltet');
});

test('staar vaerdien der allerede efter fristen, skrives den ikke en gang til', async () => {
  const saet = [], taster = [];
  const u = sele(['X'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'X' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.equal(svar.ok, true);
  assert.equal(saet.length, 0, `reserveloesningen skrev ${saet.length} gang(e) oveni en vaerdi der allerede var landet`);
});

test('et felt der formaterer vaerdien, meldes ikke som fordobling - men med den faktiske vaerdi', async () => {
  const saet = [], taster = [];
  const u = sele(['', '+45 12 34 56 78'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: '12345678' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  // Fjerde runde (Astra): formatering kan ikke skelnes sikkert fra en aendret vaerdi - den meldes med den faktiske tekst.
  assert.notEqual(svar.error, 'feltet-fordoblet', 'formatering er ikke en fordobling');
  assert.equal(svar.faktisk, '+45 12 34 56 78', 'kalderen skal se hvad feltet viser');
  // Femte runde (Astra R5 F1): 1.29.0 svarede ok:true her, og det er feltets egen formatering. ok:false er et tilbageslag.
  assert.equal(svar.ok, true, `korrekt formatering blev meldt som fejl: ${JSON.stringify(svar)}`);
  assert.equal(svar.afviger, true, 'kalderen skal kunne se at feltet viser noget andet end det skrevne');
});

test('en formatering der tilfoejer tegn ("5" -> "5,00 kr") er ikke en fordobling', async () => {
  const saet = [], taster = [];
  const u = sele(['', '5,00 kr'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: '5' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.notEqual(svar.error, 'feltet-fordoblet', `et beloebsfelt der formaterer blev kaldt fordoblet: ${JSON.stringify(svar)}`);
  assert.equal(svar.faktisk, '5,00 kr', 'kalderen skal se hvad feltet viser');
  assert.equal(svar.ok, true, `korrekt formatering blev meldt som fejl: ${JSON.stringify(svar)}`);
  assert.equal(svar.afviger, true);
});

test('et felt der blev toemt igen af et forsinket Cmd+A/Backspace meldes', async () => {
  const saet = [], taster = [];
  const u = sele(['', ''], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'abc' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene — den tester ikke fristen');
  assert.equal(svar.ok, false, `feltet endte tomt og vaerktoejet sagde ${JSON.stringify(svar)}`);
  assert.equal(svar.error, 'feltet-toemt');
});

test('en vaerdi siden afviste ("OLD" blev staaende) meldes - den kaldes ikke formatering', async () => {
  // MAALT 10/9 af Astra (anden runde): "OLD" er hverken tom eller fordoblet, saa den blev
  // behandlet som formatering og svaret ok:true med value "OLD".
  const saet = [], taster = [];
  const u = sele(['OLD', 'OLD'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'NEW' });
  assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene - den tester ikke fristen');
  assert.equal(svar.ok, false, `feltet beholdt "OLD" og vaerktoejet sagde ${JSON.stringify(svar)}`);
  assert.equal(svar.error, 'feltet-viser-andet');
});

// ── Tredje/fjerde runde (Astra) + femte runde (R5 F1) ──────────────────────────────────────────
// Tredje og fjerde runde viste at enhver regel for "det er bare formatering" har huller. Femte runde viste at
// ok:false paa enhver afvigelse ogsaa melder korrekt formatering som fejl (1.29.0 sagde ok). Skellet maales nu
// i stedet for at gaettes: feltet laeses FOER reserveloesningen skriver. Stod det stille, afviste siden vaerdien
// (ok:false). Aendrede det sig til noget andet end det skrevne, meldes ok:true med afviger:true og den faktiske
// vaerdi, saa kalderen selv kan se forskellen - aldrig en tavs succes.
for (const [navn, laesninger, vaerdi, skalOk] of [
  ['et tal der blev til et ANDET tal ("5" -> "15") er ikke formatering', ['', '15'], '5', 'afviger'],
  ['et fortegn der forsvandt ("-5" -> "5") er ikke formatering', ['', '5'], '-5', 'afviger'],
  ['tegn der forsvandt fra tekst ("A!b" -> "ab") meldes', ['', 'ab'], 'A!b', 'afviger'],
  ['et felt der skulle toemmes men beholdt "OLD", meldes', ['OLD', 'OLD'], '', false],
  ['overfloedige decimaler der blev fjernet ("5.00" -> "5") meldes med den faktiske vaerdi', ['', '5'], '5.00', 'afviger'],
  // Fjerde runde (Astra): hver 'bare formatering'-regel blev omgaaet.
  ['et decimaltal der mistede kommaet ("1.5" -> "15") meldes', ['', '15'], '1.5', 'afviger'],
  ['et beloeb der blev negativt med Unicode-minus ("5" -> "\u22125") meldes', ['', '\u22125'], '5', 'afviger'],
  ['to store tal der afrundes ens i JavaScript meldes', ['', '9007199254740993'], '9007199254740992', 'afviger'],
  ['en ekstra landekode foran et internationalt nummer meldes', ['', '+1 45 12345678'], '+45 12345678', 'afviger'],
]) {
  test(navn, async () => {
    const saet = [], taster = [];
    const u = sele(laesninger, saet, taster);
    const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: vaerdi });
    assert.ok(taster.length > 0, 'testen naaede aldrig tastetrykkene - den tester ikke fristen');
    const faktisk = laesninger[laesninger.length - 1];
    if (skalOk === 'afviger') {
      assert.equal(svar.ok, true, `"${vaerdi}" -> "${faktisk}" gav ${JSON.stringify(svar)}`);
      assert.equal(svar.afviger, true, 'en afvigelse maa aldrig vaere en tavs succes');
      assert.equal(svar.faktisk, faktisk, 'kalderen skal se den faktiske vaerdi');
      assert.equal(svar.forventet, vaerdi);
    } else {
      assert.equal(svar.ok, skalOk, `"${vaerdi}" -> "${faktisk}" gav ${JSON.stringify(svar)}`);
    }
  });
}

// Femte runde (Fable, falsifikation af F1-planen): feltet har allerede maalvaerdien foer reserveloesningen
// (gentaget fill, standardvaerdi). "Stod stille" maa ikke blive til en afvisning, naar det der staar ER det oenskede.
test('et felt der allerede viste maalvaerdien er ikke en afvisning', async () => {
  const saet = [], taster = [];
  const u = sele(['NY', 'NY'], saet, taster);
  const svar = await u.hent('dispatch')(9876, 'fill', { selector: '#f', value: 'NY' });
  assert.equal(svar.ok, true, JSON.stringify(svar));
  assert.equal(svar.afviger, undefined);
});
