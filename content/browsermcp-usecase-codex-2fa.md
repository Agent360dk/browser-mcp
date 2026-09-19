// KILDE: vaerktoejsnavne og adfaerd laest i mcp-server/tools.js + extension/background.js 19/9-2026. Soegedata: GSC 90 dage - `codex browser mcp` 9 klik/pos 2,2 · `browser mcp codex` 6 klik/CTR 46 % · `codex captcha` pos 1,0. ⚠️ Baggrundsfane-begraensningen er MAALT 19/9 og skal blive staaende: Chrome leverer ikke taster til en fane der ikke er den viste i sit vindue, og et eget vindue loeser det IKKE (vindues-hypotesen falsificeret samme dag).

# Codex and 2FA: let the agent ask you for the code

*Suggested URL: `/use-cases/codex-2fa` · Suggested title tag: "Codex + 2FA: Let It Ask You for the Code (2026)" · Suggested meta description: "Codex hits a two-factor prompt and stops. With Browser MCP it asks you on your own screen, you type six digits, and it carries on in the same tab." · Last verified: September 19, 2026*

---

**The problem in one line:** your agent gets to the two-factor prompt and there is nothing it can do, because the code is on your phone.

Most browser automation answers this by asking you to hand over credentials, wire up an API, or store a TOTP secret in a config file. Browser MCP answers it by asking you.

## What it looks like

```
You:    Log into the admin dashboard and export last month's invoices.

Codex:  [navigates, fills the login form]
        The site is asking for a 2FA code.

        ┌─────────────────────────────────────────┐
        │  Enter the 6-digit code from your app    │
        │  [______]                                │
        └─────────────────────────────────────────┘

You:    418293

Codex:  [continues in the same tab, exports the file]
        Done - invoices-2026-08.csv is in your Downloads.
```

The tool behind that pause is `browser_ask_user`. It stops the run, shows you a prompt on your own screen, waits, and carries on in the tab that was already signed in. No credential ever leaves your machine, because none was needed.

## Setting it up

Two halves, both required:

**1 - The Chrome extension.** [One click from the Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - The MCP server, registered with Codex:**

```bash
codex mcp add browser-mcp -- npx @agent360/browser-mcp@latest
```

Restart your Codex session. Full walkthrough: [Install for Codex](/docs/install-codex/).

## Two things to know before you rely on it

**The tab has to be the one in front.** Chrome does not deliver keystrokes to a tab you are not looking at - it accepts the command and drops it. Since 1.29.2 the tools tell you that instead of pretending it worked, and the fix is `browser_switch_tab`. We measured whether giving the session its own window would remove the problem: it does not. What matters is whether the *window* has focus, not whether the tab is visible in it.

**The code is still yours to read.** We do not read your phone, your authenticator or your SMS. The agent asks; you answer. That is the whole mechanism, and it is why it works on sites that would block anything more automated.

## Where this beats the alternatives

| | Browser MCP | Headless automation | Storing a TOTP secret |
|---|---|---|---|
| Needs your credentials | No | Yes | Yes |
| Works on a site that blocks automation | Yes - it is your session | Often not | Yes |
| Survives the site changing its login | Yes | No | Usually |
| You stay in control of the code | Yes | - | No |

## Frequently asked questions

**Does it work with SMS codes too?**
Yes. The tool does not care where the code came from - it asks, you type.

**Can it read the code from my Gmail instead of asking me?**
If the Gmail tab is already open in the same Chrome, yes: `browser_switch_tab` to it, read the code, switch back. That is a different flow and it works, but it needs your mail to be in that browser.

**What if I am not at my desk when it asks?**
It waits. There is a timeout, and when it expires the tool says so rather than guessing.

**Which other clients does this work with?**
All of them - the tool is the same. [Claude Code](/docs/install-claude-code/), [Cursor](/docs/install-cursor/), [VS Code](/docs/install-vscode/), [Cline](/docs/install-cline/), [Gemini CLI](/docs/install-gemini-cli/), [Zed](/docs/install-zed/), [Kiro](/docs/install-kiro/), [Continue.dev](/docs/install-continue/).
