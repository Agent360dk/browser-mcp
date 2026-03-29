# Agent360 Browser MCP

Chrome Extension der lader Claude Code styre din rigtige browser — navigere, klikke, læse sideindhold, hente cookies og mere.

```
Claude Code ←(stdio)→ MCP Server ←(WebSocket :9876)→ Chrome Extension ←→ Browser tabs
```

## Setup

### 1. Installer MCP server
```bash
cd agent360/chrome-extension-mcp/mcp-server
npm install
```

### 2. Load Chrome Extension
- Åbn `chrome://extensions`
- Slå **Developer mode** til (toggle øverst til højre)
- Klik **Load unpacked**
- Vælg mappen: `agent360/chrome-extension-mcp/extension/`
- Extension "Agent360 Browser MCP" dukker op med grønt badge

### 3. Tilføj til Claude Code
```bash
claude mcp add agent360-browser $(which node) $(pwd)/agent360/chrome-extension-mcp/mcp-server/index.js
```

### 4. Genstart Claude Code
Luk og åbn Claude Code panelet. MCP serveren starter automatisk.

Extension auto-connecter til `ws://127.0.0.1:9876` — popup viser "Forbundet til MCP server".

---

## Tools (16 stk)

| Tool | Beskrivelse |
|------|-------------|
| `browser_navigate` | Navigér aktiv tab til URL |
| `browser_get_page_content` | Hent sidens tekst eller HTML |
| `browser_screenshot` | Screenshot af synlig side (base64 PNG) |
| `browser_execute_script` | Kør JavaScript i page context |
| `browser_click` | Klik element via CSS selector |
| `browser_fill` | Udfyld input-felt med værdi |
| `browser_wait` | Vent på element (CSS selector) |
| `browser_list_tabs` | Liste over alle åbne tabs |
| `browser_switch_tab` | Skift til tab via ID |
| `browser_get_new_tab` | Hent senest åbnede tab (OAuth popups) |
| `browser_get_cookies` | Hent cookies for domæne |
| `browser_get_local_storage` | Læs localStorage fra aktiv side |
| `browser_list_frames` | Liste over iframes på siden |
| `browser_select_frame` | Kør JS i specifik iframe |
| `browser_ask_user` | Vis overlay-dialog til brugeren (2FA, CAPTCHA, input) |
| `browser_extract_token` | Navigér til provider dashboard + extract token |

---

## Kendte begrænsninger

- **`browser_execute_script`** — fejler på sider med streng CSP (de fleste dashboards). Brug `browser_get_page_content` i stedet.
- **`browser_screenshot`** — kræver `activeTab` invocation. Kan fejle på nogle sider.
- **`chrome://` sider** — ingen tools virker på Chrome-interne sider.

---

## Fejlfinding

**"Chrome extension not connected"**
- Tjek at extension er loaded i Chrome (`chrome://extensions`)
- Klik reload (🔄) på extensionen
- Popup skal vise "Forbundet til MCP server"

**Port 9876 i brug**
```bash
lsof -i :9876  # find processen
kill -9 <PID>  # dræb den
```
Genstart derefter Claude Code.

**Extension viser "Ikke forbundet"**
- MCP serveren kører ikke — genstart Claude Code
- Eller: klik "Reconnect" i popup

---

## Filer

```
chrome-extension-mcp/
  extension/
    manifest.json       # Manifest V3 + permissions
    background.js       # Service worker — Chrome API dispatcher
    offscreen.js        # Persistent WebSocket client
    offscreen.html      # Offscreen document container
    popup.html/js       # Status UI + action log
    icons/              # Extension ikoner
  mcp-server/
    index.js            # MCP server (stdio) + WebSocket server
    tools.js            # 16 tool definitions
    package.json        # Dependencies
  INTEGRATION_TASKS.md  # Provider-by-provider token extraction guide
```
