/**
 * Agent360 Browser MCP — Background Service Worker
 *
 * Handles Chrome API calls relayed from the offscreen document.
 * Each MCP session (port) gets its own Chrome Tab Group with color coding.
 * Tabs are isolated per session — no cross-session interference.
 */

// ── Session Tab Management ─────────────────────────────────────────────────

const SESSION_COLORS = ['blue', 'green', 'yellow', 'red', 'pink', 'purple', 'cyan', 'orange'];
const sessions = new Map(); // port → { tabIds: Set, groupId: number|null, color: string, label: string }
let sessionsLoaded = false;

// Restore sessions from storage (service workers lose in-memory state on suspend)
async function restoreSessions() {
  if (sessionsLoaded) return;
  sessionsLoaded = true;
  const { sessions: saved } = await chrome.storage.local.get({ sessions: {} });
  for (const [port, data] of Object.entries(saved)) {
    // Verify tabs still exist
    const validTabIds = new Set();
    for (const tabId of (data.tabIds || [])) {
      try {
        await chrome.tabs.get(tabId);
        validTabIds.add(tabId);
      } catch {} // tab no longer exists
    }
    if (validTabIds.size > 0) {
      const activeTabId = data.activeTabId && validTabIds.has(data.activeTabId) ? data.activeTabId : null;
      sessions.set(Number(port), {
        tabIds: validTabIds,
        activeTabId,
        groupId: data.groupId || null,
        color: data.color || SESSION_COLORS[sessions.size % SESSION_COLORS.length],
        label: data.label || `Claude ${sessions.size + 1}`,
      });
    }
  }
}

function getSession(port) {
  if (!sessions.has(port)) {
    const idx = sessions.size % SESSION_COLORS.length;
    sessions.set(port, {
      tabIds: new Set(),
      activeTabId: null,
      groupId: null,
      color: SESSION_COLORS[idx],
      label: `Claude ${sessions.size + 1}`,
    });
  }
  return sessions.get(port);
}

async function addTabToSession(port, tabId) {
  const session = getSession(port);
  session.tabIds.add(tabId);

  try {
    if (session.groupId !== null) {
      try {
        await chrome.tabs.group({ tabIds: [tabId], groupId: session.groupId });
      } catch {
        // Group no longer valid — will create new one below
        session.groupId = null;
      }
    }

    if (session.groupId === null) {
      const validTabIds = [...session.tabIds].filter(id => {
        try { return id; } catch { return false; }
      });
      const groupId = await chrome.tabs.group({ tabIds: validTabIds });
      session.groupId = groupId;
      await chrome.tabGroups.update(groupId, {
        title: session.label,
        color: session.color,
        collapsed: false,
      });
    }
  } catch (e) {
    console.warn('[MCP] Tab group error:', e.message);
  }

  persistSessions();
}

async function releaseSession(port) {
  const session = sessions.get(port);
  if (!session) return;

  // Detach debugger + close all session tabs
  const tabIds = [...session.tabIds];
  for (const tabId of tabIds) {
    debuggerForceDetach(tabId);
    try {
      await chrome.tabs.remove(tabId);
    } catch {} // tab may already be closed
  }

  sessions.delete(port);
  persistSessions();
}

function persistSessions() {
  const data = {};
  for (const [port, session] of sessions) {
    data[port] = {
      tabIds: [...session.tabIds],
      activeTabId: session.activeTabId,
      groupId: session.groupId,
      color: session.color,
      label: session.label,
    };
  }
  chrome.storage.local.set({ sessions: data });
}

// Get the active tab for this session (last navigated), or create one.
// activate=false (default): runs in background — no focus stealing.
// activate=true: only for commands that NEED visible tab (screenshot, ask_user, navigate, execute_script).
async function getSessionTab(port, activate = false) {
  const session = getSession(port);
  let target = null;

  // Prefer the active (last navigated) tab
  if (session.activeTabId) {
    try {
      const tab = await chrome.tabs.get(session.activeTabId);
      if (tab && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:')) {
        target = tab;
      }
    } catch {
      session.activeTabId = null;
      session.tabIds.delete(session.activeTabId);
    }
  }

  // Fallback: any usable session tab
  if (!target) {
    for (const tabId of session.tabIds) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:')) {
          session.activeTabId = tabId;
          target = tab;
          break;
        }
      } catch {
        session.tabIds.delete(tabId);
      }
    }
  }

  // No usable tab — create one
  if (!target) {
    target = await chrome.tabs.create({ url: 'about:blank', active: false });
    await addTabToSession(port, target.id);
    return target;
  }

  // Activate the tab so Chrome APIs target it (not whatever user is viewing)
  if (activate && !target.active) {
    await chrome.tabs.update(target.id, { active: true });
    // Brief wait for Chrome to render the tab
    await new Promise(r => setTimeout(r, 150));
    target = await chrome.tabs.get(target.id);
  }

  return target;
}

// ── Chrome Debugger API Helpers (CSP-bypass for Google, Stripe, Slack) ─────

// Track which tabs have debugger attached to avoid repeated attach/detach
const debuggerAttached = new Set();

async function debuggerAttach(tabId) {
  if (debuggerAttached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerAttached.add(tabId);
  } catch (e) {
    if (e.message?.includes('Already attached')) {
      debuggerAttached.add(tabId);
    } else {
      throw e;
    }
  }
}

async function debuggerDetach(tabId) {
  // Don't detach immediately — keep attached for subsequent commands.
  // Will be cleaned up when tab closes or session ends.
}

function debuggerForceDetach(tabId) {
  if (!debuggerAttached.has(tabId)) return;
  debuggerAttached.delete(tabId);
  try {
    chrome.debugger.detach({ tabId });
  } catch {}
}

// Clean up debugger + session refs when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  debuggerAttached.delete(tabId);
  for (const [, session] of sessions) {
    session.tabIds.delete(tabId);
  }
});

