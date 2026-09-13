# Browser MCP by [Agent360](https://agent360.dk)

**Your AI agent drives your real, logged-in Chrome - and works where headless tools die.**

It is the browser you are already signed into. No login step to fail, no API key to wire up,
no fresh profile that is a stranger to every account you have. Up to 20 agents at once, each
in its own colour-coded tab group. 40 tools, MIT, runs on your machine.

→ **[What it can and cannot get past](https://browsermcp.dev/docs/capability-matrix/)** - every
wall, marked *measured*, *by design*, *not yet*, or *won't*. Including the ones we have not fixed.

[![npm version](https://img.shields.io/npm/v/@agent360/browser-mcp)](https://www.npmjs.com/package/@agent360/browser-mcp)
[![npm downloads](https://img.shields.io/npm/dw/@agent360/browser-mcp)](https://www.npmjs.com/package/@agent360/browser-mcp)
[![GitHub stars](https://img.shields.io/github/stars/Agent360dk/browser-mcp)](https://github.com/Agent360dk/browser-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-live-green)](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl)


[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-000?logo=cursor)](https://cursor.com/install-mcp?name=browser-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyJAYWdlbnQzNjAvYnJvd3Nlci1tY3BAbGF0ZXN0Il19)
[![Add to VS Code](https://img.shields.io/badge/Add%20to-VS%20Code-0098FF?logo=visualstudiocode)](https://vscode.dev/redirect/mcp/install?name=browser-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22%40agent360%2Fbrowser-mcp%40latest%22%5D%7D)
[![Glama quality](https://glama.ai/mcp/servers/Agent360dk/browser-mcp/badges/score.svg)](https://glama.ai/mcp/servers/Agent360dk/browser-mcp)

[![Browser MCP Demo](https://raw.githubusercontent.com/Agent360dk/browser-mcp/main/assets/demo.gif)](https://browsermcp.dev)

▶ **[Watch the 37-second demo with sound →](https://browsermcp.dev)**

Browser MCP gives Claude Code (and any MCP client - Cursor, VS Code agent mode) control of your actual Chrome: your cookies, your sessions, your 2FA. So it works on CAPTCHA, 2FA and anti-bot sites where Playwright and Puppeteer get blocked - because it's *you* browsing.

The killer move: it hits a login wall, reads the verification code from your own Gmail tab, and continues the sign-in. No API can do that. Operate platforms with no API, QA your own web app end-to-end, or work dashboards, LinkedIn and Reddit at human pace - with you approving the sensitive steps.

40 tools. Auto-clicks the reCAPTCHA v2 checkbox, with a human fallback for the rest. Multi-session color-coded tab groups. **MIT, free, and it runs on your machine - no account, no telemetry, nothing sent to us.**

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl); Chrome keeps it updated. No store? See the unpacked install below.

**2 - Add the MCP server.** Paste this in a terminal. Required - the extension does nothing on its own:

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

**3 - Restart Claude Code.** That is what starts the server. The extension shows no badge until step 4 - the server only takes a port the first time your agent actually uses the browser. A green badge with the number of connected agents appears then; nothing on the icon before that is normal. (The icon itself never changes colour - it is the badge that turns green.)

**4 - Say this, to check it worked.** Paste it to Claude Code:

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.** → [What else to say](#youre-in-now-what)

Using Cursor, VS Code, Codex or Windsurf? Same server, that client's own config - see [browsermcp.dev/docs](https://browsermcp.dev/docs/install-cursor/). Everything below is the long version.

## The long version - install, step by step

> **Browser MCP is two halves and you need both:** a **Chrome extension** (drives the browser) and a **local MCP server** (what your agent actually talks to). Installing only the extension - e.g. straight from the Chrome Web Store - leaves it stuck on *"Not connected"*, because there is no server for it to reach. Chrome cannot install the server, and npm cannot install the extension. Hence two steps.

### Step 1: Register the MCP server with Claude Code

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

That is Claude Code's own MCP command, so the entry lands in the config Claude Code actually reads. `--scope user` makes it available in every project.

Want the extension files on disk for the unpacked install in Step 2? Also run:

```bash
npx @agent360/browser-mcp install
```

It copies the extension to `~/.browser-mcp/extension/` and **prints that path in the terminal - copy it.** (Use it for the extension files only; register the server with `claude mcp add` above.)

### Step 2: Load the extension in Chrome

> Chrome won't let extensions install themselves from npm - you load it manually one time. To **update** later, re-run the install command and reload it (see [Keeping it updated](#keeping-it-updated)). Prefer the [Chrome Web Store](#chrome-web-store-one-click-install) install if you'd rather have the extension auto-update.

1. **Open Chrome** and type `chrome://extensions` in the address bar
2. **Toggle "Developer mode"** ON (top right corner)
3. **Click "Load unpacked"** (top left, next to "Pack extension")
4. **Navigate to `~/.browser-mcp/extension/`** and click "Select"
   - On Mac: Press `Cmd+Shift+G` in the file picker, paste `~/.browser-mcp/extension/`, press Enter
   - On Windows: Paste `%USERPROFILE%\.browser-mcp\extension\` in the address bar
   - On Linux: Type `~/.browser-mcp/extension/` in the path field
5. **Restart Claude Code** so it picks up the new MCP server

That's it. The Browser MCP icon will appear in your toolbar, and 40 browser tools are now available in Claude Code.

### Alternative: Manual zip download (no npm)

If you don't want to use npm, download the extension directly:

1. [Download the extension zip](https://github.com/Agent360dk/browser-mcp/releases/latest) (`agent360-browser-mcp-<version>.zip`) from the latest GitHub release
2. Unzip the file (anywhere - e.g. `~/Downloads/browser-mcp-extension/`)
3. Follow Step 2 above, but select the unzipped folder instead of `~/.browser-mcp/extension/`
4. Register the server - run `claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest`, or add this to `~/.claude.json` by hand:
   ```json
   {
     "mcpServers": {
       "browser-mcp": {
         "command": "npx",
         "args": ["@agent360/browser-mcp@latest"]
       }
     }
   }
   ```

### Chrome Web Store (no Developer mode, auto-updating extension)

**This replaces Step 2 only - you still need Step 1.**

1. [**Install the extension from the Chrome Web Store →**](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl) - no Developer mode toggle, and Chrome keeps it updated for you.
2. Register the MCP server:
   ```bash
   claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
   ```
   (For Cursor / VS Code / Codex, use that client's own MCP config instead - see [browsermcp.dev/docs](https://browsermcp.dev/docs/install-claude-code/).)
3. Restart Claude Code.

Skip step 2 and the extension icon will sit on **"Not connected"** forever - that is the symptom of a missing MCP server, not a broken extension.

## You're in. Now what?

Nothing happens until you ask, and the hardest part of a new tool is knowing what to ask for. Paste one of these to your agent:

| Say this | What it shows |
|---|---|
| *"Take a screenshot of my current Chrome tab."* | **Start here.** An image back instead of *"I don't have browser access"* means both halves are talking. That is the whole install test. |
| *"Open my Gmail tab and tell me who sent my last 3 emails."* | The one that shows the difference - it works because it is *your* browser, already signed in. A headless tool hits a login wall here. |
| *"Go to my analytics dashboard, pull this month's numbers, and put them in a table."* | Any dashboard you are already logged into. No API key, no export, no integration to build first. |
| *"Fill in this signup form with my details. Stop and ask me before anything sensitive."* | You stay in the loop - it hands control back for passwords, payment details, or anything it should not decide alone. |
| *"Log me in here. If it emails a code, read it from my Gmail tab and continue."* | The move no API can make: it reads the one-time code out of your own inbox and finishes the sign-in. |
| *"Walk through my app's signup flow as a real user and tell me where it breaks."* | End-to-end QA of your own product, in the same browser your users have. |

The pattern: **anything you would do yourself in a browser, on a site you are already signed into.** It is strongest where there is no API - internal dashboards, admin panels, portals, LinkedIn. Built something good? [Add it to the gallery](USE_CASES.md).

## Why This Over Playwright MCP / BrowserMCP?

| | Browser MCP | Playwright MCP | BrowserMCP.io |
|---|---|---|---|
| **Browser** | Your real Chrome, via extension | Persistent profile by default, or your Chrome via their extension | Your real Chrome |
| **Maintained** | Actively - latest release v1.29.0 (2026-09-07) | Actively (Microsoft) | Last commit Apr 2025 |
| **Logins/cookies** | Your existing session | Persistent profile keeps logins between runs | Already authenticated |
| **Several agents, one logged-in profile** | 20 concurrent, each with its own color-coded tab group | Their docs: concurrent clients on one profile *conflict* - each extra client needs `--isolated` or its own `--user-data-dir` | Single session |
| **Human-in-the-loop** | `browser_ask_user` - 2FA, CAPTCHA, credential input | None | None |
| **Provider integrations** | 9 built-in (Stripe, HubSpot, Slack...) | None | None |
| **CORS bypass** | `browser_fetch` from extension background | N/A | Limited |
| **Network monitoring** | `browser_wait_for_network` via CDP | Built-in | None |
| **CSP-strict sites** | Chrome Debugger API throughout | Works (headless) | Limited |
| **Custom dropdowns** | Angular Material, React Select support | Works (headless) | Limited |
| **Install** | `claude mcp add` + extension from the Chrome Web Store | `npx @playwright/mcp` | Manual clone |

### The pages that defeat everything else

The reason this works where headless dies is not that it slips past anything. It is that
there is nothing to slip past: it is your Chrome, your session, your consent. What is left
is the hard part - pages that fight *any* automation because of how they are built.

Every release is gated on a flow test against a real Chrome that has to survive exactly
those: all 40 tools are exercised, and the gate also checks that the extension Chrome is
running is the one being released — not another copy with the same version number. The
failures that do show up are honest ones: mouse events are not delivered to a tab that is
not in front, and the tools say so instead of reporting success. What the test covers

- **strict CSP** - navigate, read, execute, wait and click all still work (falls back to
  the Chrome Debugger API when script injection is blocked)
- **cross-origin iframes** - seen into and reached inside
- **shadow DOM** - selectors reach through it
- **controlled inputs** - `fill` sticks in a React-style controlled field
- **honesty checks** - `click` refuses a 0×0 element instead of hitting (0,0), and says so
  when the page never took the event

That last group matters most. A tool that quietly reports success is worse than one that
fails, because you build on the answer. Where we still fall short of it, it is written
down: see [#19](https://github.com/Agent360dk/browser-mcp/issues/19).

> **Corrected 2026-09-07.** This table used to say Playwright MCP was headless and made you
> log in every time. That was wrong, and it had been wrong for a while - Microsoft's own README
> documents a persistent profile as the default, plus a browser extension for using the Chrome
> you already have. The row that actually survives is the one above it, and it is their
> documented limitation, not our claim: *"A persistent profile can only be used by one browser
> instance at a time, so concurrent MCP clients sharing the same workspace will conflict."*
> If you run one agent, Playwright MCP will serve you well. The difference shows up when you
> run twenty against the same logged-in browser.

> **On the name:** the similarly-named `browsermcp.io` (`@browsermcp/mcp`) is a different, unaffiliated project with no commits since April 2025. This is Browser MCP by Agent360 (`@agent360/browser-mcp`) - actively maintained. [Full side-by-side →](https://browsermcp.dev/compare/browsermcp-io/)

### Environment variables

Both are optional. Neither is needed for normal use.

| Variable | Effect |
|---|---|
| `BROWSER_MCP_CHECK_NPM=1` | Makes `browser_provide_feedback` also compare this server against the latest version published on npm. Off by default, so the call stays fast and works offline. |
| `BROWSER_MCP_EXTENSION_ID=<32-char id>` | Pins the server to one specific Chrome extension. Use it when more than one copy of Browser MCP is loaded and you want a given session to always talk to the same one. |

## 40 Tools

### Navigation & Content
| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to URL (reuses tab, or `new_tab=true`) |
| `browser_get_page_content` | Get page text or HTML |
| `browser_screenshot` | Screenshot via Chrome Debugger (works even when tab isn't focused) |
| `browser_execute_script` | Run JavaScript in page context |
| `browser_extract_list` | Read every row of a long/virtualised list by scrolling its container until no new rows appear |

### Interaction
| Tool | Description |
|------|-------------|
| `browser_click` | Click via CSS or text selector (`text=Submit`, `button:text(Next)`) |
| `browser_fill` | Fill input fields (works on CSP-strict sites) |
| `browser_press_key` | Keyboard events (Enter, Tab, Escape, modifiers) |
| `browser_scroll` | Scroll to element or by pixels |
| `browser_wait` | Wait for element to appear |
| `browser_hover` | Hover for tooltips/dropdowns |
| `browser_select_option` | Native `<select>` + custom dropdowns (Angular Material, React Select) |
| `browser_set_combobox` | Autocomplete/combobox: type query → wait for filtered listbox → click option (multi-value chip support). Use when `browser_select_option` fails on lazy-rendered options |
| `browser_set_date` | Robust date inputs: tries native value-set → masked typing → calendar-picker navigation (MUI/AntD/react-datepicker/Lexical). Use when `browser_fill` fails on date fields |
| `browser_dismiss_overlays` | Bulk-dismiss popups/modals/tooltips/banners via aria-label/text/×-char heuristics. `non_critical` mode preserves dialogs with form data |
| `browser_handle_dialog` | Accept/dismiss native alert/confirm/prompt dialogs |
| `browser_double_click` | True double-click (two trusted press/release pairs) |
| `browser_right_click` | Right-click to open page-level context menus |
| `browser_click_xy` | Escape hatch: click at raw viewport coordinates (CSS pixels) with trusted mouse events |
| `browser_reattach_debugger` | Recovery: force-detach and re-attach the Chrome debugger on the current tab |

### Tabs & Frames
| Tool | Description |
|------|-------------|
| `browser_list_tabs` | List session's tabs only |
| `browser_switch_tab` | Switch to tab by ID |
| `browser_close_tab` | Close tab (session-owned only) |
| `browser_get_new_tab` | Get most recently opened tab (OAuth popups) |
| `browser_list_frames` | List iframes on page |
| `browser_select_frame` | Execute JS in specific iframe |

### Data & Network
| Tool | Description |
|------|-------------|
| `browser_fetch` | HTTP request from extension (bypasses CORS) |
| `browser_wait_for_network` | Wait for specific API call to complete |
| `browser_extract_token` | Navigate to provider dashboard + extract API token |

### CAPTCHA Solving
| Tool | Description |
|------|-------------|
| `browser_solve_captcha` | Detect and solve CAPTCHAs. Auto-detects reCAPTCHA v2/v3, hCaptcha, Turnstile, FunCaptcha. Actions: `detect`, `click_checkbox` (auto-click, often passes when signed into Google), `click_grid` (AI vision guided), `ask_human` (fallback) |

### Human-in-the-Loop
| Tool | Description |
|------|-------------|
| `browser_ask_user` | Show overlay dialog for 2FA, CAPTCHA, credentials, or any user input |

### Data
| Tool | Description |
|------|-------------|
| `browser_get_cookies` | Get cookies for a site this session has open |
| `browser_set_cookies` | Set cookies for a domain |
| `browser_get_local_storage` | Read localStorage from page |
| `browser_set_local_storage` | Write localStorage values |
| `browser_console_logs` | Capture console.log/warn/error messages from page |
| `browser_upload_file` | Upload files to `<input type="file">` via Chrome Debugger API (no dialog) |
| `browser_drop_file` | Upload via drop-zones: finds hidden `<input type="file">` in target subtree/parent (up to 2 levels). Use when `browser_upload_file` fails because the zone has no visible input |

### Diagnostics & feedback
| Tool | Description |
|------|-------------|
| `browser_provide_feedback` | Self-check + report in one call. Compares this server against the latest on npm, the connected extension against this server, and detects **more than one Browser MCP extension connected at once** - the three things that explain most "it just stopped working" moments. Returns a verdict (`current` / `outdated` / `conflict` / `disconnected`), concrete fix steps, and a pre-filled issue link for whatever is genuinely missing. Your agent calls it on its own whenever a tool blocks it |
| `browser_about` | Project info + pre-filled links to submit a wish, use-case, or bug |

## Multi-Session Support

Each Claude Code conversation gets its own MCP server on a unique port (9876-9895). The Chrome extension connects to all active servers simultaneously.

```
Claude Session 1 ←(stdio)→ MCP :9876 ←(WS)→
Claude Session 2 ←(stdio)→ MCP :9877 ←(WS)→  Chrome Extension → Browser
Claude Session 3 ←(stdio)→ MCP :9878 ←(WS)→
```

- **Session isolation** - each session gets a color-coded Chrome Tab Group
- **Tab ownership** - sessions can only see and control their own tabs
- **Auto-cleanup** - processes exit when Claude Code closes the conversation
- **Ports are taken on demand** - a server binds its port on the first browser call, not
  at startup, and releases it 5 minutes after its last tab closes. A chat that never
  touches the browser never occupies a slot.

### Running the agent on another machine

The extension only connects to `127.0.0.1`, deliberately - it will not talk to a remote
WebSocket. If your MCP gateway runs on a different box than your browser, forward the port
range over SSH.

Recipe below contributed by [@bkuri](https://github.com/Agent360dk/browser-mcp/issues/1),
who ran into exactly this and solved it. Linux + systemd; needs `autossh` locally and your
public key already on the server:

```ini
# ~/.config/systemd/user/browser-mcp-tunnel.service
[Unit]
Description=SSH tunnel for browser-mcp WebSocket (ports 9876-9895)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/sh -c '/usr/bin/autossh -M 0 -N \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes -o LogLevel=ERROR \
  $(for p in $(seq 9876 9895); do printf " -L %s:127.0.0.1:%s" "$p" "$p"; done) \
  server-name'
Restart=on-failure
RestartSec=5
Environment="AUTOSSH_GATETIME=0"

[Install]
WantedBy=default.target
```

Replace `server-name`, then `systemctl --user enable --now browser-mcp-tunnel.service`.

> The original recipe listed ports 9876-9885 by hand - the range was ten back then. It is
> twenty now, so the loop above generates them instead of hard-coding a list that goes
> stale the next time the range changes.

## Built-in Provider Integrations

`browser_extract_token` navigates to the provider's API settings page and guides token extraction:

| Provider | Token Format | Dashboard |
|----------|-------------|-----------|
| Stripe | `sk_test_...` / `sk_live_...` | stripe.com/apikeys |
| HubSpot | `pat-...` | app.hubspot.com |
| Slack | `xoxb-...` | api.slack.com/apps |
| Shopify | Admin API token | admin.shopify.com |
| Pipedrive | UUID | app.pipedrive.com |
| Calendly | JWT | calendly.com |
| Mailchimp | `...-us1` | admin.mailchimp.com |
| Google | OAuth Client | console.cloud.google.com |
| LinkedIn | Client ID/Secret | linkedin.com/developers |

## Architecture

```
extension/
  manifest.json       # Manifest V3
  background.js       # Service worker - Chrome API dispatcher, session tab groups
  offscreen.js        # Persistent WebSocket bridge (multi-port scanning)
  popup.html/js       # Status UI - sessions, tabs, action log

mcp-server/
  index.js            # MCP server (stdio) + WebSocket client
  tools.js            # 40 tool definitions
  bin/cli.js          # Install CLI
```

### How It Works
1. Claude Code starts → spawns MCP server via stdio
2. MCP server binds to first available port (9876-9895)
3. Extension's offscreen document scans ports every 2s
4. WebSocket connection established
5. Commands flow: Claude Code → MCP → Extension → Chrome APIs
6. Process auto-exits when Claude Code closes (stdin detection)

## Keeping it updated

Browser MCP has two parts, and they update independently - how the **extension** updates depends on how you installed it:

| Part | Install method | How it updates |
|------|----------------|----------------|
| **MCP server** | any | **Automatic.** Runs via `npx @agent360/browser-mcp@latest`, so every Claude Code session pulls the newest from npm. Nothing to do. |
| **Extension** | **Chrome Web Store** | **Automatic, but not immediate.** A new version first has to pass Google's review, which usually takes 1-3 days; Chrome then picks it up in the background within hours. Nothing to do, but a fix published today does not reach you today. |
| **Extension** | **Unpacked** (`npx … install` or manual zip) | **Manual.** Chrome never auto-updates a load-unpacked extension. Re-run `npx @agent360/browser-mcp install`, then open `chrome://extensions` → Browser MCP → **↻ reload**. |

**Not sure which you have?** Open `chrome://extensions` and find Browser MCP. If it shows a **"Loaded from /path/…"** line, it's unpacked (manual updates). If there's no such line, it came from the Chrome Web Store (auto-updates).

**Want zero-maintenance updates?** Install the extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl), then run `claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest` to register the server. After that, both parts stay current on their own - as long as your config uses `@agent360/browser-mcp@latest`.

## Troubleshooting

**"Chrome extension not connected"**
- Check extension is loaded in `chrome://extensions`
- Click the extension popup → "Reconnect"
- Wait 2-3 seconds for port scan

**Screenshot fails**
- Uses the Chrome Debugger API for your session's own tab (works even when the tab isn't focused)
- From 1.29.1 there is no fallback that captures whichever tab happens to be visible: if the debugger can't produce a frame, the call fails. (1.29.0 and earlier could fall back to the visible tab.) Run `browser_reattach_debugger` and try again

**Click doesn't work on SPA**
- Try text selector: `browser_click("text=Submit")`
- Uses real mouse events via Chrome Debugger API automatically

**Stale processes**
- Processes auto-exit when Claude Code closes (stdin detection)
- Idle timeout: 4 hours without commands → auto-exit
- Manual cleanup: `lsof -i :9876-9895 | grep LISTEN`

## 💡 Help Shape Browser MCP

Browser MCP is built in the open and shaped by the people using it.

### Browse what others want / built
- 💡 **[Wishlist →](WISHLIST.md)** - features people are asking for
- 🎯 **[Use-cases →](USE_CASES.md)** - what others have built (LinkedIn ICP scraping, vendor research, daily ops, …)

### Contribute in 30 seconds
- 💡 [Wish for a feature](https://github.com/Agent360dk/browser-mcp/issues/new?template=wish.yml)
- 🎯 [Share a use-case](https://github.com/Agent360dk/browser-mcp/issues/new?template=use-case.yml)
- 🐛 [Report a bug](https://github.com/Agent360dk/browser-mcp/issues/new?template=bug.yml)

Or just **ask Claude** - it knows about the `browser_about` tool and will draft + submit on your behalf when you say things like *"I wish browser-mcp could …"* or *"share my browser-mcp use-case"*.

### If it works for you

The Chrome Web Store ranks on ratings, and we have none - so a sentence from you moves this
further than anything we can write. [Leave a review](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl/reviews)
if it earned one, and say so honestly if it did not. No signup, no reward, nothing gated
behind it - we just have no signal at all right now.

## License

MIT - [Agent360](https://agent360.dk)
