/**
 * Prøverne laeser kildekode ved at skaere en skive paa et FAST antal tegn:
 *
 *     const i = kilde.indexOf("case 'upload_file'");
 *     const blok = kilde.slice(i, i + 2600);
 *
 * Det moenster har bidt mindst tre gange (9/9 tre gange paa én dag, 19/9, og 21/9 hvor
 * `caseBlok`s 8000-faldbag klippede select_option midt over). Spoergsmaalet er hvilken
 * VEJ det bider, og de to veje er ikke lige farlige:
 *
 *   for KORT  -> moensteret falder uden for vinduet -> assert.match fejler -> ROED.
 *                Irriterende, men den annoncerer sig selv. Ingen tror noget er i orden.
 *   for LANG  -> tekst fra NABO-blokken kommer med -> en assertion kan blive groen paa
 *                noget der staar et helt andet sted. TAVS falsk groen. Det er den farlige.
 *
 * MAALT 21/9: 0 af 8 case-forankrede skiver kan naa ind i nabo-blokken. Den farlige
 * retning findes altsaa ikke i dag - og derfor er det RIGTIGE ikke at omskrive 24 kaldesteder,
 * men at holde den egenskab sand. Det er hvad den her proeve goer.
 *
 * ⛔ Bliver den roed, skal skiven ikke bare goeres kortere: find en STRUKTUREL graense
 * (naeste `case`, switch'ens afslutning) som `caseBlok` i tool-surface.test.mjs nu bruger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HER = dirname(fileURLToPath(import.meta.url));
const ROD = join(HER, '..');

test('ingen fast skive kan naa ind i nabo-blokken', () => {
  const bg = readFileSync(join(ROD, 'extension', 'background.js'), 'utf8');

  /** Finder faste skiver forankret i et `case` og melder dem der raekker for langt. */
  function find(tekst, fil) {
    const fundet = [];
    const re = /indexOf\(\s*["'](case '[a-z_]+')["']\s*\)[\s\S]{0,200}?slice\(\w+,\s*\w+\s*\+\s*(\d+)\)/g;
    let m;
    while ((m = re.exec(tekst))) {
      const anker = m[1].replace(/"/g, '');
      const n = Number(m[2]);
      const i = bg.indexOf(anker);
      if (i < 0) continue;
      // Fire mellemrum. MAALT 21/9: der er NUL cases med seks og 38 med fire, saa den
      // oprindelige soegning matchede aldrig og gjorde hver blok uendelig lang.
      const naeste = bg.indexOf("\n    case '", i + 10);
      const blokLaengde = naeste > i ? naeste - i : Infinity;
      if (n > blokLaengde) {
        fundet.push(`${fil}: ${anker} skaerer ${n} tegn, men blokken er kun ${blokLaengde}`);
      }
    }
    return fundet;
  }

  const overskridelser = [];
  // ⛔ Vagtens egen fil springes over: den BAERER med vilje en for lang skive som
  // kalibrerings-fixtur, og den skal taelle som bevis paa at detektoren virker - ikke som fund.
  const migSelv = 'kildeskiver.test.mjs';
  for (const fil of readdirSync(HER).filter((f) => f.endsWith('.test.mjs') && f !== migSelv)) {
    overskridelser.push(...find(readFileSync(join(HER, fil), 'utf8'), fil));
  }

  // ⛔ Instrumentet proeves mod et KENDT-SANDT tilfaelde foer tallet bruges. Et "0
  // overskridelser" fra en detektor der ikke virker, er en loegn - og den udgave fandtes:
  // foerste version ledte efter `case '` med SEKS mellemrums indrykning, hvor der er nul af
  // dem og 38 med fire. Den svarede "0 af 8 er i orden" mens den ikke maalte noget som helst.
  // Derfor taeller vi ikke laengere paa hvor mange rigtige skiver der findes (de forsvinder
  // efterhaanden som de konverteres) - vi fodrer detektoren en skive vi VED er for lang.
  const kendtSand = `const i = kilde.indexOf("case 'switch_tab'");\n  const blok = kilde.slice(i, i + 99999);`;
  assert.deepEqual(find(kendtSand, 'kalibrering').length, 1,
    'detektoren fanger ikke en skive vi VED er for lang - saa betyder nul overskridelser ingenting');

  assert.deepEqual(overskridelser, [],
    'en skive raekker ind i nabo-blokken - en assertion kan blive groen paa kode der staar et andet sted');
});
