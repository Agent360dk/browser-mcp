#!/usr/bin/env node

/**
 * Browser MCP CLI — install extension + configure Claude Code
 *
 * Usage:
 *   npx @agent360/browser-mcp install   — copy extension + setup mcp.json
 *   npx @agent360/browser-mcp           — start MCP server (Claude Code calls this)
 */

import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = dirname(__dirname); // mcp-server/
const command = process.argv[2];

if (command === 'install') {
  install();
} else if (!command) {
  // No subcommand = start MCP server (Claude Code calls this)
  // Auto-update extension files if installed via npx
  autoUpdateExtension();
  await import('../index.js');
} else {
  console.log(`
Browser MCP by Agent360 — control your real Chrome from Claude Code

Usage:
  npx @agent360/browser-mcp install   Install extension + configure Claude Code
  npx @agent360/browser-mcp           Start MCP server (called by Claude Code)

Docs: https://github.com/Agent360dk/browser-mcp
`);
}

function install() {
  const home = homedir();
  const extensionDir = join(home, '.browser-mcp', 'extension');
  const sourceExtension = join(pkgRoot, 'extension');

  // 1. Copy extension files
  console.log('\n🔧 Browser MCP by Agent360\n');

  if (!existsSync(sourceExtension)) {
    console.error('❌ Extension files not found in package. Please report this issue.');
    process.exit(1);
  }

  mkdirSync(extensionDir, { recursive: true });
  cpSync(sourceExtension, extensionDir, { recursive: true });
  console.log(`✅ Extension installed to ${extensionDir}`);

  // 2. Configure Claude Code mcp.json
  const claudeDir = join(home, '.claude');
  const mcpJsonPath = join(claudeDir, 'mcp.json');
  let mcpConfig = {};

  if (existsSync(mcpJsonPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
    } catch {}
  }

  if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};

  mcpConfig.mcpServers['browser-mcp'] = {
    command: 'npx',
    args: ['@agent360/browser-mcp@latest'],
  };

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  console.log(`✅ Claude Code configured (${mcpJsonPath})`);

  // 3. Print next steps
  console.log(`
📋 First-time setup (one time only):
  1. Open Chrome
  2. Go to chrome://extensions (type it in the address bar)
  3. Enable "Developer mode" (toggle in top right corner)
  4. Click "Load unpacked" button (top left)
  5. Navigate to and select this folder:
     ${extensionDir}
  6. The extension "Agent360 Browser MCP" appears with a puzzle icon
  7. Restart Claude Code — 28 browser tools are now available!

🔄 Auto-updates (fully automatic):
   - MCP server: always fetches latest from npm (npx @latest)
   - Extension files: auto-copied when npm version is newer
   - Extension reload: auto-triggered via WebSocket
   - You don't need to do anything — updates happen on every Claude Code session start

📖 Docs: https://browsermcp.dev
`);
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

    if (installed.version !== source.version) {
      cpSync(sourceExtension, extensionDir, { recursive: true });
      process.stderr.write(`[MCP] Extension auto-updated: ${installed.version} → ${source.version}\n`);
      process.stderr.write('[MCP] Extension will auto-reload when connected\n');
      // Signal to index.js that extension needs reload
      process.env.BROWSER_MCP_EXTENSION_UPDATED = '1';
    }
  } catch {}
}
