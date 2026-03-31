# Agent360 Browser MCP

Control your **real Chrome browser** from Claude Code — with your actual logins, cookies, and sessions. 23 tools for navigation, clicking, forms, screenshots, token extraction, 2FA handling, and more.

**Not a headless browser.** Your real Chrome. Your real sessions. Your real data.

**Multi-session support:** Up to 10 concurrent Claude Code sessions, each with its own color-coded Chrome Tab Group.

```
Claude Code 1 ←(stdio)→ MCP Server (:9876) ←(WS)→
Claude Code 2 ←(stdio)→ MCP Server (:9877) ←(WS)→  Chrome Extension → Your Browser
Claude Code N ←(stdio)→ MCP Server (:9878) ←(WS)→
```

---

## Why This Over Playwright MCP?

| | Agent360 Browser MCP | Playwright MCP |
|---|---|---|
| **Browser** | Your real Chrome (logged in) | Headless Chromium (no sessions) |
| **Auth** | Already logged in everywhere | Must log in every time |
| **2FA/CAPTCHA** | `browser_ask_user` dialog | Manual intervention required |
| **Cookies/sessions** | Full access | None |
| **Multi-session** | Tab groups with isolation | Single browser instance |
| **CSP-strict sites** | Chrome Debugger API bypass | Fails on strict CSP |
| **CORS** | `browser_fetch` (no CORS) | Subject to CORS |
| **Network monitoring** | `browser_wait_for_network` | Not available |
| **Custom dropdowns** | `browser_select_option` (React/Angular) | Only native `<select>` |
| **Tools** | 23 | 20 |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/Agent360dk/browser-mcp.git
cd browser-mcp

# 2. Install
cd mcp-server && npm install && cd ..

# 3. Add to Claude Code
claude mcp add agent360-browser $(which node) $(pwd)/mcp-server/index.js

# 4. Load Chrome Extension
#    chrome://extensions → Developer mode ON → Load unpacked → select browser-mcp/extension/

# 5. Restart Claude Code
```

That's it. The extension auto-connects within 2 seconds.

---

## Usage

Once set up, just ask Claude Code naturally:

### Navigation & Reading
```
"Open railway.com and show me what's on the dashboard"
"Go to my Stripe dashboard and take a screenshot"
"Read the page content and summarize it"
```

### Clicking & Forms
```
"Click the Deploy button"
"Fill in the email field with test@example.com"
"Select 'Production' from the environment dropdown"
"Press Enter to submit"
```

### Authentication & Tokens
```
"Extract my Stripe API key from the dashboard"
"Get the cookies from this domain"
"Read localStorage for the auth token"
```

### Human-in-the-Loop
```
"Ask me to solve the CAPTCHA"
"Ask the user for their 2FA code"
"Show a dialog asking for the API key"
```

### Multi-Tab Workflows
```
"Open Stripe in one tab and Railway in another, then compare"
"List my open tabs"
"Switch to the Railway tab"
"Close the old tab"
```

### Example: Full Workflow
```
You: "Go to Railway, find the backend service, check if it's healthy"

Claude Code:
1. browser_navigate → railway.com/project/...
2. browser_screenshot → sees the dashboard
3. browser_click → clicks the backend service
4. browser_get_page_content → reads status
5. "Backend is healthy, last deploy 3 minutes ago"
```

All 23 tools are available automatically — Claude Code picks the right one based on your request.

---

## Tools (23)

### Navigation & Content
| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL (reuses tab, `new_tab=true` for new) |
| `browser_get_page_content` | Get page text or HTML |
| `browser_screenshot` | Screenshot of visible area (PNG) |
| `browser_execute_script` | Run JavaScript in page context |
| `browser_scroll` | Scroll to element or by pixel amount |

### Interaction
| Tool | Description |
|------|-------------|
| `browser_click` | Click via CSS or text selector (`"button:text(Submit)"`) |
| `browser_fill` | Fill input field (works on CSP-strict sites) |
| `browser_hover` | Hover to trigger tooltips, dropdowns |
| `browser_press_key` | Keyboard key (Enter, Tab, Escape, with modifiers) |
| `browser_select_option` | Select from any dropdown (native + custom) |
| `browser_wait` | Wait for element to appear |
| `browser_handle_dialog` | Handle alert(), confirm(), prompt() |
| `browser_wait_for_network` | Wait for API call to complete |

### Tabs & Frames
| Tool | Description |
|------|-------------|
| `browser_list_tabs` | List session's tabs |
| `browser_switch_tab` | Switch to tab by ID |
| `browser_close_tab` | Close a tab |
| `browser_get_new_tab` | Get most recent tab (OAuth popups) |
| `browser_list_frames` | List iframes on page |
| `browser_select_frame` | Run JS in specific iframe |

### Data & Auth
| Tool | Description |
|------|-------------|
| `browser_get_cookies` | Get cookies for domain |
| `browser_get_local_storage` | Read localStorage |
| `browser_extract_token` | Extract API token from provider dashboard |
| `browser_fetch` | HTTP request without CORS restrictions |

### Human-in-the-Loop
| Tool | Description |
|------|-------------|
| `browser_ask_user` | Overlay dialog for 2FA, CAPTCHA, credentials |

`browser_ask_user` supports:
- **Simple confirmation:** "Please solve the CAPTCHA" → Done/Skip buttons
- **Input fields:** Email, password, API key → returns user responses

---

## Multi-Session Support

Each Claude Code conversation gets its own MCP server on a unique port. The extension auto-discovers all active servers.

- **Session isolation:** Each session gets a Chrome Tab Group with unique color
- **Tab ownership:** `navigate` creates tabs in the session's group — sessions can't interfere
- **`list_tabs`** returns only the session's own tabs
- **Auto-cleanup:** When a session ends, tabs are un-grouped (stay open)

```
Claude 1 (port 9876) 🔵
  • railway.com/dashboard
  • stripe.com/payments

