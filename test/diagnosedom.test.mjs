// Flow-spaerrens krav til selv-diagnosen (test/flow/diagnosedom.mjs), proevet uden Chrome. Backlog 1.30.2 #12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseFejl } from './flow/diagnosedom.mjs';

const svar = ({ verdict, ext, srv, fix = [] }) => ({
  verdict, fix_steps: fix,
  environment: { mcp_server_version: srv, extensions_connected: [{ active: true, version: ext }] },
});
const BUTIKSRAAD = ['If it came from the Chrome Web Store: the new version is probably in review (1-3 days after a release).'];

test('kandidaten: samme version og dommen unknown → ingen fejl', () => {
  assert.deepEqual(diagnoseFejl(svar({ verdict: 'unknown', ext: '1.30.1', srv: '1.30.1' })).fejl, []);
});

test('kandidaten maa ALDRIG lempes: aeldre udvidelse uden BMCP_UDVIDELSE_KILDE er stadig roed', () => {
  const r = diagnoseFejl(svar({ verdict: 'outdated', ext: '1.30.0', srv: '1.30.1', fix: BUTIKSRAAD }));
  assert.equal(r.vindue, false);
  assert.ok(r.fejl.length >= 2, JSON.stringify(r));
});

test('udgivelsesvinduet: butik 1.30.0 + server 1.30.1, dommen outdated med butiksraad → ingen fejl', () => {
  const r = diagnoseFejl(svar({ verdict: 'outdated', ext: '1.30.0', srv: '1.30.1', fix: BUTIKSRAAD }), { publiceretUdvidelse: true });
  assert.equal(r.vindue, true);
  assert.deepEqual(r.fejl, []);
});

test('udgivelsesvinduet: en rask dom er FORKERT (serveren saa ikke den gamle udvidelse)', () => {
  const r = diagnoseFejl(svar({ verdict: 'current', ext: '1.30.0', srv: '1.30.1', fix: BUTIKSRAAD }), { publiceretUdvidelse: true });
  assert.match(r.fejl.join(' '), /skal vaere 'outdated'/);
});

test('udgivelsesvinduet: outdated uden butiksraadet er roed', () => {
  const r = diagnoseFejl(svar({ verdict: 'outdated', ext: '1.30.0', srv: '1.30.1', fix: ['reload the extension'] }), { publiceretUdvidelse: true });
  assert.match(r.fejl.join(' '), /butikkens gennemgang/);
});

test('det udgivne med en NYERE udvidelse end serveren er ikke vinduet - samme strenge krav', () => {
  const r = diagnoseFejl(svar({ verdict: 'unknown', ext: '1.31.0', srv: '1.30.1' }), { publiceretUdvidelse: true });
  assert.equal(r.vindue, false);
  assert.match(r.fejl.join(' '), /indlaes kandidaten/);
});

test('to forbundne udvidelser er roedt i begge tilstande', () => {
  const d = svar({ verdict: 'outdated', ext: '1.30.0', srv: '1.30.1', fix: BUTIKSRAAD });
  d.environment.extensions_connected.push({ active: false, version: '1.29.0' });
  for (const publiceretUdvidelse of [false, true]) {
    assert.match(diagnoseFejl(d, { publiceretUdvidelse }).fejl.join(' '), /2 Browser MCP-udvidelser/);
  }
});

test('flow-spaerren bruger reglen, og kun det udgivne (BMCP_UDVIDELSE_KILDE) kan lempe den', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./flow/run.mjs', import.meta.url), 'utf8');
  assert.match(src, /diagnoseFejl\(r\.data, \{ publiceretUdvidelse: Boolean\(process\.env\.BMCP_UDVIDELSE_KILDE\) \}\)/,
    'run.mjs kalder ikke reglen - eller lemper paa noget andet end det udgivne');
  assert.doesNotMatch(src, /\['current', 'unknown'\]\.includes\(r\.data\?\.verdict\)/,
    'den gamle, stive dom staar der stadig ved siden af reglen');
});
