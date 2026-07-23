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
// FIX-2: promise-cache latch (not a boolean). The old `if(sessionsLoaded) return`
// flipped the flag BEFORE awaiting storage, so a second concurrent caller on a freshly
// woken service worker proceeded against an EMPTY sessions Map. Caching the promise makes
// every concurrent caller await the SAME populated completion. Resets to null on SW
// eviction (module re-init) and on error, so the next wake retries.
let restorePromise = null;

// Restore sessions from storage (service workers lose in-memory state on suspend)
function restoreSessions() {
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
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
  })().catch(err => { restorePromise = null; throw err; });
  return restorePromise;
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

// LRU eviction cap: hver session må højst have N åbne tabs samtidigt.
// Når en ny tab tilføjes ud over cap'en, lukkes den ÆLDSTE tab i sessionen
// (insertion-order via Set) — bortset fra session.activeTabId (current tab).
// Begrundelse: Claude Code-flows kan åbne 20+ navigate(new_tab=true) per session
// over en længere conversation. Uden eviction akkumulerer disse i Chrome som
// orphan-tabs der spiser RAM + giver "extension localhost 19+" tab-noise.
const MAX_TABS_PER_SESSION = 10;

async function evictOldestTabs(session, justAddedTabId) {
  // Drop dead tab-ids først (user manually closed dem)
  for (const id of [...session.tabIds]) {
    try {
      await chrome.tabs.get(id);
    } catch {
      session.tabIds.delete(id);
    }
  }
  // Evict oldest indtil ≤ cap. Skip activeTabId og just-added tab.
  const ordered = [...session.tabIds];
  for (const oldId of ordered) {
    if (session.tabIds.size <= MAX_TABS_PER_SESSION) break;
    if (oldId === session.activeTabId) continue;
    if (oldId === justAddedTabId) continue;
    try {
      await chrome.tabs.remove(oldId);
    } catch {} // tab may already be closed
    session.tabIds.delete(oldId);
  }
}

async function addTabToSession(port, tabId) {
  const session = getSession(port);
  session.tabIds.add(tabId);

  // LRU eviction: når sessionen overstiger cap, luk de ældste tabs.
  if (session.tabIds.size > MAX_TABS_PER_SESSION) {
    await evictOldestTabs(session, tabId);
  }

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
  // Remember our OWN about:blank placeholder so we reuse it instead of spawning another
  // on every read-only call before the first navigate (FIX-4: about:blank proliferation).
  let blankFallback = null;
  const consider = (tab) => {
    if (!tab) return false;
    if (tab.url.startsWith('chrome://')) return false;
    if (tab.url.startsWith('about:')) { if (!blankFallback) blankFallback = tab; return false; }
    return true;
  };

  // Prefer the active (last navigated) tab
  if (session.activeTabId) {
    try {
      const tab = await chrome.tabs.get(session.activeTabId);
      if (consider(tab)) target = tab;
    } catch {
      const dead = session.activeTabId;   // FIX-17: capture id BEFORE nulling (was deleting null)
      session.activeTabId = null;
      session.tabIds.delete(dead);
    }
  }

  // Fallback: any usable session tab
  if (!target) {
    for (const tabId of session.tabIds) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (consider(tab)) { session.activeTabId = tabId; target = tab; break; }
      } catch {
        session.tabIds.delete(tabId);
      }
    }
  }

  // Reuse our own blank placeholder rather than spawning yet another one (FIX-4).
  if (!target && blankFallback) {
    target = blankFallback;
    session.activeTabId = target.id;
    persistSessions();
  }

  // No usable tab at all — create ONE placeholder and pin it as the active tab so the
  // NEXT call reuses it (FIX-4) instead of creating a fresh about:blank every time.
  if (!target) {
    target = await chrome.tabs.create({ url: 'about:blank', active: false });
    await addTabToSession(port, target.id);
    session.activeTabId = target.id;
    persistSessions();
    // fall through to the activate branch (SC-3: previously returned early, skipping it)
  }

  // Activate the tab WITHOUT stealing the user's focus (FIX-1). This is a BACKGROUND tool:
  // screenshot/press_key run constantly, so we must NOT chrome.windows.update({focused:true})
  // here — that yanked Chrome to the foreground on every action. We only (a) un-minimize a
  // minimized window (needed so it can composite) and (b) make the tab active within its
  // window. The truly-occluded (covered) case is handled as a bounded last-resort
  // raise-and-restore inside the screenshot handler only.
  if (activate) {
    try {
      if (target.windowId != null) {
        const win = await chrome.windows.get(target.windowId).catch(() => null);
        if (win && win.state === 'minimized') {
          await chrome.windows.update(target.windowId, { state: 'normal' }); // no focused:true
        }
      }
      if (!target.active) await chrome.tabs.update(target.id, { active: true });
      await new Promise(r => setTimeout(r, 150));
      target = await chrome.tabs.get(target.id);
    } catch { /* best-effort; capture path surfaces the real error */ }
  }

  return target;
}

// ── Chrome Debugger API Helpers (CSP-bypass for Google, Stripe, Slack) ─────

// Track which tabs have debugger attached to avoid repeated attach/detach
const debuggerAttached = new Set();

// Verify Chrome's actual debugger-truth before trusting local cache.
// Fixes "ghost-attached" state where Set says attached but Chrome side is gone
// (happens on SW lifecycle events, user-canceled banners, anti-automation evictions).
async function verifyAttachedWithChrome(tabId) {
  try {
    const targets = await chrome.debugger.getTargets();
    const t = targets.find(x => x.tabId === tabId);
    return !!t?.attached;
  } catch {
    return false; // assume not-attached on API error
  }
}

async function debuggerAttach(tabId) {
  // First check local cache — fast path
  if (debuggerAttached.has(tabId)) {
    // Verify with Chrome before trusting cache (cheap, ~1ms)
    if (await verifyAttachedWithChrome(tabId)) return;
    // Cache was stale — Chrome doesn't actually have us attached
    debuggerAttached.delete(tabId);
  }

  // Up to 3 attempts. A "ghost attach" (attach resolves but getTargets shows the tab
  // NOT attached) is usually TRANSIENT: the page is mid-navigation/reload — e.g. the
  // Metro dev-server rebuilding localhost:8081 auto-detaches the debugger. Retrying
  // after a short delay lets the reload settle. Only a ghost that survives all retries
  // is a real user-canceled banner. (Previously we threw on the first ghost, which made
  // dev-server URLs unusable during their initial bundle.)
  let lastMsg = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      if (await verifyAttachedWithChrome(tabId)) {
        debuggerAttached.add(tabId);
        return;
      }
      // Ghost — detach cleanly so the next attempt starts fresh, then retry.
      lastMsg = 'attach resolved but Chrome shows tab not attached (ghost — page likely mid-reload)';
      try { await chrome.debugger.detach({ tabId }); } catch {}
    } catch (e) {
      if (e.message?.includes('Already attached')) {
        // Chrome side has session — sync local cache
        debuggerAttached.add(tabId);
        return;
      }
      // "Cannot attach"/"canceled" can also be transient during navigation — retry too.
      lastMsg = e.message || String(e);
    }
    if (attempt < 2) await new Promise(r => setTimeout(r, 250 + attempt * 250));
  }
  throw new Error(
    `Debugger attach failed after 3 attempts (tab ${tabId}). Last: ${lastMsg}. ` +
    `If persistent: the page may be continuously reloading (dev-server mid-build — wait, then retry), ` +
    `or the user canceled Chrome's debugger banner — reload Browser MCP (chrome://extensions/ → ↻) or restart Chrome.`
  );
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

// Sync local Set when Chrome auto-detaches (navigation, idle, devtools opened, etc.)
chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId) {
    debuggerAttached.delete(source.tabId);
    if (reason && reason !== 'target_closed') {
      console.log(`[MCP] Debugger auto-detached from tab ${source.tabId} (reason: ${reason})`);
    }
  }
});

