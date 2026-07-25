# Browser MCP — AI-assisted install guide

This file is written for an AI assistant (e.g. Cline) setting up **Browser MCP by Agent360**.
Follow it top to bottom. There is **one step only a human can do** — loading the Chrome
extension — and it is called out clearly. Do not claim the setup is finished until that step
is confirmed.

## What this server needs to work

Browser MCP has **two parts** that must both be present:

1. **The MCP server** (`@agent360/browser-mcp`, npm, stdio) — you can configure this.
2. **A Chrome extension** — this is what actually drives the user's real, logged-in Chrome.
   Chrome does not allow an extension to install itself from npm, so **a human loads it once.**

The server will start and list its 34 tools without the extension, but the tools only *do*
anything once the extension is loaded **and Chrome is running**. Tell the user this plainly.

## Step 1 — configure the MCP server

Run:

```bash
npx @agent360/browser-mcp install --skip-extension
```

This adds the `browser-mcp` server to the MCP client config (stdio, command `npx
@agent360/browser-mcp`). `--skip-extension` is correct here because the extension is handled
in Step 2 by the human.

If the client needs a manual config entry instead, use:

```json
{
  "mcpServers": {
    "browser-mcp": { "command": "npx", "args": ["@agent360/browser-mcp"] }
  }
}
```

## Step 2 — the Chrome extension (HUMAN action required)

Present **both** options to the user and let them choose. Option A is the easy, auto-updating
path; recommend it.

**Option A — Chrome Web Store (recommended, closest to one-click):**
1. Install from the Chrome Web Store:
   https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl
2. That's it — the extension auto-updates and needs no Developer mode.

**Option B — load unpacked (no Chrome Web Store):**
1. Run `npx @agent360/browser-mcp install` (without `--skip-extension`) to copy the extension
   files to `~/.browser-mcp/extension/`.
2. Open `chrome://extensions`, toggle **Developer mode** ON (top right).
3. Click **Load unpacked** and select `~/.browser-mcp/extension/`.

You (the AI) **cannot** perform Step 2 — it requires the user to act in their browser. Ask the
user to confirm they have completed it before proceeding.

## Step 3 — verify

Ask the user to make sure **Chrome is open**, then call `browser_list_tabs`. A successful
response (even with an empty tab list) means the server and extension are connected. If it
errors with "extension not connected", the extension is not loaded or Chrome is not running —
return to Step 2.

## Notes

- 100% local: the extension talks to the local MCP server over a localhost WebSocket; nothing
  leaves the machine.
- Full docs: https://browsermcp.dev · Troubleshooting: https://browsermcp.dev/docs/troubleshooting/
