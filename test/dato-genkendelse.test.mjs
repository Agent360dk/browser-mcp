/**
 * set_date maa ikke godkende en ANDEN dato fordi cifrene findes et sted i teksten.
 *
 * MAALT 10/9 af Astra (anden runde): valueLooksLikeIso slog tilbage paa tre `value.includes(...)`
 * hver for sig. "20/12/2026" indeholder "2026", "1" og "2" som delstrenge og blev godkendt som
 * 2026-01-02 - ogsaa i stien der melder "landede trods fejl i afsendelsen".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indlaesUdvidelse } from './hjaelp/udvidelses-sele.mjs';

const ligner = indlaesUdvidelse({ svar: {} }).hent('valueLooksLikeIso');

test('en anden dato med de samme cifre godkendes ikke', () => {
  assert.equal(ligner('20/12/2026', '2026-01-02'), false, '20. december er ikke 2. januar');
  assert.equal(ligner('12/1/2026', '2026-01-02'), false);
  assert.equal(ligner('2026-12-20', '2026-01-02'), false);
});

test('den rigtige dato genkendes i de almindelige formater', () => {
  for (const v of ['2026-01-02', '02/01/2026', '02.01.2026', '1/2/2026', '01/02/2026', '2 Jan 2026', '2. januar 2026']) {
    assert.equal(ligner(v, '2026-01-02'), true, `"${v}" er 2026-01-02`);
  }
});

// ── Tredje runde (Astra) ────────────────────────────────────────────────────
const DMY = { order: ['D', 'M', 'Y'], sep: '/', padded: [true, true, true] };

test('et klokkeslaet eller en cifferstreng leverer ikke datoen', () => {
  assert.equal(ligner('2026-1-1 02:00', '2026-11-02'), false, '1. januar kl. 02 er ikke 2. november');
  assert.equal(ligner('12 Jan 2026 02:00', '2026-01-02'), false, 'dagen er 12, ikke klokkeslaettets 2');
});

test('med kendt format proeves KUN den raekkefoelge', () => {
  assert.equal(ligner('01/12/2026', '2026-01-12', DMY), false, 'DD/MM/YYYY: 01/12/2026 er 1. december, ikke 12. januar');
  assert.equal(ligner('01/12/2026', '2026-12-01', DMY), true);
  assert.equal(ligner('02012026', '2026-01-02', DMY), true);
});

test('dansk maj og tocifret aar genkendes', () => {
  assert.equal(ligner('2. maj 2026', '2026-05-02'), true);
  assert.equal(ligner('2/1/26', '2026-01-02'), true);
});
