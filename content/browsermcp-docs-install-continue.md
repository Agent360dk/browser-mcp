// KILDE: https://docs.continue.dev/customize/deep-dives/mcp + /mcp-examples + /reference (hentet 19/9-2026, to uafhaengige research-koersler enige om at det er YAML og en LISTE). ⚠️ "kun agent mode" er ordret fra deres dokumentation og er den hyppigste grund til at MCP "ikke virker" her. Genstarts-kravet er kun bekraeftet af sekundaere kilder - derfor staar der "anbefales", ikke "kraeves".

# Install Browser MCP for Continue.dev

*Suggested URL: `/docs/install-continue` · Suggested title tag: "Browser MCP for Continue.dev: Your Real Logged-In Chrome (2026)" · Suggested meta description: "Four steps. Continue.dev drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give Continue.dev control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Open `~/.continue/config.yaml`** (or `%USERPROFILE%\.continue\config.yaml` on Windows).

**3 - Add the server. It is YAML, and `mcpServers` is a list, not an object:**

```yaml
mcpServers:
  - name: Browser MCP
    command: npx
    args:
      - "-y"
      - "@agent360/browser-mcp@latest"
```

**4 - Switch to agent mode and say this:**

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## Two things that make this look broken when it is not

**MCP only works in agent mode.** Their documentation says it outright. In chat mode the tools simply are not there, with no error to tell you why. If you have added the server and nothing happens, check which mode you are in before you check anything else.

**It is YAML with a list, not JSON with an object.** Every other client on this site takes a JSON object keyed by server name. Continue takes a YAML array of entries, each with its own `name`. Pasting a JSON block from Cline or Cursor will not work.

## The other way in

Continue also reads standalone files from `.continue/mcpServers/`. Drop a `browser-mcp.yaml` there and it is picked up. Their docs note that JSON configs from other clients can be placed in that folder and Continue converts them - convenient if you already have a working block elsewhere.

## Things worth knowing before you hit them

**Restart is probably needed.** Several community reports say a full IDE restart is required after editing `config.yaml`, not just a window reload. It is not stated in the official docs, so treat it as the first thing to try rather than a rule.

**`connectionTimeout` exists** if the first start is slow on your machine - it governs the initial connection only.

**No documented approval list.** Continue's MCP schema does not appear to have an `autoApprove` equivalent. We are not going to tell you how its approval flow behaves when their documentation does not.

## What Continue can do with your real browser

It browses **as you**. Your internal dashboard already signed in, the 2FA code from the Gmail tab you already have open, the form on the page you were looking at.

And when it hits something only you can decide, `browser_ask_user` stops, asks you on your own screen, and carries on in the same tab.

## Frequently asked questions

**I added it and no tools show up.**
Two likely causes, in order: you are in chat mode rather than agent mode, or Continue needs a restart.

**Global or project config?**
`~/.continue/config.yaml` is global. A `.continue/config.yaml` in a project overrides it there.

**Do I need `type: stdio`?**
The documented example for a local server omits it and infers stdio from `command`. Adding it explicitly is harmless if you prefer to be unambiguous.

**Why does the extension show nothing after step 3?**
The server only takes a port the first time real work arrives. Ask for a screenshot and the badge appears.
