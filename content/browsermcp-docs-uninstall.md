// KILDE: permissions verbatim fra extension/manifest.json (tabs, tabGroups, cookies, scripting, activeTab, storage, alarms, offscreen, notifications, webNavigation, debugger + host_permissions <all_urls>). "100% local / nothing leaves your machine" fra README (verificeret 2026-07-21). Uninstall-trin fra CWS + npm standard.

# Uninstalling Browser MCP — and exactly what data it touches

*Suggested URL: `/docs/uninstall` · Suggested title tag: "Uninstall Browser MCP + Exactly What Data It Touches (2026)" · Suggested meta description: "How to fully remove Browser MCP, every Chrome permission it requests and why, and the one thing that matters most: nothing it reads ever leaves your machine." · Last verified: July 21, 2026*

---

**Short answer:** removing Browser MCP is two steps — delete the Chrome extension and drop the MCP server from your client's config. And the question behind the question — "what did it have access to?" — has a short answer too: the extension holds broad Chrome permissions because driving your real browser requires them, but it runs 100% locally and transmits nothing. There is no account, no server of ours, and no telemetry. Uninstalling leaves nothing behind on our side because there was never anything on our side.

## Uninstall in two steps

1. **Remove the Chrome extension.** Open `chrome://extensions`, find Browser MCP, and click **Remove**. If you loaded it unpacked, delete the extension folder too.
2. **Remove the MCP server from your client.** Delete the `browser-mcp` entry from your MCP config (e.g. `claude mcp remove browser-mcp`, or delete the block from your Cursor/VS Code/Codex config). If you installed globally, `npm uninstall -g @agent360/browser-mcp`.

That's it. There is no uninstaller to run, no account to close, and no data of yours on any server to delete.

## Exactly what the extension can access — and why

Browser MCP requests broad permissions for one reason: its whole job is to operate the real, logged-in Chrome you already use. A tool that drives your browser needs the same reach you have. Here is the full list from the extension manifest, with what each is for:

| Permission | Why it's needed |
|---|---|
| `tabs`, `tabGroups`, `activeTab` | See and switch between your tabs; group concurrent sessions |
| `scripting`, `debugger` | Click, type and read pages via trusted events (works on React/Angular and CSP-strict sites) |
| `cookies` | Act inside sites you're already logged into — the entire point |
| `webNavigation` | Know when a page has actually finished loading before acting |
| `storage`, `alarms`, `offscreen`, `notifications` | Local extension state, the WebSocket bridge, and status prompts |
| `<all_urls>` (host access) | So the agent can work on whatever site *you* point it at — not a fixed list |

This is a lot of access, and we won't pretend otherwise. It is the same access any tool would need to do what this one does. What makes it safe is not a short permission list — it's where the data goes.

## The one thing that matters: nothing leaves your machine

The extension talks to a local MCP server over a `127.0.0.1` WebSocket bridge, and that server talks to your MCP client on the same machine. There is no Agent360 backend in the loop. Your pages, cookies, sessions and keystrokes are never sent to us — there is nowhere for them to be sent, because we don't run a server that receives them. The project is open source (MIT), so this isn't a promise you have to take on trust: you can read `extension/background.js` and confirm there is no outbound telemetry.

## FAQ

**Does uninstalling delete my data from your servers?**
There's nothing to delete — Browser MCP has no account and no server that stores your data. Removing the extension and the config entry is complete removal.

**Why does it need access to all sites and my cookies?**
Because it drives *your* logged-in browser on whatever site you choose. Cookies are how you stay logged in; `<all_urls>` is so you're not limited to a pre-approved list. Neither is transmitted anywhere.

**Is the debugger permission dangerous?**
It's what lets the agent send trusted clicks and reads that work on strict sites. Chrome shows its standard "Browser MCP started debugging this browser" banner while a session is active; it clears when the session ends.

**Can I verify the "nothing leaves your machine" claim myself?**
Yes — it's MIT-licensed open source. Read `extension/background.js` and `mcp-server/index.js`; there is no outbound analytics or telemetry endpoint.
