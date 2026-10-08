/**
 * ask_user's prompt i siden: koerer den rigtige renderAskPrompt fra background.js mod en lille DOM.
 *
 * R48 (Opus, MAALT 8 af 13 mutanter overlevede): proeverne af #62 koerte kun baggrunden, aldrig prompten.
 * Kortet kunne blive fuldskaerm igen, Submit kunne sende tomme vaerdier, Enter kunne svare skip, og en
 * besvaret prompt kunne saette sig selv paa igen - alt sammen med groenne proever. Denne fil koerer
 * funktionen. Capture-faser, layout og rigtige klik er maalt i headless Chrome i R48, ikke her.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROD } from './hjaelp/udvidelses-sele.mjs';
import { lavDom, iDom, vent } from './hjaelp/prompt-dom.mjs';

const bg = readFileSync(join(ROD, 'extension/background.js'), 'utf8');

function funktion(navn) {
  const start = bg.indexOf(`function ${navn}(`);
  assert.ok(start >= 0, `${navn} findes ikke`);
  let d = 0, i = bg.indexOf('{', start);
  for (; i < bg.length; i++) { if (bg[i] === '{') d++; else if (bg[i] === '}' && --d === 0) break; }
  return bg.slice(start, i + 1);
}
const RENDER = funktion('renderAskPrompt');
const SLET = bg.slice(bg.indexOf('function eraseAskPrompt(')).match(/func: (\(id\) => \{[\s\S]*?\n {4}\}),/)[1];

const spec = (over = {}) => ({ askId: 'ask-1', message: 'Please log in, then click Done', title: 'Agent360 - Action Required',
  fields: [], hasFields: false, sessionLabel: 'Claude 1', position: null, deadline: Date.now() + 60000, ...over });
const feltSpec = (over = {}) => spec({ fields: [{ name: 'code', label: '2FA code', type: 'password' }], hasFields: true, ...over });

function tegn(s = spec(), replay = false, dom = lavDom()) {
  iDom(RENDER, 'renderAskPrompt', dom)(s, replay);
  const vaert = dom.document.body.children.filter((n) => n.id === 'a360-overlay' && n.dataset.askId === s.askId).at(-1);
  const inde = vaert ? vaert.alle() : [];
  const knap = (tekst) => inde.find((n) => n.tagName === 'BUTTON' && n.textContent.includes(tekst));
  const felt = inde.find((n) => n.tagName === 'INPUT');
  return { dom, vaert, inde, knap, felt };
}

test('uden felter: et kort i hjoernet, ingen baggrund over siden', () => {
  const { vaert, inde } = tegn();
  assert.ok(vaert, 'prompten blev ikke tegnet');
  assert.equal(vaert.shadowRoot, null, 'shadow root skal vaere lukket');
  assert.ok(!inde.some((n) => /height:100%/.test(n.style.cssText)), 'en fuldskaerms-baggrund daekker den side, brugeren skal handle paa');
  assert.ok(inde.some((n) => /position:fixed;left:16px;bottom:16px/.test(n.style.cssText)), 'kortet nederst til venstre mangler');
});

test('med felter: en dialog over siden', () => {
  const { inde } = tegn(feltSpec());
  assert.ok(inde.some((n) => /position:fixed;top:0;left:0;width:100%;height:100%/.test(n.style.cssText)), 'en prompt med felter skal vaere en dialog');
});

test('Submit sender det indtastede, og et syntetisk klik svarer ikke', () => {
  const { dom, knap, felt } = tegn(feltSpec());
  felt.value = '482913';
  knap('Submit').fyr('click', { isTrusted: false });
  assert.equal(dom.beskeder.length, 0, 'et klik fra siden (isTrusted false) svarede for brugeren');
  knap('Submit').fyr('click');
  assert.deepEqual(dom.beskeder, [{ type: 'ask_user_answer', action: 'done', values: { code: '482913' }, askId: 'ask-1' }]);
});

test('Enter i feltet svarer done med vaerdien; Skip svarer skip uden vaerdier', () => {
  const a = tegn(feltSpec());
  a.felt.value = '771';
  a.felt.fyr('keydown', { key: 'Enter', isTrusted: false });
  assert.equal(a.dom.beskeder.length, 0, 'et syntetisk Enter svarede');
  a.felt.fyr('keydown', { key: 'Enter' });
  assert.deepEqual(a.dom.beskeder[0], { type: 'ask_user_answer', action: 'done', values: { code: '771' }, askId: 'ask-1' });
  const b = tegn(feltSpec());
  b.felt.value = 'skal ikke med';
  b.knap('Skip').fyr('click');
  assert.deepEqual(b.dom.beskeder[0], { type: 'ask_user_answer', action: 'skip', values: {}, askId: 'ask-1' });
});

test('en besvaret prompt kommer ikke igen', async () => {
  const { dom, vaert, knap } = tegn();
  knap('Done').fyr('click');
  assert.equal(vaert.isConnected, false);
  dom.document.body.appendChild(dom.document.createElement('div'));   // siden aendrer sig bagefter
  await vent();
  assert.equal(vaert.isConnected, false, 'den besvarede prompt satte sig selv paa igen');
  knap('Done').fyr('click');
  assert.equal(dom.beskeder.length, 1, 'samme prompt svarede to gange');
});

test('siden fjerner prompten: den kommer igen, ogsaa naar siden selv saetter data-closed', async () => {
  const { vaert } = tegn();
  vaert.remove();
  await vent();
  assert.equal(vaert.isConnected, true, 'prompten kom ikke igen efter en genopbygning af siden');
  vaert.dataset.closed = '1';   // R48 (Astra, MAALT): saa koblede observatoeren fra
  vaert.remove();
  await vent();
  assert.equal(vaert.isConnected, true, 'siden kunne slukke genindsaettelsen med et attribut');
});

test('en side der fjerner prompten hver gang: hoejst 20 gange, og baggrunden faar besked', async () => {
  const { dom, vaert } = tegn();
  let fjernet = 0;
  const fjendtlig = new dom.MutationObserver(() => { if (vaert.isConnected) { fjernet++; vaert.remove(); } });
  fjendtlig.observe(dom.document.documentElement, { childList: true, subtree: true });
  vaert.remove();
  for (let i = 0; i < 100; i++) await vent();
  fjendtlig.disconnect();
  assert.ok(dom.leveringer() < dom.LOEBSK, 'observatoererne jagtede hinanden uden ende (R48: 633.333 fjernelser paa 2 s)');
  assert.equal(fjernet, 20, 'prompten blev sat paa igen mere end 20 gange');
  assert.deepEqual(dom.beskeder, [{ type: 'ask_user_lost', askId: 'ask-1' }], 'baggrunden fik ikke besked, saa agenten venter til fristen');
});

test('sidens egen frist fjerner prompten, og en udloebet frist tegner intet', async () => {
  const a = tegn(spec({ deadline: Date.now() + 30 }));
  assert.equal(a.vaert.isConnected, true);
  await vent(60);
  assert.equal(a.vaert.isConnected, false, 'en foraeldreloes prompt blev staaende efter fristen');
  const b = tegn(spec({ deadline: Date.now() - 1 }));
  assert.equal(b.vaert, undefined, 'en prompt med udloebet frist blev tegnet');
});

test('en falsk vaert med samme ask-id stopper ikke en gentegning', () => {
  const dom = lavDom();
  const falsk = dom.document.createElement('div');
  falsk.id = 'a360-overlay';
  falsk.dataset.askId = 'ask-1';
  dom.document.body.appendChild(falsk);
  const { vaert } = tegn(spec(), true, dom);
  assert.ok(vaert && vaert !== falsk, 'sidens falske prompt fik gentegningen til at springe over');
});

test('en gentegning af den samme prompt i samme dokument laver ikke en til', () => {
  const dom = lavDom();
  tegn(spec(), false, dom);
  tegn(spec(), true, dom);
  assert.equal(dom.document.body.children.filter((n) => n.id === 'a360-overlay').length, 1);
});

test('baggrunden sletter prompten, og den kommer ikke igen', async () => {
  const { dom, vaert } = tegn();
  iDom(`const slet = ${SLET};`, 'slet', dom)('ask-1');
  await vent();
  assert.equal(vaert.isConnected, false, 'en slettet prompt satte sig selv paa igen');
});

test('a prompt with fields is not drawn on another origin (R51, Astra)', () => {
  const fremmed = tegn(feltSpec({ origin: 'https://bank.example' }), true, lavDom({ origin: 'https://evil.example' }));
  assert.equal(fremmed.vaert, undefined, 'the prompt was drawn on a document from another origin');
  const egen = tegn(feltSpec({ origin: 'https://bank.example' }), true, lavDom({ origin: 'https://bank.example' }));
  assert.ok(egen.vaert, 'the prompt was not drawn on its own origin');
});

test('the prompt is visible: nothing hides the host or the card (R51, Astra: display:none survived)', () => {
  for (const s of [spec(), feltSpec()]) {
    const { vaert, inde } = tegn(s);
    for (const n of [vaert, ...inde]) {
      assert.doesNotMatch(n.style.cssText, /display:\s*none|visibility:\s*hidden|opacity:\s*0(?![.\d])/, `a prompt element is hidden: ${n.style.cssText}`);
    }
  }
});

test('a prompt with fields is drawn on a sandboxed page at its own address (R51, Opus)', () => {
  const sandbox = tegn(feltSpec({ origin: 'https://raw.example' }), true, lavDom({ origin: 'null', href: 'https://raw.example/notes.txt' }));
  assert.ok(sandbox.vaert, 'a sandboxed page (location.origin "null") got no prompt');
  const fil = tegn(feltSpec({ origin: 'file://' }), true, lavDom({ origin: 'null', href: 'file:///Users/x/side.html' }));
  assert.ok(fil.vaert, 'a local file got no prompt');
});

test('a page that rewrites its body now and then keeps the prompt (R51, Opus: lost after 6.3 s)', async () => {
  const { dom, vaert } = tegn();
  for (let i = 0; i < 25; i++) {
    vaert.remove();
    await vent(120);
    assert.equal(vaert.isConnected, true, `the prompt did not come back after removal ${i + 1}`);
  }
  assert.deepEqual(dom.beskeder, [], 'a page that rewrites its body every 120 ms was reported as removing the prompt');
});
