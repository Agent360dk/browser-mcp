/**
 * Billeder kan ikke laeses af loefte-vagten - og det er billederne folk ser foerst.
 *
 * MAALT 11/9 i e2e-runden: `docs/og-image.jpg`, der vises hver gang browsermcp.dev deles, siger "34 tools" og
 * "by agent360.eu". Begge dele er forkerte (40 vaerktoejer, agent360.dk), og de har ligget live siden juni, fordi ingen
 * vagt kan laese en JPEG. Billederne bygges derfor fra kilder i `demo-video-src`, og kilderne holdes op mod koden her.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
// Kildekommentarer maa citere det de erstatter (samme regel som loefte-vagten) - ellers kan en rettelse ikke forklare sig.
const udenKommentarer = (tekst) => tekst.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const kilder = () => readdirSync(join(rod, 'demo-video-src/src'))
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => [f, udenKommentarer(readFileSync(join(rod, 'demo-video-src/src', f), 'utf8'))]);

const VAERKTOEJER = (readFileSync(join(rod, 'mcp-server/tools.js'), 'utf8').match(/name: ['"]browser_/g) || []).length;

test('billedkilderne bruger det rigtige vaerktoejstal', () => {
  assert.ok(VAERKTOEJER >= 30, `tools.js gav ${VAERKTOEJER} vaerktoejer - vagten maaler ikke det den tror`);
  const forkerte = [];
  for (const [fil, tekst] of kilder()) {
    for (const m of tekst.matchAll(/(\d+)\s+tools\b/g)) {
      if (Number(m[1]) !== VAERKTOEJER) forkerte.push(`${fil}: "${m[0]}" (rigtigt: ${VAERKTOEJER})`);
    }
  }
  assert.deepEqual(forkerte, [], `gamle tal i billedkilderne:\n  ${forkerte.join('\n  ')}`);
});

test('billedkilderne bruger den rigtige adresse', () => {
  const forkerte = kilder()
    .filter(([, tekst]) => /agent360\.(eu|com|net)/i.test(tekst))
    .map(([fil]) => fil);
  assert.deepEqual(forkerte, [], `forkert domaene i: ${forkerte.join(', ')}`);
});

test('delingsbilledet har en kilde, saa det kan bygges igen naar tallene aendrer sig', () => {
  const root = readFileSync(join(rod, 'demo-video-src/src/Root.tsx'), 'utf8');
  assert.match(root, /id="OgImage"/, 'der findes ingen OgImage-komposition');
  assert.match(root, /width=\{1200\}[\s\S]{0,80}height=\{630\}/, 'delingsbilledet har ikke formatet 1200x630');
  assert.match(root, /id="GithubSocial"/, 'der findes ingen kilde til GitHubs forhaandsbillede');
  assert.match(root, /width=\{1280\}[\s\S]{0,80}height=\{640\}/, 'GitHub-billedet har ikke formatet 1280x640');
});

// MAALT 11/9 af Opus og Fable (e2e runde 2): `assets/demo.mp4` blev genrenderet, men sitets egen forsidevideo
// `docs/demo.mp4` var stadig juni-udgaven - den lover "Extracted - stays on your machine", praecis det loefte CHANGELOG
// offentligt kalder usandt. To kopier af samme video driver fra hinanden i tavshed.
test('sitets forsidevideo er den samme som repoets demo', () => {
  const a = readFileSync(join(rod, 'assets/demo.mp4'));
  const b = readFileSync(join(rod, 'docs/demo.mp4'));
  assert.ok(a.equals(b), `docs/demo.mp4 (${b.length} bytes) er ikke den samme som assets/demo.mp4 (${a.length} bytes)`);
});

test('de billeder sitet peger paa, findes', () => {
  const html = readFileSync(join(rod, 'docs/index.html'), 'utf8');
  for (const m of html.matchAll(/https:\/\/browsermcp\.dev\/([\w.-]+\.(?:jpg|png))/g)) {
    assert.ok(existsSync(join(rod, 'docs', m[1])), `${m[1]} staar i metadata, men findes ikke i docs/`);
  }
});