// Methods that are safe to retry without double-effect.
// Side-effectful methods (Input.*, DOM.setFileInputFiles) must NEVER auto-retry:
// Chrome may detach AFTER processing the input (e.g., keystroke triggered navigation),
// and a blind retry would double-type or double-click.
const RETRYABLE_CDP_METHODS = new Set([
  'DOM.getDocument',
  'DOM.querySelector',
  'DOM.querySelectorAll',
  'DOM.focus',
  'DOM.describeNode',
  'Runtime.evaluate',
  'Runtime.enable',
  'Page.captureScreenshot',
  'Page.enable',
  'Network.enable',
  'Network.disable',
  'Network.getResponseBody',
]);

// CDP wrapper with auto-recovery: re-attaches on detach errors.
// For read-only methods (whitelist above), retries once after re-attach.
// For side-effectful methods, only re-attaches and throws — caller must decide.
async function cdpSend(tabId, method, params = {}) {
  await debuggerAttach(tabId);
  let lastMsg = '';
  // 4 total attempts (initial + 3 retries) for read-only methods; backoff 100/300/500ms.
  // Handles aggressive auto-detach on anti-automation sites (Apple ASC, Salesforce, etc.)
  // where Chrome re-detaches between attach and command execution.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await chrome.debugger.sendCommand({ tabId }, method, params);
    } catch (e) {
      const msg = e?.message || String(e);
      const isDetachError =
        msg.includes('not attached') ||
        msg.includes('Detached') ||
        msg.includes('detached') ||
        msg.includes('Debugger is gone') ||
        msg.includes('No tab with given id');
      if (!isDetachError) throw e;
      lastMsg = msg;
      debuggerAttached.delete(tabId);
      if (!RETRYABLE_CDP_METHODS.has(method)) {
        // Side-effectful methods (Input.*) — re-attach for next caller but signal
        // to handler so it can fall back to chrome.scripting (e.g., synthetic click).
        try { await debuggerAttach(tabId); } catch {}
        throw new Error(`Debugger detached during ${method} — not auto-retried (side-effect risk). Original: ${msg}`);
      }
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 100 + attempt * 200));
        try { await debuggerAttach(tabId); } catch (attachErr) {
          throw new Error(`Re-attach failed during ${method}: ${attachErr.message}`);
        }
      }
    }
  }
  throw new Error(`Debugger detached repeatedly during ${method} (4 attempts). Last: ${lastMsg}`);
}

// Clean up debugger + session refs when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  debuggerAttached.delete(tabId);
  for (const [port, session] of sessions) {
    if (!session.tabIds.has(tabId)) continue;
    session.tabIds.delete(tabId);
    if (session.tabIds.size === 0) {
      // Last tab closed — tell offscreen to terminate the MCP server.
      // Resulting WS-close triggers the existing session_disconnect → releaseSession path.
      chrome.runtime.sendMessage({ type: 'terminate_mcp_session', port }).catch(() => {});
    } else {
      persistSessions();
    }
  }
});

