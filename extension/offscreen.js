/**
 * Offscreen Document — Persistent WebSocket bridge (multi-session)
 *
 * Scans port range 9876-9885 and maintains connections to ALL active
 * MCP servers. Each Claude Code session gets its own port automatically.
 * Passes port ID with every command so background.js can track tab ownership.
 *
 * Flow: MCP Server(s) ←(WS)→ this ←(chrome.runtime.sendMessage)→ Service Worker → Chrome APIs
 */

const BASE_PORT = 9876;
const MAX_PORT = 9895;
const connections = new Map(); // port → WebSocket

function scanPorts() {
  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    const existing = connections.get(port);
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      continue;
    }
    tryConnect(port);
  }
}

function tryConnect(port) {
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
  } catch {
    return;
  }

  const connectTimeout = setTimeout(() => {
    if (ws.readyState !== WebSocket.OPEN) ws.close();
  }, 2000);

  ws.onopen = () => {
    clearTimeout(connectTimeout);
    connections.set(port, ws);
    console.log(`[Offscreen] Connected to MCP server on port ${port} (${connections.size} total)`);
    updateStatus();
  };

  ws.onmessage = async (event) => {
    let cmd;
    try { cmd = JSON.parse(event.data); } catch { return; }
    const { id, method, params } = cmd;

    try {
      // Include port so background.js knows which session owns this command
      const result = await chrome.runtime.sendMessage({
        type: 'mcp_command',
        port,
        method,
        params: params || {},
      });

      if (result && result.__error) {
        ws.send(JSON.stringify({ id, error: result.__error }));
      } else {
        ws.send(JSON.stringify({ id, result }));
      }
    } catch (err) {
      ws.send(JSON.stringify({ id, error: err.message || String(err) }));
    }
  };

  ws.onclose = () => {
    clearTimeout(connectTimeout);
    if (connections.get(port) === ws) {
      connections.delete(port);
      console.log(`[Offscreen] Disconnected from port ${port} (${connections.size} remaining)`);
      updateStatus();
      // Notify background to release tabs for this session
      chrome.runtime.sendMessage({ type: 'session_disconnect', port }).catch(() => {});
    }
  };

  ws.onerror = () => {
    clearTimeout(connectTimeout);
    ws.close();
  };
}

function updateStatus() {
  const count = connections.size;
  chrome.runtime.sendMessage({
    type: 'ws_status',
    connected: count > 0,
    count,
    ports: [...connections.keys()],
  }).catch(() => {});
}

// Clipboard bridge (v1.26): background.js has no DOM, so system-clipboard read/write
// happens here via the hidden textarea + execCommand (the MV3-offscreen-sanctioned path).
// Secret-hygiene contract: background NEVER forwards clipboard content to the MCP server
// for copy/stats ops — only lengths/shape booleans leave the extension.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'bmcp_clipboard') return;
  try {
    const ta = document.getElementById('bmcp-clip') || (() => {
      const t = document.createElement('textarea');
      t.id = 'bmcp-clip';
      document.body.appendChild(t);
      return t;
    })();
    if (msg.op === 'write') {
      ta.value = msg.text ?? '';
      ta.select();
      const ok = document.execCommand('copy');
      ta.value = '';
      sendResponse({ ok, chars: (msg.text ?? '').length });
    } else if (msg.op === 'read') {
      ta.value = '';
      ta.focus();
      const ok = document.execCommand('paste');
      const text = ta.value;
      ta.value = '';
      sendResponse({ ok, text });
    } else {
      sendResponse({ ok: false, error: 'unknown clipboard op: ' + msg.op });
    }
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
  return true;
});

// Listen for terminate signals from background.js (sent when last tab in a session closes)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'terminate_mcp_session' || typeof msg.port !== 'number') return;
  const ws = connections.get(msg.port);
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'terminate' }));
    }
  } catch {}
  try { ws.close(); } catch {}
  // ws.onclose handler removes from connections + notifies background
});

// Initial scan + frequent rescan for new servers
scanPorts();
setInterval(scanPorts, 2000);
