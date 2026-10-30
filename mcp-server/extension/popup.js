// ── Status ──────────────────────────────────────────────────────────────────

// mcpCount = agent clients on the socket. `sessions` = agents that have actually claimed a
// tab. They differ, and showing "Connected - 1 session" above "No active sessions" read as a
// contradiction at exactly the moment a new user checks whether the install worked.
function paintStatus(connected, count, sessionCount) {
  document.getElementById('dot').className = `dot ${connected ? 'on' : 'off'}`;
  document.getElementById('label').textContent = !connected
    ? 'Not connected - nothing on ports 9876-9895 yet'
    : sessionCount > 0
      ? `Connected - ${sessionCount} active session${sessionCount === 1 ? '' : 's'}`
      : `Connected - ready (${count} agent${count === 1 ? '' : 's'} listening)`;
  // The Chrome Web Store can only install the extension. If nothing is listening on
  // ports 9876-9895, the user almost certainly never ran the npx install - say so.
  document.getElementById('setup').classList.toggle('show', !connected);
  // Connected but idle: they got it working and now need to know what to say.
  document.getElementById('try').classList.toggle('show', connected && sessionCount === 0);
}

function refreshStatus() {
  chrome.storage.local.get({ mcpConnected: false, mcpCount: 0, sessions: {} }, (result) => {
    paintStatus(result.mcpConnected === true, result.mcpCount || 0,
                Object.keys(result.sessions || {}).length);
  });
}

refreshStatus();

// ── Sessions with tabs ─────────────────────────────────────────────────────

// R186: sessionens navn er agentens tekst (browser_set_group_label, #91), og fanernes titler kommer fra websider - intet af det
// maa tolkes som HTML i popuppen.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderSessions() {
  chrome.storage.local.get({ sessions: {} }, ({ sessions }) => {
    const container = document.getElementById('sessions');
    const entries = Object.entries(sessions);

    if (!entries.length) {
      container.innerHTML = '<div class="empty">No tabs claimed yet</div>';
      return;
    }

    // Fetch tab info for each session
    const promises = entries.map(async ([port, session]) => {
      const tabInfos = [];
      for (const tabId of session.tabIds || []) {
        try {
          const tab = await chrome.tabs.get(tabId);
          const url = tab.url || '';
          const display = url.length > 40 ? url.slice(0, 40) + '…' : url;
          tabInfos.push(display);
        } catch {}
      }
      return { port, session, tabInfos };
    });

    Promise.all(promises).then(results => {
      container.innerHTML = results.map(({ port, session, tabInfos }) => {
        const color = session.color || 'blue';
        const tabHtml = tabInfos.length
          ? tabInfos.map(u => `<div>• ${esc(u)}</div>`).join('')
          : '<div>No tabs</div>';
        return `
          <div class="session-card color-${esc(color)}">
            <div class="session-header">${esc(session.label)} <span style="font-weight:normal;font-size:10px;color:#64748b">port ${port}</span></div>
            <div class="session-tabs">${tabHtml}</div>
          </div>`;
      }).join('');
    });
  });
}

renderSessions();

// ── Action Log ──────────────────────────────────────────────────────────────

function renderLog() {
  chrome.storage.local.get({ actionLog: [] }, ({ actionLog }) => {
    const container = document.getElementById('log');
    if (!actionLog.length) {
      container.innerHTML = '<div class="empty">No actions yet</div>';
      return;
    }
    container.innerHTML = actionLog.slice(0, 30).map(entry => {
      const time = new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const cat = entry.category || 'safe';
      const cls = cat === 'sensitive' ? 'log-sensitive' : 'log-safe';
      return `<div class="log-entry"><span class="log-time">${time}</span><span class="log-method ${cls}">${esc(entry.method)}</span><span class="log-session">${esc(entry.session)}</span></div>`;
    }).join('');
  });
}

renderLog();

// ── This Chrome profile (1.31, #58) ────────────────────────────────────────
// The name lets a server pick this profile (BROWSER_MCP_PROFILE). The background keeps it in chrome.storage.local and sends
// it to the bridge, which greets every connected server again with the new name - no connection is dropped.
const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;
const profileNote = document.getElementById('profileNote');
const profileNoteText = profileNote.innerHTML;

function showIdentity(r) {
  if (!r || !r.ok) return;
  document.getElementById('instanceId').textContent = r.instance || 'not created yet';
  document.getElementById('profileName').value = r.profile || '';
}

chrome.runtime.sendMessage({ type: 'bmcp_identitet' }).then(showIdentity).catch(() => {});

document.getElementById('saveProfile').addEventListener('click', async () => {
  const name = document.getElementById('profileName').value.trim();
  if (name && !PROFILE_PATTERN.test(name)) {
    profileNote.className = 'fejl';
    profileNote.textContent = 'Not saved: use only letters, digits, dot, dash and underscore, up to 32 characters.';
    return;
  }
  try {
    const r = await chrome.runtime.sendMessage({ type: 'bmcp_saet_profil', profile: name });
    if (!r || !r.ok) throw new Error(r?.error || 'no answer');
    showIdentity(r);
    profileNote.className = '';
    profileNote.textContent = r.profile
      ? `Saved. A server with BROWSER_MCP_PROFILE=${r.profile} picks this profile, as long as no other profile has the same name.`
      : 'Saved without a name. A server with BROWSER_MCP_PROFILE set will not pick this profile.';
    setTimeout(() => { profileNote.className = ''; profileNote.innerHTML = profileNoteText; }, 6000);
  } catch (e) {
    profileNote.className = 'fejl';
    profileNote.textContent = `Not saved: ${e?.message || e}`;
  }
});

// ── Buttons ─────────────────────────────────────────────────────────────────

document.getElementById('reconnect').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'reconnect' });
  document.getElementById('label').textContent = 'Reconnecting…';
  setTimeout(() => {
    refreshStatus();
    renderSessions();
  }, 3000);
});

document.getElementById('copyCmd').addEventListener('click', (e) => {
  navigator.clipboard.writeText(document.getElementById('setupCmd').textContent.trim());
  e.target.textContent = 'Copied!';
  setTimeout(() => { e.target.textContent = 'Copy command'; }, 1500);
});

document.getElementById('clearLog').addEventListener('click', () => {
  chrome.storage.local.set({ actionLog: [] }, renderLog);
});

