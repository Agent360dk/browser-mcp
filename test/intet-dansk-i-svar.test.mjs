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

// ⛔ MAALT 29/9 (backlog 1.30.2 #13): digraf-vagten ovenfor var blind for dansk UDEN oe/ae/aa. Tolv tekster slap
// igennem - «select ikke fundet», «Ingen mulighed matchede», «...but the change beviser ikke at det var valget»,
// «Chrome tillader kun ÉN debugger», «To veje ud» - og den laeste linje for linje, saa en tekst paa sin egen
// linje eller i en indlejret skabelon gik fri. Reglen er stadig MEKANIK, ikke en ordliste over indhold: danske
// FUNKTIONSORD er en lukket ordklasse, som naesten hver dansk saetning har mindst ét af, plus æøå. Engelske
// dobbeltgaengere (at, for, men, over, under, til) er udeladt med vilje.
// Og teksten laeses med en tokenizer (kommentarer, strenge, skabeloner med ${...}, sidekode indefra).
const FUNKTIONSORD = /[æøåÆØÅ]|\b(?:ikke|og|det|er|en|et|den|af|med|som|har|kan|fra|der|jeg|vi|du|skal|kun|ingen|eller|efter|hvis|nu|ud|op|ved|blev|bliver|gav|intet|allerede|denne|dette|logget|fandt|kunne|ogsaa|naar|hvor|kald|gange)\b/i; // R42 (Astra): «gav intet svar», «allerede logget i denne session» slap igennem
const LOG = /(?:console\.(?:log|warn|error|info|debug)|process\.stderr\.write)$/;
// Ord der MATCHES mod danske sider (knapper, datovaelgere, cookie-bannere) er data, ikke tekst til agenten.
// Nye ord her kraever en begrundelse: det skal vaere noget der staar PAA en side, ikke noget vi siger.
const SIDEORD = new Set(['vælg dato', 'åbn', 'næste', 'ikke nu', 'køb', 'log ud']);
// Et sideord kan ogsaa CITERES i engelsk tekst (tools.js: «text content (Skip/Cancel/Ikke nu/...)»). Det skaeres ud foer maalingen.
const udenSideord = (t) => [...SIDEORD].reduce((a, o) => a.replace(new RegExp(o.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' '), t);
// MAALT 29/9 af Astra (R2): ét kodeord var nok - «return gav ikke noget: » blev laest som kode og slap igennem.
// Nu kraeves mindst tre forskellige kodetegn; prosa med et enkelt «return» er stadig tekst.
const KODETEGN = [/\bfunction\b/, /=>/, /\bconst\s+\w+\s*=/, /\breturn\b/, /;/, /[{}]/, /\bdocument\./];
const ER_KODE = { test: (t) => KODETEGN.filter((r) => r.test(t)).length >= 3 };
const ER_REGEX = /\[a-z[^\]]*æøå|\\d|\\s/;

// Returnerer [{ tekst, linje, iLog }] for hver streng/skabelon-del uden for kommentarer.
function strenge(kilde) {
  const ud = [];
  const parens = [];          // for hver aaben '(' : erkender kaldet foran den et logkald?
  const skabeloner = [];      // dybde af ${ } inde i skabeloner
  let i = 0, linje = 1, foerIdent = '';
  const iLog = () => parens.some(Boolean);
  while (i < kilde.length) {
    const c = kilde[i], n = kilde[i + 1];
    if (c === '\n') { linje++; i++; continue; }
    if (c === '/' && n === '/') { while (i < kilde.length && kilde[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const j = kilde.indexOf('*/', i + 2); for (; i < (j < 0 ? kilde.length : j + 2); i++) if (kilde[i] === '\n') linje++; continue; }
    if (c === "'" || c === '"') {
      let t = '', start = linje; i++;
      while (i < kilde.length && kilde[i] !== c) { if (kilde[i] === '\\') { t += kilde[i + 1]; i += 2; continue; } if (kilde[i] === '\n') linje++; t += kilde[i++]; }
      i++; ud.push({ tekst: t, linje: start, iLog: iLog() }); foerIdent = ''; continue;
    }
    if (c === '`' || (c === '}' && skabeloner.length && skabeloner[skabeloner.length - 1] === 0)) {
      if (c === '}') skabeloner.pop();
      let t = '', start = linje; i++;
      while (i < kilde.length && kilde[i] !== '`' && !(kilde[i] === '$' && kilde[i + 1] === '{')) {
        if (kilde[i] === '\\') { t += kilde[i + 1]; i += 2; continue; } if (kilde[i] === '\n') linje++; t += kilde[i++];
      }
      ud.push({ tekst: t, linje: start, iLog: iLog() });
      if (kilde[i] === '$') { skabeloner.push(0); i += 2; } else i++;
      foerIdent = ''; continue;
    }
    if (c === '{' && skabeloner.length) skabeloner[skabeloner.length - 1]++;
    if (c === '}' && skabeloner.length) skabeloner[skabeloner.length - 1]--;
    if (c === '(') { parens.push(LOG.test(foerIdent)); foerIdent = ''; i++; continue; }
    if (c === ')') { parens.pop(); foerIdent = ''; i++; continue; }
    if (/[\w.$]/.test(c)) foerIdent += c; else if (!/\s/.test(c)) foerIdent = '';
    i++;
  }
  return ud;
}


test('tokenizeren finder strenge i skabeloner og ser logkald (kalibrering)', () => {
  const s = strenge("const a = `x ${f('inde')} y`; // 'kommentar'\nconsole.warn('[BG] log', `ogsaa ${1}`);\nreturn { error: 'ude' };");
  assert.deepEqual(s.filter(x => !x.iLog).map(x => x.tekst), ['x ', 'inde', ' y', 'ude']);
  assert.deepEqual(s.filter(x => x.iLog).map(x => x.tekst), ['[BG] log', 'ogsaa ', '']);
});

for (const fil of FILER) {
  test(`${fil}: ingen dansk (ogsaa uden digrafer) i tekster der kan naa agenten`, () => {
    const alle = [];
    const saml = (liste, forskyd) => { for (const x of liste) {
      if (ER_KODE.test(x.tekst)) saml(strenge(x.tekst), forskyd + x.linje - 1);
      else alle.push({ ...x, linje: x.linje + forskyd });
    } };
    saml(strenge(readFileSync(join(rod, fil), 'utf8')), 0);
    const fund = alle
      .filter(s => !s.iLog && !ER_REGEX.test(s.tekst) && FUNKTIONSORD.test(udenSideord(s.tekst)))
      .map(s => `${fil}:${s.linje}: «${s.tekst.slice(0, 90)}»`);
    assert.deepEqual(fund, [], 'dansk i en tekst agenten kan faa:\n' + fund.join('\n'));
  });
}
