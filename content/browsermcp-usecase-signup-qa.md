// KILDE: vaerktoejerne laest i mcp-server/tools.js 8/10-2026 (browser_navigate, browser_fill, browser_click, browser_console_logs, browser_wait_for_network, browser_screenshot, browser_ask_user). console_logs installerer sin opfanger ved foerste kald (tools.js-beskrivelsen) - tidligere beskeder kommer ikke med; det staar paa siden.

# Test your signup like a real user

*Suggested URL: `/use-cases/test-your-signup-flow` · Suggested title tag: "Test Your Signup Flow With an AI Agent in Your Real Chrome (Browser MCP)" · Suggested meta description: "Ask your agent to walk through your own signup as a user would, in your real Chrome, and tell you where it breaks: the step, what the page logged and a screenshot." · Last verified: October 8, 2026*

---

**The problem in one line:** your signup works on your machine, in your test, and breaks for the person who has a password manager, a cookie banner and an old session.

Your agent can walk the flow in the Chrome you use every day, with your extensions, password manager and cookie banners in the way, as in a real visitor's browser, and tell you where it stopped. Sign out of your app first, or give it a fresh email.

## What it looks like

```
You:    Walk through the signup at localhost:3000 as a new user and
        tell me where it breaks.

Claude: [browser_navigate, browser_console_logs]
        Listening to the console. Now the form.
        [browser_fill, browser_fill, browser_click]
        The form fills, but Submit stays disabled after the password.
        [browser_console_logs]
        The page logged an error right after the password changed:
        "strength meter failed to load".
        [browser_screenshot]
        Here is the screen at that point. The strength meter never
        renders, and the button waits for it.
```

## Setting it up

Two halves, both required:

**1 - The Chrome extension.** [One click from the Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - The MCP server**, for Claude Code:

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

Restart your agent. Other clients: [the install guides](/docs/install-cursor/).

## What it checks well

- **Real filling.** `browser_fill` fills each field and checks that a framework form (React, Angular) actually took the value.
- **What the page logged.** `browser_console_logs` returns what the page writes to the console (`console.log`, `warn`, `error`) from its first call onwards, on the same page, so ask for it after the page has loaded and before the step you are testing. An error the page never logs does not show up.
- **Waiting for the network.** `browser_wait_for_network` waits for a request you name (for example `/api/signup`) to come back, so a slow API is not mistaken for a broken button.
- **Proof.** `browser_screenshot` shows you the screen at the moment it stopped.

## Two things to know before you rely on it

**It walks the flow once, as one careful user.** That is the way you would test it by hand. For hundreds of runs in CI, use a headless tool such as Playwright.

**Stop before anything real.** Tell it where to stop, for example before a real payment. It can also ask you with `browser_ask_user` before a step it should not decide alone.

## Frequently asked questions

**Can it test a site on localhost?**
Yes. It opens whatever address you give it in its own tab, including your local development server.

**Will it use my saved passwords?**
It works in your Chrome, so a page may show your browser's own autofill. Give it test details to type, and it fills those.

**Does it see my other tabs?**
No. It works only in its own tab group and cannot read or close a tab you opened.
