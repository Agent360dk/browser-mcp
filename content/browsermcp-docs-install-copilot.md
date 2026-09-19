// KILDE: https://code.visualstudio.com/docs/agent-customization/mcp-servers + https://code.visualstudio.com/docs/agents/reference/mcp-configuration (hentet 19/9-2026, to uafhaengige research-koersler enige om at noeglen er `servers`). 74.604.637 installationer af GitHub Copilot paa VS Code Marketplace, hentet 19/9. ⚠️ 128-vaerktoejs-graensen staar KUN i deres issue-tracker, ikke i dokumentationen - derfor er den formuleret forsigtigt her. Fjern ikke forbeholdet.

# Install Browser MCP for GitHub Copilot agent mode

*Suggested URL: `/docs/install-copilot` · Suggested title tag: "Browser MCP for GitHub Copilot Agent Mode (VS Code, 2026)" · Suggested meta description: "Four steps. Copilot agent mode drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give Copilot agent mode control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Add the server.** Easiest way: Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) → **MCP: Add Server** → follow the guided flow and pick Workspace or Global.

**3 - Or write the file yourself** - `.vscode/mcp.json` in your project:

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

**4 - Say this, to check it worked.** In agent mode:

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## The one thing that trips everyone up

**The key is `servers`. Not `mcpServers`.**

Every other client on this site uses `mcpServers`. VS Code does not. If you paste a working block from Cline, Cursor or Claude Desktop straight into `.vscode/mcp.json`, nothing happens and nothing tells you why. It is the single most common reason this looks broken.

## Things worth knowing before you hit them

**You will get a trust dialog** the first time the server starts, and you should. Their documentation notes that starting a server directly from the `mcp.json` file skips that prompt - which is worth knowing rather than relying on.

**No restart needed.** VS Code starts servers that have never run and restarts ones whose config changed. `MCP: List Servers` gives you manual start, stop and restart per server.

**There may be a tool ceiling.** The VS Code issue tracker reports a limit of 128 tools per chat request in Copilot agent mode, mitigated by `github.copilot.chat.virtualTools.threshold`. It is not in the official documentation, so treat it as a thing to recognise if you see it rather than a rule.

**Copilot's own file is not ours, and not Cline's.** Three MCP config files can live in one editor: `.vscode/mcp.json` (Copilot, key `servers`), Cline's own settings file (key `mcpServers`), and the user-level file behind **MCP: Open User Configuration**.

## What Copilot can do with your real browser

It browses **as you**. Your admin dashboard already signed in, the 2FA code from the Gmail tab you already have open, the form on the page you were looking at. Nothing to re-authenticate, because it is your authenticated browser.

And when it hits something only you can decide, `browser_ask_user` stops, asks you on your own screen, and carries on in the same tab.

## Frequently asked questions

**Does this work in Copilot chat, or only agent mode?**
Agent mode. MCP tools are an agent-mode feature.

**Where is the user-level config file?**
VS Code does not publish the path - use **MCP: Open User Configuration** from the Command Palette and it opens the right one for your profile.

**Why does the extension show nothing after step 3?**
The server only takes a port the first time real work arrives. Ask for a screenshot and the badge appears.
