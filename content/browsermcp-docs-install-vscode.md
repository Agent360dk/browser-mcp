// KILDE: https://code.visualstudio.com/docs/agent-customization/mcp-servers

# Add Browser MCP to VS Code (Agent Mode)

**Give VS Code's Copilot agent mode control of your real, already-logged-in Chrome — install takes about 90 seconds.**

```bash
# 1. One-time: installs the Chrome extension files
npx @agent360/browser-mcp install

# 2. Registers the server with VS Code (user profile, works in every window)
code --add-mcp "{\"name\":\"browser-mcp\",\"command\":\"npx\",\"args\":[\"@agent360/browser-mcp\"]}"
```

Run those two, load the extension once in Chrome, switch Copilot Chat to **Agent** mode — done. 34 browser tools, your actual cookies and sessions, works on 2FA and CAPTCHA-gated sites where headless tools (Playwright, Puppeteer) get blocked. MIT-licensed, free, and 100% local — nothing leaves your machine.

If you want the full walkthrough, keep reading. If you just needed the commands, that's it above.

---

## Step-by-step install (VS Code, Agent mode)

### Before you start: GitHub Copilot Chat + Agent mode

Browser MCP's tools surface inside Copilot Chat, so you need the **GitHub Copilot Chat** extension installed (the free tier is enough) and the chat mode dropdown switched from **Ask** (or **Edit**) to **Agent** — MCP tools only run in Agent mode.

### Step 1 — Install the Chrome extension files

```bash
npx @agent360/browser-mcp install
```

This copies the extension to `~/.browser-mcp/extension/` and prints the path — copy it, you'll need it in Step 3. (It also writes a Claude Code config entry if you have Claude Code installed; harmless to ignore if you don't.)

### Step 2 — Register the MCP server with VS Code

Pick whichever of these three is easiest — they all end up in the same place.

**A. One-line CLI (fastest)**

```bash
code --add-mcp "{\"name\":\"browser-mcp\",\"command\":\"npx\",\"args\":[\"@agent360/browser-mcp\"]}"
```

Writes the server into your VS Code **user profile** config, so it's available in every window, not just one project. Requires the `code` CLI on your `PATH` — if it's not recognized, run `Shell Command: Install 'code' command in PATH` from the Command Palette first.

**B. Command Palette guided flow**

1. `Cmd+Shift+P` / `Ctrl+Shift+P` → **MCP: Add Server**
2. Choose **Workspace** (writes `.vscode/mcp.json` in this project, good for committing so teammates get it too) or **Global** (user profile, same result as method A)
3. Pick **stdio** as the server type, `npx` as the command, `@agent360/browser-mcp` as the argument

**C. Edit the JSON by hand**

Workspace-level — create or edit `.vscode/mcp.json` at your project root:

```json
{
  "servers": {
    "browser-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["@agent360/browser-mcp"]
    }
  }
}
```

For user-level instead, run **MCP: Open User Configuration** from the Command Palette and paste the same block. Note the root key is `servers` — VS Code's own convention, not `mcpServers` (that's the Claude Code / Cursor key — don't copy-paste a Claude Code config block in here verbatim).

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

### Step 4 — Start the server and switch to Agent mode

