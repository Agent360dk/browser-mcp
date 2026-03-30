# Agent360 Browser MCP

Chrome Extension + MCP Server der lader Claude Code styre din rigtige browser — navigere, klikke, læse sideindhold, hente cookies, bede brugeren om input og mere.

**Multi-session support:** Op til 10 samtidige Claude Code sessions, hver med sin egen farvekodede Chrome Tab Group.

```
Claude Code Session 1 ←(stdio)→ MCP Server (:9876) ←(WS)→
Claude Code Session 2 ←(stdio)→ MCP Server (:9877) ←(WS)→  Chrome Extension → Browser
Claude Code Session N ←(stdio)→ MCP Server (:9878) ←(WS)→
```

## Quick Start

```bash
# 1. Clone repo
git clone https://github.com/Agent360dk/browser-mcp.git
cd browser-mcp

# 2. Install MCP server dependencies
cd mcp-server && npm install && cd ..

# 3. Add to Claude Code
claude mcp add agent360-browser $(which node) $(pwd)/mcp-server/index.js

# 4. Load Chrome Extension
#    chrome://extensions → Developer mode ON → Load unpacked → select browser-mcp/extension/

# 5. Restart Claude Code
```

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
5. "Agent360 Browser MCP" appears with the Agent360 icon

### 3. Add to Claude Code
```bash
claude mcp add agent360-browser $(which node) /path/to/browser-mcp/mcp-server/index.js
```

Or manually in your project's `.mcp.json`:
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

Agent360 Browser MCP replaces Playwright MCP, BrowserMCP, and similar tools. Run with **only one browser MCP** for best performance — multiple browser MCPs cause conflicts (duplicate tool names, tab fighting, unpredictable routing).

```bash
claude mcp remove Playwright
claude mcp remove browsermcp
```

### 5. Restart Claude Code
Close and reopen Claude Code. The MCP server starts automatically and finds a free port (9876-9885). The extension auto-connects within 2 seconds.

---

## Usage

Once set up, Claude Code can control your browser directly. Just ask naturally:

### Navigation & Reading
```
"Open railway.com and show me what's there"
"Go to my Stripe dashboard and take a screenshot"
"Read the page content on forbrugeragenten.dk"
```

### Clicking & Forms
```
"Click the Deploy button"
"Fill in the email field with test@example.com"
"Wait for the loading spinner to disappear"
```

### Authentication & Tokens
```
"Log into Railway and extract my API token"
"Get the cookies from this domain"
"Read localStorage for the auth token"
```

### Human-in-the-Loop
```
"Ask me to solve the CAPTCHA"
"Ask the user for their 2FA code"
```

### Multi-Tab Workflows
```
"Open Stripe in one tab and Railway in another, then compare the data"
"List my open tabs"
"Switch to the Railway tab"
```

### Example: Deploy a Service
```
You: "Go to Railway, find the langfuse service, and click Deploy"

Claude Code:
1. browser_navigate → railway.com/project/...
2. browser_screenshot → sees the dashboard
3. browser_click → clicks the langfuse service
4. browser_click → clicks Deploy button
5. browser_screenshot → confirms deployment started
```

All 16 tools are available automatically — Claude Code picks the right one based on your request.

---

## Multi-Session Support

Hver Claude Code conversation starter sin egen MCP server på en unik port. Extensionen scanner automatisk for alle aktive servere.

- **Session isolation:** Hver session får sin egen Chrome Tab Group med farve (blå, grøn, gul, etc.)
- **Tab ownership:** `navigate` opretter tabs i sessionens gruppe — sessions kan ikke trampe på hinandens tabs
- **`list_tabs`** returnerer kun sessionens egne tabs
- **Auto-cleanup:** Når en session lukker, un-groupes tabs automatisk (de forbliver åbne)

Popup viser alle aktive sessions med deres tabs:

```
Claude 1 (port 9876) 🔵
  • agent360.dk/blog
  • stripe.com/dashboard

Claude 2 (port 9877) 🟢
  • facebook.com/me
```

---

## Tools (16 stk)

