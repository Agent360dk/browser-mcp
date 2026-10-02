// KILDE: run by hand on Linux, 27/9-2026, with Qwen Code 0.24.6 (npm i -g @qwen-code/qwen-code@0.24.6) against @agent360/browser-mcp@latest (resolved to 1.30.0). Every command and every response on this page was copied from that terminal, including the "Pending approval" state for project scope. Scope default (user), the --trust flag and the Node >=22 requirement come from `qwen mcp add --help` and the package's engines field. The chat prompt in step 4 was NOT run (no model account on that machine) - do not add a Qwen transcript here without running it.

# Install Browser MCP for Qwen Code

*Suggested URL: `/docs/install-qwen-code` · Suggested title tag: "Browser MCP for Qwen Code: Drive Your Logged-In Chrome (2026)" · Suggested meta description: "One command. Qwen Code drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 27, 2026*

---

**Give Qwen Code control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Add the MCP server.** One command. Required - the extension does nothing on its own:

```bash
qwen mcp add browser-mcp npx -y @agent360/browser-mcp@latest
```

It answers:

```text
MCP server "browser-mcp" added to user settings. (stdio)
```

**3 - Check that Qwen Code can start it.**

```bash
qwen mcp list
```

What comes back when it works:

```text
Configured MCP servers:
✓ browser-mcp: npx -y @agent360/browser-mcp@latest (stdio) - Connected
```

`Connected` means Qwen Code launched the server and completed the MCP handshake. Chrome does not have to be open for this step.

**4 - Ask for something in the browser.** Start `qwen` and paste:

> Open example.com and take a screenshot.

## If you would rather edit the file

`qwen mcp add` writes to `~/.qwen/settings.json` by default. The same thing by hand:

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

**The default scope is user, not project.** Unlike Gemini CLI, which Qwen Code is based on, `qwen mcp add` writes to your user settings unless you pass `-s project`. That puts the browser in every project, which is usually what you want.

**A project-scoped server has to be approved first.** With `-s project` the server goes into `.qwen/settings.json` in the current directory, and `qwen mcp list` shows it as not yet allowed to run:

```text
Configured MCP servers:
● browser-mcp: npx -y @agent360/browser-mcp@latest (stdio) - Pending approval
```

Approve it once for that workspace:

```bash
qwen mcp approve browser-mcp
```

```text
Approved MCP server "browser-mcp" (bound to its current config).
Approved servers connect in your next interactive session.
```

After that, `qwen mcp list` reports `Connected`. Until you approve it, the list keeps saying `Pending approval` - easy to mistake for a broken install.

**`--trust` skips tool confirmations.** Qwen Code offers it on `qwen mcp add`. A browser tool that can read every page you are signed in to deserves the confirmation, so leave it off unless you know why you want it.

**Qwen Code needs Node.js 22 or newer.** That is Qwen Code's own requirement, not Browser MCP's.

## What Qwen Code can do with your real browser

The point is not "Qwen Code can browse". It is that it browses **as you**. It opens your admin dashboard already signed in, reads the 2FA code from your Gmail, already signed in, and fills the form on the page you were looking at.

And when it hits something only you can decide - a 2FA code, a CAPTCHA, a choice between three accounts - `browser_ask_user` stops, asks you on your own screen, and carries on in the same tab.

## Frequently asked questions

**How do I remove it again?**
`qwen mcp remove browser-mcp` for the user-scope install, `qwen mcp remove -s project browser-mcp` for a project one. It answers `Server "browser-mcp" removed from user settings.`

**Why does `qwen mcp list` say "Pending approval"?**
You added it with `-s project`. Run `qwen mcp approve browser-mcp` in that directory.

**Why does the extension show nothing after step 3?**
The server only takes a port the first time real work arrives. Ask for a screenshot and the badge appears.
