// KILDE: https://zcode.z.ai/en/docs/mcp-services

# Add Browser MCP to ZCode

**Give your ZCode agent control of your real, already-logged-in Chrome — install takes about 90 seconds.**

```bash
npx @agent360/browser-mcp install
```

Then in ZCode: **Settings → MCP Servers → New MCP Server**, set type `stdio`, command `npx`, argument `@agent360/browser-mcp` (full form fields and a paste-in JSON block below).

Load the extension once in Chrome, and you're driving your actual cookies and sessions — including sites gated by 2FA and CAPTCHA that block headless tools like Playwright and Puppeteer outright. 34 browser tools, MIT-licensed, free, and 100% local — nothing leaves your machine.

If you want the full walkthrough, keep reading. If you just needed the command, that's it above.

---

## Step-by-step install (ZCode)

### Step 1 — Get the extension files

```bash
npx @agent360/browser-mcp install
```

This copies the Chrome extension to `~/.browser-mcp/extension/` and prints the path in your terminal — copy it, you'll need it in Step 3. (It also writes a Claude Code MCP config entry as a side effect; harmless to ignore if ZCode is the only agent you use — Step 2 is what actually wires it into ZCode.)

### Step 2 — Add the MCP server in ZCode

Open ZCode → **Settings → MCP Servers → New MCP Server** (top-right corner).

**Form mode** (fastest):

