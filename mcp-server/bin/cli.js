#!/usr/bin/env node

/**
 * Browser MCP CLI — put the extension on disk + register the MCP server
 *
 * Usage:
 *   npx @agent360/browser-mcp install                     — extension files + register server
 *   npx @agent360/browser-mcp install --skip-extension    — register the server only
 *   npx @agent360/browser-mcp                             — start MCP server (the client calls this)
 *
 * Registration goes through `claude mcp add`, i.e. Claude Code's own command. An earlier
 * version wrote ~/.claude/mcp.json directly — Claude Code does not read that path, so the
 * install silently did nothing while printing success.
 */

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(__dirname); // mcp-server/
const command = process.argv[2];
const skipExtension = process.argv.includes('--skip-extension');
// Serverdefinitionen alle klienter registreres med. Staar her, fordi install() koeres straks nedenfor.
const SERVER_NAVN = 'browser-mcp';
const SERVER_KOMMANDO = 'npx';
const SERVER_ARGS = ['@agent360/browser-mcp@latest'];

if (command === 'install') {
  install({ skipExtension });
} else if (!command) {
  // No subcommand = start MCP server (Claude Code calls this)
  // Auto-update extension files if installed via npx
  autoUpdateExtension();
  await import('../index.js');
} else {
  console.log(`
Browser MCP by Agent360 — control your real Chrome from Claude Code

Usage:
  npx @agent360/browser-mcp install                   Extension files + register the server
  npx @agent360/browser-mcp install --skip-extension  Register the server only
                                                      (use this if you installed the
                                                       extension from the Chrome Web Store)
  npx @agent360/browser-mcp                           Start MCP server (called by your client)

Docs: https://github.com/Agent360dk/browser-mcp
`);
}

// Register the server with Claude Code using Claude Code's own CLI. Writing a config file
// ourselves is what broke before: ~/.claude/mcp.json is not a path Claude Code reads, so the
// entry never took effect. `claude mcp add` writes wherever the installed version keeps it.
function registerWithClaudeCode() {
  try {
    execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'browser-mcp',
                            '--', 'npx', '@agent360/browser-mcp@latest'],
                 { stdio: 'pipe' });
    console.log('✅ Registered with Claude Code (claude mcp add --scope user)');
    return true;
  } catch (err) {
    const msg = String(err && (err.stderr || err.message) || '');
    if (/already exists/i.test(msg)) {
      console.log('✅ Already registered with Claude Code — nothing to do');
      return true;
    }
    // `claude` not on PATH, or a different client entirely. Do not pretend it worked.
    console.log('⚠️  Could not register automatically (the `claude` command was not found).');
    console.log('   Register the server yourself — Claude Code:');
    console.log('     claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest');
    console.log('   Codex:');
    console.log('     codex mcp add browser-mcp -- npx @agent360/browser-mcp@latest');
    console.log('   Cursor / VS Code / other — add to that client\'s MCP config:');
    console.log('     {"mcpServers": {"browser-mcp": {"command": "npx", "args": ["@agent360/browser-mcp@latest"]}}}');
    console.log('   Guides: https://browsermcp.dev/docs/install-claude-code/');
    return false;
  }
}

// Plan 8.2 (11/9): Codex, VS Code og Cursor registreres ogsaa. Samme lektie som ovenfor: klientens EGEN kommando hvor den
// findes, og kun klienter der faktisk er installeret. En klient der ikke findes, roeres ikke og kaldes ikke registreret.
// (SERVER_NAVN, SERVER_KOMMANDO og SERVER_ARGS staar oeverst: install() koeres foer filens nederste linjer er naaet.)

function registerWithCodex() {
  try {
    execFileSync('codex', ['mcp', 'add', SERVER_NAVN, '--', SERVER_KOMMANDO, ...SERVER_ARGS], { stdio: 'pipe' });
    console.log('✅ Registered with Codex (codex mcp add)');
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;   // Codex er ikke installeret
    const msg = String(err && (err.stderr || err.message) || '');
    if (/already exists/i.test(msg)) {
      console.log('✅ Already registered with Codex — nothing to do');
      return true;
    }
    console.log('⚠️  Codex is installed, but registration failed. Run: codex mcp add browser-mcp -- npx @agent360/browser-mcp@latest');
    return false;
  }
}

function registerWithVSCode() {
  let hjaelp;
  try {
    hjaelp = String(execFileSync('code', ['--help'], { stdio: 'pipe' }));
  } catch {
    return null;   // VS Code's `code` er ikke paa PATH
  }
  // Kun versioner der kender flaget, faar det - en aeldre `code` ville aabne et vindue med JSON'en som filnavn.
  if (!/--add-mcp/.test(hjaelp)) {
    console.log('⚠️  VS Code found, but this version cannot add MCP servers from the command line. Use "Add to VS Code" in the README.');
    return false;
  }
  try {
    execFileSync('code', ['--add-mcp', JSON.stringify({ name: SERVER_NAVN, command: SERVER_KOMMANDO, args: SERVER_ARGS })], { stdio: 'pipe' });
    console.log('✅ Registered with VS Code (code --add-mcp)');
    return true;
  } catch {
    console.log('⚠️  VS Code registration failed. Use "Add to VS Code" in the README.');
    return false;
  }
}

