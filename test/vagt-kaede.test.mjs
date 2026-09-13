/**
 * Foraeldre-vagten - koert, ikke grepped.
 *
 * MAALT 22/8 mod en LEVENDE server, og det var en fejl jeg selv indfoerte samme aften:
 *
 *     [MCP] vagt-kaede: 1
 *     [MCP] Chrome extension connected on port 9882
 *     [MCP] Proces 1 i kaeden doede - chatten bag denne server er vaek
 *
 * Pid 1 er launchd. Den doede ikke. `process.kill(1, 0)` kaster EPERM for en
 * almindelig bruger, og koden tolkede ENHVER exception som "processen doede".
 * Vagten der skulle frigive tomme porte draebte i stedet levende chats efter fem
 * sekunder - med en fejltekst der navngav en proces der aldrig doede.
 *
 * Den gamle test kunne ikke se det: den greppede efter `process.kill(pid, 0)` og
 * `gracefulShutdown(`, og begge stod der stadig. Derfor er beslutningen nu trukket
 * ud i `ledErDoedt` og KOERES her mod stubbede fejl.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledErDoedt, forfaedreKaede } from '../mcp-server/vagt.js';

const kaster = (kode) => () => { const e = new Error(kode); e.code = kode; throw e; };

// ── Mutations-verificeret: `if (e?.code === 'ESRCH') return true` -> `return true` gav roed.
test('EPERM betyder at processen LEVER - den er bare en andens', () => {
  assert.equal(ledErDoedt(1, kaster('EPERM')), false,
    'pid 1 er launchd og altid root-ejet. Tolkes EPERM som doed, draeber serveren ' +
    'sig selv fem sekunder efter opstart paa HVER maskine.');
});

test('ESRCH betyder at processen faktisk er vaek', () => {
  assert.equal(ledErDoedt(999999, kaster('ESRCH')), true,
    'det er den ENESTE fejl der betyder doed - og hele pointen med vagten');
});

test('svarer kaldet uden fejl, lever processen', () => {
  assert.equal(ledErDoedt(4242, () => {}), false);
});

// ── Mutations-verificeret: `return false` -> `return true` i den sidste gren gav roed.
test('en ukendt fejl tolkes som i live - vi draeber ikke paa tvivl', () => {
  assert.equal(ledErDoedt(4242, kaster('EINVAL')), false,
    'at lukke en levende chat ned er en vaerre fejl end at holde en port lidt for laenge');
  assert.equal(ledErDoedt(4242, () => { throw new Error('uden kode'); }), false,
    'en fejl uden kode maa heller ikke betyde doed');
});

test('den aegte process.kill giver det rigtige svar paa denne maskine', () => {
  assert.equal(ledErDoedt(process.pid), false, 'vores egen proces lever');
  assert.equal(ledErDoedt(1), false, 'launchd lever - det er hele fejlen fra 22/8');
  assert.equal(ledErDoedt(999999), true, 'et pid der ikke findes er doedt');
});

// ── Kaeden. MAALT 22/8: mutationen `i < 12` -> `i < 1` slap igennem den gamle test,
//    fordi den kun greppede efter `for (const pid of vagtKaede)`. En kaede klippet
//    til ét led er PRAECIS den fejl vagten blev skrevet for at rette - den ville
//    vogte `npm exec` i stedet for Claude Code, og de tomme porte var tilbage.
test('kaeden gaar hele vejen op, ikke kun ét led', () => {
  //  server → npm exec → wrapper → Claude Code → login → launchd
  const trae = { 100: 200, 200: 300, 300: 400, 400: 500, 500: 1 };
  const k = forfaedreKaede(100, (p) => trae[p] ?? null);
  assert.deepEqual(k, [100, 200, 300, 400, 500],
    'klippes kaeden til ét led, vogter vi npm exec i stedet for chatten - ' +
    'og saa er de tyve tomme porte tilbage');
});

test('kaeden stopper ved roden og tager ikke pid 1 med', () => {
  const k = forfaedreKaede(100, (p) => (p === 100 ? 1 : null));
  assert.deepEqual(k, [100], 'launchd er ingen vagt - den doer aldrig');
});

test('kan et led ikke laeses, stopper kaeden pænt', () => {
  const k = forfaedreKaede(100, (p) => (p === 100 ? 200 : null));
  assert.deepEqual(k, [100, 200], 'ingen exception, bare en kortere kaede');
});

test('en cyklus kan ikke faa loekken til at loebe evigt', () => {
  const k = forfaedreKaede(100, () => 100);
  assert.deepEqual(k, [100], 'et led der peger paa sig selv stopper med det samme');
  const dyb = forfaedreKaede(1, () => 999);
  assert.deepEqual(dyb, [], 'starter vi paa pid 1, er der ingen kaede at vogte');
});

test('loftet paa 12 led holder, ogsaa i et absurd dybt traee', () => {
  const k = forfaedreKaede(1000, (p) => p + 1);
  assert.equal(k.length, 12, 'loftet skal holde, ellers kan opstarten haenge i et sygt procestrae');
});
