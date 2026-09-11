/**
 * `npx @agent360/browser-mcp install` skal registrere serveren hos de klienter brugeren faktisk har.
 *
 * Plan 8.2 (Fable, 11/9): installationen registrerede kun hos Claude Code; Codex, Cursor og VS Code var manuelle skridt,
 * selvom de er tre af de fire klienter guiderne naevner. Samtidig er foerste lektie fra juli stadig gaeldende: at skrive en
 * konfigurationsfil en klient ikke laeser, er en installation der siger succes og intet goer. Derfor:
 *   · Codex og VS Code registreres med deres EGNE kommandoer (codex mcp add, code --add-mcp).
 *   · Cursor har ingen kommando; dens globale fil ~/.cursor/mcp.json flettes, og eksisterende servere bevares.
 *   · En klient der ikke findes, roeres ikke, og der skrives ikke "registreret" om den.
 *
 * Testen koerer den rigtige bin/cli.js med et midlertidigt hjem og falske klient-kommandoer paa PATH, saa maskinens
 * rigtige Claude Code, Codex og VS Code aldrig roeres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const rod = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(rod, 'mcp-server/bin/cli.js');

function installer({ klienter = [], codeKanAddMcp = true, cursor = false, cursorIndhold } = {}) {
  const hjem = mkdtempSync(join(tmpdir(), 'cli-hjem-'));
  const bin = mkdtempSync(join(tmpdir(), 'cli-bin-'));
  const log = join(hjem, 'kald.log');
  for (const k of klienter) {
    const hjaelp = k === 'code' && codeKanAddMcp ? 'echo "  --add-mcp <json>  Adds a Model Context Protocol server definition"' : 'true';
    writeFileSync(join(bin, k), `#!/bin/sh\nif [ "$1" = "--help" ]; then ${hjaelp}; exit 0; fi\nprintf '%s\\n' "${k} $*" >> "${log}"\nexit 0\n`);
    chmodSync(join(bin, k), 0o755);
  }
  if (cursor) {
    mkdirSync(join(hjem, '.cursor'));
    if (cursorIndhold !== undefined) writeFileSync(join(hjem, '.cursor', 'mcp.json'), cursorIndhold);
  }
  const r = spawnSync(process.execPath, [cli, 'install', '--skip-extension'], {
    encoding: 'utf8', timeout: 30000,
    env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: hjem, USERPROFILE: hjem },
  });
  const kald = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const cursorFil = join(hjem, '.cursor', 'mcp.json');
  const cursorEfter = existsSync(cursorFil) ? readFileSync(cursorFil, 'utf8') : null;
  rmSync(bin, { recursive: true, force: true });
  rmSync(hjem, { recursive: true, force: true });
  return { status: r.status, ud: r.stdout + r.stderr, kald, cursorEfter };
}

test('install registrerer hos Codex med codex mcp add, naar codex findes', () => {
  const { status, ud, kald } = installer({ klienter: ['codex'] });
  assert.equal(status, 0, ud);
  assert.match(kald, /^codex mcp add browser-mcp -- npx @agent360\/browser-mcp@latest$/m, `codex blev ikke kaldt rigtigt: ${kald}`);
  assert.match(ud, /Codex/);
});

test('install registrerer hos VS Code med code --add-mcp, naar code kan det', () => {
  const { kald } = installer({ klienter: ['code'] });
  const linje = kald.split('\n').find((l) => l.startsWith('code --add-mcp '));
  assert.ok(linje, `code --add-mcp blev ikke kaldt: ${kald}`);
  const def = JSON.parse(linje.slice('code --add-mcp '.length));
  assert.deepEqual(def, { name: 'browser-mcp', command: 'npx', args: ['@agent360/browser-mcp@latest'] });
});

test('en VS Code uden --add-mcp faar ikke et flag den ikke kender', () => {
  const { kald } = installer({ klienter: ['code'], codeKanAddMcp: false });
  assert.doesNotMatch(kald, /--add-mcp/);
});

test('install fletter serveren ind i Cursors globale fil og bevarer de servere der stod der', () => {
  const { cursorEfter, ud } = installer({ cursor: true, cursorIndhold: JSON.stringify({ mcpServers: { anden: { command: 'x' } } }) });
  assert.ok(cursorEfter, 'Cursor-filen blev ikke skrevet');
  const d = JSON.parse(cursorEfter);
  assert.deepEqual(d.mcpServers.anden, { command: 'x' }, 'en eksisterende server blev fjernet');
  assert.deepEqual(d.mcpServers['browser-mcp'], { command: 'npx', args: ['@agent360/browser-mcp@latest'] });
  assert.match(ud, /Cursor/);
});

test('findes Cursor-mappen men ingen fil, oprettes filen', () => {
  const { cursorEfter } = installer({ cursor: true });
  assert.deepEqual(JSON.parse(cursorEfter || '{}').mcpServers?.['browser-mcp'], { command: 'npx', args: ['@agent360/browser-mcp@latest'] });
});

test('en Cursor-fil der ikke kan laeses, overskrives ikke', () => {
  const { cursorEfter } = installer({ cursor: true, cursorIndhold: '{ ikke gyldig json' });
  assert.equal(cursorEfter, '{ ikke gyldig json', 'brugerens Cursor-konfiguration blev overskrevet');
});

test('klienter der ikke findes, roeres ikke og kaldes ikke registreret', () => {
  const { status, ud, kald, cursorEfter } = installer({});
  assert.equal(status, 0, ud);
  assert.equal(kald, '');
  assert.equal(cursorEfter, null, 'en Cursor-fil blev oprettet uden at Cursor findes');
  assert.doesNotMatch(ud, /Registered with (Codex|Cursor|VS Code)/, 'installationen paastod en registrering der ikke skete');
});
