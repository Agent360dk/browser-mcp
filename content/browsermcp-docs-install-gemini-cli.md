// KILDE: https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md + https://geminicli.com/docs/tools/mcp-server/ + https://geminicli.com/docs/cli/tutorials/mcp-setup/ (alle hentet 19/9-2026, to uafhaengige research-koersler enige om kommando, noegle og sti). 107.074 GitHub-stjerner, hentet 19/9. ⚠️ Underscore-faelden og genstarts-kravet er MAALT fra deres egen dokumentation og issue-tracker - fjern dem ikke uden at tjekke kilden igen.

# Install Browser MCP for Gemini CLI

*Suggested URL: `/docs/install-gemini-cli` · Suggested title tag: "Browser MCP for Gemini CLI: Your Real Logged-In Chrome (2026)" · Suggested meta description: "One command. Gemini CLI drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give Gemini CLI control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Add the MCP server.** One command. Required - the extension does nothing on its own:

```bash
gemini mcp add browser-mcp npx @agent360/browser-mcp@latest
```

Add `-s user` if you want it available in every project rather than just this one. The default scope is the project.

**3 - Restart Gemini CLI.** Their own tutorial says so, and it matters: `/mcp refresh` has open bugs and does not reliably pick up a new server. Close it and start it again.

**4 - Say this, to check it worked.** Paste it to Gemini:

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## If you would rather edit the file

`gemini mcp add` writes to `~/.gemini/settings.json` (user scope) or `.gemini/settings.json` (project scope). The same thing by hand:

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

## Things worth knowing before you hit them

**Never put an underscore in the server name.** `browser_mcp` breaks Gemini's policy parser. Use `browser-mcp`, as above. This is documented on their side and it fails in a way that does not obviously point at the name.

**`"trust": true` skips every confirmation.** It is available, and it means tool calls run without asking you. Only for servers you control - and a browser tool that can read any page you are signed in to deserves the prompt.

**Environment variables are stripped unless you list them.** If you ever need one, it has to be in the `env` block explicitly.

**Restart, do not refresh.** Covered above, but it is the single most common reason this looks broken when it is not.

## What Gemini CLI can do with your real browser

The point is not "Gemini can browse". It is that it browses **as you**. It opens your admin dashboard already signed in, reads the 2FA code from the Gmail tab you already have open, and fills the form on the page you were looking at.

And when it hits something only you can decide - a 2FA code, a CAPTCHA, a choice between three accounts - `browser_ask_user` stops, asks you on your own screen, and carries on in the same tab.

## Frequently asked questions

**Do I need a Gemini API key for this?**
Not for Browser MCP. The server is local, there is no account and no telemetry. Whatever Gemini CLI needs for itself is unchanged.

**Project scope or user scope?**
User scope (`-s user`) if you want your browser available everywhere; project scope if you only want it in one repository. The default is project.

**Why does the extension show nothing after step 3?**
The server only takes a port the first time real work arrives. Ask for a screenshot and the badge appears.

**Does `/mcp refresh` work instead of restarting?**
Not reliably. There are open issues on their tracker about it, and their own tutorial tells you to restart. Restart.
