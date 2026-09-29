/**
 * Alt agenten faar tilbage er paa engelsk - ogsaa fejlbeskeder og noter.
 *
 * MAALT 29/9 (backlog 1.30.2 #13): tolv tekster til agenten var helt eller delvist danske, fx
 * «...but the change » + «beviser ikke at det var valget.» og «Chrome tillader kun ÉN debugger».
 * Agenten viderebringer dem ordret til brugeren. Den foerste skanning (et regex) missede to af dem,
 * fordi den ene stod alene paa sin linje og den anden inde i en indlejret skabelon - derfor laeser
 * denne proeve filen med en lille tokenizer (kommentarer, strenge, skabeloner med ${...}).
 * Logkald (console.*, process.stderr.write) er udviklerens og maa vaere danske.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const FILER = ['extension/background.js', 'mcp-server/index.js'];
const DANSK = /[æøåÆØÅ]|\b(?:ikke|ingen|kunne|tillader|veje|herfra|ukendt|oplyser|dukkede|angivet|kvitterede|beviser|landede|matchede|fundet|valget|alligevel|tasten|trods|fejl|afsendelsen|brug|eller|enkelt|inden|fristen|mulighed|siden|feltet)\b/i;
const LOG = /(?:console\.(?:log|warn|error|info|debug)|process\.stderr\.write)$/;
// Ord der MATCHES mod danske sider (knapper, datovaelgere, cookie-bannere) er data, ikke tekst til agenten.
// Nye ord her kraever en begrundelse: det skal vaere noget der staar PAA en side, ikke noget vi siger.
const SIDEORD = new Set(['vælg dato', 'åbn', 'næste', 'ikke nu', 'køb']);
const ER_KODE = /\bfunction\b|=>|\bconst\b|\breturn\b/;
const ER_REGEX = /\[a-z[^\]]*æøå|\\d|\\s/;

// Returnerer [{ tekst, linje, iLog }] for hver streng/skabelon-del uden for kommentarer.
export function strenge(kilde) {
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
  test(`${fil}: ingen dansk i tekster til agenten`, () => {
    // JavaScript der koeres i siden (skabeloner med kode) laeses indefra: dens egne strenge kan naa agenten.
    const alle = [];
    const saml = (liste, forskyd) => { for (const x of liste) {
      if (ER_KODE.test(x.tekst)) saml(strenge(x.tekst), forskyd + x.linje - 1);
      else alle.push({ ...x, linje: x.linje + forskyd });
    } };
    saml(strenge(readFileSync(join(rod, fil), 'utf8')), 0);
    const fund = alle
      .filter(s => !s.iLog && DANSK.test(s.tekst) && !SIDEORD.has(s.tekst) && !ER_REGEX.test(s.tekst))
      .map(s => `${fil}:${s.linje}: «${s.tekst.slice(0, 90)}»`);
    assert.deepEqual(fund, [], 'dansk i en tekst agenten kan faa:\n' + fund.join('\n'));
  });
}