- After you save the config (Step 2), start the server: run **MCP: List Servers** from the Command Palette and choose **Start**/**Enable** (VS Code may also show an inline Start action directly above the server entry when you open the config file — check for it, but `MCP: List Servers` always works). A trust prompt appears the first time; approve it.
- Open Copilot Chat and switch the mode dropdown to **Agent**.
- The Browser MCP icon appears in your Chrome toolbar once the extension connects. 34 browser tools are now available in Agent mode.

### Verify it's working

Ask Copilot Chat (in Agent mode) to navigate to a URL or screenshot the current tab. If it acts instead of saying it has no browser access, you're connected.

---

## Alternative installs

### No npm? Manual zip download

1. Download the extension zip from the [latest GitHub release](https://github.com/Agent360dk/browser-mcp/releases/latest)
2. Unzip it anywhere (e.g. `~/Downloads/browser-mcp-extension/`)
3. Follow Step 3 above, but select the unzipped folder instead of `~/.browser-mcp/extension/`
4. Register the server with VS Code — `code --add-mcp "{\"name\":\"browser-mcp\",\"command\":\"npx\",\"args\":[\"@agent360/browser-mcp\"]}"`, or add the `.vscode/mcp.json` block from Step 2C by hand

### No Developer mode — Chrome Web Store

[Install from the Chrome Web Store →](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl)

No Developer mode toggle needed, and Chrome updates the extension automatically in the background. Then register the server with VS Code using either method from Step 2 above — the extension and the MCP server config are independent of each other.

---

## What your agent can do

### The 2FA killer move

This is the reason people install Browser MCP: Copilot Chat (Agent mode) hits a login wall, needs a verification code, and — because it's driving your actual logged-in Chrome rather than a fresh headless session — it can switch to your own Gmail tab, read the code, and finish the sign-in itself. No API can do that; there's no "read my 2FA code" endpoint to call. It works because Browser MCP isn't simulating a browser, it's operating yours: your cookies, your sessions, your already-passed 2FA challenges.

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

`browser_extract_token` ships with zero-config shortcuts for 9 common services (Stripe, HubSpot, Slack, Shopify, Pipedrive, Calendly, Mailchimp, Google, LinkedIn) — but it isn't limited to those. For anything else, your agent falls back to `browser_navigate` + `browser_get_page_content` on the provider's own dashboard, so it works for any service, not just the pre-wired nine.

Full source: [github.com/Agent360dk/browser-mcp](https://github.com/Agent360dk/browser-mcp).

### Why this over Playwright MCP

| | Browser MCP | Playwright MCP |
|---|---|---|
| Browser | Your real Chrome | Headless (fresh session) |
| Logins/cookies | Already authenticated | Must log in every time |
| 2FA / CAPTCHA / anti-bot sites | Works — it's your session | Frequently blocked |
| Human-in-the-loop | `browser_ask_user` | None |
| Multi-session | 10 concurrent sessions, color-coded tab groups | Single session |
| Provider shortcuts | 9 zero-config (Stripe, HubSpot, Slack, Shopify, Pipedrive, Calendly, Mailchimp, Google, LinkedIn) — works for any provider via fallback | None |
| Install | `npx @agent360/browser-mcp install` + `code --add-mcp` | `npx @anthropic-ai/mcp-playwright` |

### Multi-session support

Each running MCP server — whether spawned by VS Code, Claude Code, or Cursor — binds to its own port in the 9876–9885 range, and the Chrome extension keeps every session's tabs in a separate, color-coded tab group, so one session can't see or click another's tabs. Up to 10 concurrent sessions are supported; idle ones auto-exit after 4 hours without commands. That means a VS Code window and a Claude Code conversation can drive Chrome side by side without colliding.

---

## Works with any MCP client

Browser MCP is a standard MCP server over stdio — nothing about it is VS Code-specific under the hood. The exact same `npx @agent360/browser-mcp` command works in Claude Code, Cursor, or any other MCP-compatible client; only the config file, and its root key (`servers` here vs. `mcpServers` elsewhere), differs. Also using Claude Code? See the [Claude Code install guide](/docs/install-claude-code).

---

## FAQ

**How do I add an MCP server to VS Code?**
Run `code --add-mcp "{\"name\":\"browser-mcp\",\"command\":\"npx\",\"args\":[\"@agent360/browser-mcp\"]}"` from a terminal, or open the Command Palette (`Cmd/Ctrl+Shift+P`) → **MCP: Add Server** → choose Workspace or Global → **stdio** → command `npx`, argument `@agent360/browser-mcp`. Start the server afterward via **MCP: List Servers** from the Command Palette.

**Do I need GitHub Copilot?**
Yes. Browser MCP's tools surface through Copilot Chat's Agent mode, so you need the GitHub Copilot Chat extension installed and signed in (the free tier is enough) with the chat mode dropdown set to **Agent** — not Ask or Edit.

**Workspace config or user/global config — which should I use?**
Workspace (`.vscode/mcp.json`) if you want the server scoped to one project and want to commit the config so teammates get it automatically. User/global (via `code --add-mcp` or **MCP: Open User Configuration**) if you want it available in every VS Code window. Browser MCP works identically either way.

**Why is the JSON key `servers` instead of `mcpServers`?**
That's VS Code's own convention — Claude Code and Cursor use `mcpServers` as the root key, VS Code uses `servers`. Same server, same package (`@agent360/browser-mcp`), different config wrapper. Don't copy a Claude Code config block into `.vscode/mcp.json` verbatim — swap the root key.

**What is Browser MCP?**
An MCP (Model Context Protocol) server that gives VS Code's Copilot agent mode — or any MCP client, including Claude Code and Cursor — control of your actual, already-logged-in Chrome: your cookies, your sessions, your 2FA. 34 tools, MIT-licensed, 100% local.

**Is it free?**
Yes. MIT license, no account, no paid tier. (GitHub Copilot's free tier is enough to use Agent mode.)

**Does my browsing data leave my machine?**
No. The MCP server runs locally over stdio, talks to the extension over a local WebSocket, and the extension talks to Chrome through Chrome's own APIs. Nothing is sent to a remote server.

**How do I update it?**
The MCP server updates itself — every session runs `npx @agent360/browser-mcp@latest`, so there's nothing to do. The extension auto-updates only if you installed it from the Chrome Web Store; if you loaded it unpacked, re-run `npx @agent360/browser-mcp install` and click **↻ reload** on `chrome://extensions`.

**Chrome extension says "not connected" — what do I check?**
Confirm it's loaded under `chrome://extensions`, click the extension icon → "Reconnect," and give it 2–3 seconds — it scans ports 9876–9885 for the running MCP server.

**Is this the same as browsermcp.io?**
No — different project, same underlying idea (MCP + your real Chrome), separate codebase. If you found this page searching generically for "browser mcp," make sure you're grabbing the one you meant: this one is `@agent360/browser-mcp` on npm, `github.com/Agent360dk/browser-mcp` on GitHub.

**Can I run it in more than one VS Code window at once?**
Yes — each running server instance gets its own port (9876–9885) and its own color-coded Chrome tab group, so concurrent windows or clients don't see or control each other's tabs.