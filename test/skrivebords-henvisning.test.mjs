/**
 * Henvisningen til et skrivebords-vaerktoej maa KUN staa hvor vaeggen aerligt ligger uden
 * for browseren.
 *
 * Gustav 19/9 foreslog en pop-up i udvidelsen: hver gang Browser MCP rammer en vaeg, tilbyd
 * Computer MCP. MAALT foerst: vaerktoejerne svarer med 26 forskellige vaegge, og et
 * skrivebords-vaerktoej loeser ÉN familie - filvaelgeren naar den aabner som OS-dialog.
 * Baggrundsfane loeses af browser_switch_tab. React-styret felt loeses af den native setter.
 * CAPTCHA loeses af browser_ask_user. Stram CSP er allerede lukket. Arbejdsmappe-spaerren er
 * et bevidst vaern, ikke en mangel.
 *
 * En henvisning paa enhver vaeg ville altsaa vaere usand i 25 af 26 tilfaelde - samme klasse
 * paastande som loefte-vagten, konkurrent-vagten og registre-vagten er bygget til at fange.
 * Derfor denne proeve: den taeller hvor henvisningen staar, og bliver roed hvis den spreder sig.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const bg = readFileSync(join(rod, 'extension/background.js'), 'utf8');
const srv = readFileSync(join(rod, 'mcp-server/index.js'), 'utf8');

test('udvidelsen henviser til et skrivebords-vaerktoej praecis to steder - begge om filvaelgeren', () => {
  const traef = [...bg.matchAll(/computer-mcp/g)];
  assert.equal(traef.length, 2,
    `henvisningen staar ${traef.length} steder. Den maa kun staa hvor vaeggen ligger uden for ` +
    'browseren - ellers er den usand paa en baggrundsfane, et React-felt eller en CAPTCHA');
  for (const m of traef) {
    const omkring = bg.slice(Math.max(0, m.index - 900), m.index);
    assert.match(omkring, /picker-did-not-open|file-chooser-without-node/,
      'en henvisning staar et sted der ikke handler om filvaelgeren');
  }
});

test('henvisningen er betinget - den paastaar ikke at brugeren HAR vaerktoejet', () => {
  for (const m of bg.matchAll(/computer-mcp/g)) {
    const linje = bg.slice(Math.max(0, m.index - 400), m.index + 200);
    assert.match(linje, /If you have desktop-level tools|if you have desktop-level tools/,
      'henvisningen er ubetinget - den sender brugeren efter noget der maaske ikke findes');
  }
});

test('svaret siger HVORFOR vi ikke kan naa det, ikke bare hvem der kan', () => {
  const i = bg.indexOf("error: 'picker-did-not-open'");
  // Teksten er sat sammen af flere strengstykker i kilden. Proeven skal laese den som
  // agenten faar den, ikke som den staar skrevet - ellers maaler den kildens linjeskift.
  const blok = bg.slice(i, i + 900).replace(/'\s*\+\s*'/g, '');
  assert.match(blok, /no browser extension can reach/,
    'svaret forklarer ikke at det ligger uden for browseren - saa laeses det som en reklame');
  assert.match(blok, /this one included/,
    'vi undtager os selv fra begraensningen - det er praecis den slags halve sandhed vagterne findes for');
});

test('serverens instruktion afgraenser sig selv paa samme maade', () => {
  const i = srv.indexOf('not in a web page at all');
  assert.ok(i > -1, 'instruktionens linje mangler');
  const linje = srv.slice(i, srv.indexOf('\n', i));
  assert.match(linje, /background tab|React|CAPTCHA/,
    'instruktionen siger ikke hvad henvisningen IKKE gaelder');
});
