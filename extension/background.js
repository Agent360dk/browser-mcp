/**
 * Agent360 Browser MCP — Background Service Worker
 *
 * Handles Chrome API calls relayed from the offscreen document.
 * The WebSocket connection lives in offscreen.js (persistent),
 * not here (service workers get suspended by Chrome after ~30s).
 */

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

// ── Action Logging ──────────────────────────────────────────────────────────

const SENSITIVE = new Set(['get_cookies', 'get_local_storage', 'execute_script', 'extract_token']);

function logAction(method, params) {
  const category = SENSITIVE.has(method) ? 'sensitive' : 'safe';
  const entry = {
    time: Date.now(),
    method,
    params: JSON.stringify(params).slice(0, 200),
    category,
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
    logAction(msg.method, msg.params);
    dispatch(msg.method, msg.params)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ __error: err.message || String(err) }));
    return true; // async response
  }

  if (msg.type === 'reconnect') {
    // Re-create offscreen document to force WebSocket reconnect
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

chrome.tabs.onCreated.addListener((tab) => {
  lastCreatedTabId = tab.id;
});

// ── Command Dispatcher ──────────────────────────────────────────────────────

async function getUsableTab() {
  // Get active tab, but skip chrome:// and about: pages
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && !tab.url.startsWith('chrome://') && !tab.url.startsWith('about:')) {
    return tab;
  }
  // Fallback: find any non-chrome tab
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const usable = tabs.find(t => !t.url.startsWith('chrome://') && !t.url.startsWith('about:'));
  return usable || tab; // return whatever we have if nothing usable
}