async function debuggerType(tabId, text) {
  await debuggerAttach(tabId);
  try {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      await cdpSend(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        text: char,
        key: char,
        code: `Key${char.toUpperCase()}`,
        unmodifiedText: char,
      });
      await cdpSend(tabId, 'Input.dispatchKeyEvent', {
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
    // 0. Capture the DEEPEST target element under the point BEFORE dispatching.
    //    Web-components (Google Ads <button-panel>, Material Web) keep their real
    //    <button> inside an (open) shadow root, so we pierce shadow roots to reach
    //    it. We stash it on window so the framework fallback (step 3) can verify it
    //    is still connected — if the trusted click already navigated/re-rendered,
    //    the ref is detached and we must NOT re-fire (avoids mis-clicks on the new
    //    view / double-submits).
    await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        let el = document.elementFromPoint(${x}, ${y});
        let host = el;
        for (let i = 0; i < 20 && host && host.shadowRoot; i++) {
          const inner = host.shadowRoot.elementFromPoint(${x}, ${y});
          if (!inner || inner === host) break;
          el = inner; host = inner;
        }
        window.__bmcpClickTarget = el || null;
        // FIX-13: watch whether the trusted click (step 2) actually lands on the target,
        // so step 3's framework-fallback does NOT double-fire on elements that stay
        // connected (toggles, checkboxes, add-to-cart, form fields).
        window.__bmcpClicked = false;
        try { window.__bmcpClickListener && document.removeEventListener('click', window.__bmcpClickListener, true); } catch (e) {}
        window.__bmcpClickListener = (ev) => {
          try {
            const t = ev.target;
            if (el && (t === el || el.contains(t) || (ev.composedPath && ev.composedPath().includes(el)))) {
              window.__bmcpClicked = true;
            }
          } catch (e) {}
        };
        document.addEventListener('click', window.__bmcpClickListener, true);
      })()`,
    });
    // 1. mouseMoved first (triggers hover state, required by some frameworks)
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y,
    });
    await new Promise(r => setTimeout(r, 30));
    // 2. mousePressed + mouseReleased. The `buttons` bitmask (1 while pressed,
    //    0 on release) plus a small press→release gap are REQUIRED for Chrome to
    //    synthesize a *trusted* 'click' from the pair. Without them, web-components
    //    that gate on the trusted click event (Google Ads, Material Web) never fire.
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1,
    });
    await new Promise(r => setTimeout(r, 30));
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1,
    });
    // 3. Framework fallback — only if the captured target is STILL connected (i.e.
    //    the trusted click in step 2 did not already handle it). Settle delay lets
    //    SPA re-renders (Google Ads) detach the element first. Fires a full pointer
    //    + mouse sequence on the shadow-pierced target, then React/Angular handlers.
    await new Promise(r => setTimeout(r, 120));
    await cdpSend(tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const el = window.__bmcpClickTarget;
        const landed = window.__bmcpClicked === true;
        try { window.__bmcpClickListener && document.removeEventListener('click', window.__bmcpClickListener, true); } catch (e) {}
        try { delete window.__bmcpClickTarget; delete window.__bmcpClicked; delete window.__bmcpClickListener; } catch (e) {}
        if (landed) return;                   // FIX-13: trusted click already landed — do NOT double-fire
        if (!el || !el.isConnected) return;   // already navigated/handled — don't double-fire
        const opts = { bubbles: true, cancelable: true, composed: true, view: window, clientX: ${x}, clientY: ${y} };
        try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        if (typeof el.click === 'function') el.click();

        // React fiber fallback — find and call onClick handler directly
        const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (fiberKey) {
          let fiber = el[fiberKey];
          for (let i = 0; i < 10 && fiber; i++) {
            if (fiber.memoizedProps?.onClick) { fiber.memoizedProps.onClick(new MouseEvent('click', {bubbles:true})); break; }
            fiber = fiber.return;
          }
        }

        // Angular Material fallback — ripple + internal handlers
        const ngKey = Object.keys(el).find(k => k.startsWith('__ng'));
        if (ngKey || el.getAttribute('ng-click') || el.getAttribute('(click)')) {
          const matRipple = el.closest && el.closest('[mat-button], [mat-raised-button], [mat-icon-button], [mat-fab], mat-checkbox, mat-slide-toggle, mat-radio-button');
          if (matRipple) matRipple.dispatchEvent(new MouseEvent('click', opts));
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
    const { root } = await cdpSend(tabId, 'DOM.getDocument', {});
    const { nodeId } = await cdpSend(tabId, 'DOM.querySelector', {
      nodeId: root.nodeId, selector,
    });
    if (!nodeId) throw new Error('Element not found: ' + selector);
    await cdpSend(tabId, 'DOM.focus', { nodeId });
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
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2,
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'a', code: 'KeyA',
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Backspace', code: 'Backspace',
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
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
    const result = await cdpSend(tabId, 'Runtime.evaluate', {
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

// Synthetic click via chrome.scripting — fallback when debugger detaches on
// anti-automation sites (Apple ASC, etc.). Loses isTrusted=true but works for
// the ~95% of sites that don't check it. Handles text= and :text() selectors.
async function scriptingClick(tabId, selector) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (sel) => {
        let el;
        if (sel.startsWith('text=')) {
          const text = sel.slice(5).trim();
          el = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="tab"], [role="option"], input, label, span, div, p, li, td'))
            .find(e => (e.textContent || '').trim() === text);
        } else {
          const m = sel.match(/^([\w-]+):text\(([^)]+)\)$/);
          if (m) {
            const needle = m[2].trim();
            el = Array.from(document.querySelectorAll(m[1]))
              .find(e => (e.textContent || '').trim().includes(needle));
          } else {
            el = document.querySelector(sel);
          }
        }
        if (!el) return { ok: false, reason: 'not_found' };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.click();
        return { ok: true, tag: el.tagName };
      },
      args: [selector],
    });
    return result?.result || { ok: false, reason: 'no_result' };
  } catch (e) {
    return { ok: false, reason: 'exception', error: e.message };
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
  const wantTag = tagFilter ? JSON.stringify(tagFilter.toUpperCase()) : 'null';
  return `(function() {
    const text = ${escaped};
    const wantTag = ${wantTag};
    // Interactive controls we prefer to actually click. Fixes the class of bug where a
    // text match lands on a large CONTAINER (e.g. Angular Material <mat-nav-list>,
    // toolbar, list-item) whose center is NOT over the real <button> — so the trusted
    // click misses and menus/dropdowns never open.
    const CLICKABLE = 'a,button,summary,label,[role="button"],[role="menuitem"],' +
      '[role="menuitemcheckbox"],[role="menuitemradio"],[role="option"],[role="tab"],' +
      '[role="link"],[role="checkbox"],[role="radio"],[role="switch"],[onclick],' +
      '[mat-button],[mat-raised-button],[mat-stroked-button],[mat-flat-button],' +
      '[mat-icon-button],[mat-fab],[mat-mini-fab],[mat-menu-item],[mat-list-item],' +
      'mat-checkbox,mat-slide-toggle,mat-radio-button';
    function collectAll(root, results) {
      for (const el of root.querySelectorAll('*')) {
        results.push(el);
        if (el.shadowRoot) collectAll(el.shadowRoot, results);
      }
      return results;
    }
    const all = collectAll(document, []);
    const tagOk = (el) => !wantTag || el.tagName === wantTag;
    // Map a matched element to the ACTIONABLE control: itself if clickable, else the
    // nearest clickable ancestor (only if its own text isn't much larger than the match,
    // so we don't grab a whole toolbar), else a clickable descendant.
    function toClickable(el) {
      if (el.matches && el.matches(CLICKABLE)) return el;
      const anc = el.closest && el.closest(CLICKABLE);
      if (anc && (anc.textContent || '').trim().length <= text.length + 40) return anc;
      const desc = el.querySelector && el.querySelector(CLICKABLE);
      if (desc) return desc;
      return el;
    }
    function pick(test) {
      const matches = all.filter(el => tagOk(el) && test((el.textContent || '').trim()));
      if (!matches.length) return null;
      // Prefer the INNERMOST matches (an element that is not an ancestor of another
      // match) — this is what "prefer leaf nodes" was supposed to do.
      const inner = matches.filter(el => !matches.some(o => o !== el && el.contains && el.contains(o)));
      const pool = inner.length ? inner : matches;
      // Prefer a match that resolves to a real interactive control.
      for (const el of pool) {
        const c = toClickable(el);
        if (c && c.matches && c.matches(CLICKABLE)) return c;
      }
      return toClickable(pool[0]);
    }
    // Exact match first, then partial fallback.
    return pick(t => t === text) || pick(t => t && t.includes(text));
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

// ── Date Input Helpers ──────────────────────────────────────────────────────

const MONTHS_EN = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTHS_DA = ['januar','februar','marts','april','maj','juni','juli','august','september','oktober','november','december'];
const MONTHS_ABBR_EN = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function parsePlaceholderFormat(placeholder) {
  if (!placeholder) return null;
  const upper = placeholder.toUpperCase();
  let sep = null;
  if (upper.includes('/')) sep = '/';
  else if (upper.includes('-')) sep = '-';
  else if (upper.includes('.')) sep = '.';
  else return null;
  const parts = upper.split(sep);
  if (parts.length !== 3) return null;
  const order = parts.map(p => p.includes('Y') ? 'Y' : p.includes('M') ? 'M' : p.includes('D') ? 'D' : null);
  if (order.includes(null) || new Set(order).size !== 3) return null;
  const padded = parts.map(p => p.length >= 2);
  return { sep, order, padded };
}

function isoToFormat(iso, fmt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error('Invalid ISO date: ' + iso);
  const [, y, mo, d] = m;
  return fmt.order.map((slot, i) => {
    if (slot === 'Y') return y;
    if (slot === 'M') return fmt.padded[i] ? mo : String(parseInt(mo, 10));
    if (slot === 'D') return fmt.padded[i] ? d : String(parseInt(d, 10));
  }).join(fmt.sep);
}

function parseMonthYearText(text) {
  if (!text) return null;
  const cleaned = text.toLowerCase().trim();
  const tables = [MONTHS_EN, MONTHS_DA, MONTHS_ABBR_EN];
  for (const table of tables) {
    for (let i = 0; i < table.length; i++) {
      if (cleaned.includes(table[i])) {
        const ym = cleaned.match(/(\d{4})/);
        if (ym) return { year: parseInt(ym[1], 10), month: i + 1 };
      }
    }
  }
  const num = cleaned.match(/(\d{1,2})[\/\-\s.](\d{4})/);
  if (num) return { year: parseInt(num[2], 10), month: parseInt(num[1], 10) };
  return null;
}

function valueLooksLikeIso(value, iso) {
  if (!value || !iso) return false;
  const [y, m, d] = iso.split('-');
  const digits = value.replace(/\D/g, '');
  if (digits.includes(y + m + d)) return true;
  if (digits.includes(m + d + y)) return true;
  if (digits.includes(d + m + y)) return true;
  const hasYear = value.includes(y);
  const hasMonth = value.includes(m) || value.includes(String(parseInt(m, 10)));
  const hasDay = value.includes(d) || value.includes(String(parseInt(d, 10)));
  return hasYear && hasMonth && hasDay;
}

async function getDateInputInfo(tabId, selector) {
  const json = await debuggerEval(tabId, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ found: false });
    return JSON.stringify({
      found: true,
      tag: el.tagName,
      inputType: (el.type || '').toLowerCase(),
      readOnly: !!el.readOnly,
      disabled: !!el.disabled,
      placeholder: el.placeholder || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      value: el.value !== undefined ? el.value : (el.textContent || ''),
    });
  })()`);
  return JSON.parse(json);
}

async function readBackValue(tabId, selector) {
  const json = await debuggerEval(tabId, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return JSON.stringify({ value: null });
    return JSON.stringify({ value: el.value !== undefined ? el.value : (el.textContent || '') });
  })()`);
  return JSON.parse(json).value;
}

