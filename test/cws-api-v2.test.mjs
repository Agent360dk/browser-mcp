/**
 * ⛔ MAALT 24/9: publish-cws.sh brugte butikkens API v1.1. Google afloeste den med v2 i oktober
 * 2025 og arkiverede dokumentationen for v1. v2 kraever udgiver-id'et i adressen - og kalder en
 * vellykket upload «SUCCEEDED», ikke «SUCCESS». En blind adresse-udskiftning ville have meldt
 * hver vellykket upload som fejlet.
 *
 * Proeverne her koerer scriptets EGEN svar-laeser og versions-vagt mod svar formet efter Googles
 * maskinlaesbare beskrivelse ($discovery/rest?version=v2). De sender intet til butikken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const kilde = readFileSync(join(rod, 'scripts', 'publish-cws.sh'), 'utf8');

test('scriptet taler med API v2, ikke v1.1', () => {
  const kode = kilde.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.doesNotMatch(kode, /chromewebstore\/v1\.1/, 'et kald til v1.1 staar stadig i scriptet');
  assert.match(kode, /upload\/v2\/\$\{ITEM\}:upload/, 'uploaden bruger ikke v2');
  assert.match(kode, /v2\/\$\{ITEM\}:publish/, 'udgivelsen bruger ikke v2');
  assert.match(kode, /CWS_PUBLISHER_ID/, 'v2 kraever udgiver-id, og scriptet kender det ikke');
});

/** Koerer scriptets egen svar-laeser, ikke en kopi af den. */
function felt(json, sti) {
  const linje = kilde.split('\n').find((l) => l.startsWith('felt()'));
  assert.ok(linje, 'svar-laeseren felt() blev ikke fundet');
  return execFileSync('bash', ['-c', `${linje}\nprintf '%s' "$1" | felt ${sti}`, '_', json], { encoding: 'utf8' }).trim();
}

test('en vellykket upload hedder SUCCEEDED i v2 - v1-ordet SUCCESS godkendes ikke', () => {
  assert.equal(felt('{"uploadState":"SUCCEEDED"}', 'uploadState'), 'SUCCEEDED');
  assert.match(kilde, /"\$UPLOAD_STATE" != "SUCCEEDED"/, 'scriptet tjekker ikke efter v2-ordet');
  assert.doesNotMatch(kilde, /"\$UPLOAD_STATE" != "SUCCESS"/,
    'scriptet tjekker stadig efter v1-ordet - saa meldes hver vellykket upload som fejlet');
});

test('et tomt svar eller en HTML-fejlside giver en tom vaerdi, ikke et nedbrud', () => {
  assert.equal(felt('', 'uploadState'), '');
  assert.equal(felt('<html>404</html>', 'uploadState'), '');
});

test('versions-vagten afviser en pakke med en anden version end manifestet', () => {
  assert.match(kilde, /\[\[ -n "\$FIK" && "\$FIK" != "\$VERSION" \]\]/,
    'uden vagten kan den forkerte zip uploades uden at nogen opdager det foer brugerne faar den');
});

test('--trusted stopper hoejlydt i stedet for at udgive til alle', () => {
  const r = (() => { try { execFileSync('bash', [join(rod, 'scripts', 'publish-cws.sh'), '--trusted'], { encoding: 'utf8', stdio: 'pipe', env: { PATH: process.env.PATH } }); return 0; } catch (e) { return e.status; } })();
  assert.equal(r, 1, 'v2 har intet trusted-testers-maal; stille at udgive til alle ville vaere vaerre end at stoppe');
});