async function dispatch(method, params) {
  switch (method) {
    case 'navigate': {
      let tab = await getUsableTab();
      // If active tab is chrome://, create a new tab instead
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
        tab = await chrome.tabs.create({ url: params.url });
      } else {
        await chrome.tabs.update(tab.id, { url: params.url });
      }
      // Wait for navigation to complete
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
      const updated = await chrome.tabs.get(tab.id);
      return { title: updated.title, url: updated.url };
    }

    case 'get_page_content': {
      const tab = await getUsableTab();
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
      const tab = await getUsableTab();
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
      const tab = await getUsableTab();
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot execute scripts on chrome:// pages');
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: new Function('return (' + params.code + ')'),
        world: 'MAIN',
      });
      return { result: result.result };
    }

    case 'click': {
      const tab = await getUsableTab();
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
      const tab = await getUsableTab();
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
      const tab = await getUsableTab();
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
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.map(t => ({ id: t.id, url: t.url, title: t.title, active: t.active })) };
    }

    case 'get_cookies': {
      const cookies = await chrome.cookies.getAll({ domain: params.domain });
      return { cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path })) };
    }

    case 'get_local_storage': {
      const tab = await getUsableTab();
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot access chrome:// pages');
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (key) => key ? localStorage.getItem(key) : JSON.stringify(Object.fromEntries(Object.entries(localStorage))),
        args: [params.key || null],
      });
      return { value: result.result };
    }

    case 'ask_user': {
      const tab = await getUsableTab();
      const timeout = params.timeout || 120000;
      const fields = params.fields || []; // [{label, name, type}]
      const hasFields = fields.length > 0;

      // Change badge to alert state + send notification BEFORE overlay
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
      const notifId = 'mcp-ask-' + Date.now();
      chrome.notifications.create(notifId, {
        type: 'basic',
        iconUrl: 'icons/icon-128.png',
        title: params.title || 'Agent360 — Action Required',
        message: params.message,
        priority: 2,
      });

      // Inject overlay dialog into the page
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (message, title, fields, hasFields, timeout) => {
          return new Promise((resolve) => {
            // Remove any existing overlay
            document.getElementById('a360-overlay')?.remove();

            const overlay = document.createElement('div');
            overlay.id = 'a360-overlay';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,sans-serif';

            const card = document.createElement('div');
            card.style.cssText = 'background:#1e293b;border-radius:12px;padding:24px;max-width:420px;width:90%;color:#e2e8f0;box-shadow:0 20px 60px rgba(0,0,0,0.5)';

            const h = document.createElement('div');
            h.style.cssText = 'font-size:14px;font-weight:600;color:#3b82f6;margin-bottom:12px';
            h.textContent = title || 'Agent360 — Action Required';
            card.appendChild(h);

            const msg = document.createElement('div');
            msg.style.cssText = 'font-size:13px;color:#cbd5e1;margin-bottom:16px;line-height:1.5';
            msg.textContent = message;
            card.appendChild(msg);

            // Input fields (if any)
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

            // Buttons
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:8px;margin-top:16px';

            const doneBtn = document.createElement('button');
            doneBtn.textContent = hasFields ? 'Submit' : '✓ Done';
            doneBtn.style.cssText = 'flex:1;padding:8px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:500';
            doneBtn.addEventListener('click', () => {
              const values = {};
              Object.entries(inputs).forEach(([k, el]) => values[k] = el.value);
              overlay.remove();
              resolve({ acknowledged: true, action: 'done', values });
            });

            const skipBtn = document.createElement('button');
            skipBtn.textContent = '✗ Skip';
            skipBtn.style.cssText = 'flex:1;padding:8px;background:#334155;color:#94a3b8;border:none;border-radius:6px;font-size:13px;cursor:pointer';
            skipBtn.addEventListener('click', () => {
              overlay.remove();
              resolve({ acknowledged: true, action: 'skip', values: {} });
            });

            btnRow.appendChild(doneBtn);
            btnRow.appendChild(skipBtn);
            card.appendChild(btnRow);
            overlay.appendChild(card);
            document.body.appendChild(overlay);

            // Auto-focus first input
            const firstInput = Object.values(inputs)[0];
            if (firstInput) setTimeout(() => firstInput.focus(), 100);

            // Enter key submits
            card.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') doneBtn.click();
            });

            // Timeout
            setTimeout(() => {
              if (document.getElementById('a360-overlay')) {
                overlay.remove();
                resolve({ acknowledged: false, action: 'timeout', values: {} });
              }
            }, timeout);
          });
        },
        args: [params.message, params.title, fields, hasFields, timeout],
        world: 'MAIN',
      });

      // Restore badge + clear notification
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
      chrome.notifications.clear(notifId);

      return result.result;
    }

    case 'select_frame': {
      // Execute script in a specific iframe by index or selector
      const tab = await getUsableTab();
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
      const tab = await getUsableTab();
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      return { frames: frames?.map((f, i) => ({ index: i, url: f.url, frame_id: f.frameId, parent_frame_id: f.parentFrameId })) || [] };
    }

    case 'get_new_tab': {
      // Get the most recently created tab (useful after OAuth redirects / popups)
      if (!lastCreatedTabId) return { error: 'No new tab detected' };
      try {
        const tab = await chrome.tabs.get(lastCreatedTabId);
        return { id: tab.id, url: tab.url, title: tab.title };
      } catch {
        return { error: 'Tab no longer exists' };
      }
    }

    case 'switch_tab': {
      // Activate a specific tab by ID
      const tab = await chrome.tabs.update(params.tab_id, { active: true });
      return { id: tab.id, url: tab.url, title: tab.title };
    }

    default:
      throw new Error('Unknown method: ' + method);
  }
}

// ── Start ───────────────────────────────────────────────────────────────────
ensureOffscreen().catch(console.error);

// Re-ensure offscreen when service worker wakes
chrome.runtime.onStartup.addListener(() => ensureOffscreen().catch(console.error));
chrome.runtime.onInstalled.addListener(() => ensureOffscreen().catch(console.error));

// Backup: alarm re-creates offscreen if it died
chrome.alarms.create('ensure-offscreen', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'ensure-offscreen') {
    ensureOffscreen().catch(console.error);
  }
});