async function debuggerType(tabId, text) {
  await debuggerAttach(tabId);
  try {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        key: char,
        code: `Key${char.toUpperCase()}`,
        unmodifiedText: char,
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: char,
        code: `Key${char.toUpperCase()}`,
      });
      // Human-like typing: random 30-120ms, occasional longer pause
      const pause = (i > 0 && i % (7 + Math.floor(Math.random() * 5)) === 0)
        ? 150 + Math.random() * 200  // thinking pause every ~10 chars
        : 30 + Math.random() * 90;   // normal keystroke
      await new Promise(r => setTimeout(r, pause));
    }
  } finally {
    await debuggerDetach(tabId);
  }
}

async function debuggerClick(tabId, x, y) {
  await debuggerAttach(tabId);
  try {
    // 1. mouseMoved first (triggers hover state, required by some frameworks)
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y,
    });
    await new Promise(r => setTimeout(r, 30));
    // 2. mousePressed + mouseReleased (fires trusted mousedown/mouseup)
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
    // 3. CDP doesn't synthesize 'click' event from mousePressed/mouseReleased.
    //    Fire JS click + React fiber lookup as backup for React SPAs.
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(() => {
        const el = document.elementFromPoint(${x}, ${y});
        if (!el) return;
        el.click();
        // React fiber fallback — find and call onClick handler directly
        const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (fiberKey) {
          let fiber = el[fiberKey];
          for (let i = 0; i < 10 && fiber; i++) {
            if (fiber.memoizedProps?.onClick) { fiber.memoizedProps.onClick(new MouseEvent('click', {bubbles:true})); break; }
            fiber = fiber.return;
          }
        }
      })()`,
    });
  } finally {
    await debuggerDetach(tabId);
  }
}

async function debuggerFocus(tabId, selector) {
  await debuggerAttach(tabId);
  try {
    const { root } = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument', {});
    const { nodeId } = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
      nodeId: root.nodeId, selector,
    });
    if (!nodeId) throw new Error('Element not found: ' + selector);
    await chrome.debugger.sendCommand({ tabId }, 'DOM.focus', { nodeId });
    return nodeId;
  } catch (e) {
    await debuggerDetach(tabId);
    throw e;
  }
}

async function debuggerFill(tabId, selector, value) {
  // Check if element is contenteditable (rich text editors: LinkedIn, Slack)
  const isContentEditable = await debuggerEval(tabId, `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)});
      return el?.isContentEditable || el?.getAttribute('contenteditable') === 'true';
    })()
  `);

  if (isContentEditable) {
    // Rich text editors (Quill, ProseMirror, Slate, Draft.js) maintain internal
    // state. Key events get ignored. execCommand('insertText') fires proper
    // InputEvent that these editors handle correctly.
    await debuggerEval(tabId, `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        el.focus();
        // Select all existing content and delete it
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        // Insert new text — fires InputEvent with inputType='insertText'
        document.execCommand('insertText', false, ${JSON.stringify(value)});
      })()
    `);
    return;
  }

  // Standard input/textarea — focus, clear, type
  await debuggerFocus(tabId, selector);
  await debuggerAttach(tabId);
  try {
    // Ctrl+A to select all, then Backspace to clear
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'a', code: 'KeyA',
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Backspace', code: 'Backspace',
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Backspace', code: 'Backspace',
    });
  } finally {
    await debuggerDetach(tabId);
  }
  await debuggerType(tabId, value);
}

async function debuggerEval(tabId, expression) {
  await debuggerAttach(tabId);
  try {
    const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Script execution failed');
    }
    return result.result?.value;
  } finally {
    await debuggerDetach(tabId);
  }
}

// Try executeScript first, fall back to debugger on CSP error
async function safeExecuteScript(tabId, func, args = [], world = 'MAIN') {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func,
      args,
      ...(world === 'MAIN' ? { world: 'MAIN' } : {}),
    });
    return { result: result.result, usedDebugger: false };
  } catch (e) {
    if (e.message?.includes('Content Security Policy') || e.message?.includes('unsafe-eval')) {
      // CSP blocked — this is expected on Google, Stripe, Slack
      return { cspBlocked: true };
    }
    throw e;
  }
}

// ── Smart Selector Resolution ─────────────────────────────────────────────
// Supports CSS selectors AND text-based selectors:
//   "button:text(Get started)" → finds button containing "Get started"
//   "#my-id" → standard CSS selector
//   "text=Submit" → any element containing "Submit"

function buildTextFinderJS(textPattern, tagFilter) {
  const escaped = JSON.stringify(textPattern);
  const tagCheck = tagFilter ? `&& el.tagName === ${JSON.stringify(tagFilter.toUpperCase())}` : '';
  return `(function() {
    const text = ${escaped};
    // Collect all elements including inside shadow DOM
    function collectAll(root, results) {
      for (const el of root.querySelectorAll('*')) {
        results.push(el);
        if (el.shadowRoot) collectAll(el.shadowRoot, results);
      }
      return results;
    }
    const all = collectAll(document, []);
    // Exact match first (prefer leaf nodes)
    for (const el of all) {
      if (el.children.length > 3) continue;
      const t = el.textContent?.trim();
      if (t === text ${tagCheck}) {
        return el;
      }
    }
    // Partial match fallback
    for (const el of all) {
      if (el.children.length > 3) continue;
      const t = el.textContent?.trim();
      if (t && t.includes(text) ${tagCheck}) {
        return el;
      }
    }
    return null;
  })()`;
}

function parseSelector(selector) {
  // "button:text(Get started)" → { tag: 'button', text: 'Get started' }
  const tagTextMatch = selector.match(/^(\w+):text\((.+)\)$/);
  if (tagTextMatch) return { type: 'text', tag: tagTextMatch[1], text: tagTextMatch[2] };

  // "text=Submit" → { text: 'Submit' }
  if (selector.startsWith('text=')) return { type: 'text', tag: null, text: selector.slice(5) };

  // Standard CSS selector
  return { type: 'css', selector };
}

async function resolveElement(tabId, selectorStr) {
  const parsed = parseSelector(selectorStr);

  if (parsed.type === 'css') {
    // Standard CSS with shadow DOM traversal — try executeScript first, debugger fallback
    const deepQueryFn = (sel) => {
      function queryDeep(root, s) {
        const el = root.querySelector(s);
        if (el) return el;
        for (const node of root.querySelectorAll('*')) {
          if (node.shadowRoot) {
            const found = queryDeep(node.shadowRoot, s);
            if (found) return found;
          }
        }
        return null;
      }
      const el = queryDeep(document, sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: el.tagName, found: true };
    };

    const scriptResult = await safeExecuteScript(tabId, deepQueryFn, [parsed.selector]);

    if (scriptResult.cspBlocked) {
      const sel = JSON.stringify(parsed.selector);
      const result = await debuggerEval(tabId, `
        (function() {
          function queryDeep(root, s) {
            const el = root.querySelector(s);
            if (el) return el;
            for (const node of root.querySelectorAll('*')) {
              if (node.shadowRoot) { const f = queryDeep(node.shadowRoot, s); if (f) return f; }
            }
            return null;
          }
          const el = queryDeep(document, ${sel});
          if (!el) return null;
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2, tag: el.tagName, found: true };
        })()
      `);
      return result ? { ...result, method: 'debugger' } : null;
    }
    return scriptResult.result;
  }

  // Text-based selector — always use debugger (more reliable, no CSP issues)
  const finderJS = buildTextFinderJS(parsed.text, parsed.tag);
  const result = await debuggerEval(tabId, `
    (function() {
      const el = ${finderJS};
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, tag: el.tagName, text: el.textContent?.trim().slice(0, 80), found: true };
    })()
  `);
  return result ? { ...result, method: 'debugger' } : null;
}

// ── Offscreen Document Setup ───────────────────────────────────────────────

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Maintain persistent WebSocket connection to local MCP server',
    });
  }
}

// ── Action Logging ─────────────────────────────────────────────────────────

const SENSITIVE = new Set(['get_cookies', 'get_local_storage', 'execute_script', 'extract_token']);

function logAction(port, method, params) {
  const category = SENSITIVE.has(method) ? 'sensitive' : 'safe';
  const session = sessions.get(port);
  const entry = {
    time: Date.now(),
    method,
    params: JSON.stringify(params).slice(0, 200),
    category,
    session: session?.label || `Port ${port}`,
    color: session?.color || 'grey',
  };
  chrome.storage.local.get({ actionLog: [] }, ({ actionLog }) => {
    actionLog.unshift(entry);
    if (actionLog.length > 50) actionLog.length = 50;
    chrome.storage.local.set({ actionLog });
  });
}

// ── Message Handler — receives commands from offscreen.js ──────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'mcp_command') {
    const port = msg.port;
    logAction(port, msg.method, msg.params);
    // Restore sessions from storage (service worker may have restarted)
    restoreSessions().then(() => {
      dispatch(port, msg.method, msg.params)
        .then(result => sendResponse(result))
        .catch(err => sendResponse({ __error: err.message || String(err) }));
    });
    return true; // async response
  }

  if (msg.type === 'session_disconnect') {
    releaseSession(msg.port);
    return;
  }

  if (msg.type === 'reconnect') {
    chrome.offscreen.hasDocument().then(exists => {
      if (exists) chrome.offscreen.closeDocument().then(() => ensureOffscreen());
      else ensureOffscreen();
    });
    return;
  }

  if (msg.type === 'ws_status') {
    const count = msg.count || (msg.connected ? 1 : 0);
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    if (count > 0) {
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    }
    chrome.storage.local.set({
      mcpConnected: msg.connected,
      mcpCount: count,
      mcpPorts: msg.ports || [],
    });
    return;
  }
});

// ── OAuth Popup Interception ─────────────────────────────────────────────────

const OAUTH_DOMAINS = ['accounts.google.com', 'login.microsoftonline.com', 'github.com/login/oauth', 'slack.com/oauth', 'app.hubspot.com/oauth'];

let lastCreatedTabId = null;

chrome.tabs.onCreated.addListener(async (tab) => {
  lastCreatedTabId = tab.id;

  // Auto-claim OAuth popups for the session that opened them
  if (tab.pendingUrl || tab.url) {
    const url = tab.pendingUrl || tab.url;
    const isOAuth = OAUTH_DOMAINS.some(d => url.includes(d));
    if (isOAuth) {
      for (const [port, session] of sessions) {
        if (tab.openerTabId && session.tabIds.has(tab.openerTabId)) {
          await addTabToSession(port, tab.id);
          session.activeTabId = tab.id;
          persistSessions();
          break;
        }
      }
    }
  }
});

// ── CAPTCHA Detection ────────────────────────────────────────────────────────

async function detectCaptcha(tabId) {
  try {
    return await debuggerEval(tabId, `
      (function() {
        if (document.querySelector('iframe[src*="hcaptcha.com"]') || document.querySelector('.h-captcha')) return 'hcaptcha';
        if (document.querySelector('iframe[src*="recaptcha"]') || document.querySelector('.g-recaptcha')) return 'recaptcha';
        if (document.querySelector('iframe[src*="challenges.cloudflare.com"]') || document.querySelector('.cf-turnstile')) return 'turnstile';
        if (document.documentElement.innerHTML.includes('challenge-platform')) return 'challenge';
        return null;
      })()
    `);
  } catch { return null; }
}

// ── Deep Shadow DOM Query ────────────────────────────────────────────────────
// querySelectorDeep: finds elements inside shadow DOMs (Shopify, Salesforce, etc.)

function buildDeepQueryJS(selector) {
  return `(function() {
    function queryDeep(root, sel) {
      const el = root.querySelector(sel);
      if (el) return el;
      for (const node of root.querySelectorAll('*')) {
        if (node.shadowRoot) {
          const found = queryDeep(node.shadowRoot, sel);
          if (found) return found;
        }
      }
      return null;
    }
    return queryDeep(document, ${JSON.stringify(selector)});
  })()`;
}

// ── Command Dispatcher ──────────────────────────────────────────────────────

async function dispatch(port, method, params) {
  switch (method) {
    case 'navigate': {
      const session = getSession(port);
      let tab = await getSessionTab(port);

      // Always reuse the active tab — navigate in place, don't create new tabs
      // Only create new tab if explicitly requested via new_tab param
      if (params.new_tab) {
        tab = await chrome.tabs.create({ url: params.url, active: false });
        await addTabToSession(port, tab.id);
      } else {
        await chrome.tabs.update(tab.id, { url: params.url });
      }

      // Wait for load
      await new Promise(resolve => {
        const listener = (tabId, info) => {
          if (tabId === tab.id && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
      });

      // Set as active tab for this session
      session.activeTabId = tab.id;
      persistSessions();
      const updated = await chrome.tabs.get(tab.id);

      // Check for CAPTCHA after navigation
      const captcha = await detectCaptcha(tab.id);
      const result = { title: updated.title, url: updated.url, tab_id: tab.id, session: session.label };
      if (captcha) {
        result.captcha_detected = captcha;
        result.hint = `CAPTCHA (${captcha}) detected. Use browser_ask_user to ask the user to solve it, then retry.`;
      }
      return result;
    }

    case 'get_page_content': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const format = params.format || 'text';
      const scriptResult = await safeExecuteScript(tab.id, (fmt) => fmt === 'html' ? document.documentElement.outerHTML : document.body.innerText, [format]);
      if (!scriptResult.cspBlocked) {
        return { content: scriptResult.result, url: tab.url, title: tab.title };
      }
      // CSP fallback
      const content = await debuggerEval(tab.id, format === 'html' ? 'document.documentElement.outerHTML' : 'document.body.innerText');
      return { content, url: tab.url, title: tab.title, method: 'debugger' };
    }

    case 'screenshot': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot screenshot chrome:// pages');
      // Use debugger Page.captureScreenshot as PRIMARY method.
      // captureVisibleTab requires active tab in active window — fails when
      // user is in terminal. Debugger works regardless of tab focus.
      try {
        await debuggerAttach(tab.id);
        const { data } = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.captureScreenshot', {
          format: 'png',
        });
        return { image: 'data:image/png;base64,' + data };
      } catch {
        // Debugger failed — fall back to captureVisibleTab (needs active tab)
        try {
          await chrome.tabs.update(tab.id, { active: true });
          await new Promise(r => setTimeout(r, 150));
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
          return { image: dataUrl };
        } catch (e) {
          throw new Error('Screenshot failed: ' + e.message);
        }
      }
    }

    case 'execute_script': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot execute scripts on chrome:// pages');
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: new Function('return (' + params.code + ')'),
          world: 'MAIN',
        });
        return { result: result.result };
      } catch (e) {
        if (e.message?.includes('Content Security Policy') || e.message?.includes('unsafe-eval')) {
          // CSP blocked — fall back to debugger Runtime.evaluate
          const value = await debuggerEval(tab.id, params.code);
          return { result: value, method: 'debugger' };
        }
        throw e;
      }
    }

    case 'click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');

      // Resolve element (supports CSS + text selectors, auto-scrolls)
      const el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };

      // Always use debugger mouse events — works on all sites including SPAs
      await debuggerClick(tab.id, el.x, el.y);
      return { ok: true, method: el.method || 'debugger', tag: el.tag, text: el.text };
    }

    case 'fill': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const parsed = parseSelector(params.selector);

      // For text-based selectors, click the element first then type
      if (parsed.type === 'text') {
        const el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
        await debuggerClick(tab.id, el.x, el.y);
        await new Promise(r => setTimeout(r, 100));
        await debuggerType(tab.id, params.value);
        return { ok: true, method: 'debugger' };
      }

      // Always use debugger for input/textarea — React/Angular/Vue need real keyboard events
      try {
        await debuggerFill(tab.id, parsed.selector, params.value);
        return { ok: true, method: 'debugger' };
      } catch (e) {
        // Fallback to executeScript if debugger fails
        const scriptResult = await safeExecuteScript(tab.id, (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return { ok: false, error: 'Element not found: ' + sel };
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          el.focus();
          // Use nativeInputValueSetter to bypass React controlled input
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, val); else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        }, [parsed.selector, params.value]);
        if (!scriptResult.cspBlocked) return scriptResult.result;
        return { ok: false, error: e.message, method: 'debugger' };
      }
    }

    case 'wait': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const timeout = params.timeout || 10000;
      const sel = params.selector;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        // Text-based selectors use debugger directly
        if (sel.startsWith('text=') || sel.match(/^\w+:text\(/)) {
          const el = await resolveElement(tab.id, sel);
          if (el) return { found: true, method: 'debugger' };
        } else {
          const scriptResult = await safeExecuteScript(tab.id, (s) => !!document.querySelector(s), [sel]);
          if (scriptResult.cspBlocked) {
            const found = await debuggerEval(tab.id, `!!document.querySelector(${JSON.stringify(sel)})`);
            if (found) return { found: true, method: 'debugger' };
          } else if (scriptResult.result) {
            return { found: true };
          }
        }
        await new Promise(r => setTimeout(r, 500));
      }
      return { found: false };
    }

    case 'press_key': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const key = params.key; // e.g. "Enter", "Tab", "Escape", "ArrowDown"
      const modifiers = (params.ctrl ? 2 : 0) | (params.alt ? 1 : 0) | (params.shift ? 8 : 0) | (params.meta ? 4 : 0);

      await debuggerAttach(tab.id);
      try {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          key,
          code: params.code || key,
          modifiers,
          text: key.length === 1 ? key : '',
        });
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key,
          code: params.code || key,
          modifiers,
        });
      } finally {
        await debuggerDetach(tab.id);
      }
      return { ok: true, key };
    }

    case 'scroll': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      // Scroll to element
      if (params.selector) {
        const el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
        return { ok: true, scrolled_to: params.selector };
      }
      // Scroll by pixels using CDP mouseWheel — works in React containers with overflow:scroll
      const dx = params.x || 0;
      const dy = params.y || 0;
      try {
        await debuggerAttach(tab.id);
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseWheel', x: 400, y: 300, deltaX: dx, deltaY: dy,
        });
        await debuggerDetach(tab.id);
      } catch {
        // Fallback to window.scrollBy for simple pages
        await debuggerEval(tab.id, `window.scrollBy(${dx}, ${dy})`);
      }
      return { ok: true, scrolled: { x: dx, y: dy } };
    }

    case 'hover': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
      await debuggerAttach(tab.id);
      try {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: el.x, y: el.y,
        });
        // Hold hover for duration (default 500ms) so menus/tooltips appear
        await new Promise(r => setTimeout(r, params.duration || 500));
      } finally {
        await debuggerDetach(tab.id);
      }
      return { ok: true, tag: el.tag, text: el.text };
    }

    case 'select_option': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');

      // Strategy: handle native <select> and custom dropdowns differently
      const isNativeSelect = await debuggerEval(tab.id, `
        (function() {
          const el = document.querySelector(${JSON.stringify(params.selector)});
          return el?.tagName === 'SELECT';
        })()
      `);

      if (isNativeSelect) {
        // Native <select> — set value directly
        await debuggerEval(tab.id, `
          (function() {
            const sel = document.querySelector(${JSON.stringify(params.selector)});
            const opt = Array.from(sel.options).find(o => o.text.includes(${JSON.stringify(params.option)}) || o.value === ${JSON.stringify(params.option)});
            if (opt) {
              sel.value = opt.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              sel.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return !!opt;
          })()
        `);
        return { ok: true, type: 'native_select' };
      }

      // Custom dropdown (Angular Material, React Select, etc.)
      // Step 1: Click the trigger to open
      const trigger = await resolveElement(tab.id, params.selector);
      if (!trigger) return { ok: false, error: 'Dropdown trigger not found: ' + params.selector };
      await debuggerClick(tab.id, trigger.x, trigger.y);

      // Step 2: Wait for options to appear
      await new Promise(r => setTimeout(r, params.wait || 300));

      // Step 3: Find and click the option by text
      const option = await resolveElement(tab.id, `text=${params.option}`);
      if (!option) return { ok: false, error: 'Option not found: ' + params.option };
      await debuggerClick(tab.id, option.x, option.y);

      return { ok: true, type: 'custom_dropdown', selected: params.option };
    }

    case 'handle_dialog': {
      // Auto-handle JS alert/confirm/prompt dialogs
      // Must be set up BEFORE the dialog appears
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const action = params.action || 'accept'; // accept, dismiss
      const promptText = params.text || '';

      await debuggerAttach(tab.id);
      try {
        // Enable page events to catch dialogs
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable', {});

        // Wait for dialog to appear (or handle existing one)
        const result = await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            chrome.debugger.onEvent.removeListener(listener);
            resolve({ ok: false, error: 'No dialog appeared within timeout' });
          }, params.timeout || 10000);

          const listener = (source, method, eventParams) => {
            if (source.tabId !== tab.id || method !== 'Page.javascriptDialogOpening') return;
            chrome.debugger.onEvent.removeListener(listener);
            clearTimeout(timeout);

            chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.handleJavaScriptDialog', {
              accept: action === 'accept',
              promptText: promptText,
            }).then(() => {
              resolve({
                ok: true,
                dialog_type: eventParams.type,
                message: eventParams.message,
                action,
              });
            }).catch(e => resolve({ ok: false, error: e.message }));
          };
          chrome.debugger.onEvent.addListener(listener);
        });

        return result;
      } finally {
        await debuggerDetach(tab.id);
      }
    }

    case 'wait_for_network': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const urlPattern = params.url_pattern || '';
      const timeout = params.timeout || 15000;

      await debuggerAttach(tab.id);
      try {
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable', {});

        const result = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            chrome.debugger.onEvent.removeListener(listener);
            resolve({ ok: false, error: 'No matching request within timeout' });
          }, timeout);

          const listener = (source, method, eventParams) => {
            if (source.tabId !== tab.id) return;

            if (method === 'Network.responseReceived') {
              const url = eventParams.response?.url || '';
              const status = eventParams.response?.status;
              // Match by pattern (substring match) or return any if no pattern
              if (!urlPattern || url.includes(urlPattern)) {
                chrome.debugger.onEvent.removeListener(listener);
                clearTimeout(timer);
                // Try to get response body
                chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.getResponseBody', {
                  requestId: eventParams.requestId,
                }).then(bodyResult => {
                  resolve({
                    ok: true,
                    url,
                    status,
                    method: eventParams.response?.requestHeaders?.[':method'] || 'GET',
                    body: bodyResult?.body?.substring(0, 5000) || null,
                  });
                }).catch(() => {
                  resolve({
                    ok: true,
                    url,
                    status,
                    method: eventParams.response?.requestHeaders?.[':method'] || 'GET',
                    body: null,
                  });
                });
              }
            }
          };
          chrome.debugger.onEvent.addListener(listener);
        });

        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.disable', {});
        return result;
      } finally {
        await debuggerDetach(tab.id);
      }
    }

    case 'fetch': {
      // HTTP requests from background — NOT subject to CORS
      const options = {
        method: params.method || 'GET',
        headers: params.headers || {},
      };
      if (params.body) options.body = typeof params.body === 'string' ? params.body : JSON.stringify(params.body);
      try {
        const resp = await fetch(params.url, options);
        const text = await resp.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        return { ok: resp.ok, status: resp.status, body: json || text };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    case 'list_tabs': {
      // Return only this session's tabs
      const session = getSession(port);
      const tabs = [];
      for (const tabId of session.tabIds) {
        try {
          const tab = await chrome.tabs.get(tabId);
          tabs.push({ id: tab.id, url: tab.url, title: tab.title, active: tab.active });
        } catch {
          session.tabIds.delete(tabId);
        }
      }
      return { tabs, session: session.label, color: session.color };
    }

    case 'get_cookies': {
      const cookies = await chrome.cookies.getAll({ domain: params.domain });
      return { cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })) };
    }

    case 'get_local_storage': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const scriptResult = await safeExecuteScript(tab.id, (key) => key ? localStorage.getItem(key) : JSON.stringify(Object.fromEntries(Object.entries(localStorage))), [params.key || null]);
      if (!scriptResult.cspBlocked) {
        return { value: scriptResult.result };
      }
      const expr = params.key
        ? `localStorage.getItem(${JSON.stringify(params.key)})`
        : `JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`;
      const value = await debuggerEval(tab.id, expr);
      return { value, method: 'debugger' };
    }

    case 'set_cookies': {
      const results = [];
      const cookieList = Array.isArray(params.cookies) ? params.cookies : [params];
      for (const c of cookieList) {
        try {
          const cookie = await chrome.cookies.set({
            url: c.url || `https://${c.domain}`,
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            secure: c.secure !== false,
            httpOnly: c.httpOnly || false,
            sameSite: c.sameSite || 'lax',
          });
          results.push({ ok: true, name: c.name });
        } catch (e) {
          results.push({ ok: false, name: c.name, error: e.message });
        }
      }
      return { results };
    }

    case 'set_local_storage': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const key = params.key;
      const val = params.value;
      const expr = `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(val)})`;
      try {
        const scriptResult = await safeExecuteScript(tab.id, (k, v) => { localStorage.setItem(k, v); return { ok: true }; }, [key, val]);
        if (!scriptResult.cspBlocked) return scriptResult.result;
      } catch {}
      await debuggerEval(tab.id, expr);
      return { ok: true, method: 'debugger' };
    }

    case 'console_logs': {
      const tab = await getSessionTab(port);
      const count = params.count || 50;
      try {
        await debuggerAttach(tab.id);
        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.enable');
        // Collect console messages for a brief period
        const logs = [];
        const handler = (source, method, eventParams) => {
          if (source.tabId === tab.id && method === 'Runtime.consoleAPICalled') {
            logs.push({
              type: eventParams.type,
              text: eventParams.args?.map(a => a.value || a.description || '').join(' '),
              timestamp: eventParams.timestamp,
            });
          }
        };
        chrome.debugger.onEvent.addListener(handler);
        // Also grab existing console via page JS
        const { result } = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.evaluate', {
          expression: `(() => {
            if (!window.__mcpConsoleLogs) {
              window.__mcpConsoleLogs = [];
              const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
              for (const [type, fn] of Object.entries(orig)) {
                console[type] = (...args) => {
                  window.__mcpConsoleLogs.push({ type, text: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), ts: Date.now() });
                  if (window.__mcpConsoleLogs.length > 200) window.__mcpConsoleLogs.shift();
                  fn.apply(console, args);
                };
              }
            }
            return JSON.stringify(window.__mcpConsoleLogs.slice(-${count}));
          })()`,
          returnByValue: true,
        });
        chrome.debugger.onEvent.removeListener(handler);
        await debuggerDetach(tab.id);
        const existing = JSON.parse(result.value || '[]');
        return { logs: [...existing, ...logs].slice(-count) };
      } catch (e) {
        try { await debuggerDetach(tab.id); } catch {}
        return { logs: [], error: e.message };
      }
    }

    case 'ask_user': {
      const tab = await getSessionTab(port, true);
      const timeout = params.timeout || 120000;
      const fields = params.fields || [];
      const hasFields = fields.length > 0;
      const session = getSession(port);

      // Activate tab + alert badge
      await chrome.tabs.update(tab.id, { active: true });
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      const notifId = 'mcp-ask-' + Date.now();
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: `${session.label} — Action Required`,
        message: params.message,
        requireInteraction: true,
        silent: false,
        priority: 2,
      });

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (message, title, fields, hasFields, timeout, sessionLabel) => {
          return new Promise((resolve) => {
            document.getElementById('a360-overlay')?.remove();

            // Notification sound — short pleasant chime
            try {
              const ctx = new AudioContext();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = 880;
              osc.type = 'sine';
              gain.gain.setValueAtTime(0.3, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.4);
              // Second tone (higher, pleasant ding-dong)
              setTimeout(() => {
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.frequency.value = 1320;
                osc2.type = 'sine';
                gain2.gain.setValueAtTime(0.2, ctx.currentTime);
                gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
                osc2.start(ctx.currentTime);
                osc2.stop(ctx.currentTime + 0.3);
              }, 150);
            } catch {}

            // Inject animation keyframes
            if (!document.getElementById('a360-styles')) {
              const style = document.createElement('style');
              style.id = 'a360-styles';
              style.textContent = `
                @keyframes a360-fade-in { from { opacity: 0; } to { opacity: 1; } }
                @keyframes a360-slide-up { from { opacity: 0; transform: translateY(30px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
              `;
              document.head.appendChild(style);
            }

            const overlay = document.createElement('div');
            overlay.id = 'a360-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif;animation:a360-fade-in 0.3s ease-out';

            const card = document.createElement('div');
            card.style.cssText = 'background:#1e293b;border-radius:12px;padding:24px;max-width:420px;width:90%;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:a360-slide-up 0.4s ease-out';

            const h = document.createElement('div');
            h.style.cssText = 'font-size:14px;font-weight:600;color:#3b82f6;margin-bottom:4px';
            h.textContent = title || 'Agent360 — Action Required';
            card.appendChild(h);
            const badge = document.createElement('div');
            badge.style.cssText = 'font-size:10px;color:#94a3b8;margin-bottom:12px';
            badge.textContent = sessionLabel;
            card.appendChild(badge);
            const msg = document.createElement('div');
            msg.style.cssText = 'font-size:13px;color:#cbd5e1;margin-bottom:16px;line-height:1.5';
            msg.textContent = message;
            card.appendChild(msg);
            const inputs = {};
            if (hasFields) {
              fields.forEach(f => {
                const label = document.createElement('label');
                label.style.cssText = 'display:block;font-size:11px;color:#94a3b8;margin-bottom:4px;margin-top:8px';
                label.textContent = f.label || f.name;
                card.appendChild(label);
                const input = document.createElement('input');
                input.type = f.type || 'text';
                input.placeholder = f.label || f.name;
                input.style.cssText = 'width:100%;padding:8px 10px;background:#0f172a;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font-size:13px;outline:none;box-sizing:border-box';
                input.addEventListener('focus', () => input.style.borderColor = '#3b82f6');
                input.addEventListener('blur', () => input.style.borderColor = '#334155');
                card.appendChild(input);
                inputs[f.name] = input;
              });
            }
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px';
            const doneBtn = document.createElement('button');
            doneBtn.textContent = hasFields ? 'Submit' : '✓ Done';
            doneBtn.style.cssText = 'flex:1;padding:10px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500';
            doneBtn.addEventListener('click', () => {
              const values = {};
              Object.entries(inputs).forEach(([k, el]) => values[k] = el.value);
              overlay.remove();
              resolve({ acknowledged: true, action: 'done', values });
            });
            const skipBtn = document.createElement('button');
            skipBtn.textContent = '✗ Skip';
            skipBtn.style.cssText = 'flex:1;padding:10px;background:#334155;color:#94a3b8;border:none;border-radius:6px;font-size:13px;cursor:pointer';
            skipBtn.addEventListener('click', () => { overlay.remove(); resolve({ acknowledged: true, action: 'skip', values: {} }); });
            btnRow.appendChild(doneBtn);
            btnRow.appendChild(skipBtn);
            card.appendChild(btnRow);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
            const firstInput = Object.values(inputs)[0];
            if (firstInput) setTimeout(() => firstInput.focus(), 100);
            card.addEventListener('keydown', (e) => { if (e.key === 'Enter') doneBtn.click(); });
            setTimeout(() => { if (document.getElementById('a360-overlay')) { overlay.remove(); resolve({ acknowledged: false, action: 'timeout', values: {} }); } }, timeout);
          });
        },
        args: [params.message, params.title, fields, hasFields, timeout, session.label],
        world: 'MAIN',
      });

      // Restore badge
      const count = sessions.size;
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      chrome.notifications.clear(notifId);
      return result.result;
    }

    case 'select_frame': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const frameIndex = params.frame_index ?? 0;
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      if (!frames || frameIndex >= frames.length) {
        return { error: `Frame ${frameIndex} not found. Available: ${frames?.length || 0} frames`, frames: frames?.map((f, i) => ({ index: i, url: f.url })) };
      }
      const frameId = frames[frameIndex].frameId;
      const code = params.code || 'document.body.innerText.slice(0, 5000)';
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [frameId] },
        func: new Function('return (' + code + ')'),
        world: 'MAIN',
      });
      return { result: result.result, frame_url: frames[frameIndex].url };
    }

    case 'list_frames': {
      const tab = await getSessionTab(port);
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      return { frames: frames?.map((f, i) => ({ index: i, url: f.url, frame_id: f.frameId, parent_frame_id: f.parentFrameId })) || [] };
    }

    case 'get_new_tab': {
      if (!lastCreatedTabId) return { error: 'No new tab detected' };
      try {
        const tab = await chrome.tabs.get(lastCreatedTabId);
        // Claim the new tab for this session
        await addTabToSession(port, tab.id);
        return { id: tab.id, url: tab.url, title: tab.title };
      } catch {
        return { error: 'Tab no longer exists' };
      }
    }

    case 'switch_tab': {
      const session = getSession(port);
      if (!session.tabIds.has(params.tab_id)) {
        throw new Error(`Tab ${params.tab_id} does not belong to this session (${session.label})`);
      }
      const tab = await chrome.tabs.update(params.tab_id, { active: true });
      session.activeTabId = tab.id;
      persistSessions();
      return { id: tab.id, url: tab.url, title: tab.title };
    }

    case 'close_tab': {
      const session = getSession(port);
      const tabId = params.tab_id;
      if (!session.tabIds.has(tabId)) {
        throw new Error(`Tab ${tabId} does not belong to this session (${session.label})`);
      }
      await chrome.tabs.remove(tabId);
      session.tabIds.delete(tabId);
      if (session.activeTabId === tabId) session.activeTabId = null;
      persistSessions();
      return { ok: true, remaining: session.tabIds.size };
    }

    case 'solve_captcha': {
      const tab = await getSessionTab(port);
      const action = params.action || 'detect';

      // ── Detect CAPTCHA on page ──
      if (action === 'detect') {
        const detection = await detectCaptcha(tab.id);
        return detection;
      }

      // ── Auto-click reCAPTCHA checkbox ──
      if (action === 'click_checkbox') {
        const result = await clickRecaptchaCheckbox(tab.id);
        // Wait for challenge or pass
        await new Promise(r => setTimeout(r, 2500));
        // Re-detect to see if it passed or image challenge appeared
        const after = await detectCaptcha(tab.id);
        return { ...result, after };
      }

      // ── Click specific grid cells (AI vision guided) ──
      if (action === 'click_grid') {
        const cells = params.cells || [];
        if (!cells.length) return { error: 'No cells specified' };
        const result = await clickCaptchaGridCells(tab.id, cells);
        return result;
      }

      // ── Human fallback ──
      if (action === 'ask_human') {
        return { method: 'human', instructions: 'Call browser_ask_user with message: "A CAPTCHA needs to be solved. Please solve it in the browser and click Done when finished."' };
      }

      return { error: 'Unknown action: ' + action };
    }

    case 'reload_extension': {
      // MCP server signals that extension files were updated via npx
      // Reload after a short delay to allow response to be sent
      setTimeout(() => chrome.runtime.reload(), 500);
      return { ok: true, message: 'Extension reloading in 500ms' };
    }

    default:
      throw new Error('Unknown method: ' + method);
  }
}

