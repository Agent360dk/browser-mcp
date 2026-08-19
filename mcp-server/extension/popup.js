// ── Status ──────────────────────────────────────────────────────────────────

function paintStatus(connected, count) {
  document.getElementById('dot').className = `dot ${connected ? 'on' : 'off'}`;
  document.getElementById('label').textContent = connected
    ? `Connected — ${count} session${count === 1 ? '' : 's'}`
    : 'Not connected — no MCP server found';
  // The Chrome Web Store can only install the extension. If nothing is listening on
  // ports 9876-9885, the user almost certainly never ran the npx install — say so.
  document.getElementById('setup').classList.toggle('show', !connected);
}

function refreshStatus() {
  chrome.storage.local.get(['mcpConnected', 'mcpCount'], (result) => {
    paintStatus(result.mcpConnected === true, result.mcpCount || 0);
  });
}

refreshStatus();

// ── Sessions with tabs ─────────────────────────────────────────────────────

function renderSessions() {
  chrome.storage.local.get({ sessions: {} }, ({ sessions }) => {
    const container = document.getElementById('sessions');
    const entries = Object.entries(sessions);

    if (!entries.length) {
      container.innerHTML = '<div class="empty">No active sessions</div>';
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
          ? tabInfos.map(u => `<div>• ${u}</div>`).join('')
          : '<div>No tabs</div>';
        return `
          <div class="session-card color-${color}">
            <div class="session-header">${session.label} <span style="font-weight:normal;font-size:10px;color:#64748b">port ${port}</span></div>
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
      return `<div class="log-entry"><span class="log-time">${time}</span><span class="log-method ${cls}">${entry.method}</span><span class="log-session">${entry.session || ''}</span></div>`;
    }).join('');
  });
}

renderLog();

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
