/**
 * Besked-kontrakten mellem broen og service-workeren - koert, ikke grepped.
 *
 * MAALT 22/8: mutationen `return true` -> `return false` i chrome.runtime.onMessage
 * slap igennem HELE suiten. Den er katastrofal: Chromes kontrakt er at `true` holder
 * beskedkanalen aaben til et asynkront sendResponse. Returneres false (eller intet),
 * lukkes kanalen med det samme, svaret naar aldrig frem, og HVERT ENESTE
 * vaerktoejskald haenger uden fejl. Udvidelsen ser levende ud og goer ingenting.
 *
 * Lytteren klippes ud af den aegte kilde og KOERES med stubbede afhaengigheder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');

/** Klipper `chrome.runtime.onMessage.addListener(<fn>)` ud og returnerer <fn> som tekst. */
function udklipLytter(nr = 0) {
  let fra = -1;
  for (let i = 0; i <= nr; i++) fra = kilde.indexOf('chrome.runtime.onMessage.addListener(', fra + 1);
  assert.ok(fra > -1, `lytter #${nr} findes ikke`);
  const i = kilde.indexOf('(', fra + 'chrome.runtime.onMessage.addListener'.length - 1);
  let d = 0;
  for (let j = i; j < kilde.length; j++) {
    if (kilde[j] === '(') d++;
    else if (kilde[j] === ')') {
      d--;
      if (d === 0) return kilde.slice(i + 1, j);
    }
  }
  throw new Error('kunne ikke afgraense lytteren');
}

/** Rejser hovedlytteren med stubbede afhaengigheder og returnerer {retur, svar}. */
async function send(besked, { dispatchSvar = { ok: true }, dispatchFejler = null } = {}) {
  let svar; let svarKaldt = 0;
  const sendResponse = (r) => { svar = r; svarKaldt++; };

  const fn = new Function(
    'restoreSessions', 'adoptOrphanedSession', 'getSession', 'dispatch',
    'logAction', 'releaseSession', 'chrome', 'console',
    `return (${udklipLytter(0)});`,
  )(
    async () => {},
    async () => null,
    () => ({}),
    async () => { if (dispatchFejler) throw new Error(dispatchFejler); return dispatchSvar; },
    () => {},
    () => {},
    { runtime: { lastError: null } },
    { log() {}, warn() {}, error() {} },
  );

  const retur = fn(besked, {}, sendResponse);
  await new Promise((r) => setTimeout(r, 30));   // lad de asynkrone led loebe faerdigt
  return { retur, svar, svarKaldt };
}

// ── DEN KATASTROFALE. Mutations-verificeret: `return true` -> `return false` gav roed.
test('mcp_command holder kanalen aaben - ellers haenger HVERT vaerktoejskald', async () => {
  const { retur } = await send({ type: 'mcp_command', port: 9877, method: 'list_tabs', params: {} });
  assert.equal(retur, true,
    'Chromes kontrakt: kun `return true` holder beskedkanalen aaben til et asynkront ' +
    'sendResponse. Returneres false, lukkes kanalen straks, svaret naar aldrig frem, ' +
    'og udvidelsen ser levende ud mens den ikke svarer paa noget som helst.');
});

test('svaret naar faktisk frem til kalderen', async () => {
  const { svar, svarKaldt } = await send(
    { type: 'mcp_command', port: 9877, method: 'list_tabs', params: {} },
    { dispatchSvar: { tabs: [], session: 'Claude 1' } },
  );
  assert.equal(svarKaldt, 1, 'praecis ét svar - hverken nul eller to');
  assert.deepEqual(svar, { tabs: [], session: 'Claude 1' });
});

// ── Mutations-verificeret: .catch() paa dispatch fjernet gav roed.
test('en fejl i dispatch bliver til et svar, ikke til stilhed', async () => {
  const { svar, svarKaldt } = await send(
    { type: 'mcp_command', port: 9877, method: 'click', params: {} },
    { dispatchFejler: 'element ikke fundet' },
  );
  assert.equal(svarKaldt, 1, 'en fejl maa ALDRIG efterlade kalderen uden svar');
  assert.match(svar.__error, /element ikke fundet/,
    'fejlen skal med tilbage - ellers ser agenten en timeout i stedet for aarsagen');
});

// ── Mutations-verificeret: den ydre .catch fjernet gav roed.
//    Kommentaren i koden siger det selv: "else a storage-restore reject hangs the caller".
test('fejler selv sessions-gendannelsen, faar kalderen stadig svar', () => {
  const i = kilde.indexOf("msg.type === 'mcp_command'");
  const blok = kilde.slice(i, kilde.indexOf('return true;', i));
  const catches = (blok.match(/\.catch\(/g) || []).length;
  assert.ok(catches >= 3,
    `kun ${catches} fangster i mcp_command-stien - hver asynkron gren skal kunne svare, ` +
    'ellers haenger kalderen tavst paa den gren der fejler');
});