// ── CAPTCHA Detection & Solving Helpers ─────────────────────────────────────

async function detectCaptcha(tabId) {
  try {
    await debuggerAttach(tabId);
    const { result } = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(() => {
        const res = { found: false, types: [] };

        // reCAPTCHA v2 — checkbox iframe
        const recaptchaAnchor = document.querySelector('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]');
        if (recaptchaAnchor) {
          res.found = true;
          res.types.push('recaptcha_v2_checkbox');
          const container = document.querySelector('.g-recaptcha');
          if (container) res.sitekey = container.getAttribute('data-sitekey');
        }

        // reCAPTCHA v2 — image challenge iframe
        const recaptchaChallenge = document.querySelector('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]');
        if (recaptchaChallenge) {
          res.found = true;
          if (!res.types.includes('recaptcha_v2_checkbox')) res.types.push('recaptcha_v2_image');
          res.types.push('recaptcha_v2_challenge_visible');
          // Get iframe dimensions for grid clicking
          const rect = recaptchaChallenge.getBoundingClientRect();
          res.challengeFrame = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }

        // reCAPTCHA v3 — invisible badge
        const recaptchaV3 = document.querySelector('.grecaptcha-badge');
        if (recaptchaV3 && !recaptchaAnchor) {
          res.found = true;
          res.types.push('recaptcha_v3_invisible');
          res.note = 'reCAPTCHA v3 is invisible and score-based. Real Chrome with Google login usually passes automatically. No action needed.';
        }

        // hCaptcha
        const hcaptcha = document.querySelector('iframe[src*="hcaptcha.com"], .h-captcha');
        if (hcaptcha) {
          res.found = true;
          res.types.push('hcaptcha');
          const container = document.querySelector('.h-captcha');
          if (container) res.sitekey = container.getAttribute('data-sitekey');
        }

        // Cloudflare Turnstile
        const turnstile = document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile');
        if (turnstile) {
          res.found = true;
          res.types.push('cloudflare_turnstile');
          const container = document.querySelector('.cf-turnstile');
          if (container) res.sitekey = container.getAttribute('data-sitekey');
        }

        // Cloudflare challenge page (5-second interstitial)
        if (document.title.includes('Just a moment') || document.querySelector('#challenge-running')) {
          res.found = true;
          res.types.push('cloudflare_challenge_page');
          res.note = 'Cloudflare challenge page. Wait 5-10 seconds — real Chrome usually passes automatically.';
        }

        // FunCaptcha / Arkose Labs
        const funcaptcha = document.querySelector('#FunCaptcha, iframe[src*="funcaptcha"], iframe[src*="arkoselabs"]');
        if (funcaptcha) {
          res.found = true;
          res.types.push('funcaptcha');
        }

        if (!res.found) res.note = 'No CAPTCHA detected on this page.';
        res.pageUrl = window.location.href;
        return JSON.stringify(res);
      })()`,
      returnByValue: true,
    });
    await debuggerDetach(tabId);
    return JSON.parse(result.value);
  } catch (e) {
    try { await debuggerDetach(tabId); } catch {}
    return { found: false, error: e.message };
  }
}

async function clickRecaptchaCheckbox(tabId) {
  try {
    await debuggerAttach(tabId);
    // Find the reCAPTCHA anchor iframe position
    const { result } = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(() => {
        const iframe = document.querySelector('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]');
        if (!iframe) return JSON.stringify({ found: false });
        const rect = iframe.getBoundingClientRect();
        // Checkbox is roughly at 27,30 inside the iframe (standard reCAPTCHA layout)
        return JSON.stringify({ found: true, x: rect.x + 27, y: rect.y + 30 });
      })()`,
      returnByValue: true,
    });
    const pos = JSON.parse(result.value);
    if (!pos.found) {
      await debuggerDetach(tabId);
      return { clicked: false, reason: 'reCAPTCHA checkbox iframe not found' };
    }

    // Click the checkbox using real mouse events
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: pos.x, y: pos.y,
    });
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
    });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
    });
    await debuggerDetach(tabId);
    return { clicked: true, position: pos, note: 'Checkbox clicked. Wait 2-3 seconds then re-detect to check if passed or image challenge appeared.' };
  } catch (e) {
    try { await debuggerDetach(tabId); } catch {}
    return { clicked: false, error: e.message };
  }
}

