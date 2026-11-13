// Instrumentets faktiske afkodning, rundeloekke og exitlogik med simulerede MCP-svar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const kilde = readFileSync(new URL('./flow/repro-100.mjs', import.meta.url), 'utf8');
const kald = kilde.slice(kilde.indexOf('const kald ='), kilde.indexOf("await rpc('initialize'"));
const loekke = kilde.slice(kilde.indexOf('const domme = []'));
assert.ok(kald.includes('JSON.parse(tekst)') && loekke.includes('process.exit(kode)'));
const svar = (data, isError = false) => ({ result: { content: [{ type: 'text', text: JSON.stringify(data) }], isError } });
const tekstSvar = (text, isError = false) => ({ result: { content: [{ type: 'text', text }], isError } });
const gode = {
  browser_navigate: svar({ tab_id: 7 }), browser_switch_tab: svar({ ok: true }),
  browser_click: svar({ ok: false, maybe_landed: true, dialog_open: { type: 'confirm' } }),
  browser_handle_dialog: svar({ ok: true, dialog_type: 'confirm', action: 'dismiss' }),
  browser_execute_script: svar('RESULT false'), browser_close_tab: svar({ ok: true }),
};
async function proev(overstyr = {}, runder = [['A', 1], ['A', 2], ['A', 3], ['B', 1]]) {
  let kode, lukket = 0;
  const log = [];
  const ctx = vm.createContext({ runder, URL_: 'http://fixture.invalid/',
    console: { log(...xs) { log.push(xs.join(' ')); } },
    rpc: async (_, p) => overstyr[p.name] ?? gode[p.name],
    srv: { kill() { lukket++; } }, web: { close() { lukket++; } },
    process: { exit(k) { kode = k; } },
  });
  await vm.runInContext('(async () => {\n' + kald + '\n' + loekke + '\n})()', ctx);
  assert.equal(lukket, 2);
  return { kode, log: log.join('\n') };
}

test('repro-100: JSON-resultat giver 0 i A og B; titel og alle trin er stadig praecise', async () => {
  for (const titel of ['RESULT false', { result: 'RESULT false', method: 'debugger' }]) {
    const r = await proev({ browser_execute_script: svar(titel) });
    assert.equal(r.kode, 0, r.log);
    assert.match(r.log, /A1: BESVARET/);
    assert.match(r.log, /B1: BESVARET/);
  }
  assert.equal((await proev({ browser_execute_script: tekstSvar('RESULT false') })).kode, 0);
  for (const titel of ['RESULT false ', ' RESULT false', 'RESULT false\n', 'RESULT true', { title: 'RESULT false' },
    { result: 'RESULT false ekstra' }, { result: false }]) {
    assert.equal((await proev({ browser_execute_script: svar(titel) })).kode, 5);
  }
  for (const [navn, data] of [
    ['browser_navigate', {}], ['browser_switch_tab', { ok: false }], ['browser_click', { ok: false }],
    ['browser_handle_dialog', { ok: true, armed: true }],
  ]) assert.equal((await proev({ [navn]: svar(data) })).kode, 6);
  assert.equal((await proev({}, [])).kode, 4);
});

test('repro-100: kun den praecise klikfrist med besvaret confirm giver 7; fejl har forrang', async () => {
  const frist = tekstSvar('Error: Command timed out after 30000ms: click', true);
  const r = await proev({ browser_click: frist, browser_execute_script: svar({ result: 'RESULT false' }) });
  assert.equal(r.kode, 7, r.log);
  assert.match(r.log, /A1: KLIK-FRIST, BESVARET/);
  assert.match(r.log, /B1: KLIK-FRIST, BESVARET/);
  assert.doesNotMatch(r.log, /UGYLDIG RUNDE/);
  for (const forkert of [tekstSvar('Error: Command timed out after 30000ms: click'),
    tekstSvar('Error: Command timed out after 30000ms: click_xy', true), { klientfrist: true }]) {
    assert.equal((await proev({ browser_click: forkert })).kode, 6);
  }
  assert.equal((await proev({ browser_click: frist, browser_execute_script: svar('RESULT true') })).kode, 5);
  assert.equal((await proev({ browser_click: frist, browser_handle_dialog: svar({ ok: true, armed: true }) })).kode, 6);
  assert.equal((await proev({ browser_click: frist, browser_execute_script: { klientfrist: true } })).kode, 1);
});
