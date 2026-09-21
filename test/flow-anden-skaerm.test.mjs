/**
 * Flow-spaerren maa kunne koere uden at tage menneskets skaerm.
 *
 * ⛔ Gustav har sagt det tre gange paa to dage. Det er ikke en praeference, det er en
 * arbejdsbetingelse: `forrest()` henter fanen frem foer hvert af de 12 vaerktoejer der
 * fysisk kraever fokus, saa en koersel hopper op foran ham igen og igen.
 *
 * Fokus kan ikke bare slaas fra - MAALT 19/9 leverer Chrome hverken mus eller tastatur til
 * en baggrundsfane ELLER til et eget vindue uden fokus. Det der KAN aendres er hvor fokus
 * sker. Derfor `FLOW_VINDUE_X`.
 *
 * Proeven vogter tre ting, og den tredje er den vigtigste: at koerslen BEKRAEFTER at
 * tilstanden blev lavet. 19/9 koerte Chrome den gamle udvidelseskode, `eget_vindue` blev
 * ignoreret i stilhed, og maalingen foregik i virkeligheden i en baggrundsfane. Det saa ud
 * som et resultat og var ingenting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kilde = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'flow', 'run.mjs'), 'utf8');

test('FLOW_VINDUE_X sendes videre som placering OG fokus', () => {
  assert.match(kilde, /FLOW_VINDUE_X/, 'variablen laeses ikke');
  const i = kilde.indexOf('FLOW_VINDUE_X');
  const blok = kilde.slice(i, kilde.indexOf('── Navigation & indhold ──', i));
  assert.ok(blok.length > 200 && blok.length < 3000, 'opsaetnings-blokken ser ikke ud som forventet');

  assert.match(blok, /eget_vindue:\s*true/, 'der oprettes ikke et eget vindue');
  assert.match(blok, /fokuser:\s*true/,
    'uden fokus leverer Chrome intet input - maalt 19/9. Et vindue paa den anden skaerm UDEN fokus maaler ingenting');
  assert.match(blok, /vindue_x:\s*VINDUE_X/, 'placeringen sendes ikke med, saa vinduet havner paa hovedskaermen');
});

test('koerslen bekraefter at tilstanden BLEV lavet, og siger til hvis ikke', () => {
  const i = kilde.indexOf('FLOW_VINDUE_X');
  const blok = kilde.slice(i, kilde.indexOf('── Navigation & indhold ──', i));
  assert.match(blok, /r\?\.eget_vindue\s*&&\s*r\?\.fokuseret/,
    'svaret efterproeves ikke - saa kan en gammel udvidelse ignorere parametrene i stilhed');
  assert.match(blok, /TAGER skaermen/,
    'naar tilstanden IKKE blev lavet, skal koerslen sige hoejt at den nu tager skaermen');
});

test('Number.isFinite bruges, saa en tom variabel ikke bliver til x=0', () => {
  const i = kilde.indexOf('const VINDUE_X');
  const blok = kilde.slice(i, i + 220);
  assert.match(blok, /Number\.isFinite\(VINDUE_X\)/,
    'uden det ville en usat eller ugyldig variabel give x=0 - altsaa hovedskaermen, det stik modsatte');
});
