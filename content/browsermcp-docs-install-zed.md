// KILDE: https://zed.dev/docs/ai/mcp (hentet 19/9-2026) + github.com/zed-industries/zed/blob/main/crates/paths/src/paths.rs (kildekoden, hentet 19/9 - stien er LAEST i koden, ikke i en blog: sekundaere kilder paastod ~/Library/Application Support/Zed/ og ~/.zed/, og de er FORKERTE). 90.533 stjerner, hentet 19/9. ⚠️ `source: custom` er obligatorisk - uden feltet springer Zed serveren over UDEN fejlmelding. Fjern det aldrig fra eksemplet.

# Install Browser MCP for Zed

*Suggested URL: `/docs/install-zed` · Suggested title tag: "Browser MCP for Zed: Drive Your Logged-In Chrome (2026)" · Suggested meta description: "Four steps. Zed drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give Zed's agent control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Open Zed's settings.** Command Palette → `agent: open settings` → **MCP Servers** → **Add Server** → **Add Local Server**. Or edit `settings.json` directly.

**3 - Add the server.** Zed calls them `context_servers`, not `mcpServers`:

```json
{
  "context_servers": {
    "browser-mcp": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "@agent360/browser-mcp@latest"],
      "env": {}
    }
  }
}
```

**4 - Say this, to check it worked.** In the agent panel:

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## Two things that fail silently in Zed

**`"source": "custom"` is required.** Leave it out and Zed skips the server without an error message. You get no tools and no explanation. This is the one line people delete when they tidy up a config.

**Zed never says "stdio".** Their UI and docs only talk about **Local Server** and **Remote Server**. If you go looking for a transport dropdown with "stdio" in it, you will not find one - a local server with `command` and `args` *is* stdio.

## Where the settings file actually lives

| | |
|---|---|
| macOS | `~/.config/zed/settings.json` |
| Linux / FreeBSD | `$XDG_CONFIG_HOME/zed/settings.json` (usually the same) |
| Windows | `%APPDATA%\Zed\settings.json` |
| Per project | `.zed/settings.json` in the project root |

These come from Zed's own source (`crates/paths/src/paths.rs`), not from a blog post. Several third-party guides list `~/Library/Application Support/Zed/` or `~/.zed/` for macOS. Those are wrong - Application Support holds Zed's *data* directory, which is a different thing.

## Things worth knowing before you hit them

**No restart needed for tool changes.** Zed handles the `notifications/tools/list_changed` notification and reloads the tool list on its own. Settings hot-reload too - except when the settings file is a symlink, which is a known bug on their tracker.

**Every tool call asks you by default.** `agent.tool_permissions.default` is `"confirm"`. You can set it to `"allow"`, but a browser tool that can read any page you are signed in to is a poor first candidate for that.

**Tool selection varies by model.** Zed's own wording: "How reliably MCP tools get called can vary from model to model." Naming the server in your prompt helps.

## Frequently asked questions

**Why do I get no tools and no error?**
Almost always the missing `"source": "custom"`. Add it and reload.

**Does Zed run on Windows?**
Yes, and the settings path is `%APPDATA%\Zed\settings.json`.

**Is there a limit on servers or tools?**
Nothing documented. Many servers at once will fill the model's context with tool definitions, which is a general MCP cost rather than a Zed one.

**Why does the extension show nothing after step 3?**
The server only takes a port the first time real work arrives. Ask for a screenshot and the badge appears.
