// ── Status ──────────────────────────────────────────────────────────────────

chrome.storage.local.get(['mcpConnected', 'mcpCount', 'mcpPorts'], (result) => {
  const connected = result.mcpConnected === true;
  const count = result.mcpCount || 0;
  const ports = result.mcpPorts || [];
  document.getElementById('dot').className = `dot ${connected ? 'on' : 'off'}`;
  document.getElementById('label').textContent = connected ? `Forbundet til ${count} MCP server${count > 1 ? 's' : ''}` : 'Ikke forbundet';
  document.getElementById('sessions').textContent = count;
  document.getElementById('ports').textContent = ports.length ? ports.join(', ') : '—';
});

// ── Active tab info ─────────────────────────────────────────────────────────

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) {
    const url = tabs[0].url || '—';
    document.getElementById('tab').textContent = url.length > 35 ? url.slice(0, 35) + '…' : url;
  }
});

// ── Action Log ──────────────────────────────────────────────────────────────

function renderLog() {
  chrome.storage.local.get({ actionLog: [] }, ({ actionLog }) => {
    const container = document.getElementById('log');
    if (!actionLog.length) {
      container.innerHTML = '<div class="empty">Ingen actions endnu</div>';
      return;
    }
    container.innerHTML = actionLog.slice(0, 30).map(entry => {
      const time = new Date(entry.time).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const cat = entry.category || 'safe';
      let cls = 'log-safe';
      if (cat.startsWith('destructive')) cls = cat.includes('denied') ? 'log-denied' : 'log-destructive';
      else if (cat === 'sensitive') cls = 'log-sensitive';
      const params = entry.params ? entry.params.replace(/^{|}$/g, '').slice(0, 50) : '';
      return `<div class="log-entry"><span class="log-time">${time}</span><span class="log-method ${cls}">${entry.method}</span><span class="log-params">${params}</span></div>`;
    }).join('');
  });
}

renderLog();

// ── Buttons ─────────────────────────────────────────────────────────────────

document.getElementById('reconnect').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'reconnect' });
  document.getElementById('label').textContent = 'Reconnecting...';
  setTimeout(() => {
    chrome.storage.local.get(['mcpConnected'], (result) => {
      const connected = result.mcpConnected === true;
      document.getElementById('dot').className = `dot ${connected ? 'on' : 'off'}`;
      document.getElementById('label').textContent = connected ? 'Forbundet til MCP server' : 'Ikke forbundet';
    });
  }, 3000);
});

document.getElementById('clearLog').addEventListener('click', () => {
  chrome.storage.local.set({ actionLog: [] }, renderLog);
});
