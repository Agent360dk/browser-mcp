// KILDE: https://kiro.dev/docs/mcp/configuration/ + https://kiro.dev/docs/mcp/ (hentet 19/9-2026, to uafhaengige research-koersler enige om noegle, sti og hot-reload). ⚠️ PATH-faelden er MAALT fra deres egen dokumentation: Kiro arver ikke shellens PATH. Den er den hyppigste grund til at "npx" fejler her og ingen andre steder - fjern den ikke.

# Install Browser MCP for Kiro

*Suggested URL: `/docs/install-kiro` · Suggested title tag: "Browser MCP for Kiro (AWS): Your Real Logged-In Chrome (2026)" · Suggested meta description: "Four steps. Kiro drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give Kiro control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Open the MCP config.** Command Palette → **Kiro: Open user MCP config (JSON)** for every workspace, or **Kiro: Open workspace MCP config (JSON)** for just this one. There is also an "Open MCP Config" icon in the Kiro panel.

**3 - Add the server:**

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "npx",
      "args": ["-y", "@agent360/browser-mcp@latest"],
      "env": {},
      "disabled": false
    }
  }
}
```

**4 - Say this, to check it worked:**

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## The one that catches people here and nowhere else

**Kiro does not inherit your shell's PATH.**

If `npx` works in your terminal but the server will not start in Kiro, this is why: Kiro runs with its own environment, and a bare command name may not resolve. Their own documentation says to test the command first and use a full path if needed. On a typical macOS setup that is something like `/usr/local/bin/npx` or `~/.nvm/versions/node/<version>/bin/npx` - run `which npx` and use what it tells you.

This is not a Browser MCP quirk. It hits every MCP server in Kiro, and it is the reason a config that is character-for-character correct can still do nothing.

## Where the files live

| | |
|---|---|
| Global (all workspaces) | `~/.kiro/settings/mcp.json` |
| Workspace | `.kiro/settings/mcp.json` |

Same paths on macOS, Linux and Windows. Both are merged, and workspace wins on a conflict.

## Things worth knowing before you hit them

**Hot-reload, no restart.** Saving the file restarts only the servers that changed, at the next quiet moment between turns.

**`autoApprove: ["*"]` approves everything from that server.** It exists, and for a browser tool that can read any page you are signed in to, it is worth leaving off until you know what you are approving.

**Environment variables get a security prompt.** Kiro asks before passing them through. Expected, not a fault.

## What Kiro can do with your real browser

It browses **as you**. Your AWS console already signed in, the 2FA code from the Gmail tab you already have open, the form on the page you were looking at.

And when it hits something only you can decide, `browser_ask_user` stops, asks you on your own screen, and carries on in the same tab.

## Frequently asked questions

**The JSON is right and nothing happens. What now?**
Almost always PATH. Run `which npx` in a terminal and put the full path in `command`.

**Global or workspace?**
Global if you want your browser everywhere; workspace if it belongs to one project. Workspace wins where both define the same server.

**Do I need to restart Kiro after editing?**
No. It hot-reloads the servers that changed.

**Why does the extension show nothing after step 3?**
The server only takes a port the first time real work arrives. Ask for a screenshot and the badge appears.