async function clickCaptchaGridCells(tabId, cells) {
  try {
    await debuggerAttach(tabId);
    // Find the challenge iframe position and dimensions
    const { result } = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(() => {
        const iframe = document.querySelector('iframe[src*="recaptcha/api2/bframe"], iframe[src*="recaptcha/enterprise/bframe"]');
        if (!iframe) return JSON.stringify({ found: false });
        const rect = iframe.getBoundingClientRect();
        return JSON.stringify({ found: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      })()`,
      returnByValue: true,
    });
    const frame = JSON.parse(result.value);
    if (!frame.found) {
      await debuggerDetach(tabId);
      return { clicked: false, reason: 'Challenge iframe not found. Take a screenshot to verify CAPTCHA state.' };
    }

    // Determine grid size — reCAPTCHA uses 3x3 or 4x4 grids
    // The image grid starts ~100px from top of iframe, and is roughly square
    const gridTop = frame.y + 100;
    const gridLeft = frame.x + 14;
    const gridSize = frame.width - 28; // padding on each side
    const cols = cells.some(c => c >= 9) ? 4 : 3;
    const rows = cols;
    const cellSize = gridSize / cols;

    const maxCell = cols * rows - 1;
    const validCells = cells.filter(c => c >= 0 && c <= maxCell);
    if (!validCells.length) {
      await debuggerDetach(tabId);
      return { clicked: false, error: `All cell indices out of bounds. Grid is ${cols}x${rows}, valid range: 0-${maxCell}` };
    }

    const clicked = [];
    for (const cell of validCells) {
      const row = Math.floor(cell / cols);
      const col = cell % cols;
      const x = Math.round(gridLeft + col * cellSize + cellSize / 2);
      const y = Math.round(gridTop + row * cellSize + cellSize / 2);

      // Human-like click with small random offset
      const ox = x + Math.round((Math.random() - 0.5) * cellSize * 0.3);
      const oy = y + Math.round((Math.random() - 0.5) * cellSize * 0.3);

      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: ox, y: oy,
      });
      await new Promise(r => setTimeout(r, 150 + Math.random() * 300));
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: ox, y: oy, button: 'left', clickCount: 1,
      });
      await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: ox, y: oy, button: 'left', clickCount: 1,
      });
      await new Promise(r => setTimeout(r, 200 + Math.random() * 400));
      clicked.push({ cell, row, col, x: ox, y: oy });
    }

    await debuggerDetach(tabId);
    return {
      clicked: true,
      cells: clicked,
      grid: `${cols}x${rows}`,
      note: 'Cells clicked. Take a screenshot to verify, then click the "Verify" / "Skip" button if needed.',
    };
  } catch (e) {
    try { await debuggerDetach(tabId); } catch {}
    return { clicked: false, error: e.message };
  }
}

// ── Start ───────────────────────────────────────────────────────────────────
ensureOffscreen().catch(console.error);

chrome.runtime.onStartup.addListener(() => ensureOffscreen().catch(console.error));
chrome.runtime.onInstalled.addListener(() => ensureOffscreen().catch(console.error));

chrome.alarms.create('ensure-offscreen', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ensure-offscreen') {
    ensureOffscreen().catch(console.error);
  }
});