| Field | Value |
|---|---|
| Scope | `User` (available in every workspace) — or `Workspace` to scope it to the current project only |
| Name | `browser-mcp` |
| Type | `stdio` (leave HTTP/SSE alone — Browser MCP runs locally over stdio, it's not a remote service) |
| Command | `npx` |
| Arguments | `@agent360/browser-mcp` |
| Environment variables | none — leave empty, no API key required |

**Or Full configuration mode** — paste this JSON directly instead of filling the form:

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

ZCode also advertises auto-detection of MCP servers you've already configured for Claude Code, Codex CLI, or OpenCode. If you ran Step 1 previously for one of those, check the "Configured MCP servers" list first — `browser-mcp` may already show up as a one-click import instead of something you need to type in. We couldn't pin down the exact detection path from ZCode's public docs, so treat this as a shortcut worth checking, not a guaranteed step.

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

### Step 4 — Confirm it's enabled and reload ZCode

Check that `browser-mcp` shows as **Enabled** in ZCode's MCP Servers list. If your agent doesn't see the browser tools right away, restart ZCode — that forces it to pick up the new server. You'll also see the Browser MCP icon appear in your Chrome toolbar once the extension connects.

### Verify it's working

Ask your ZCode agent to navigate to a URL or take a screenshot of the current tab. If it acts instead of saying it has no browser access, you're connected.

---

## Alternative installs

### No Developer mode — Chrome Web Store

[Install from the Chrome Web Store →](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl)

No Developer mode toggle needed, and Chrome updates the extension automatically in the background. You still need Step 2 (or the JSON block above) to register the server in ZCode.

### No npm? Manual zip download

1. Download the extension zip from the [latest GitHub release](https://github.com/Agent360dk/browser-mcp/releases/latest)
2. Unzip it anywhere (e.g. `~/Downloads/browser-mcp-extension/`)
3. Follow Step 3 above, but select the unzipped folder instead of `~/.browser-mcp/extension/`
4. Add the server in ZCode using the JSON block from Step 2 — no `npx install` run needed for this path.

---

## What your agent can do

### The 2FA killer move

This is the reason people install Browser MCP: your ZCode agent hits a login wall, needs a verification code, and — because it's driving your actual logged-in Chrome rather than a fresh headless session — it can switch to your own Gmail tab, read the code, and finish the sign-in itself. No API can do that; there's no "read my 2FA code" endpoint to call. It works because Browser MCP isn't simulating a browser, it's operating yours: your cookies, your sessions, your already-passed 2FA challenges.

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

`browser_extract_token` ships with zero-config shortcuts for 9 common dashboards (Stripe, HubSpot, Slack, Shopify, Pipedrive, Calendly, Mailchimp, Google, LinkedIn) — but it isn't limited to those. For anything else, the agent falls back to `browser_navigate` + `browser_get_page_content` and walks the dashboard itself.

Full source: [github.com/Agent360dk/browser-mcp](https://github.com/Agent360dk/browser-mcp).

### Why this over Playwright MCP

| | Browser MCP | Playwright MCP |
|---|---|---|
| Browser | Your real Chrome | Headless (fresh session) |
| Logins/cookies | Already authenticated | Must log in every time |
| 2FA / CAPTCHA / anti-bot sites | Works — it's your session | Frequently blocked |
| Human-in-the-loop | `browser_ask_user` | None |
| Multi-session | 10 concurrent sessions, color-coded tab groups | Single session |
| Provider dashboards | Zero-config shortcuts for 9 common ones, works with any | None |
| Install | `npx @agent360/browser-mcp install` | `npx @anthropic-ai/mcp-playwright` |

### Works with any MCP client

Browser MCP is a standard stdio MCP server — it has no idea which agent is driving it, and doesn't need to. The setup is identical for Cursor, VS Code agent mode, Claude Code, or anything else that speaks MCP: point the client at `npx @agent360/browser-mcp` with no arguments, and the 34 tools show up. This ZCode guide and the [Claude Code guide](/docs/install-claude-code) differ only in Step 2 — how each client's UI registers a stdio server.

### Running more than one agent session at once

Each session gets its own MCP server on its own port (9876–9885), and the extension keeps every session's tabs in a separate color-coded Chrome tab group — one session can't see or click another's tabs. Idle sessions auto-exit after 4 hours without commands.

---

## FAQ

**How do I add Browser MCP as an MCP server in ZCode?**
Run `npx @agent360/browser-mcp install` to fetch the extension files, then in ZCode go to Settings → MCP Servers → New MCP Server, set type `stdio`, command `npx`, argument `@agent360/browser-mcp`. Load the Chrome extension once (Step 3), confirm `browser-mcp` shows Enabled, and restart ZCode if the tools don't appear immediately.

**What is Browser MCP?**
An MCP (Model Context Protocol) server that gives ZCode — or any MCP client, including Claude Code, Cursor, and VS Code agent mode — control of your actual, already-logged-in Chrome: your cookies, your sessions, your 2FA. 34 tools, MIT-licensed, 100% local.

**Is it free?**
Yes. MIT license, no account, no paid tier.

**Does it only work with ZCode?**
No. It's a standard MCP server, so it works with any MCP-compatible client. Only Step 2 — how you register the server — differs between clients; Cursor and VS Code agent mode both take the same `{"mcpServers": {"browser-mcp": {"command": "npx", "args": ["@agent360/browser-mcp"]}}}` block.

**Why do I have to load the extension manually instead of it just installing?**
Chrome blocks extensions from self-installing from npm or any script — that's a Chrome security boundary, not a Browser MCP limitation. Loading unpacked once, or installing from the Chrome Web Store, are the only two ways in.

**Does my browsing data leave my machine?**
No. The MCP server runs locally over stdio, talks to the extension over a local WebSocket, and the extension talks to Chrome through Chrome's own APIs. Nothing is sent to a remote server.

**How do I update it?**
The MCP server updates itself — `npx @agent360/browser-mcp` always resolves to latest on npm, so there's nothing to do. The extension auto-updates only if you installed it from the Chrome Web Store; if you loaded it unpacked, re-run `npx @agent360/browser-mcp install` and click **↻ reload** on `chrome://extensions`.

**ZCode isn't picking up the browser tools — what do I check?**
First, confirm `browser-mcp` shows as **Enabled** in ZCode's MCP Servers list (adding it isn't always the same as it being active). Then confirm the Chrome extension is loaded under `chrome://extensions` — click the extension icon → "Reconnect" and give it 2–3 seconds, it scans ports 9876–9885 for the running MCP server. If both check out and it's still not showing, restart ZCode.

**Is this the same as browsermcp.io?**
No — different project, same underlying idea (MCP + your real Chrome), separate codebase. If you found this page searching generically for "browser mcp," make sure you're grabbing the one you meant: this one is `@agent360/browser-mcp` on npm, `github.com/Agent360dk/browser-mcp` on GitHub.

**Can I run it across multiple ZCode sessions at once?**
Yes — up to 10 concurrent sessions, each on its own port with its own color-coded Chrome tab group, so sessions can't see or control each other's tabs.