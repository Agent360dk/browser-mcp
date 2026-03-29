# Agent360 Browser MCP

Chrome Extension + MCP Server der lader Claude Code styre din rigtige browser — navigere, klikke, læse sideindhold, hente cookies, bede brugeren om input og mere.

**Multi-session support:** Op til 10 samtidige Claude Code sessions, hver med sin egen farvekodede Chrome Tab Group.

```
Claude Code Session 1 ←(stdio)→ MCP Server (:9876) ←(WS)→
Claude Code Session 2 ←(stdio)→ MCP Server (:9877) ←(WS)→  Chrome Extension → Browser
Claude Code Session N ←(stdio)→ MCP Server (:9878) ←(WS)→
```

## Setup

### 1. Installer MCP server dependencies
```bash
cd agent360/chrome-extension-mcp/mcp-server
npm install
```

### 2. Load Chrome Extension
1. Åbn `chrome://extensions`
2. Slå **Developer mode** til (toggle øverst til højre)
3. Klik **Load unpacked**
4. Vælg mappen: `agent360/chrome-extension-mcp/extension/`
5. Extension "Agent360 Browser MCP" dukker op med Agent360 ikon

### 3. Tilføj til Claude Code
```bash
claude mcp add agent360-browser node /path/to/agent360/chrome-extension-mcp/mcp-server/index.js
```

Eller manuelt i `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "agent360-browser": {
      "command": "node",
      "args": ["/path/to/agent360/chrome-extension-mcp/mcp-server/index.js"]
    }
  }
}
```

### 4. Genstart Claude Code
Luk og åbn Claude Code. MCP serveren starter automatisk og finder en ledig port (9876-9885). Extension auto-connecter inden for 2 sekunder.

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
