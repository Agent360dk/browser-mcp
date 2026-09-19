// KILDE: sessions-modellen laest i extension/background.js (tabGroups, 20 porte 9876-9895) + mcp-server/index.js:45-46, 19/9-2026. ⚠️ Microsofts udvidelse giver OGSAA hver klient sin egen fanegruppe (deres README l.41-43, maalt 19/9) - siden maa ikke paastaa at det er vores alene.

# Several VS Code agents, one browser, no fighting over tabs

*Suggested URL: `/use-cases/vscode-concurrent-sessions` · Suggested title tag: "Multiple VS Code Agents, One Chrome (2026): Colour-Coded Tab Groups" · Suggested meta description: "Run several agent conversations against the same logged-in Chrome. Each gets its own colour-coded tab group and cannot touch the others' tabs." · Last verified: September 19, 2026*

---

**The problem in one line:** two agent conversations share a browser, and the second one closes the first one's tab.

Browser MCP gives each session its own colour-coded Chrome tab group. A session sees its own tabs and nothing else. Up to twenty at once.

## What it looks like

Three conversations running against one Chrome:

```
  ● blue    Claude Code   - reading the analytics dashboard
  ● green   Copilot agent - filling a form in the admin panel
  ● orange  Codex         - watching a deploy log
```

Three groups in your tab strip, three colours, three names. `browser_list_tabs` in the blue session returns blue's tabs. It cannot close green's.

And this is the exchange when one session reaches for another's tab:

```
You:     Close the tab with the deploy log.

Copilot: [browser_list_tabs]
         I can see three tabs, all green - the analytics dashboard, the admin
         form and a blank tab. The deploy log is not among them; it belongs to
         another session.

You:     Close it anyway.

Copilot: [browser_close_tab  tab_id: 481]
         Error: Tab 481 does not belong to this session (green)
         I cannot. That is the isolation doing its job, not a bug.
```

The refusal is the feature. A session that could close another session's tabs
would make three parallel agents unusable the first time two of them disagreed.

## Setting it up

**1 - The Chrome extension.** [One click from the Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - The MCP server.** Command Palette → **MCP: Add Server**, or `.vscode/mcp.json`:

```json
{
  "servers": {
    "browser-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@agent360/browser-mcp@latest"]
    }
  }
}
```

⚠️ VS Code's key is `servers`, not `mcpServers`. Every other client uses the other one. Full walkthrough: [Install for VS Code](/docs/install-vscode/).

## How the isolation actually works

Each server takes one port from a range of twenty (9876-9895), and the port is what identifies the session. The extension keeps a tab group per port. A tool call arrives on a port, and it can only reach the tabs in that port's group.

Two consequences worth knowing:

**Twenty is the real ceiling.** Twenty-one conversations, and the twenty-first gets no port and says so rather than sharing someone else's.

**The port is taken on first use, not at startup.** A server that never touches the browser never takes a port, so idle conversations do not consume the range.

## The honest comparison

This is not something only we do. Microsoft's Playwright extension gives each connected client its own coloured tab group too - their own README says so, and we measured it on 19 September. If tab-group isolation is your whole requirement, both tools have it.

What differs is what happens when a run needs a human: none of Playwright MCP's 72 tools can stop and ask you for a code. [The full comparison, with the parts that go against us](/compare/playwright-mcp/).

## Two things to know before you rely on it

**Only the visible tab gets mouse and keyboard.** Chrome does not deliver input to a tab that is not the visible one in its window - so with three sessions running, only the one you are looking at can click and type. Reading works everywhere. Since 1.29.2 the tools say which case you are in instead of reporting a success that did not happen.

We measured whether giving each session its own window would fix that. **It does not** - what matters is whether the window has focus, not whether the tab is visible in it. [The measurement](https://github.com/Agent360dk/browser-mcp/blob/main/test/aerlighed/RESULTAT-vindueshypotesen-2026-09-19.md).

## Frequently asked questions

**Can two sessions open the same page?**
Yes. They get separate tabs in separate groups, with the same cookies - it is one browser profile.

**What happens if I close a session's group by hand?**
The session notices and creates a new tab on its next call.

**Do the twenty ports conflict with anything else?**
They are bound only when a session first touches the browser, and released when it exits.

**Does this work outside VS Code?**
Yes, the same twenty apply across all clients. Three Claude Code windows and two Cursor windows share the same twenty.
