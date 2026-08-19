# Add Browser MCP to Claude Code

**Give Claude Code control of your real, already-logged-in Chrome — install takes about 60 seconds.**

```bash
# 1. register the MCP server with Claude Code
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
# 2. get the Chrome extension (Chrome Web Store link in Step 2 below)
```

Run that, install the extension, restart Claude Code — done. 34 browser tools, your actual cookies and sessions, works on 2FA and CAPTCHA-gated sites where headless tools (Playwright, Puppeteer) get blocked. MIT-licensed, free, and 100% local — nothing leaves your machine.

If you want the full walkthrough, keep reading. If you just needed the command, that's it above.

---

## Step-by-step install (Claude Code)

**Why two steps?** Browser MCP is two halves and both are required: a **Chrome extension** that drives the browser, and a **local MCP server** that Claude Code talks to. Chrome forbids extensions installing themselves from npm, and npm cannot install a Chrome extension — so neither half can install the other. If you already have the extension (e.g. from the Chrome Web Store), you still need Step 1; if you only run Step 1, you still need Step 2.

### Step 1 — Register the MCP server with Claude Code

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

That is Claude Code's own MCP command, so the entry lands in the config Claude Code actually reads. `--scope user` makes Browser MCP available in every project instead of just the current directory; drop it if you only want it here.

Prefer to edit the config by hand? Add this to `~/.claude.json`:

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

The `@latest` matters: it is what makes the server update itself on every run.

If you want the extension files on disk too (for the unpacked install in Step 2), run:

```bash
npx @agent360/browser-mcp install
```

It copies the extension to `~/.browser-mcp/extension/` and prints the path — copy it, you'll need it in Step 2. Do not rely on it to configure Claude Code; use the `claude mcp add` command above for that.

### Step 2 — Load the extension in Chrome

