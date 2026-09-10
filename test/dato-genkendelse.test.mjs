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
