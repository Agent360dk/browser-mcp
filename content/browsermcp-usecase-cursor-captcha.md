// KILDE: browser_solve_captcha laest i extension/background.js + mcp-server/tools.js 19/9-2026. ⚠️ Vi udgiver INGEN loesnings-procent - den er aldrig maalt ordentligt, og et tal uden en maaling bag er praecis det vi brugte 19/9 paa at fjerne fra ni sider. Skriv aldrig et her.

# Cursor meets a CAPTCHA

*Suggested URL: `/use-cases/cursor-captcha` · Suggested title tag: "Cursor + CAPTCHA (2026): You Solve What The Agent Cannot" · Suggested meta description: "Cursor hits a CAPTCHA and the run dies. With Browser MCP the agent can try the reCAPTCHA checkbox, and ask you to solve the rest in the same tab before it carries on." · Last verified: September 19, 2026*

---

**The problem in one line:** the agent hits a CAPTCHA, and everything after it never happens.

There is no honest way to automate past a challenge designed to stop automation. So we do not try to. The agent can try the simple case, and ask you to solve the rest: `browser_ask_user` brings the tab forward and waits for your answer.

## What it looks like

```
You:     Pull the shipping rates from the carrier portal.

Cursor:  [navigates, hits a CAPTCHA]
         There's a challenge on this page. I've brought the tab
         forward - can you solve it?

You:     [clicks the images, done]

Cursor:  [continues in the same tab]
         Rates are in - zone 3 went up 4% this month.
```

`browser_solve_captcha` can try the reCAPTCHA checkbox. When a reCAPTCHA escalates to an image grid, the agent can click the cells it chooses after its own screenshot. For a slider or anything else it can call `browser_ask_user`, which brings the tab forward, shows you a dialog and waits for your answer. `browser_ask_user` is the same mechanism for anything else only a human can answer.

## Setting it up

**1 - The Chrome extension.** [One click from the Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - The MCP server.** Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (one project):

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

Full walkthrough: [Install for Cursor](/docs/install-cursor/).

## What we will not tell you

**We publish no solve rate.** We have not benchmarked it rigorously enough to stand behind a number, and a number without a measurement behind it is worse than no number. What we can say is what the tool does: the agent can try the reCAPTCHA checkbox and image grid, and ask you for the rest.

**It will not get you past a challenge that is working.** If a site has decided you look like a robot, the honest outcome is that you solve it yourself. The value here is that the run does not die - it pauses, you click, it continues in the same tab with the same session.

## Two things to know before you rely on it

**The tab has to be in front for the challenge to reach you.** Chrome does not deliver mouse and keyboard to a tab that is not the visible one in its window, and the tool brings the tab forward before it asks. That is deliberate: the alternative is a prompt for a challenge you cannot see.

**Your session is what makes most of this unnecessary.** Many CAPTCHAs fire because a fresh headless browser looks like a bot. It is your real Chrome with your real profile, so on a lot of sites the challenge never appears. That is not a guarantee, and it is not unique to us - Playwright MCP's extension and Chrome DevTools MCP can also drive a signed-in browser.

## Frequently asked questions

**Does it solve CAPTCHAs for me?**
It can try the reCAPTCHA checkbox and click the reCAPTCHA grid cells your agent chooses. Anything it cannot clear, your agent hands to you with `browser_ask_user`. We are not a solving service and do not use one.

**Do you send the challenge anywhere?**
Not to us, and not to a solving service. The server is local, there is no account and no telemetry. If your agent takes a screenshot to choose grid cells, that image goes to your AI client like any other tool result.

**Can I skip the attempt and just be asked straight away?**
Yes - call `browser_ask_user` yourself, or tell the agent to show you the page instead of trying.

**Which other clients does this work with?**
All of them. [Claude Code](/docs/install-claude-code/), [Codex](/docs/install-codex/), [VS Code](/docs/install-vscode/), [Cline](/docs/install-cline/), [Gemini CLI](/docs/install-gemini-cli/), [Zed](/docs/install-zed/), [Kiro](/docs/install-kiro/), [Continue.dev](/docs/install-continue/).