Chrome doesn't let extensions install themselves from npm, so this one step is manual:

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top right)
3. Click **Load unpacked** (top left, next to "Pack extension")
4. Navigate to `~/.browser-mcp/extension/` and select it
   - **Mac:** in the file picker, press `Cmd+Shift+G`, paste `~/.browser-mcp/extension/`, hit Enter
   - **Windows:** paste `%USERPROFILE%\.browser-mcp\extension\` into the address bar
   - **Linux:** type `~/.browser-mcp/extension/` into the path field

Don't want Developer mode on? Use the [Chrome Web Store install](#no-developer-mode-chrome-web-store) instead — see below.

### Step 3 — Restart Claude Code

Restart Claude Code so it picks up the new MCP server. You'll see the Browser MCP icon appear in your Chrome toolbar — that's the extension connected. 34 browser tools are now available in any Claude Code conversation.

### Verify it's working

Ask Claude Code to navigate to a URL or take a screenshot of the current tab. If it acts instead of saying it has no browser access, you're connected.

---

## Alternative installs

### No npm? Manual zip download

1. Download the extension zip from the [latest GitHub release](https://github.com/Agent360dk/browser-mcp/releases/latest)
2. Unzip it anywhere (e.g. `~/Downloads/browser-mcp-extension/`)
3. Follow Step 2 above, but select the unzipped folder instead of `~/.browser-mcp/extension/`
4. Wire up Claude Code manually — add this to `~/.claude.json`:

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

Or skip the manual JSON entirely and let Claude Code write it:

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

### No Developer mode — Chrome Web Store

[Install from the Chrome Web Store →](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl)

No Developer mode toggle needed, and Chrome updates the extension automatically in the background. **This replaces Step 2, not Step 1** — the store hands you the extension, and the extension still needs a server to talk to. So run:

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

That registers the server and leaves your store-installed extension alone. Restart Claude Code afterwards.

**Installed from the store and the icon says "Not connected"?** That is Step 1 missing — not a bug. Run the command above, restart Claude Code, and it goes green.

---

## What your agent can do

### The 2FA killer move

This is the reason people install Browser MCP: Claude Code hits a login wall, needs a verification code, and — because it's driving your actual logged-in Chrome rather than a fresh headless session — it can switch to your own Gmail tab, read the code, and finish the sign-in itself. No API can do that; there's no "read my 2FA code" endpoint to call. It works because Browser MCP isn't simulating a browser, it's operating yours: your cookies, your sessions, your already-passed 2FA challenges.

The same real-session advantage is why it works on 2FA- and CAPTCHA-gated sites that block Playwright and Puppeteer — it is not a fresh anonymous session, it is yours. (We do not build detection-evasion; see when-not-to-use.)

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

Full source: [github.com/Agent360dk/browser-mcp](https://github.com/Agent360dk/browser-mcp).

### Why this over Playwright MCP

| | Browser MCP | Playwright MCP |
|---|---|---|
| Browser | Your real Chrome | Headless (fresh session) |
| Logins/cookies | Already authenticated | Must log in every time |
| 2FA / CAPTCHA-gated sites | Works — it's your session | Frequently blocked |
| Human-in-the-loop | `browser_ask_user` | None |
| Multi-session | 10 concurrent sessions, color-coded tab groups | Single session |
| Provider integrations | 9 built-in (Stripe, HubSpot, Slack, Shopify, Pipedrive, Calendly, Mailchimp, Google, LinkedIn) | None |
| Install | `npx @agent360/browser-mcp install` | `npx @playwright/mcp` |

### Running more than one Claude Code conversation at once

Each conversation gets its own MCP server on its own port (9876–9885), and the extension keeps every session's tabs in a separate color-coded Chrome tab group — one conversation can't see or click another's tabs. Idle sessions auto-exit after 4 hours without commands.

---

## FAQ

**How do I add an MCP server to Claude Code?**
Run `claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest`. That is Claude Code's built-in command for registering an MCP server, so no manual JSON is required. Restart Claude Code afterward so it picks up the new server.

**What is Browser MCP?**
An MCP (Model Context Protocol) server that gives Claude Code — or any MCP client, including Cursor and VS Code agent mode — control of your actual, already-logged-in Chrome: your cookies, your sessions, your 2FA. 34 tools, MIT-licensed, 100% local.

**Is it free?**
Yes. MIT license, no account, no paid tier.

**Does it only work with Claude Code, or also Cursor / VS Code?**
Any MCP-compatible client. The install command wires up Claude Code specifically. For Cursor or VS Code agent mode, add the same block to that client's MCP config instead:
```json
{"mcpServers": {"browser-mcp": {"command": "npx", "args": ["@agent360/browser-mcp@latest"]}}}
```

**Why do I have to load the extension manually instead of it just installing?**
Chrome blocks extensions from self-installing from npm or any script — that's a Chrome security boundary, not a Browser MCP limitation. Loading unpacked once, or installing from the Chrome Web Store, are the only two ways in.

**Does my browsing data leave my machine?**
No. The MCP server runs locally over stdio, talks to the extension over a local WebSocket, and the extension talks to Chrome through Chrome's own APIs. Nothing is sent to a remote server.

**How do I update it?**
The MCP server updates itself — every Claude Code session runs `npx @agent360/browser-mcp@latest` (note the `@latest` in your config), so there's nothing to do. The extension auto-updates only if you installed it from the Chrome Web Store; if you loaded it unpacked, re-run `npx @agent360/browser-mcp install` and click **↻ reload** on `chrome://extensions`.

**Chrome extension says "not connected" — what do I check?**
First: did you register the MCP server, not just install the extension? If you got the extension from the Chrome Web Store and never added the server to your MCP config, that is the whole problem — the extension has nothing to connect to. Run `claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest` and restart Claude Code. If the server *is* configured, confirm the extension is loaded under `chrome://extensions`, click the extension icon → "Reconnect," and give it 2–3 seconds — it scans ports 9876–9885 for the running server. Still stuck: [troubleshooting](/docs/troubleshooting).

**Is this the same as browsermcp.io?**
No — different project, same underlying idea (MCP + your real Chrome), separate codebase. If you found this page searching generically for "browser mcp," make sure you're grabbing the one you meant: this one is `@agent360/browser-mcp` on npm, `github.com/Agent360dk/browser-mcp` on GitHub.

**Can I run it across multiple Claude Code conversations at once?**
Yes — up to 10 concurrent sessions, each on its own port with its own color-coded Chrome tab group, so sessions can't see or control each other's tabs.