async function setDateNative(tabId, selector, iso) {
  const r = await safeExecuteScript(tabId, (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, error: 'not-found' };
    try {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, val); else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return { ok: true, value: el.value };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, [selector, iso]);
  if (r.cspBlocked) {
    await debuggerEval(tabId, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(iso)}); else el.value = ${JSON.stringify(iso)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    })()`);
    return { ok: true, csp: true };
  }
  return r.result || { ok: false, error: 'no-result' };
}

async function setDateMaskedTyping(tabId, selector, iso, format) {
  const formatted = isoToFormat(iso, format);
  await debuggerFocus(tabId, selector);
  await debuggerAttach(tabId);
  try {
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2,
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'a', code: 'KeyA',
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Backspace', code: 'Backspace',
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Backspace', code: 'Backspace',
    });
    await cdpSend(tabId, 'Input.insertText', { text: formatted });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Tab', code: 'Tab',
    });
    await cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Tab', code: 'Tab',
    });
  } finally {
    await debuggerDetach(tabId);
  }
  return { ok: true, formatted };
}

const PICKER_OPEN_SELECTORS = [
  '[role="dialog"] [role="grid"]',
  '[role="dialog"] [role="gridcell"]',
  '.react-datepicker',
  '.MuiPickersPopper-root',
  '.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
  '[class*="DayPicker"]:not(input)',
  '[class*="Calendar"][class*="open" i]',
];

async function isPickerOpen(tabId) {
  return await debuggerEval(tabId, `(() => {
    const sels = ${JSON.stringify(PICKER_OPEN_SELECTORS)};
    for (const s of sels) {
      try { if (document.querySelector(s)) return true; } catch {}
    }
    return false;
  })()`);
}

async function getPickerRoot(tabId) {
  return await debuggerEval(tabId, `(() => {
    const sels = ${JSON.stringify(PICKER_OPEN_SELECTORS)};
    for (const s of sels) {
      try {
        const el = document.querySelector(s);
        if (el) {
          const root = el.closest('[role="dialog"], .react-datepicker, .MuiPickersPopper-root, .ant-picker-dropdown') || el;
          // Return a stable selector path — for runtime use we re-query each time
          return true;
        }
      } catch {}
    }
    return false;
  })()`);
}

async function setDatePicker(tabId, selector, iso) {
  const [yStr, mStr, dStr] = iso.split('-');
  const targetYear = parseInt(yStr, 10);
  const targetMonth = parseInt(mStr, 10);
  const targetDay = parseInt(dStr, 10);

  const inputEl = await resolveElement(tabId, selector);
  if (!inputEl) return { ok: false, error: 'input-not-found' };
  await debuggerClick(tabId, inputEl.x, inputEl.y);

  let opened = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 100));
    if (await isPickerOpen(tabId)) { opened = true; break; }
  }

  if (!opened) {
    const triggerClicked = await safeExecuteScript(tabId, (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const candidates = [
        ...(el.parentElement?.querySelectorAll('button, [role="button"], [aria-haspopup]') || []),
        ...(el.parentElement?.parentElement?.querySelectorAll('button, [role="button"], [aria-haspopup]') || []),
      ];
      for (const c of candidates) {
        const label = (c.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('calendar') || label.includes('date') || label.includes('vælg dato') || label.includes('open') || label.includes('åbn')) {
          c.click();
          return true;
        }
      }
      for (const c of candidates) {
        if (c.querySelector('svg, [class*="calendar" i]')) {
          c.click();
          return true;
        }
      }
      return false;
    }, [selector]);
    if (triggerClicked.result) {
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 100));
        if (await isPickerOpen(tabId)) { opened = true; break; }
      }
    }
  }

  if (!opened) return { ok: false, error: 'picker-did-not-open' };

  const MAX_NAV = 36;
  let navAttempts = 0;
  let lastHeader = null;
  let stuck = 0;
  let navExitReason = 'reached-target';
  let lastReachedMonthYear = null;
  for (let i = 0; i < MAX_NAV; i++) {
    const headerJson = await debuggerEval(tabId, `(() => {
      const roots = [
        document.querySelector('[role="dialog"]'),
        document.querySelector('.react-datepicker'),
        document.querySelector('.MuiPickersPopper-root'),
        document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'),
      ].filter(Boolean);
      for (const root of roots) {
        const candidates = [
          root.querySelector('[role="heading"]'),
          root.querySelector('[aria-live]'),
          root.querySelector('.MuiPickersCalendarHeader-label'),
          root.querySelector('.react-datepicker__current-month'),
          root.querySelector('.ant-picker-header-view'),
        ].filter(Boolean);
        for (const el of candidates) {
          const t = (el.textContent || '').trim();
          if (t.length > 0 && t.length < 80) return JSON.stringify({ text: t });
        }
      }
      return JSON.stringify({});
    })()`);
    const header = JSON.parse(headerJson);
    const parsed = parseMonthYearText(header.text || '');
    if (!parsed) {
      navExitReason = header.text ? 'header-parse-failed' : 'no-header-found';
      break;
    }
    lastReachedMonthYear = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;

    if (header.text === lastHeader) {
      stuck++;
      if (stuck >= 3) { navExitReason = 'navigation-stuck'; break; }
    } else {
      stuck = 0;
      lastHeader = header.text;
    }

    const delta = (targetYear * 12 + targetMonth) - (parsed.year * 12 + parsed.month);
    if (delta === 0) break;
    if (i === MAX_NAV - 1) {
      navExitReason = 'max-nav-exceeded';
    }

    const dir = delta > 0 ? 'next' : 'prev';
    const navClicked = await safeExecuteScript(tabId, (direction) => {
      const roots = [
        document.querySelector('[role="dialog"]'),
        document.querySelector('.react-datepicker'),
        document.querySelector('.MuiPickersPopper-root'),
        document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'),
      ].filter(Boolean);
      const labels = direction === 'next'
        ? ['next month', 'next', 'forward', 'næste']
        : ['previous month', 'previous', 'prev', 'back', 'forrige'];
      const classFallbacks = direction === 'next'
        ? ['.react-datepicker__navigation--next', '.ant-picker-header-next-btn', '.ant-picker-header-super-next-btn']
        : ['.react-datepicker__navigation--previous', '.ant-picker-header-prev-btn', '.ant-picker-header-super-prev-btn'];
      for (const root of roots) {
        const buttons = [...root.querySelectorAll('button, [role="button"]')];
        for (const b of buttons) {
          const label = (b.getAttribute('aria-label') || b.title || '').toLowerCase();
          if (labels.some(l => label.includes(l))) { b.click(); return true; }
        }
        for (const cs of classFallbacks) {
          const b = root.querySelector(cs);
          if (b) { b.click(); return true; }
        }
      }
      return false;
    }, [dir]);

    if (!navClicked.result) {
      await debuggerAttach(tabId);
      try {
        const key = delta > 0 ? 'PageDown' : 'PageUp';
        await cdpSend(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key, code: key,
        });
        await cdpSend(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key, code: key,
        });
      } finally {
        await debuggerDetach(tabId);
      }
    }
    navAttempts++;
    await new Promise(r => setTimeout(r, 90));
  }

  const dayResult = await safeExecuteScript(tabId, (day, year, month, monthsEn, monthsDa, monthsAbbr) => {
    const roots = [
      document.querySelector('[role="dialog"]'),
      document.querySelector('.react-datepicker'),
      document.querySelector('.MuiPickersPopper-root'),
      document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)'),
    ].filter(Boolean);
    const monthEn = monthsEn[month - 1];
    const monthDa = monthsDa[month - 1];
    const monthAbbr = monthsAbbr[month - 1];

    for (const root of roots) {
      const cells = [...root.querySelectorAll('[role="gridcell"], .react-datepicker__day, .ant-picker-cell, [class*="PickersDay"]')];
      const isDisabled = (c) => c.getAttribute('aria-disabled') === 'true' ||
        c.classList.contains('disabled') ||
        c.classList.contains('react-datepicker__day--disabled') ||
        c.classList.contains('ant-picker-cell-disabled') ||
        c.classList.contains('Mui-disabled');
      const isOutside = (c) => {
        const cls = c.className || '';
        if (/outside|other-month|--prev|--next|adjacent/i.test(cls)) return true;
        if (c.classList.contains('react-datepicker__day--outside-month')) return true;
        if (c.classList.contains('ant-picker-cell') && !c.classList.contains('ant-picker-cell-in-view')) return true;
        return false;
      };

      for (const c of cells) {
        if (isDisabled(c) || isOutside(c)) continue;
        const label = (c.getAttribute('aria-label') || '').toLowerCase();
        if (!label) continue;
        const matchesMonth = label.includes(monthEn) || label.includes(monthDa) || label.includes(monthAbbr);
        const matchesYear = label.includes(String(year));
        const dayPattern = new RegExp('\\b' + day + '(st|nd|rd|th)?\\b');
        const dayPaddedPattern = new RegExp('\\b' + String(day).padStart(2, '0') + '\\b');
        if (matchesMonth && matchesYear && (dayPattern.test(label) || dayPaddedPattern.test(label))) {
          c.click();
          return { ok: true, method: 'aria-label', label };
        }
      }

      for (const c of cells) {
        if (isDisabled(c) || isOutside(c)) continue;
        const text = (c.textContent || '').trim();
        if (text === String(day) || text === String(day).padStart(2, '0')) {
          c.click();
          return { ok: true, method: 'text-content' };
        }
      }
    }
    return { ok: false, error: 'day-not-found' };
  }, [targetDay, targetYear, targetMonth, MONTHS_EN, MONTHS_DA, MONTHS_ABBR_EN]);

  if (!dayResult.result || !dayResult.result.ok) {
    return {
      ok: false,
      error: dayResult.result?.error || 'day-click-failed',
      navAttempts,
      navExitReason,
      lastReachedMonthYear,
      targetMonthYear: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
    };
  }

  await new Promise(r => setTimeout(r, 350));
  return { ok: true, method: dayResult.result.method, navAttempts };
}

async function collectVisibleErrors(tabId, selector) {
  const json = await debuggerEval(tabId, `(() => {
    const errs = [];
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el?.getAttribute('aria-invalid') === 'true') errs.push('aria-invalid=true on input');
    const candidates = [
      ...document.querySelectorAll('[role="alert"], .error-text, [class*="error" i]:not(input):not(button)'),
    ].slice(0, 8);
    for (const c of candidates) {
      const t = (c.textContent || '').trim();
      if (t && t.length < 200 && c.offsetHeight > 0) errs.push(t);
    }
    return JSON.stringify(errs);
  })()`);
  try { return JSON.parse(json); } catch { return []; }
}

// ── Overlay Dismissal Helper ────────────────────────────────────────────────

async function dismissOverlays(tabId, scope = 'non_critical', maxPasses = 3) {
  // Clamp to sensible range; reject sloppy input
  const passes = Math.max(1, Math.min(10, Number.isInteger(maxPasses) ? maxPasses : 3));
  const allDismissed = [];
  const allSkipped = [];

  for (let pass = 0; pass < passes; pass++) {
    const r = await safeExecuteScript(tabId, (s) => {
      const dismissed = [];
      const skipped = [];

      // "Safe" texts cannot revert form data — they're purely informational close affordances
      const safeTexts = [
        "luk", "dismiss", "close", "got it", "got it, thanks",
        "not now", "ikke nu", "senere", "later",
        "don't show", "don't show again", "dont show again", "dont show",
        "no thanks", "maybe later", "ok", "ok!", "okay",
      ];
      // "Ambiguous" texts MAY revert partial form data ("Cancel" usually reverts state)
      // — only used when overlay has no editable form fields, or in aggressive scope
      const ambiguousTexts = [
        "skip", "cancel", "afvis", "spring over",
      ];
      const xChars = ['×', '✕', '✖', '⨯'];

      const isVisible = (el) => {
        if (!el || !el.offsetParent && el.tagName !== 'BODY') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const findCloseAffordance = (overlay, allowAmbiguous) => {
        const all = [...overlay.querySelectorAll('button, [role="button"], a[href="#"], [aria-label]')];
        const allTexts = allowAmbiguous ? [...safeTexts, ...ambiguousTexts] : safeTexts;

        // Priority 1: aria-label match (close/dismiss/luk/afvis are always safe)
        for (const c of all) {
          if (!isVisible(c)) continue;
          const label = (c.getAttribute('aria-label') || '').toLowerCase();
          if (!label) continue;
          if (label.includes('close') || label.includes('dismiss') || label.includes('luk')) {
            return { el: c, method: 'aria-label', label };
          }
          if (allowAmbiguous && label.includes('afvis')) {
            return { el: c, method: 'aria-label', label };
          }
        }

        // Priority 2: button text exact match
        for (const c of all) {
          if (!isVisible(c)) continue;
          const text = (c.textContent || '').trim().toLowerCase();
          if (!text || text.length > 30) continue;
          if (allTexts.some(t => text === t || text === t + '!' || text === t + '.')) {
            return { el: c, method: 'text-exact', label: text };
          }
        }
        // Priority 3: button text contains
        for (const c of all) {
          if (!isVisible(c)) continue;
          const text = (c.textContent || '').trim().toLowerCase();
          if (!text || text.length > 40) continue;
          if (allTexts.some(t => text.includes(t))) {
            return { el: c, method: 'text-contains', label: text };
          }
        }

        // Priority 4: × character buttons (always safe — these are universal close)
        for (const c of all) {
          if (!isVisible(c)) continue;
          const text = (c.textContent || '').trim();
          if (xChars.includes(text)) {
            return { el: c, method: 'x-char', label: text };
          }
        }

        return null;
      };

      const overlays = new Set();
      const selectors = [
        '[role="dialog"]:not([aria-hidden="true"])',
        '[role="alertdialog"]:not([aria-hidden="true"])',
        '[role="tooltip"]:not([aria-hidden="true"])',
        '[role="alert"]',
        '[class*="modal" i]:not([class*="-hidden"]):not([style*="display: none"])',
        '[class*="tooltip" i]:not([class*="-hidden"])',
        '[class*="popover" i]:not([class*="-hidden"])',
        '[class*="overlay" i]:not([class*="-hidden"])',
        '[class*="banner" i]:not([class*="-hidden"]):not(input):not(button)',
        '[data-testid*="dialog" i]',
        '[data-testid*="modal" i]',
      ];
      for (const sel of selectors) {
        try {
          for (const el of document.querySelectorAll(sel)) {
            if (isVisible(el) && el.tagName !== 'INPUT' && el.tagName !== 'BUTTON') {
              overlays.add(el);
            }
          }
        } catch {}
      }

      for (const overlay of overlays) {
        const role = overlay.getAttribute('role') || (overlay.className || '').split(' ')[0] || 'unknown';

        // Inspect for editable form fields
        const editableTextInputs = overlay.querySelectorAll(
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), [contenteditable="true"]'
        );
        const allEditableInputs = overlay.querySelectorAll(
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), [contenteditable="true"]'
        );
        const hasTextFields = editableTextInputs.length > 0;
        const hasOnlyCheckboxRadios = !hasTextFields && allEditableInputs.length > 0;

        // Determine if ambiguous keywords (Skip/Cancel/Afvis) are allowed
        let allowAmbiguous;
        if (s === 'aggressive') {
          allowAmbiguous = true;
        } else if (role === 'tooltip' || role === 'alert') {
          allowAmbiguous = true;  // tooltips never hold form data
        } else if (hasTextFields) {
          allowAmbiguous = false; // protect form data — only safe keywords
        } else {
          allowAmbiguous = true;  // checkbox-only or empty dialogs — fair game
        }

        const found = findCloseAffordance(overlay, allowAmbiguous);
        if (found) {
          try {
            found.el.click();
            dismissed.push({ role, method: found.method, label: found.label, scope: allowAmbiguous ? 'ambiguous-ok' : 'safe-only' });
          } catch (e) {
            skipped.push({ role, reason: 'click-error', error: e.message });
          }
        } else {
          skipped.push({
            role,
            reason: hasTextFields && !allowAmbiguous
              ? 'no-safe-dismiss-affordance (text fields present)'
              : 'no-dismiss-affordance-found',
            hasTextFields,
            hasOnlyCheckboxRadios,
          });
        }
      }

      return { dismissed, skipped };
    }, [scope]);

    const passResult = r.result || { dismissed: [], skipped: [] };
    if (pass === 0) allSkipped.push(...passResult.skipped);
    if (passResult.dismissed.length === 0) break;
    allDismissed.push(...passResult.dismissed);
    await new Promise(r2 => setTimeout(r2, 250));
  }

  return { dismissed: allDismissed, skipped: allSkipped };
}

// ── Combobox / Autocomplete Helper ──────────────────────────────────────────

async function setCombobox(tabId, selector, values, opts = {}) {
  const valueList = Array.isArray(values) ? values : [values];
  const multi = !!opts.multi;
  const queryPrefixLen = opts.query_chars || 4;
  const waitMs = opts.wait_ms || 3000;
  const waitIterations = Math.max(1, Math.ceil(waitMs / 100));
  const results = [];

  for (const val of valueList) {
    try {
      const inputEl = await resolveElement(tabId, selector);
      if (!inputEl) {
        results.push({ value: val, ok: false, error: 'input-not-found' });
        continue;
      }
      await debuggerClick(tabId, inputEl.x, inputEl.y);
      await new Promise(r => setTimeout(r, 120));

      // Clear input only if non-empty. Backspace on empty multi-select deletes the previous chip
      // (react-select, MUI Autocomplete, Meta combobox all behave this way) — so we use native
      // value-setter to clear cleanly without ever pressing Backspace on an empty field.
      const currentValue = await readBackValue(tabId, selector);
      if (currentValue) {
        await safeExecuteScript(tabId, (sel) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, ''); else el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, [selector]);
      }

      // Type partial query via Input.insertText (bypasses per-keystroke validators)
      const query = val.slice(0, Math.min(queryPrefixLen, val.length));
      await debuggerAttach(tabId);
      await cdpSend(tabId, 'Input.insertText', { text: query });

      // Wait for listbox/options to appear
      let ready = false;
      for (let i = 0; i < waitIterations; i++) {
        await new Promise(r => setTimeout(r, 100));
        const found = await debuggerEval(tabId, `(() => {
          const lbs = document.querySelectorAll('[role="listbox"], [role="grid"][aria-label*="suggest" i], [class*="autocomplete" i] [class*="option" i], [class*="menu" i][role]:not([aria-hidden="true"])');
          for (const lb of lbs) {
            if (lb.offsetHeight === 0) continue;
            const opts = lb.querySelectorAll('[role="option"], [role="menuitem"], [data-option-index], [class*="option" i]:not([class*="optgroup" i])');
            if (opts.length > 0) return true;
          }
          return false;
        })()`);
        if (found) { ready = true; break; }
      }

      if (!ready) {
        results.push({ value: val, ok: false, error: 'no-options-rendered', query, waitMs });
        continue;
      }

      // Find and click matching option
      const click = await safeExecuteScript(tabId, (query) => {
        const lbs = [...document.querySelectorAll('[role="listbox"], [role="grid"][aria-label*="suggest" i], [class*="autocomplete" i], [class*="menu" i][role]:not([aria-hidden="true"])')]
          .filter(lb => lb.offsetHeight > 0);

        const queryLower = query.toLowerCase();
        const allOptions = [];
        for (const lb of lbs) {
          const opts = [...lb.querySelectorAll('[role="option"], [role="menuitem"], [data-option-index]')];
          if (opts.length === 0) {
            opts.push(...lb.querySelectorAll('li, [class*="option" i]:not([class*="optgroup" i])'));
          }
          const enabled = opts.filter(o =>
            o.getAttribute('aria-disabled') !== 'true' &&
            !o.classList.contains('disabled') &&
            o.offsetHeight > 0
          );
          allOptions.push(...enabled);
        }

        for (const o of allOptions) {
          const text = (o.textContent || '').trim().toLowerCase();
          if (text === queryLower) {
            o.click();
            return { ok: true, method: 'exact', text: o.textContent.trim() };
          }
        }
        for (const o of allOptions) {
          const text = (o.textContent || '').trim().toLowerCase();
          if (text.startsWith(queryLower)) {
            o.click();
            return { ok: true, method: 'startsWith', text: o.textContent.trim() };
          }
        }
        for (const o of allOptions) {
          const text = (o.textContent || '').trim().toLowerCase();
          if (text.includes(queryLower)) {
            o.click();
            return { ok: true, method: 'contains', text: o.textContent.trim() };
          }
        }

        return { ok: false, error: 'no-match-found', optionCount: allOptions.length };
      }, [val]);

      if (click.result?.ok) {
        results.push({ value: val, ok: true, method: click.result.method, selected: click.result.text });
        if (multi) {
          await new Promise(r => setTimeout(r, 250));
        }
      } else {
        results.push({ value: val, ok: false, error: click.result?.error || 'click-failed' });
      }
    } catch (e) {
      results.push({ value: val, ok: false, error: e?.message || String(e) });
    }
  }

  return { ok: results.every(r => r.ok), results };
}

// ── File Drop Helper (for drop-zones without <input type="file">) ───────────

async function dropFileOnTarget(tabId, selector, files) {
  const fileList = Array.isArray(files) ? files : [files];

  // Sweep any stale tags from previous failed runs before tagging fresh
  await debuggerEval(tabId, `(() => {
    document.querySelectorAll('[data-bmcp-drop-tag]').forEach(el => el.removeAttribute('data-bmcp-drop-tag'));
  })()`);

  // Strategy 1: search subtree (and 2 ancestor levels) for a file input — even if hidden
  const inputJson = await debuggerEval(tabId, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return JSON.stringify({ found: false, error: 'target-not-found' });

    const candidates = [];
    candidates.push(...target.querySelectorAll('input[type="file"]'));
    if (candidates.length === 0 && target.parentElement) {
      candidates.push(...target.parentElement.querySelectorAll('input[type="file"]'));
    }
    if (candidates.length === 0 && target.parentElement?.parentElement) {
      candidates.push(...target.parentElement.parentElement.querySelectorAll('input[type="file"]'));
    }
    if (candidates.length === 0) {
      // Last resort: any file input on the page
      candidates.push(...document.querySelectorAll('input[type="file"]'));
    }
    if (candidates.length === 0) return JSON.stringify({ found: false });

    // Tag the first viable input with a unique data-attribute so we can re-query reliably
    const tag = '__bmcp_drop_target_' + Math.random().toString(36).slice(2, 10);
    candidates[0].setAttribute('data-bmcp-drop-tag', tag);
    return JSON.stringify({ found: true, tag, accept: candidates[0].accept || '', multiple: !!candidates[0].multiple });
  })()`);

  const inputInfo = JSON.parse(inputJson);

  if (inputInfo.found) {
    const taggedSel = `[data-bmcp-drop-tag="${inputInfo.tag}"]`;
    let result;
    let caughtError;
    try {
      await debuggerAttach(tabId);
      const docResult = await cdpSend(tabId, 'DOM.getDocument', {});
      const queryResult = await cdpSend(tabId, 'DOM.querySelector', {
        nodeId: docResult.root.nodeId,
        selector: taggedSel,
      });
      if (queryResult.nodeId) {
        await cdpSend(tabId, 'DOM.setFileInputFiles', {
          nodeId: queryResult.nodeId,
          files: fileList,
        });
        result = { ok: true, method: 'hidden-input', files: fileList, accept: inputInfo.accept };
      }
    } catch (e) {
      caughtError = e?.message || String(e);
    } finally {
      // Always remove the tag attribute — success or failure
      try {
        await debuggerEval(tabId, `(() => {
          const el = document.querySelector(${JSON.stringify(taggedSel)});
          if (el) el.removeAttribute('data-bmcp-drop-tag');
        })()`);
      } catch {}
    }
    if (result) return result;
    if (caughtError) {
      return {
        ok: false,
        error: 'setFileInputFiles-failed',
        detail: caughtError,
      };
    }
  }

  return {
    ok: false,
    error: 'no-file-input-found',
    hint: 'No <input type="file"> found in target subtree, parent, or page. Pure drag-drop zones (without backing input) require synthesizing File objects from disk content via mcp-server, which is not yet implemented. Try selecting a more specific selector, or fall back to manual upload via browser_ask_user.',
  };
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
      if (captcha && captcha.found) {
        result.captcha_detected = captcha.types.join(', ');
        result.hint = `CAPTCHA detected: ${captcha.types.join(', ')}. Use browser_solve_captcha to handle it.`;
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
      // getSessionTab(…, true) is focus-NEUTRAL now: it un-minimizes + activates the tab
      // but does NOT steal window focus (FIX-1). Screenshots run constantly, so the common
      // path must never yank Chrome to the foreground.
      const tab = await getSessionTab(port, true);
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
        throw new Error(`Cannot screenshot ${tab.url.split(':')[0]}: pages — navigate to a real page first`);
      }
      // Capture without stealing focus: CDP Page.captureScreenshot (default → fromSurface:false
      // retry) works for background/visible tabs; captureVisibleTab is the secondary.
      const tryCapture = async () => {
        try {
          await debuggerAttach(tab.id);
          try {
            const shot = await cdpSend(tab.id, 'Page.captureScreenshot', { format: 'png' });
            return { image: 'data:image/png;base64,' + shot.data };
          } catch {
            const shot = await cdpSend(tab.id, 'Page.captureScreenshot', {
              format: 'png', fromSurface: false, captureBeyondViewport: false,
            });
            return { image: 'data:image/png;base64,' + shot.data };
          }
        } catch {
          // CDP failed entirely — native tabs API (needs the tab visible in its window).
          const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
          return { image: dataUrl };
        }
      };

      // Attempt 1 — focus-neutral. Handles the vast majority (background-but-visible window).
      try {
        return await tryCapture();
      } catch (firstErr) {
        // Both methods failed → the window is genuinely OCCLUDED (covered by other windows),
        // so Chrome's compositor produced no frames. LAST RESORT ONLY: raise the window to
        // de-occlude it, capture, then RESTORE the user's previously-focused window. This
        // focus-steal happens ONLY in the rare covered case — never on a normal screenshot.
        const prev = await chrome.windows.getLastFocused().catch(() => null);
        try {
          await chrome.windows.update(tab.windowId, { focused: true, state: 'normal' });
          await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
          await new Promise(r => setTimeout(r, 250)); // let it composite
          return await tryCapture();
        } catch (secondErr) {
          throw new Error(
            `Screenshot failed after focus-neutral AND raised attempts. ` +
            `First: ${firstErr?.message || firstErr}. Raised: ${secondErr?.message || secondErr}. ` +
            `If both say "image readback failed" the GPU compositor is not producing frames — ` +
            `disable Chrome hardware acceleration (chrome://settings/system) as a last resort.`
          );
        } finally {
          // Give focus back to the user's previous Chrome window (best-effort; getLastFocused
          // only sees Chrome windows, so a non-Chrome IDE can't be re-focused programmatically).
          if (prev && prev.id != null && prev.id !== tab.windowId) {
            await chrome.windows.update(prev.id, { focused: true }).catch(() => {});
          }
        }
      }
    }

    case 'execute_script': {
      // v1.22.2 (DIAGNOSTIC): Try scripting paths but log all errors so we can see WHY they fail
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot execute scripts on chrome:// pages');

      const diag = { tried: [] };

      // Step 1: try ISOLATED world
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'ISOLATED',
          args: [params.code],
          func: (codeStr) => {
            try {
              const fn = new Function('return (' + codeStr + ')');
              return { __ok: true, value: fn() };
            } catch (e) {
              return { __scriptingError: true, message: String(e?.message || e), name: e?.name, world: 'ISOLATED' };
            }
          },
        });
        const r = result?.result;
        diag.tried.push({ world: 'ISOLATED', result_keys: r ? Object.keys(r) : null, r_type: typeof r });
        if (r && typeof r === 'object' && r.__ok) {
          return { result: r.value, method: 'scripting-isolated' };
        }
        if (r && typeof r === 'object' && r.__scriptingError) {
          diag.isolated_error = r.message;
        }
      } catch (e) {
        diag.isolated_throw = String(e?.message || e);
      }

      // Step 2: try MAIN world
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          args: [params.code],
          func: (codeStr) => {
            try {
              const fn = new Function('return (' + codeStr + ')');
              return { __ok: true, value: fn() };
            } catch (e) {
              return { __scriptingError: true, message: String(e?.message || e), name: e?.name, world: 'MAIN' };
            }
          },
        });
        const r = result?.result;
        diag.tried.push({ world: 'MAIN', result_keys: r ? Object.keys(r) : null, r_type: typeof r });
        if (r && typeof r === 'object' && r.__ok) {
          return { result: r.value, method: 'scripting-main' };
        }
        if (r && typeof r === 'object' && r.__scriptingError) {
          diag.main_error = r.message;
        }
      } catch (e) {
        diag.main_throw = String(e?.message || e);
      }

      // Step 3: debugger fallback — the ONLY universal path for arbitrary STRING code
      // (both scripting worlds block `new Function`: ISOLATED via MV3 extension-CSP,
      // MAIN via the page's own unsafe-eval CSP). CDP Runtime.evaluate bypasses CSP.
      // FIX (2026-07-16): retry on an EMPTY/undefined CDP response. On some pages the
      // debugger auto-detaches mid-command and `chrome.debugger.sendCommand` RESOLVES
      // with `undefined` instead of rejecting, so cdpSend's throw-based retry never
      // fires and debuggerEval silently returned undefined → the caller saw a bare
      // `{method:"debugger"}` with no result. Also surface script exceptions + raw
      // diagnostics so a genuine failure is never mistaken for an empty success.
      let rawDbg, dbgErr = '';
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          await debuggerAttach(tab.id);
          rawDbg = await cdpSend(tab.id, 'Runtime.evaluate', {
            expression: '(' + params.code + '\n)',
            returnByValue: true,
            awaitPromise: true,
          });
          if (rawDbg && rawDbg.exceptionDetails) {
            const ex = rawDbg.exceptionDetails;
            await debuggerDetach(tab.id).catch(() => {});
            throw new Error('__SCRIPT_EX__' + (ex.exception?.description || ex.text || 'Script exception'));
          }
          if (rawDbg && rawDbg.result && rawDbg.result.type !== 'undefined') {
            await debuggerDetach(tab.id).catch(() => {});
            return { result: rawDbg.result.value, method: 'debugger' };
          }
          dbgErr = 'empty/undefined CDP response: ' + JSON.stringify(rawDbg);
        } catch (e) {
          const m = String(e?.message || e);
          if (m.startsWith('__SCRIPT_EX__')) {
            throw new Error(m.slice('__SCRIPT_EX__'.length) + ' | scripting-diag: ' + JSON.stringify(diag));
          }
          dbgErr = m;
          if (!/detach|attach|empty|gone|given id|not attached/i.test(m)) break;
        }
        await debuggerDetach(tab.id).catch(() => {});
        await new Promise(r => setTimeout(r, 200 + attempt * 200));
      }
      throw new Error(
        'execute_script failed on all paths. debugger: ' + dbgErr +
        ' | raw: ' + JSON.stringify(rawDbg) +
        ' | scripting-diag: ' + JSON.stringify(diag)
      );
    }

    case 'click': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');

      // Wrap full click flow (incl. resolveElement) so debugger failures in EITHER
      // resolveElement (text-selectors use debuggerEval) OR debuggerClick trigger
      // the scripting-fallback. v1.21.2: previously only debuggerClick was wrapped,
      // leaving text-selector clicks unrecoverable when debugger was user-blocked.
      try {
        const el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };

        // Primary path: debugger mouse events (isTrusted=true, works on React/Angular SPAs)
        await debuggerClick(tab.id, el.x, el.y);
        return { ok: true, method: el.method || 'debugger', tag: el.tag, text: el.text };
      } catch (e) {
        // Fallback: synthetic click via chrome.scripting for anti-automation sites
        // (Apple ASC etc.) OR user-blocked-debugger scenarios.
        if (/Debugger detached/.test(e?.message || '')) {
          const r = await scriptingClick(tab.id, params.selector);
          if (r.ok) return { ok: true, method: 'scripting-fallback', tag: r.tag };
        }
        throw e;
      }
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

    case 'set_date': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
        return { ok: false, error: 'date must be ISO format YYYY-MM-DD, got: ' + params.date };
      }

      const info = await getDateInputInfo(tab.id, params.selector);
      if (!info.found) return { ok: false, error: 'Element not found: ' + params.selector };

      const tried = [];
      const iso = params.date;

      // Path A: native <input type="date"> or <input type="datetime-local">
      if (info.tag === 'INPUT' && (info.inputType === 'date' || info.inputType === 'datetime-local')) {
        await setDateNative(tab.id, params.selector, iso);
        await new Promise(r => setTimeout(r, 200));
        const v = await readBackValue(tab.id, params.selector);
        tried.push({ path: 'native', value: v });
        if (v && v.startsWith(iso)) return { ok: true, method: 'native', value: v };
      }

      // Path B: masked text input — parse format and type via Input.insertText
      if (info.tag === 'INPUT' && !info.readOnly && !info.disabled) {
        const fmt = parsePlaceholderFormat(info.placeholder) || parsePlaceholderFormat(info.ariaLabel);
        if (fmt) {
          try {
            await setDateMaskedTyping(tab.id, params.selector, iso, fmt);
            await new Promise(r => setTimeout(r, 250));
            const v = await readBackValue(tab.id, params.selector);
            tried.push({ path: 'masked', format: fmt.order.join(fmt.sep), value: v });
            if (valueLooksLikeIso(v, iso)) return { ok: true, method: 'masked', value: v, format: fmt.order.join(fmt.sep) };
          } catch (e) {
            tried.push({ path: 'masked', error: e.message });
          }
        } else {
          tried.push({
            path: 'masked',
            skipped: true,
            reason: 'no-parseable-format',
            placeholder: info.placeholder,
            ariaLabel: info.ariaLabel,
          });
        }
      } else {
        tried.push({
          path: 'masked',
          skipped: true,
          reason: info.tag !== 'INPUT' ? 'not-input-element' : (info.readOnly ? 'readonly' : 'disabled'),
        });
      }

      // Path C: calendar-picker navigation
      if (!params.skip_picker) {
        const r = await setDatePicker(tab.id, params.selector, iso);
        await new Promise(r2 => setTimeout(r2, 200));
        const v = await readBackValue(tab.id, params.selector);
        tried.push({ path: 'picker', ...r, value: v });
        if (r.ok && valueLooksLikeIso(v, iso)) return { ok: true, method: 'picker', value: v, navAttempts: r.navAttempts };
      }

      const visibleErrors = await collectVisibleErrors(tab.id, params.selector);
      const finalValue = await readBackValue(tab.id, params.selector);
      return {
        ok: false,
        error: 'all-paths-failed',
        tried,
        current_value: finalValue,
        visible_errors: visibleErrors,
        input_info: info,
      };
    }

    case 'dismiss_overlays': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const scope = params.scope || 'non_critical';
      const maxPasses = params.max_passes ?? 3;
      const r = await dismissOverlays(tab.id, scope, maxPasses);
      return { ok: true, dismissed: r.dismissed, skipped: r.skipped, count: r.dismissed.length };
    }

    case 'set_combobox': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      if (!params.selector) return { ok: false, error: 'selector required' };
      if (!params.values && !params.value) return { ok: false, error: 'value or values required' };
      const values = params.values || [params.value];
      const r = await setCombobox(tab.id, params.selector, values, {
        multi: !!params.multi,
        query_chars: params.query_chars,
      });
      const visibleErrors = r.ok ? [] : await collectVisibleErrors(tab.id, params.selector);
      return r.ok ? r : { ...r, visible_errors: visibleErrors };
    }

    case 'drop_file': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const files = Array.isArray(params.files) ? params.files : [params.files || params.file];
      if (!files[0]) return { ok: false, error: 'files or file required' };
      return await dropFileOnTarget(tab.id, params.selector || 'body', files);
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
      // v1.22: activate tab so key-event lands in foreground (otherwise Chrome routes to active tab)
      const tab = await getSessionTab(port, true);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const key = params.key; // e.g. "Enter", "Tab", "Escape", "ArrowDown"
      const modifiers = (params.ctrl ? 2 : 0) | (params.alt ? 1 : 0) | (params.shift ? 8 : 0) | (params.meta ? 4 : 0);

      // v1.22: Chrome requires windowsVirtualKeyCode for navigation/system keys to trigger
      // scroll/form-submit behavior. Without these, key-event is dispatched but page doesn't react.
      const VK_CODES = {
        'Backspace': 8, 'Tab': 9, 'Enter': 13, 'Shift': 16, 'Control': 17, 'Alt': 18,
        'Escape': 27, 'Space': 32, ' ': 32,
        'PageUp': 33, 'PageDown': 34, 'End': 35, 'Home': 36,
        'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40,
        'Delete': 46,
      };
      const vkCode = VK_CODES[key];
      const vkParams = vkCode ? { windowsVirtualKeyCode: vkCode, nativeVirtualKeyCode: vkCode } : {};

      await debuggerAttach(tab.id);
      try {
        await cdpSend(tab.id, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          key,
          code: params.code || key,
          modifiers,
          text: key.length === 1 ? key : '',
          ...vkParams,
        });
        await cdpSend(tab.id, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
          key,
          code: params.code || key,
          modifiers,
          ...vkParams,
        });
      } finally {
        await debuggerDetach(tab.id);
      }
      return { ok: true, key };
    }

    case 'scroll': {
      // v1.22: NO activate — CDP Input.dispatchMouseEvent goes via debugger directly to target,
      // doesn't need active tab. Re-activating on every scroll-call destabilizes debugger.
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      // Scroll to element
      if (params.selector) {
        const el = await resolveElement(tab.id, params.selector);
        if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
        return { ok: true, scrolled_to: params.selector };
      }
      // Scroll by pixels using CDP mouseWheel — split into smaller steps so IntersectionObservers fire.
      // FB/Twitter/IG only trigger lazy-load on continuous wheel events, not a single large delta.
      const dx = params.x || 0;
      const dy = params.y || 0;
      try {
        await debuggerAttach(tab.id);
        const STEP_SIZE = 300; // pixels per wheel-event (matches a typical mouse-wheel notch)
        const totalSteps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / STEP_SIZE));
        const stepX = dx / totalSteps;
        const stepY = dy / totalSteps;
        for (let i = 0; i < totalSteps; i++) {
          await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: 400, y: 300, deltaX: stepX, deltaY: stepY,
          });
          // Small delay between wheel-events so IntersectionObserver + lazy-load XHRs can fire
          if (i < totalSteps - 1) await new Promise(r => setTimeout(r, 80));
        }
        // After last wheel-event, give FB/Twitter/IG ~600ms to start lazy-load XHRs
        // before any subsequent commands run (caller often scrapes immediately after)
        await new Promise(r => setTimeout(r, 600));
      } catch (e) {
        // Fallback to window.scrollBy for simple pages (synthetic but works on non-anti-scrape sites)
        await debuggerEval(tab.id, `window.scrollBy(${dx}, ${dy})`);
        return { ok: true, scrolled: { x: dx, y: dy }, method: 'fallback', fallback_reason: e.message };
      }
      return { ok: true, scrolled: { x: dx, y: dy }, method: 'mouseWheel-stepped' };
    }

    case 'hover': {
      const tab = await getSessionTab(port);
      if (tab.url.startsWith('chrome://')) throw new Error('Cannot interact with chrome:// pages');
      const el = await resolveElement(tab.id, params.selector);
      if (!el) return { ok: false, error: 'Element not found: ' + params.selector };
      await debuggerAttach(tab.id);
      try {
        await cdpSend(tab.id, 'Input.dispatchMouseEvent', {
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
        await cdpSend(tab.id, 'Page.enable', {});

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

            cdpSend(tab.id, 'Page.handleJavaScriptDialog', {
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
        await cdpSend(tab.id, 'Network.enable', {});

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
                cdpSend(tab.id, 'Network.getResponseBody', {
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

        await cdpSend(tab.id, 'Network.disable', {});
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
        await cdpSend(tab.id, 'Runtime.enable');
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
        const { result } = await cdpSend(tab.id, 'Runtime.evaluate', {
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

    case 'upload_file': {
      const tab = await getSessionTab(port);
      const selector = params.selector || 'input[type="file"]';
      try {
        await debuggerAttach(tab.id);
        // Find the file input element
        const { result: nodeResult } = await cdpSend(tab.id, 'Runtime.evaluate', {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return JSON.stringify({ found: false, error: 'File input not found: ${selector}' });
            return JSON.stringify({ found: true, tag: el.tagName, type: el.type, accept: el.accept, multiple: el.multiple });
          })()`,
          returnByValue: true,
        });
        const info = JSON.parse(nodeResult.value);
        if (!info.found) {
          await debuggerDetach(tab.id);
          return info;
        }

        // Get the DOM node ID for the file input
        const { result: docResult } = await cdpSend(tab.id, 'DOM.getDocument', {});
        const { nodeId } = await cdpSend(tab.id, 'DOM.querySelector', {
          nodeId: docResult.root.nodeId,
          selector: selector,
        });

        if (!nodeId) {
          await debuggerDetach(tab.id);
          return { found: false, error: 'Could not get DOM node for file input' };
        }

        // Set files on the input using CDP
        const files = Array.isArray(params.files) ? params.files : [params.files || params.file];
        await cdpSend(tab.id, 'DOM.setFileInputFiles', {
          nodeId: nodeId,
          files: files,
        });

        await debuggerDetach(tab.id);
        return { ok: true, files: files, input: info };
      } catch (e) {
        try { await debuggerDetach(tab.id); } catch {}
        return { ok: false, error: e.message };
      }
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
    const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
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
    const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
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
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: pos.x, y: pos.y,
    });
    await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1,
    });
    await cdpSend(tabId, 'Input.dispatchMouseEvent', {
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
    const { result } = await cdpSend(tabId, 'Runtime.evaluate', {
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

      await cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: ox, y: oy,
      });
      await new Promise(r => setTimeout(r, 150 + Math.random() * 300));
      await cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed', x: ox, y: oy, button: 'left', clickCount: 1,
      });
      await cdpSend(tabId, 'Input.dispatchMouseEvent', {
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
