/**
 * Dialog-armeringen - lytteren koeres, ikke greppes.
 *
 * MAALT 22/8: fem mutationer af handle_dialog slap igennem hele suiten. To af dem er
 * aegte korrekthedsfejl:
 *   · `source.tabId !== tab.id`-gaten fjernet → ÉN CHAT TAGER EN ANDEN CHATS DIALOG.
 *     Alle sessioner deler den samme chrome.debugger.onEvent-stroem, saa uden gaten
 *     svarer den foerste armering paa enhver dialog i hele browseren.
 *   · `accept: action === 'accept'` → `accept: true`. Et `dismiss` ville saa ACCEPTERE
 *     dialogen. Paa en "vil du slette?"-bekraeftelse er det den forkerte vej.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

/** Klipper dialog-lytteren ud og rejser den med stubbede afhaengigheder. */
function rejsLytter({ tabId = 42, action = 'accept', promptText = '' } = {}) {
  const i = kilde.indexOf("case 'handle_dialog'");
  const j = kilde.indexOf('const listener = (source, method, eventParams) => {', i);
  let d = 0, slut = -1;
  for (let k = kilde.indexOf('{', j); k < kilde.length; k++) {
    if (kilde[k] === '{') d++;
    else if (kilde[k] === '}') { d--; if (d === 0) { slut = k + 1; break; } }
  }
  const src = kilde.slice(j, slut) + '\nreturn listener;';

  const log = { afvaebnet: [], cdp: [], opfyldt: [] };
  const fn = new Function('tab', 'action', 'promptText', 'afvaebnDialog', 'cdpSend', 'opfyld',
    `return (() => { ${src} })();`);
  const listener = fn(
    { id: tabId }, action, promptText,
    (id) => log.afvaebnet.push(id),
    async (id, metode, params) => { log.cdp.push({ id, metode, params }); },
    (r) => log.opfyldt.push(r),
  );
  return { listener, log };
}

const DIALOG = 'Page.javascriptDialogOpening';
const HAENDELSE = { type: 'confirm', message: 'Er du sikker?' };

// ── DEN VIGTIGE. Mutations-verificeret: tabId-gaten fjernet gav roed.
test('en armering roerer ALDRIG en anden fanes dialog', async () => {
  const { listener, log } = rejsLytter({ tabId: 42 });
  listener({ tabId: 99 }, DIALOG, HAENDELSE);          // en ANDEN chats fane
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(log.cdp.length, 0,
    'alle sessioner deler den samme debugger-haendelsesstroem. Uden tabId-gaten ' +
    'svarer den foerste armering paa enhver dialog i hele browseren - ogsaa dem der ' +
    'hoerer til en anden chats arbejde.');
  assert.equal(log.opfyldt.length, 0, 'og den maa slet ikke melde succes');
});

test('en anden slags debugger-haendelse ignoreres', async () => {
  const { listener, log } = rejsLytter({ tabId: 42 });
  listener({ tabId: 42 }, 'Page.loadEventFired', {});
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(log.cdp.length, 0, 'kun javascriptDialogOpening maa udloese en handling');
});

test('den rigtige fanes dialog haandteres', async () => {
  const { listener, log } = rejsLytter({ tabId: 42 });
  listener({ tabId: 42 }, DIALOG, HAENDELSE);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(log.cdp.length, 1, 'dialogen skal faktisk besvares');
  assert.equal(log.cdp[0].metode, 'Page.handleJavaScriptDialog');
  assert.equal(log.afvaebnet[0], 42, 'armeringen skal ryddes - én dialog pr. armering');
  assert.equal(log.opfyldt[0].ok, true);
  assert.equal(log.opfyldt[0].message, 'Er du sikker?', 'beskeden skal med tilbage til agenten');
});

// ── Mutations-verificeret: `accept: action === 'accept'` -> `accept: true` gav roed.
test('dismiss AFVISER - den maa aldrig acceptere', async () => {
  const { listener, log } = rejsLytter({ tabId: 42, action: 'dismiss' });
  listener({ tabId: 42 }, DIALOG, HAENDELSE);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(log.cdp[0].params.accept, false,
    'paa en "vil du slette?"-bekraeftelse er forskellen mellem accept og dismiss ' +
    'forskellen mellem at slette og at lade vaere');
  assert.equal(log.opfyldt[0].action, 'dismiss', 'svaret skal oplyse hvad der faktisk skete');
});

test('accept ACCEPTERER, og prompt-teksten foelger med', async () => {
  const { listener, log } = rejsLytter({ tabId: 42, action: 'accept', promptText: 'Gustav' });
  listener({ tabId: 42 }, DIALOG, { type: 'prompt', message: 'Navn?' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(log.cdp[0].params.accept, true);
  assert.equal(log.cdp[0].params.promptText, 'Gustav', 'ellers er prompt-vaerktoejet meningsloest');
});
