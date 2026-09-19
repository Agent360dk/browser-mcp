// KILDE: https://docs.cline.bot/mcp/configuring-mcp-servers + https://docs.cline.bot/mcp/mcp-overview (hentet 19/9-2026, to uafhaengige research-koersler enige om skema og noegle). Installationstal: marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev = 5.376.095, hentet 19/9. ⚠️ OS-stierne til cline_mcp_settings.json staar IKKE ordret i docs.cline.bot - derfor peger siden paa UI-knappen som foerstevalg og naevner stien som sekundaer. Skriv aldrig en sti her uden at kunne citere kilden.

# Install Browser MCP for Cline

*Suggested URL: `/docs/install-cline` · Suggested title tag: "Browser MCP for Cline: Drive Your Logged-In Chrome (2026)" · Suggested meta description: "Four steps. Cline drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give Cline control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Open Cline's MCP settings.** In the Cline panel, click the **MCP Servers** icon, then **Configure MCP Servers**. That opens the right file for your install - don't go hunting for the path yourself.

**3 - Add the server.** Cline uses the `mcpServers` key:

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "npx",
      "args": ["-y", "@agent360/browser-mcp@latest"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

**4 - Say this, to check it worked.** Paste it to Cline:

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## Things worth knowing before you hit them

**Cline watches the config file.** Saving it restarts the changed server; you do not need to reload VS Code. There is also a per-server restart button in the MCP panel.

**`autoApprove` is a loaded gun.** It is an array of tool names that run without asking you. Cline's own documentation says to limit it to safe tools, and we agree: `browser_navigate` is one thing, `browser_execute_script` is another. Leaving it empty, as above, means every call asks.

**Cline's config is not VS Code's config.** If you also use GitHub Copilot's agent mode, that reads `.vscode/mcp.json` with a completely different key (`servers`, not `mcpServers`). Two files, two schemas, same editor. Pasting one into the other fails silently.

**The CLI version uses a different file.** Standalone Cline reads `~/.cline/mcp.json`. The VS Code extension does not.

## What Cline can do with your real browser

The point is not "Cline can browse". It is that it browses **as you**. It opens your admin dashboard already signed in, reads the 2FA code from the Gmail tab you already have open, and fills the form on the page you were looking at. Nothing to re-authenticate, because it is your authenticated browser.

And when it hits something only you can decide - a 2FA code, a CAPTCHA, a choice between three accounts - `browser_ask_user` stops, asks you on your own screen, and carries on in the same tab.

## Frequently asked questions

**Does this work with Cline's CLI as well as the VS Code extension?**
Yes, but they read different files. The extension uses the settings file behind the Configure MCP Servers button; the CLI uses `~/.cline/mcp.json`. The JSON block above is the same in both.

**Do I need to restart VS Code?**
No. Cline watches the config file and restarts the server that changed.

**Can I run this alongside other MCP servers?**
Yes. We have not found a documented limit on servers or tools in Cline. Be aware that many servers at once fill the model's context with tool definitions, which is a general MCP cost rather than a Cline one.

**Why does the extension show nothing after step 3?**
The server only takes a port the first time real work arrives. Ask Cline to take a screenshot and the badge appears.
