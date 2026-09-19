// KILDE: https://docs.trae.ai/ide/add-mcp-servers + https://docs.trae.ai/ide/mcp-server-install-links, begge LAEST 19/9-2026 med vores eget browser_get_page_content (siderne er JS-renderede - curl giver en tom skal, og WebFetch fik kun titlen). Ordret derfra: `mcpServers`-formen · `.trae/mcp.json` + «Enable Project MCP»-kontakten · «The command must not contain spaces, otherwise parsing errors will occur» · `START_MCP_TIMEOUT_MS`/`RUN_MCP_TIMEOUT_MS` · link-formatet `trae://trae.ai-ide/mcp-import?type=&name=&config=`. ⚠️ Produktet hedder TraeCode nu. ⚠️ Vores install-link er GENERERET og round-trip-efterproevet 19/9 - aendres pakkenavnet, skal base64'en genberegnes, ellers installerer linket den gamle pakke TAVST.

# Install Browser MCP for Trae

*Suggested URL: `/docs/install-trae` · Suggested title tag: "Browser MCP for Trae: Drive Your Logged-In Chrome (2026)" · Suggested meta description: "One click, or four steps. Trae drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give Trae's agent control of your real, already-logged-in Chrome.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## One click

Paste this into your browser's address bar and press Enter. Trae opens, shows you the configuration, and you confirm:

```
trae://trae.ai-ide/mcp-import?type=stdio&name=browser-mcp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhZ2VudDM2MC9icm93c2VyLW1jcEBsYXRlc3QiXX0%3D
```

That is Trae's own install-link format. The unreadable part is the base64 of exactly the config shown below - nothing hidden, and you can decode it yourself before you run it.

Then install the [Chrome extension](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl) - the server is only half of it.

## Or four steps, by hand

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Open the MCP window.** Settings icon (top right) → **MCP**. In SOLO mode the same icon sits at the top right of the chat panel.

**3 - Add > Add Manually**, and paste:

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "npx",
      "args": ["-y", "@agent360/browser-mcp@latest"]
    }
  }
}
```

**4 - Say this, to check it worked.** In the agent panel:

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## What it looks like

```
You:     Open the admin dashboard and tell me yesterday's orders.

Trae:    [browser_navigate]
         [browser_get_page_content]
         41 orders yesterday. No login step - you were already signed in.
```

## Three things that fail silently in Trae

**The project-level file needs a switch.** You can put `mcp.json` in `.trae/` in the project root, but Trae ignores it until **Settings → MCP → Enable Project MCP** is toggled on and confirmed. A config file that is simply never read looks exactly like a broken server.

**No spaces in `command`.** Trae's own wording: *"The command must not contain spaces, otherwise parsing errors will occur."* `npx` is fine. A Windows path with `Program Files` in it is not - use a path without spaces, or let `npx` resolve it.

**The startup timeout is yours to set.** Browser MCP takes its port the first time the browser is actually used, not at startup, so a slow first call is normal rather than a hang. If your machine is slow to fetch the package, raise it:

```json
"env": {
  "START_MCP_TIMEOUT_MS": "60000",
  "RUN_MCP_TIMEOUT_MS": "60000"
}
```

## Things worth knowing before you hit them

**The marketplace is a shortcut, not a requirement.** Trae has an MCP marketplace in the same window. Adding the JSON by hand does exactly the same thing.

**`${workspaceFolder}` exists if you need it.** Trae resolves it to the project root inside `args`. Browser MCP does not need it - it is only useful when you point at a script in your own repo.

**Trae is called TraeCode now.** The docs use both names, and TraeWork is a separate product. The MCP configuration above is TraeCode's.

## Frequently asked questions

**Why does the extension badge stay grey after step 3?**
The server only takes a port the first time real work arrives. Ask for a screenshot and the badge appears.

**Can I decode the install link before using it?**
Yes, and you should. Base64-decode the `config` parameter and you get the same four lines of JSON shown above.

**Does the project-level `.trae/mcp.json` work without the switch?**
No. Toggle **Enable Project MCP** first - that is the single most common "it does nothing" report.

**Is there a Windows difference?**
Only the space rule above. The config is identical.