### Navigation & Content
| Tool | Beskrivelse |
|------|-------------|
| `browser_navigate` | Navigér til URL (opretter tab i sessionens gruppe) |
| `browser_get_page_content` | Hent sidens tekst eller HTML |
| `browser_screenshot` | Screenshot af synlig side (PNG, jpeg fallback) |
| `browser_execute_script` | Kør JavaScript i page context |

### Interaktion
| Tool | Beskrivelse |
|------|-------------|
| `browser_click` | Klik element via CSS selector |
| `browser_fill` | Udfyld input-felt med værdi |
| `browser_wait` | Vent på element (CSS selector, timeout) |

### Tabs & Frames
| Tool | Beskrivelse |
|------|-------------|
| `browser_list_tabs` | Sessionens egne tabs |
| `browser_switch_tab` | Skift til tab via ID (kun egne tabs) |
| `browser_get_new_tab` | Hent senest åbnede tab (OAuth popups) |
| `browser_list_frames` | Liste over iframes på siden |
| `browser_select_frame` | Kør JS i specifik iframe |

### Data
| Tool | Beskrivelse |
|------|-------------|
| `browser_get_cookies` | Hent cookies for domæne |
| `browser_get_local_storage` | Læs localStorage fra aktiv side |
| `browser_extract_token` | Navigér til provider dashboard + extract API token |

### Human-in-the-Loop
| Tool | Beskrivelse |
|------|-------------|
| `browser_ask_user` | Vis overlay-dialog til brugeren — 2FA, CAPTCHA, credentials, input |

`browser_ask_user` kan vise:
- **Simpel bekræftelse:** "Løs venligst CAPTCHA'en" → Done/Skip knapper
- **Input fields:** Email, password, API key felter → returnerer brugerens svar

---

## Arkitektur

```
extension/
  manifest.json       # Manifest V3, permissions, icons
  background.js       # Service worker — Chrome API dispatcher, session tab groups
  offscreen.js        # Persistent WebSocket bridge (multi-port scanning)
  offscreen.html      # Offscreen document container
  popup.html/js       # Status UI — sessions, tabs, action log
  icons/              # Agent360 favicon ikoner (16/48/128px)

mcp-server/
  index.js            # MCP server (stdio) + WebSocket (auto port 9876-9885)
  tools.js            # 16 tool definitions + provider pages
  package.json        # Dependencies (@modelcontextprotocol/sdk, ws)
```

### Connection Flow
1. Claude Code starter → spawner MCP server via stdio
2. MCP server binder til første ledige port (9876-9885)
3. Extension's offscreen document scanner porte hvert 2s
4. WebSocket connection established
5. Commands flyder: Claude Code → MCP Server → Offscreen → Service Worker → Chrome APIs
6. Responses returnerer samme vej

### Keepalive
- Offscreen document er persistent (dør ikke som service workers)
- MCP server sender heartbeat ping hvert 20s
- Alarm re-sikrer offscreen document hvert minut
- Port scanning hvert 2s finder nye/genoprettede servere

---

## Fejlfinding

### "Chrome extension not connected"
1. Tjek at extension er loaded i Chrome (`chrome://extensions`)
2. Klik popup → "Reconnect"
3. Vent 2-3 sekunder (port scan interval)

### Stale sessions i popup
Gamle Claude Code conversations kan efterlade MCP server-processer:
```bash
lsof -i :9876-9885 | grep LISTEN  # se aktive servere
kill <PID>                         # dræb specifikke
```

### Extension viser "Ikke forbundet"
MCP serveren kører ikke — start en ny Claude Code conversation.

### Screenshot fejler
Chrome's `captureVisibleTab` kræver at tab'en er synlig. Extension aktiverer tab'en automatisk men kan fejle på `chrome://` sider.

---

## Kendte begrænsninger

- **10 samtidige sessions max** (port range 9876-9885)
- **`chrome://` sider** — ingen tools virker på Chrome-interne sider
- **2FA/CAPTCHA** — kræver `browser_ask_user` for human-in-the-loop
- **Streng CSP** — `browser_execute_script` kan fejle på sider med strict Content Security Policy
- **Screenshot** — kræver synlig tab, jpeg fallback på macOS GPU issues
