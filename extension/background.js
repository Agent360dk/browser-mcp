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

  // Ungroup tabs (don't close them)
  try {
    const tabIds = [...session.tabIds];
    if (tabIds.length > 0) {
      await chrome.tabs.ungroup(tabIds);
    }
  } catch {}

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
// IMPORTANT: Also activates the tab so Chrome APIs (captureVisibleTab,
// executeScript) operate on the correct tab, not whatever the user is viewing.
async function getSessionTab(port, activate = true) {
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

// ── Popup tracking (for OAuth flows) ────────────────────────────────────────

let lastCreatedTabId = null;
let lastCreatedTabPort = null;

chrome.tabs.onCreated.addListener((tab) => {
  lastCreatedTabId = tab.id;
});

// Clean up closed tabs from sessions
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [, session] of sessions) {
    session.tabIds.delete(tabId);
  }
});

// ── Command Dispatcher ──────────────────────────────────────────────────────

async function dispatch(port, method, params) {
  switch (method) {
    case 'navigate': {
      const session = getSession(port);
      let tab = await getSessionTab(port);

      if (tab.url === 'about:blank' || tab.url.startsWith('chrome://')) {
        await chrome.tabs.update(tab.id, { url: params.url });
      } else {
        // Create new tab for new URL
        tab = await chrome.tabs.create({ url: params.url, active: false });
        await addTabToSession(port, tab.id);
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

      // Auto-close about:blank placeholder tabs in this session
      for (const tabId of session.tabIds) {
        if (tabId === tab.id) continue;
        try {
          const t = await chrome.tabs.get(tabId);
          if (t.url === 'about:blank') {
            await chrome.tabs.remove(tabId);
            session.tabIds.delete(tabId);
          }
        } catch { session.tabIds.delete(tabId); }
      }

      persistSessions();
      const updated = await chrome.tabs.get(tab.id);
      return { title: updated.title, url: updated.url, tab_id: tab.id, session: session.label };
    }

    case 'get_page_content': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const format = params.format || 'text';
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (fmt) => fmt === 'html' ? document.documentElement.outerHTML : document.body.innerText,
        args: [format],
      });
      return { content: result.result, url: tab.url, title: tab.title };
    }

    case 'screenshot': {
      const tab = await getSessionTab(port); // auto-activates
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot screenshot chrome:// pages');
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        return { image: dataUrl };
      } catch {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 90 });
        return { image: dataUrl };
      }
    }

    case 'execute_script': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot execute scripts on chrome:// pages');
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: new Function('return (' + params.code + ')'),
        world: 'MAIN',
      });
      return { result: result.result };
    }

    case 'click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel) => {
          const el = document.querySelector(sel);
          if (!el) return { ok: false, error: 'Element not found: ' + sel };
          el.click();
          return { ok: true };
        },
        args: [params.selector],
      });
      return result.result;
    }

    case 'fill': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return { ok: false, error: 'Element not found: ' + sel };
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        },
        args: [params.selector, params.value],
      });
      return result.result;
    }

    case 'wait': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const timeout = params.timeout || 10000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (sel) => !!document.querySelector(sel),
          args: [params.selector],
        });
        if (result.result) return { found: true };
        await new Promise(r => setTimeout(r, 500));
      }
      return { found: false };
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
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (key) => key ? localStorage.getItem(key) : JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
        args: [params.key || null],
      });
      return { value: result.result };
    }

    case 'ask_user': {
      const tab = await getSessionTab(port);
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

    default:
      throw new Error('Unknown method: ' + method);
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