// Cursor har ingen kommando. Dens globale fil er ~/.cursor/mcp.json; den flettes, og alt andet i den bevares.
function registerWithCursor() {
  const mappe = join(homedir(), '.cursor');
  if (!existsSync(mappe)) return null;   // Cursor er ikke installeret
  const fil = join(mappe, 'mcp.json');
  const roerIkke = () => {
    console.log(`⚠️  Cursor found, but ${fil} could not be read, so it was left untouched. Add browser-mcp there yourself.`);
    return false;
  };
  let cfg = {};
  if (existsSync(fil)) {
    try { cfg = JSON.parse(readFileSync(fil, 'utf8')); } catch { return roerIkke(); }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return roerIkke();
    if (cfg.mcpServers !== undefined && (!cfg.mcpServers || typeof cfg.mcpServers !== 'object' || Array.isArray(cfg.mcpServers))) return roerIkke();
  }
  cfg.mcpServers = cfg.mcpServers || {};
  if (cfg.mcpServers[SERVER_NAVN]) {
    console.log('✅ Already registered with Cursor — nothing to do');
    return true;
  }
  cfg.mcpServers[SERVER_NAVN] = { command: SERVER_KOMMANDO, args: SERVER_ARGS };
  writeFileSync(fil, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`✅ Registered with Cursor (${fil})`);
  return true;
}

function install({ skipExtension = false } = {}) {
  const home = homedir();
  const extensionDir = join(home, '.browser-mcp', 'extension');
  const sourceExtension = join(pkgRoot, 'extension');

  console.log('\n🔧 Browser MCP by Agent360\n');
  console.log('Browser MCP is two halves and needs both: a Chrome extension, and this MCP');
  console.log('server registered with your AI client.\n');

  // 1. Extension files (skipped when the user already has it from the Chrome Web Store)
  if (skipExtension) {
    console.log('⏭  Skipping extension files (--skip-extension)');
  } else {
    if (!existsSync(sourceExtension)) {
      console.error('❌ Extension files not found in package. Please report this issue.');
      process.exit(1);
    }
    mkdirSync(extensionDir, { recursive: true });
    cpSync(sourceExtension, extensionDir, { recursive: true });
    console.log(`✅ Extension files copied to ${extensionDir}`);
  }

  // 2. Register the server with every client that is installed
  registerWithClaudeCode();
  registerWithCodex();
  registerWithVSCode();
  registerWithCursor();

  // 3. Print next steps — only the ones that still apply
  if (skipExtension) {
    console.log(`
📋 Last step:
  1. Make sure the Agent360 Browser MCP extension is enabled at chrome://extensions
  2. Restart your AI client so it picks up the server
  3. Click the extension icon — it should turn green`);
  } else {
    console.log(`
📋 Load the extension in Chrome (one time only):
  1. Open Chrome
  2. Go to chrome://extensions (type it in the address bar)
  3. Enable "Developer mode" (toggle in top right corner)
  4. Click "Load unpacked" button (top left)
  5. Navigate to and select this folder:
     ${extensionDir}
  6. The extension "Agent360 Browser MCP" appears with a puzzle icon
  7. Restart your AI client — the browser tools are now available

  Prefer a one-click, auto-updating extension instead of loading unpacked?
  https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl
  (then re-run this command with --skip-extension)`);
  }

  console.log(`
🔄 Auto-updates (fully automatic):
   - MCP server: always fetches latest from npm (npx @latest)
   - Extension files: auto-copied when npm version is newer
   - Extension reload: auto-triggered via WebSocket
   - You don't need to do anything — updates happen on every session start

💡 Help shape Browser MCP:
   - Public wishlist:  https://github.com/Agent360dk/browser-mcp/blob/main/WISHLIST.md
   - Use-case gallery: https://github.com/Agent360dk/browser-mcp/blob/main/USE_CASES.md
   - Got an idea, bug, or cool thing you built? Just ask Claude — it can draft + submit for you.

📖 Docs: https://browsermcp.dev
`);
}

// Tal, ikke tekst: en ren tekstsammenligning ville sige at 1.9.0 er nyere end 1.10.0.
function cmpSemver(a, b) {
  const pa = String(a || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function autoUpdateExtension() {
  const home = homedir();
  const extensionDir = join(home, '.browser-mcp', 'extension');
  const sourceExtension = join(pkgRoot, 'extension');

  if (!existsSync(extensionDir) || !existsSync(sourceExtension)) return;

  try {
    // Compare manifest versions
    const installedManifest = join(extensionDir, 'manifest.json');
    const sourceManifest = join(sourceExtension, 'manifest.json');
    if (!existsSync(installedManifest)) return;

    const installed = JSON.parse(readFileSync(installedManifest, 'utf8'));
    const source = JSON.parse(readFileSync(sourceManifest, 'utf8'));

    // MAALT 21/8: her stod `if (installed.version !== source.version)`. Den kopierede
    // naar versionerne var FORSKELLIGE — ikke naar pakkens var NYERE. En installation
    // paa 1.27.1 blev derfor overskrevet af npm-pakkens 1.25.0, og linjen nedenfor
    // meldte det som "auto-updated: 1.27.1 → 1.25.0". Det skete ved hver eneste
    // serveropstart, saa en lokal nyere udgave kunne ikke blive liggende. Det er
    // ogsaa forklaringen paa at ~/.browser-mcp/extension stod paa juli-kode i ugevis.
    if (cmpSemver(source.version, installed.version) > 0) {
      cpSync(sourceExtension, extensionDir, { recursive: true });
      process.stderr.write(`[MCP] Extension auto-updated: ${installed.version} → ${source.version}\n`);
      process.stderr.write('[MCP] Extension will auto-reload when connected\n');
      // Signal to index.js that extension needs reload
      process.env.BROWSER_MCP_EXTENSION_UPDATED = '1';
    } else if (installed.version !== source.version) {
      // Den lokale er nyere end pakkens — typisk under udvikling. Sig det, men roer den ikke.
      process.stderr.write(`[MCP] Extension paa disken (${installed.version}) er nyere end pakkens (${source.version}) — lader den vaere\n`);
    }
  } catch {}
}
