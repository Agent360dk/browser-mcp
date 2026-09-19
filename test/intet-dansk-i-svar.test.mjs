/**
 * Ingen dansk tekst maa forlade processen - og vagten maa ikke vaere en ORDLISTE.
 *
 * MAALT 19/9: jeg erklaerede «0 danske strenge forlader processen» og committede det.
 * Det var falsk. `mcp-server/index.js:583` sagde stadig «${n} andre chats bruger browseren
 * i oejeblikket» - midt inde i den ENGELSKE alle-porte-optaget-fejl som agenten citerer
 * videre til brugeren. En konsulent fandt den; mit eget instrument kunne ikke.
 *
 * Hvorfor det slap forbi: min maaling var en liste over danske ORD, og den saetning brugte
 * ord der ikke stod paa listen. Det er husets egen lære fra 7/9, begaaet igen af mig selv:
 * **danske ord kan ikke baere en regel.**
 *
 * Denne vagt maaler MEKANIKKEN i stedet. Dansk skrives translittereret i dette repo (oe, ae,
 * aa for ø, æ, å), og de tre digrafer er sjaeldne inde i engelske ord. Vagten flager hvert
 * ord med en af dem i en streng der kan naa agenten, og kender kun de faa aegte engelske
 * undtagelser. Et nyt dansk ord fanges derfor uden at nogen skal huske at tilfoeje det.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const FILER = ['extension/background.js', 'extension/offscreen.js', 'mcp-server/index.js', 'mcp-server/tools.js'];

// Aegte engelske ord med oe/ae/aa. Holdes kort med vilje: bliver listen lang, er reglen forkert.
const ENGELSK = new Set([
  'aardvark', 'aesthetic', 'aesthetics', 'phoenix', 'toe', 'toes', 'shoe', 'shoes', 'does',
  'doesn', 'goes', 'canoe', 'foe', 'oe', 'maelstrom', 'archaeology', 'caesar', 'bazaar',
  'aaa', 'baseline', 'nae',
]);

function danskeOrd(tekst) {
  return [...tekst.matchAll(/\b[a-z]*(?:oe|ae|aa)[a-z]*\b/gi)]
    .map((m) => m[0].toLowerCase())
    .filter((o) => !ENGELSK.has(o));
}

test('ingen streng der kan naa agenten indeholder translittereret dansk', () => {
  const fund = [];
  for (const fil of FILER) {
    const t = readFileSync(join(rod, fil), 'utf8');
    t.split('\n').forEach((l, i) => {
      const s = l.trim();
      if (s.startsWith('//') || s.startsWith('*')) return;          // kommentarer maa vaere danske
      if (/console\.(log|warn|error|debug)/.test(l)) return;        // konsollen er husets eget vindue
      if (/stderr\.write/.test(l)) return;                          // serverens egen log, samme vindue
      for (const m of l.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
        const tekst = m[1] || m[2] || m[3] || '';
        if (tekst.length < 12) continue;
        // Et enkelt ord uden mellemrum er en NOEGLE eller et felt-navn (fx `parringsnoegle`
        // i chrome.storage), ikke noget nogen laeser. Kontrakter maa hedde hvad de hedder.
        if (!/\s/.test(tekst)) continue;
        // `${...}` indeholder KODE - variabelnavne som `oenskede.length` er ikke tekst
        // brugeren laeser. Den gengivne streng er engelsk. Derfor skaeres udtrykkene ud
        // foer maalingen, i stedet for at udvide undtagelseslisten med vores egne navne.
        const ord = danskeOrd(tekst.replace(/\$\{[^}]*\}/g, ' '));
        if (ord.length) fund.push(`${fil}:${i + 1}  ${ord.join(', ')}  ->  "${tekst.slice(0, 70)}"`);
      }
    });
  }
  assert.deepEqual(fund, [], `dansk i noget der forlader processen:\n  ${fund.join('\n  ')}`);
});
