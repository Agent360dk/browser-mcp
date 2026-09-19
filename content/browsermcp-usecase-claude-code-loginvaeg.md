// KILDE: adfaerd laest i extension/background.js + mcp-server/tools.js 19/9-2026. Soegedata GSC 90 dage: `claude code browser mcp` 65 visn/pos 28,4 · `browser mcp claude code` 89 visn/pos 22,8 · `claude code chrome mcp login workaround` (Bings query-stats, pos 1). ⚠️ Ingen paastand om at vi er de eneste der bruger din indloggede Chrome - det goer Microsoft, Google og Anthropic ogsaa (maalt 19/9).

# Claude Code behind a login wall: use the session you already have

*Suggested URL: `/use-cases/claude-code-login-wall` · Suggested title tag: "Claude Code Behind a Login Wall (2026): Use Your Real Session" · Suggested meta description: "Claude Code cannot read the page because it is behind a login. Browser MCP drives the Chrome you are already signed in to, so there is no login to get past." · Last verified: September 19, 2026*

---

**The problem in one line:** you ask Claude Code to look at something, and it comes back with a login page instead of your data.

That happens because the tool it used opened a fresh browser that has never met your account. Browser MCP does not open a browser. It uses the one you are sitting in front of, with the session you already have.

## What it looks like

```
You:    What's our churn rate in the analytics dashboard this month?

Claude: [opens the dashboard in your Chrome - already signed in]
        4.2%, down from 5.1% in August. The drop is almost entirely
        in the annual plans.
```

No login step, because there is nothing to log in to. The tab is yours.

## Setting it up

Two halves, both required:

**1 - The Chrome extension.** [One click from the Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - The MCP server:**

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

Restart Claude Code. Full walkthrough: [Install for Claude Code](/docs/install-claude-code/).

## When it still asks you for something

Some pages re-challenge even an authenticated session: a step-up 2FA prompt, a CAPTCHA, a "choose an account" screen. The agent stops and asks you on your own screen, then carries on in the same tab. That is `browser_ask_user`, and it is covered in [Codex + 2FA](/use-cases/codex-2fa/) - the mechanism is identical whichever client you use.

## Two things to know before you rely on it

**The tab has to be in front.** Chrome does not deliver mouse and keyboard to a tab that is not the visible one in its window. Reading a page works anywhere; clicking and typing do not. Since 1.29.2 the tools say so instead of reporting a success that did not happen, and the fix is `browser_switch_tab`.

**This is not unique to us, and we are not going to pretend it is.** Playwright MCP ships a Chrome extension that also uses your logged-in browser, Chrome DevTools MCP can attach to a running Chrome, and Anthropic's own Claude in Chrome shares your browser session. If "use my real session" is all you need, several tools do it. [What is actually different](/learn/tools-that-lie/) is narrower than we used to claim.

## Frequently asked questions

**Does Claude Code see everything in my browser?**
It sees the tabs in its own session group, which it creates. It does not roam your other tabs unless you tell it to switch to one.

**Does anything leave my machine?**
The server is local, there is no account and no telemetry. What the agent reads goes to Claude, the same as anything else you paste into it.

**What about a site that detects automation?**
It is your real Chrome with your real profile, so most detection does not fire. That is the honest answer for most sites and not a guarantee for all of them.

**Can several Claude Code conversations use it at once?**
Yes - up to 20, each in its own colour-coded tab group.