Claude 2 (port 9877) 🟢
  • github.com/pulls
  • vercel.com/deployments
```

---

## Detailed Setup

### 1. Clone and install
```bash
git clone https://github.com/Agent360dk/browser-mcp.git
cd browser-mcp/mcp-server
npm install
```

### 2. Load Chrome Extension
1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle top-right)
3. Click **Load unpacked**
4. Select the `browser-mcp/extension/` folder

### 3. Add to Claude Code
```bash
claude mcp add agent360-browser $(which node) /path/to/browser-mcp/mcp-server/index.js
```

Or manually in `.mcp.json`:
```json
{
  "mcpServers": {
    "agent360-browser": {
      "command": "node",
      "args": ["/path/to/browser-mcp/mcp-server/index.js"]
    }
  }
}
```

### 4. Remove other browser MCPs
Run with **only one browser MCP** — multiple cause conflicts.

```bash
claude mcp remove Playwright
claude mcp remove browsermcp
```

### 5. Restart Claude Code

---

## Architecture

```
extension/
  manifest.json       # Manifest V3, permissions
  background.js       # Service worker — Chrome API dispatcher, tab groups
  offscreen.js        # Persistent WebSocket bridge (multi-port scan)
  offscreen.html      # Offscreen document container
  popup.html/js       # Status UI — sessions, tabs, action log
  icons/              # Extension icons (16/48/128px)

mcp-server/
  index.js            # MCP server (stdio) + WebSocket (auto port 9876-9885)
  tools.js            # 23 tool definitions + provider token pages
  package.json        # Dependencies (@modelcontextprotocol/sdk, ws)
```

### Connection Flow
1. Claude Code starts → spawns MCP server via stdio
2. MCP server binds to first free port (9876-9885)
3. Extension's offscreen document scans ports every 2s
4. WebSocket connection established
5. Commands flow: Claude Code → MCP Server → Offscreen → Service Worker → Chrome APIs

### Keepalive
- Offscreen document is persistent (doesn't die like service workers)
- MCP server sends heartbeat ping every 20s
- Alarm re-ensures offscreen document every minute
- Port scanning every 2s discovers new/restarted servers

---

## Troubleshooting

### "Chrome extension not connected"
1. Check extension is loaded in Chrome (`chrome://extensions`)
2. Click popup → "Reconnect"
3. Wait 2-3 seconds (port scan interval)

### Stale sessions in popup
Old Claude Code conversations may leave MCP server processes:
```bash
lsof -i :9876-9885 | grep LISTEN  # see active servers
kill <PID>                         # kill specific ones
```

### Extension shows "Not connected"
MCP server isn't running — start a new Claude Code conversation.

### Screenshot fails
Chrome's `captureVisibleTab` requires the tab to be visible. Extension activates the tab automatically but fails on `chrome://` pages.

---

## Known Limitations

- **10 concurrent sessions max** (port range 9876-9885)
- **`chrome://` pages** — no tools work on Chrome internal pages
- **2FA/CAPTCHA** — requires `browser_ask_user` for human-in-the-loop
- **Strict CSP** — `browser_execute_script` may fail (use `browser_click`/`browser_fill` instead)
- **Screenshot** — requires visible tab, jpeg fallback on macOS GPU issues

---

## License

MIT
