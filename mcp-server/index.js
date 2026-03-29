#!/usr/bin/env node
/**
 * Agent360 Browser MCP Server
 *
 * Bridges Claude Code (stdio MCP) to Chrome Extension (WebSocket).
 *
 * Architecture:
 *   Claude Code ←(stdio)→ this process ←(WebSocket :9876)→ Offscreen Doc ←(sendMessage)→ Service Worker → Chrome APIs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import { execSync } from 'child_process';
import { TOOLS, PROVIDER_PAGES } from './tools.js';

const BASE_PORT = 9876;
const MAX_PORT = 9885; // 10 concurrent sessions max
let extensionSocket = null;
let activePort = null;
let cmdId = 0;
const pending = new Map(); // id → { resolve, reject, timer }

// ── WebSocket Server (for Chrome Extension's offscreen document) ───────────

function createWSS(port = BASE_PORT) {
  const server = new WebSocketServer({ host: '127.0.0.1', port });

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
    process.stderr.write(`[MCP] Chrome extension connected\n`);

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

  // Heartbeat — keep WebSocket alive
  setInterval(() => {
    if (extensionSocket && extensionSocket.readyState === 1) {
      extensionSocket.ping();
    }
  }, 20000);

  return server;
}

createWSS();

// ── Send command to extension ───────────────────────────────────────────────

function sendToExtension(method, params = {}, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!extensionSocket || extensionSocket.readyState !== 1) {
      reject(new Error('Chrome extension not connected. Open Chrome and ensure Agent360 Browser MCP extension is installed and active.'));
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

const mcpServer = new Server(
  { name: 'agent360-browser', version: '1.2.0' },
  { capabilities: { tools: {} } },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const methodMap = {
      browser_navigate: 'navigate',
      browser_get_page_content: 'get_page_content',
      browser_screenshot: 'screenshot',
      browser_execute_script: 'execute_script',
      browser_click: 'click',
      browser_fill: 'fill',
      browser_wait: 'wait',
      browser_list_tabs: 'list_tabs',
      browser_get_cookies: 'get_cookies',
      browser_get_local_storage: 'get_local_storage',
      browser_ask_user: 'ask_user',
      browser_select_frame: 'select_frame',
      browser_list_frames: 'list_frames',
      browser_get_new_tab: 'get_new_tab',
      browser_switch_tab: 'switch_tab',
    };

    // Special handler: browser_extract_token
    if (name === 'browser_extract_token') {
      return await handleExtractToken(args);
    }

    const method = methodMap[name];
    if (!method) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    // ask_user needs longer timeout (waits for human)
    const timeout = method === 'ask_user' ? (args?.timeout || 120000) + 5000 : 30000;
    const result = await sendToExtension(method, args || {}, timeout);

    // Screenshot returns base64 image (png or jpeg fallback)
    if (name === 'browser_screenshot' && result?.image) {
      const isJpeg = result.image.startsWith('data:image/jpeg');
      const prefix = isJpeg ? /^data:image\/jpeg;base64,/ : /^data:image\/png;base64,/;
      const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
      const base64 = result.image.replace(prefix, '');
      return { content: [{ type: 'image', data: base64, mimeType }] };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── browser_extract_token handler ───────────────────────────────────────────

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

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
process.stderr.write(`[MCP] Agent360 Browser MCP server running (stdio)\n`);
