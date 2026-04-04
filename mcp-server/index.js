#!/usr/bin/env node
/**
 * Agent360 Browser MCP Server
 *
 * Bridges Claude Code (stdio MCP) to Chrome Extension (WebSocket).
 * Auto-selects first available port in range 9876-9885 for multi-session support.
 *
 * Architecture:
 *   Claude Code ←(stdio)→ this process ←(WS :port)→ Offscreen Doc ←(sendMessage)→ Service Worker → Chrome APIs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import { execSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { TOOLS, PROVIDER_PAGES } from './tools.js';

// ── Auto-update on startup ─────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = dirname(__dirname); // parent of mcp-server/

let extensionUpdated = false;
try {
  const before = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
  execSync('git pull --ff-only 2>/dev/null', { cwd: repoDir, timeout: 10000 });
  const after = execSync('git rev-parse HEAD', { cwd: repoDir }).toString().trim();
  if (before !== after) {
    extensionUpdated = true;
    process.stderr.write(`[MCP] Updated to ${after.slice(0, 8)} — extension reload recommended\n`);
    // Check if npm deps changed
    try {
      const diff = execSync(`git diff ${before} ${after} -- mcp-server/package.json`, { cwd: repoDir }).toString();
      if (diff) {
        execSync('npm install --silent', { cwd: `${repoDir}/mcp-server`, timeout: 30000 });
        process.stderr.write('[MCP] Dependencies updated\n');
      }
    } catch {}
  } else {
    process.stderr.write('[MCP] Already up to date\n');
  }
} catch (e) {
  process.stderr.write(`[MCP] Auto-update skipped: ${e.message?.split('\n')[0]}\n`);
}

const BASE_PORT = 9876;
const MAX_PORT = 9885;
let extensionSocket = null;
let activePort = null;
let wss = null; // Track WSS for graceful shutdown
let cmdId = 0;
let lastActivity = Date.now();
const pending = new Map();

// ── WebSocket Server ───────────────────────────────────────────────────────

function createWSS(port = BASE_PORT) {
  const server = new WebSocketServer({ host: '127.0.0.1', port });
  wss = server;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (port < MAX_PORT) {
        process.stderr.write(`[MCP] Port ${port} in use, trying ${port + 1}...\n`);
        createWSS(port + 1);
      } else {
        process.stderr.write(`[MCP] All ports ${BASE_PORT}-${MAX_PORT} in use. Cannot start.\n`);
      }
    } else {
      process.stderr.write(`[MCP] WebSocket error: ${err.message}\n`);
    }
  });

  server.on('connection', (ws) => {
    extensionSocket = ws;
    process.stderr.write(`[MCP] Chrome extension connected on port ${port}\n`);

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      const { id, result, error } = msg;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    });

    ws.on('close', () => {
      if (extensionSocket === ws) {
        extensionSocket = null;
        process.stderr.write(`[MCP] Chrome extension disconnected\n`);
      }
    });
  });

  server.on('listening', () => {
    activePort = port;
    process.stderr.write(`[MCP] WebSocket server listening on ws://127.0.0.1:${port}\n`);
  });

  // Heartbeat + idle timeout (4 hours)
  setInterval(() => {
    if (extensionSocket && extensionSocket.readyState === 1) {
      extensionSocket.ping();
    }
    if (Date.now() - lastActivity > 4 * 60 * 60 * 1000) {
      process.stderr.write('[MCP] Idle timeout (4h) — shutting down\n');
      process.exit(0);
    }
  }, 20000);
}

createWSS();

// ── Send command to extension ───────────────────────────────────────────────

function sendToExtension(method, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== 1) {
      reject(new Error('Chrome extension not connected. Open Chrome and ensure Agent360 Browser MCP extension is installed.'));
      return;
    }
    const id = ++cmdId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    extensionSocket.send(JSON.stringify({ id, method, params }));
  });
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const INSTRUCTIONS = `You control the user's real Chrome browser via this MCP server. Each session gets its own color-coded Chrome Tab Group.

## Key behaviors
- **Always use browser_ask_user** when you need credentials, 2FA codes, CAPTCHA help, or any user input. Never guess passwords or tokens.
- **ALWAYS close tabs when done** with browser_close_tab after completing each task. Don't leave tabs open — close them immediately after extracting the data you need. Use browser_list_tabs to find and close all session tabs when a task is complete.
- **Check existing tabs first** with browser_list_tabs before navigating — reuse tabs instead of opening duplicates.
- **One task per tab** — navigate to a URL, do your work, then close or move on.
- **Tell the user what you're doing** in the browser. "I'm navigating to Stripe to find the API key" not just silently calling tools.

## Tab management
- navigate creates tabs in your session's tab group (visible in Chrome as colored groups)
- list_tabs only shows YOUR session's tabs — other Claude sessions have their own
- switch_tab lets you jump between your tabs
- close_tab cleans up when you're done

## Authentication flows
1. Navigate to login page
2. Use browser_ask_user with fields for email/password
3. Fill credentials with browser_fill
4. Click submit with browser_click
5. If 2FA required, use browser_ask_user again: "Please enter the 2FA code shown in your authenticator app"
6. After success, extract what you need with browser_get_page_content

## Screenshots
- browser_screenshot captures the visible tab — useful for visual verification
- The tab is auto-activated before capture, so it always shows the right page

## Text-based selectors (preferred for dynamic sites)
- browser_click("text=Get started") — clicks any element containing "Get started"
- browser_click("button:text(Submit)") — clicks a button containing "Submit"
- browser_fill("text=Email", "user@example.com") — fills input near "Email" label
- browser_wait("text=Success") — waits for text to appear
- These work on ALL sites including Google Cloud, Stripe, Slack (CSP-strict)

## Keyboard
- browser_press_key("Enter") — submit forms
- browser_press_key("Tab") — navigate between fields
- browser_press_key("Escape") — close dialogs
- browser_press_key("ArrowDown") — navigate dropdowns
- browser_press_key("a", ctrl=true) — select all

## CAPTCHA handling
Use browser_solve_captcha to detect and solve CAPTCHAs automatically:
1. Call browser_solve_captcha() — detects CAPTCHA type on page
2. If reCAPTCHA v2 checkbox found → call browser_solve_captcha(action="click_checkbox") — auto-clicks, passes ~80% with logged-in Google
3. If image challenge appears → call browser_screenshot, analyze the grid visually, then call browser_solve_captcha(action="click_grid", cells=[2,5,7]) with the correct cell indices
4. If all else fails → call browser_solve_captcha(action="ask_human") to show overlay to user
5. After solving, retry the action that was blocked

For image grid challenges: cells are 0-indexed, left-to-right, top-to-bottom. A 3x3 grid has cells 0-8. A 4x4 grid has cells 0-15.

## OAuth popups
- OAuth popups (Google, Microsoft, GitHub, Slack, HubSpot) are automatically intercepted and added to your session's tab group
- Use browser_get_new_tab to access them, or they'll become your active tab automatically

## Shadow DOM (Shopify, Salesforce, etc.)
- CSS selectors automatically search inside shadow DOM
- If a standard selector fails, the extension recursively searches shadow roots
- Text-based selectors ("text=Submit") also traverse shadow DOM

## When things fail
- Element not found → try text-based selector instead of CSS
- Screenshot fails → debugger fallback is automatic
- Click doesn't work on SPA → debugger mouse events are used automatically
- CAPTCHA blocks page → use browser_ask_user, let human solve it

## Extension updates
The MCP server auto-pulls the latest code from git on every new session startup.
If the extension files were updated, ask the user to reload it:
"The Browser MCP extension was updated. Please go to chrome://extensions, find 'Agent360 Browser MCP', and click the reload icon (🔄) to apply the update."
You cannot navigate to chrome:// pages — the user must do this manually.`;

const mcpServer = new Server(
  { name: 'agent360-browser', version: '1.15.0' },
  { capabilities: { tools: {} } },
  { instructions: INSTRUCTIONS },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  lastActivity = Date.now();

  try {
    const methodMap = {
      browser_navigate: 'navigate',
      browser_get_page_content: 'get_page_content',
      browser_screenshot: 'screenshot',
      browser_execute_script: 'execute_script',
      browser_click: 'click',
      browser_fill: 'fill',
      browser_wait: 'wait',
      browser_press_key: 'press_key',
      browser_scroll: 'scroll',
      browser_hover: 'hover',
      browser_fetch: 'fetch',
      browser_select_option: 'select_option',
      browser_handle_dialog: 'handle_dialog',
      browser_wait_for_network: 'wait_for_network',
      browser_list_tabs: 'list_tabs',
      browser_get_cookies: 'get_cookies',
      browser_get_local_storage: 'get_local_storage',
      browser_ask_user: 'ask_user',
      browser_select_frame: 'select_frame',
      browser_list_frames: 'list_frames',
      browser_get_new_tab: 'get_new_tab',
      browser_switch_tab: 'switch_tab',
      browser_close_tab: 'close_tab',
      browser_set_cookies: 'set_cookies',
      browser_set_local_storage: 'set_local_storage',
      browser_console_logs: 'console_logs',
      browser_solve_captcha: 'solve_captcha',
    };

    if (name === 'browser_extract_token') {
      return await handleExtractToken(args);
    }

    const method = methodMap[name];
    if (!method) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    const timeout = method === 'ask_user' ? (args?.timeout || 120000) + 5000 :
                    method === 'solve_captcha' ? 60000 : 30000;
    const result = await sendToExtension(method, args || {}, timeout);

    if (name === 'browser_screenshot' && result?.image) {
      const isJpeg = result.image.startsWith('data:image/jpeg');
      const prefix = isJpeg ? /^data:image\/jpeg;base64,/ : /^data:image\/png;base64,/;
      const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
      const base64 = result.image.replace(prefix, '');
      return { content: [{ type: 'image', data: base64, mimeType }] };
    }

    const response = {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };

    // Notify on first call if extension was updated
    if (extensionUpdated) {
      extensionUpdated = false;
      response.content.push({
        type: 'text',
        text: '\n⚠️ Extension was updated on startup. Ask the user to reload the extension in chrome://extensions (click 🔄 on Agent360 Browser MCP).',
      });
    }

    return response;
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

async function handleExtractToken(args) {
  const { provider, store_in_vault } = args;
  const info = PROVIDER_PAGES[provider];

  if (!info) {
    return {
      content: [{
        type: 'text',
        text: `Unknown provider: ${provider}. Known: ${Object.keys(PROVIDER_PAGES).join(', ')}\n\nYou can still use browser_navigate + browser_get_page_content to extract tokens from any provider manually.`,
      }],
    };
  }

  const nav = await sendToExtension('navigate', { url: info.url });
  const content = [
    { type: 'text', text: `Navigated to ${info.url} (${nav.title})\n\nInstructions: ${info.instructions}\n\nUse browser_get_page_content or browser_screenshot to find the token, then use browser_execute_script to extract it.` },
  ];

  if (store_in_vault) {
    content.push({
      type: 'text',
      text: `\nWhen you have the token, POST it to the vault:\ncurl -X POST http://localhost:8000/v1/vault/connect -H "Authorization: Bearer {jwt}" -d '{"provider":"${provider}","token":"{extracted_token}"}'`,
    });
  }

  return { content };
}

// ── Start ───────────────────────────────────────────────────────────────────

// Clean shutdown — release port so next session can use it
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('exit', () => {
  if (wss) try { wss.close(); } catch {}
  if (extensionSocket) try { extensionSocket.close(); } catch {}
});

// Detect Claude Code exit (stdin closes when conversation ends)
process.stdin.on('end', () => {
  process.stderr.write('[MCP] stdin closed — shutting down\n');
  process.exit(0);
});

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
process.stderr.write(`[MCP] Agent360 Browser MCP server running (stdio)\n`);
