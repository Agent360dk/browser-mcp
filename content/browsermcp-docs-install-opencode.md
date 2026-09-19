// KILDE: https://opencode.ai/docs/mcp-servers/ (hentet 19/9-2026). Ordret derfra: noeglen er `mcp` i `opencode.jsonc`/`opencode.json`, `"type": "local"` for stdio, og `command` er et ARRAY af strenge - ikke en streng plus `args` som alle andre klienter. `enabled`, `cwd`, `environment` og `timeout` er valgfrie. ⚠️ Skriv ALDRIG `command` som streng her; det er den fejl der koster mest paa denne side, fordi det ligner alle de andre klienters form. ⚠️ Ingen af de fire ét-klik-formater findes til opencode (19/9) - derfor har siden ingen.

# Install Browser MCP for opencode

*Suggested URL: `/docs/install-opencode` · Suggested title tag: "Browser MCP for opencode: Drive Your Logged-In Chrome (2026)" · Suggested meta description: "Four steps. opencode drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give opencode control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Open your config.** `opencode.jsonc` (or `opencode.json`), in the project or your global config.

**3 - Add the server under `mcp`:**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "browser-mcp": {
      "type": "local",
      "command": ["npx", "-y", "@agent360/browser-mcp@latest"]
    }
  }
}
```

**4 - Say this, to check it worked:**

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## What it looks like

```
You:      Open the admin dashboard and tell me yesterday's signups.

opencode: [browser_navigate]
          [browser_get_page_content]
          41 signups yesterday. No login step - you were already signed in.
```

## The one thing that trips people up here

**`command` is an array, not a string.** Every other MCP client splits this into `command` plus `args`:

```json
"command": "npx",
"args": ["-y", "@agent360/browser-mcp@latest"]
```

opencode does not. It takes one array with the executable first:

```json
"command": ["npx", "-y", "@agent360/browser-mcp@latest"]
```

If you copy a config from a Claude Code or Cursor guide, this is the line that breaks, and the failure looks like the server never starting rather than a config error.

**And `"type": "local"` is required.** It is what marks the server as stdio. Leave it out and opencode looks for a remote one.

## Things worth knowing before you hit them

**No one-click link.** Trae and VS Code publish install-link formats; opencode does not, as of September 2026. The four lines above are the whole install.

**The badge stays grey until you ask for something.** The server only takes a port the first time real work arrives. Ask for a screenshot and it appears.

**`environment` if you need the pairing key.** Running two Chrome profiles with an agent in each? Add `"environment": { "BROWSER_MCP_TOKEN": "your-key" }` and type the same key in the extension popup under **Pairing**. Leave it out otherwise.

## Frequently asked questions

**Global or per project?**
Either. A global `opencode.json` gives every project the browser; a project-level file keeps it to one.

**Why does it say the server never started?**
Almost always `command` written as a string instead of an array. See above.

**Does it work with the Chrome I am already using?**
That is the whole point - it drives your existing profile, with your sessions, rather than launching a clean one.
