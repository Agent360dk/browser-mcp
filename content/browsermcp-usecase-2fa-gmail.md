// KILDE: grounded i faktiske tools (browser_navigate, browser_get_page_content, browser_ask_user — verificeret i mcp-server/tools.js) + real-Chrome-model (README). INGEN performance-tal — ren walkthrough. Framing: brugerens EGNE konti, autoriseret brug (konsistent med /docs/when-not-to-use anti-evasion-holdning).

# How an AI agent reads a 2FA code from your Gmail — mid-login

*Suggested URL: `/use-cases/read-2fa-from-gmail` · Suggested title tag: "How an AI Agent Reads a 2FA Code From Gmail Mid-Login (Browser MCP)" · Suggested meta description: "A step-by-step walkthrough of the move headless browsers can't make: your agent hits a login wall, reads the 2FA code from the Gmail you're already signed into, and continues." · Last verified: July 22, 2026*

---

**Short answer:** because Browser MCP drives your real, already-logged-in Chrome, your agent can do something a headless browser fundamentally can't — when a site emails a 2FA code, the agent opens the Gmail tab *you're already signed into*, reads the code, and types it back into the login form. No API keys, no forwarding, no re-authentication. It works because it's your browser, on your machine, acting on accounts you're already logged into.

## The problem this solves

An agent automating a real task hits a login that sends a one-time code to your email. A headless browser is a stranger here: it isn't signed into your Gmail, so the flow dead-ends. The usual workarounds — email-API integrations, forwarding rules, manual copy-paste — are exactly the friction you were trying to remove.

## The walkthrough

1. **The agent hits the 2FA prompt.** It's filling a login on some site (using `browser_fill` and `browser_click`) and the site says "we've emailed you a code."
2. **It opens your Gmail — already signed in.** `browser_navigate` to `mail.google.com`. There's no login step, because this is the Chrome where you're already authenticated. Your session, your cookies.
3. **It reads the newest message.** `browser_get_page_content` returns the inbox text; the agent finds the latest sender/subject that matches and reads the code out of the body.
4. **It types the code back and continues.** Back to the login tab, `browser_fill` the code, submit, done — the task carries on past the wall.
5. **If it's unsure, it asks you.** `browser_ask_user` lets the agent pause and confirm with a human before doing anything sensitive — a built-in checkpoint, not an afterthought.

That's the whole move. No new integration, no secret to store, no code leaving your machine.

## Why headless tools can't do this

Playwright, Puppeteer and other headless setups spawn a fresh browser with none of your sessions. To read a 2FA email they'd need you to hand over Gmail credentials or wire up the Gmail API — which is the friction, not the fix. Browser MCP sidesteps it by never being a stranger to your accounts in the first place.

## One honest boundary

This works on **your own accounts, that you're already logged into, for things you're authorized to do** — the same boundary as everything else Browser MCP does. It is not a way around 2FA on accounts that aren't yours; the code still lands in an inbox only you control. See [When NOT to use Browser MCP](/docs/when-not-to-use/) for where that line sits.

## FAQ

**Does the 2FA code leave my machine?**
No. The agent reads it locally in your own browser and types it back locally. Browser MCP runs 100% on your machine — [nothing is transmitted](/docs/uninstall/) to any server of ours.

**Do I need the Gmail API or an app password?**
No. The whole point is that it uses the Gmail you're already signed into in Chrome — no API, no key, no forwarding rule.

**Can I keep the agent from acting without me?**
Yes — the `browser_ask_user` tool lets it pause for a human decision at any step you care about.

**Does it work with Outlook / other webmail?**
Yes — any webmail you're logged into in your Chrome. Gmail is just the common case; the mechanism is "read the tab you're already signed into."

**How do I set this up?**
[Install Browser MCP for Claude Code](/docs/install-claude-code/) (about 60 seconds), then ask your agent to complete a flow that hits a 2FA wall.
