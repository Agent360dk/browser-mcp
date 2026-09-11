/**
 * set_date maa ikke godkende en ANDEN dato fordi cifrene findes et sted i teksten.
 *
 * MAALT 10/9 af Astra (anden runde): valueLooksLikeIso slog tilbage paa tre `value.includes(...)`
 * hver for sig. "20/12/2026" indeholder "2026", "1" og "2" som delstrenge og blev godkendt som
 * 2026-01-02 - ogsaa i stien der melder "landede trods fejl i afsendelsen".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// ── Fjerde runde (Astra) ────────────────────────────────────────────────────
const udv = indlaesUdvidelse({ svar: {} });

test('et klokkeslaet bliver ikke til et aarstal, og aaret har en graense', () => {
  assert.equal(ligner('2 Jan 26 05:00', '2005-02-26'), false, 'maanedsnavnet ignoreredes og timen blev aar');
  assert.equal(ligner('2 Jan 20260', '2026-01-02'), false, 'aaret 20260 er ikke 2026');
});

test('en korrekt ISO-aflaesning med tid godkendes - ogsaa med kendt format', () => {
  assert.equal(ligner('2026-01-02T12:00:00', '2026-01-02', DMY), true);
  assert.equal(ligner('2026-01-020', '2026-01-02'), false);
});

test('tocifret aar i placeholderen skrives med to cifre', () => {
  const fmt = udv.hent('parsePlaceholderFormat')('DD/MM/YY');
  assert.equal(udv.hent('isoToFormat')('2026-01-02', fmt), '02/01/26');
});

// ── Femte runde (Astra R5) ──────────────────────────────────────────────────
// F2: readonly DD/MM/YYYY, oensket 2020-01-02, feltet viste "02/01 20:26". Timen 20 blev aaret 2020,
// og set_date svarede ok:true,picker. 1.29.0 afviste.
test('et numerisk klokkeslaet uden aar bliver ikke til aaret (F2)', () => {
  assert.equal(ligner('02/01 20:26', '2020-01-02', DMY), false, 'timen 20 er ikke aaret 2020');
  assert.equal(ligner('02/01 20:26', '2020-01-02'), false);
});

// F3: oensket 2026-01-02, feltet normaliserede til "02/01/2026 12:00 GMT". Bogstavkontrollen saa "GMT",
// og en korrekt dato blev afvist - med et ekstra kalenderklik oveni. 1.29.0 godkendte.
test('en korrekt dato med klokkeslaet og tidszone godkendes (F3)', () => {
  assert.equal(ligner('02/01/2026 12:00 GMT', '2026-01-02', DMY), true, 'det er den rigtige dato');
  assert.equal(ligner('02/01/2026 12:00 PM', '2026-01-02', DMY), true);
  assert.equal(ligner('02/01/2026 23:59:59 UTC', '2026-01-02', DMY), true);
  assert.equal(ligner('20/12/2026 12:00 GMT', '2026-01-02', DMY), false, 'tidszonen maa ikke goere en anden dato rigtig');
});

test('alle tre aflaesninger i set_date kender feltets format - ogsaa kalender-grenen', () => {
  const kilde = readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const i = kilde.indexOf("case 'set_date'");
  const blok = kilde.slice(i, kilde.indexOf("\n    case '", i + 10));
  const antal = (blok.match(/valueLooksLikeIso\(v, iso, (fmt|kendtFormat)\)/g) || []).length;
  assert.equal(antal, 3, `kun ${antal} af 3 aflaesninger giver formatet med - 01/12/2026 kan blive 12. januar`);
});
