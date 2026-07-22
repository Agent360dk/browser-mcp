// KILDE: https://cursor.com/docs/mcp

# Add Browser MCP to Cursor

**Give Cursor's agent control of your real, already-logged-in Chrome — install takes about 60 seconds.**

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "npx",
      "args": ["@agent360/browser-mcp"]
    }
  }
}
```

Paste that into `~/.cursor/mcp.json` (global — available in every project) or `.cursor/mcp.json` inside one project (that project only), reload Cursor, then load the Chrome extension once — done. 34 browser tools, your actual cookies and sessions, works on 2FA and CAPTCHA-gated sites where headless tools (Playwright, Puppeteer) get blocked. MIT-licensed, free, and 100% local — nothing leaves your machine.

If you want the full walkthrough, keep reading. If you just needed the config block, that's it above.

---

## Step-by-step install (Cursor)

### Step 1 — Run the installer (gets the Chrome extension onto disk)

```bash
npx @agent360/browser-mcp install
```

This copies the Chrome extension files to `~/.browser-mcp/extension/` — the terminal prints the path, copy it, you'll need it in Step 3. As a side effect it also writes a `browser-mcp` entry into Claude Code's config; harmless to leave in place even if you don't use Claude Code.

### Step 2 — Point Cursor at the MCP server

Cursor doesn't read Claude Code's config, so it needs its own entry. Two ways to add it:

**A — Edit the config file directly (most reliable):**

Open (or create) one of these and add the `mcpServers` block from the top of this page:

- `~/.cursor/mcp.json` — global, the server is available in every Cursor project
- `.cursor/mcp.json` inside a specific project's folder — that project only

**B — Use Cursor's UI:** open Cursor Settings (gear icon, top right) → **Tools & MCP** → **New MCP Server**. The exact menu wording has moved before across Cursor releases; if you don't see it, editing the JSON file directly (Method A) always works. The UI method just opens the same `mcp.json` for you to fill in.

### Step 3 — Load the extension in Chrome

Chrome doesn't let extensions install themselves from npm, so this one step is manual:

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked** (top left, next to "Pack extension")
4. Navigate to `~/.browser-mcp/extension/` and select it
   - **Mac:** in the file picker, press `Cmd+Shift+G`, paste `~/.browser-mcp/extension/`, hit Enter
   - **Windows:** paste `%USERPROFILE%\.browser-mcp\extension\` into the address bar
   - **Linux:** type `~/.browser-mcp/extension/` into the path field

Don't want Developer mode on? Use the [Chrome Web Store install](#no-developer-mode-chrome-web-store) instead — see below.

### Step 4 — Reload Cursor

Reload the window (`Cmd/Ctrl+Shift+P` → "Reload Window") or fully quit and reopen Cursor — it reads `mcp.json` on startup and launches the server process automatically. Open **Cursor Settings → Tools & MCP** and confirm `browser-mcp` shows as loaded with an active status dot.

### Verify it's working

Ask Cursor's agent to navigate to a URL or take a screenshot of the current tab. If it acts instead of saying it has no browser access, you're connected.

---

## Alternative installs

### No npm? Manual zip download

1. Download the extension zip from the [latest GitHub release](https://github.com/Agent360dk/browser-mcp/releases/latest)
2. Unzip it anywhere (e.g. `~/Downloads/browser-mcp-extension/`)
3. Follow Step 3 above, but select the unzipped folder instead of `~/.browser-mcp/extension/`
4. Add the `mcpServers` block from the top of this page to `~/.cursor/mcp.json` (or `.cursor/mcp.json` for one project) by hand

### No Developer mode — Chrome Web Store

[Install from the Chrome Web Store →](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl)

No Developer mode toggle needed, and Chrome updates the extension automatically in the background. Then add the same `mcpServers` block to Cursor's config as in Step 2 — the Chrome Web Store install only replaces Step 3, not Step 2.

---

## Works with any MCP client

Browser MCP is a standard stdio MCP server — it doesn't know or care which client is driving it. The same `npx @agent360/browser-mcp` command works for Cursor, Claude Code, VS Code's agent mode, Windsurf, or any other MCP-compatible client; only the config file it goes into changes. See the [Claude Code install](/docs/install-claude-code) if you also use that.

---

## What your agent can do

### The 2FA killer move

This is the reason people install Browser MCP: Cursor's agent hits a login wall, needs a verification code, and — because it's driving your actual logged-in Chrome rather than a fresh headless session — it can switch to your own Gmail tab, read the code, and finish the sign-in itself. No API can do that; there's no "read my 2FA code" endpoint to call. It works because Browser MCP isn't simulating a browser, it's operating yours: your cookies, your sessions, your already-passed 2FA challenges.

The same real-session advantage is why it clears CAPTCHA and anti-bot checks that block Playwright and Puppeteer outright — the traffic genuinely is coming from a human-operated Chrome, because it is one.

### 34 tools

| Category | Tools |
|---|---|
| **Navigation & content** | `browser_navigate`, `browser_get_page_content`, `browser_screenshot`, `browser_execute_script` |
| **Interaction** | `browser_click`, `browser_fill`, `browser_press_key`, `browser_scroll`, `browser_wait`, `browser_hover`, `browser_select_option`, `browser_set_combobox`, `browser_set_date`, `browser_dismiss_overlays`, `browser_handle_dialog` |
| **Tabs & frames** | `browser_list_tabs`, `browser_switch_tab`, `browser_close_tab`, `browser_get_new_tab`, `browser_list_frames`, `browser_select_frame` |
| **Data & network** | `browser_get_cookies`, `browser_set_cookies`, `browser_get_local_storage`, `browser_set_local_storage`, `browser_fetch`, `browser_wait_for_network`, `browser_extract_token`, `browser_console_logs`, `browser_upload_file`, `browser_drop_file` |
| **CAPTCHA assistance** | `browser_solve_captcha` - detects reCAPTCHA v2/v3, hCaptcha, Turnstile and FunCaptcha, attempts the checkbox, then hands the challenge to you if it cannot. No third-party solving service |
| **Human-in-the-loop** | `browser_ask_user` — overlay dialog for 2FA, CAPTCHA, or credential input, right inside the page |
| **Meta** | `browser_about` — session/extension info |

`browser_extract_token` ships with zero-config shortcuts for 9 common services (Stripe, HubSpot, Slack, Shopify, Mailchimp, Pipedrive, Calendly, Google, LinkedIn) — but it isn't limited to them. For any other provider, the agent falls back to `browser_navigate` + `browser_get_page_content` to find and extract the token itself.

Full source: [github.com/Agent360dk/browser-mcp](https://github.com/Agent360dk/browser-mcp).

### Why this over Playwright MCP

| | Browser MCP | Playwright MCP |
|---|---|---|
| Browser | Your real Chrome | Headless (fresh session) |
| Logins/cookies | Already authenticated | Must log in every time |
| 2FA / CAPTCHA / anti-bot sites | Works — it's your session | Frequently blocked |
| Human-in-the-loop | `browser_ask_user` | None |
| Multi-session | 10 concurrent sessions, color-coded tab groups | Single session |
| Install | Config block above | `npx @anthropic-ai/mcp-playwright` |

### Running more than one Cursor conversation at once

Each conversation gets its own MCP server on its own port (9876–9885), and the extension keeps every session's tabs in a separate color-coded Chrome tab group — one conversation can't see or click another's tabs. Idle sessions auto-exit after 4 hours without commands.

---

## FAQ

**How do I add an MCP server to Cursor?**
Add a `browser-mcp` entry to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in a project (project-only) — the block is at the top of this page. Or use the UI: Cursor Settings → Tools & MCP → New MCP Server. Reload the window or restart Cursor afterward so it picks up the new server.

**What is Browser MCP?**
An MCP (Model Context Protocol) server that gives Cursor — or any MCP client, including Claude Code and VS Code agent mode — control of your actual, already-logged-in Chrome: your cookies, your sessions, your 2FA. 34 tools, MIT-licensed, 100% local.

**Is it free?**
Yes. MIT license, no account, no paid tier.

**Does it only work with Cursor, or also Claude Code / VS Code?**
Any MCP-compatible client. It's the exact same server and the exact same config block — `{"mcpServers": {"browser-mcp": {"command": "npx", "args": ["@agent360/browser-mcp"]}}}` — only the file you paste it into changes per client.

**Should I use the global or project config?**
Global (`~/.cursor/mcp.json`) if you want Browser MCP available in every Cursor project, which is what most people want. Project-scoped (`.cursor/mcp.json` inside one repo) if you only want it active there — useful if you're on a team and don't want it turning up in a shared repo's config for everyone else.

**Why do I have to load the extension manually instead of it just installing?**
Chrome blocks extensions from self-installing from npm or any script — that's a Chrome security boundary, not a Browser MCP limitation. Loading unpacked once, or installing from the Chrome Web Store, are the only two ways in.

**Does my browsing data leave my machine?**
No. The MCP server runs locally over stdio, talks to the extension over a local WebSocket, and the extension talks to Chrome through Chrome's own APIs. Nothing is sent to a remote server.

**How do I update it?**
The MCP server updates itself — every run uses `npx @agent360/browser-mcp`, so there's nothing to pin or bump. The extension auto-updates only if you installed it from the Chrome Web Store; if you loaded it unpacked, re-run `npx @agent360/browser-mcp install` and click **↻ reload** on `chrome://extensions`.

**Chrome extension says "not connected" — what do I check?**
Confirm it's loaded under `chrome://extensions`, click the extension icon → "Reconnect," and give it 2–3 seconds — it scans ports 9876–9885 for the running MCP server.

**I already run several other MCP servers in Cursor — will Browser MCP's 34 tools be a problem?**
Cursor limits how many tools can be active across all your MCP servers combined, so if you're already close to that ceiling, disable tools you don't need from **Settings → Tools & MCP** (you can toggle individual tools per server, not just whole servers).

**Is this the same as browsermcp.io?**
No — different project, same underlying idea (MCP + your real Chrome), separate codebase. If you found this page searching generically for "browser mcp," make sure you're grabbing the one you meant: this one is `@agent360/browser-mcp` on npm, `github.com/Agent360dk/browser-mcp` on GitHub.

**Can I run it across multiple Cursor windows/conversations at once?**
Yes — up to 10 concurrent sessions, each on its own port with its own color-coded Chrome tab group, so sessions can't see or control each other's tabs.