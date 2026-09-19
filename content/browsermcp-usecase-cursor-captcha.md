// KILDE: browser_solve_captcha laest i extension/background.js + mcp-server/tools.js 19/9-2026. ⚠️ Vi udgiver INGEN loesnings-procent - den er aldrig maalt ordentligt, og et tal uden en maaling bag er praecis det vi brugte 19/9 paa at fjerne fra ni sider. Skriv aldrig et her.

# Cursor and CAPTCHAs: it tries, then hands it to you

*Suggested URL: `/use-cases/cursor-captcha` · Suggested title tag: "Cursor + CAPTCHA (2026): The Agent Hands It To You" · Suggested meta description: "Cursor hits a CAPTCHA and the run dies. Browser MCP attempts the checkbox, and when that is not enough it shows you the challenge and carries on after you solve it." · Last verified: September 19, 2026*

---

**The problem in one line:** the agent hits a CAPTCHA, and everything after it never happens.

There is no honest way to automate past a challenge designed to stop automation. So we do not try to. The tool attempts the simple case, and where that is not enough it puts the challenge in front of you and waits.

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

`browser_solve_captcha` attempts the checkbox challenge. When the page escalates to images or a slider, it shows you the tab and waits. `browser_ask_user` is the same mechanism for anything else only a human can answer.

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

**We publish no solve rate.** We have not benchmarked it rigorously enough to stand behind a number, and a number without a measurement behind it is worse than no number. What we can say is what the tool does: it tries the checkbox, and where that fails it asks you.

**It will not get you past a challenge that is working.** If a site has decided you look like a robot, the honest outcome is that you solve it yourself. The value here is that the run does not die - it pauses, you click, it continues in the same tab with the same session.

## Two things to know before you rely on it

**The tab has to be in front for the challenge to reach you.** Chrome does not deliver mouse and keyboard to a tab that is not the visible one in its window, and the tool brings the tab forward before it asks. That is deliberate: the alternative is a prompt for a challenge you cannot see.

**Your session is what makes most of this unnecessary.** Many CAPTCHAs fire because a fresh headless browser looks like a bot. It is your real Chrome with your real profile, so on a lot of sites the challenge never appears. That is not a guarantee, and it is not unique to us - Playwright MCP's extension and Chrome DevTools MCP can also drive a signed-in browser.

## Frequently asked questions

**Does it solve CAPTCHAs for me?**
It attempts the checkbox. Anything harder, it hands to you. We are not a solving service and do not use one.

**Do you send the challenge anywhere?**
No. The server is local, there is no account and no telemetry. The challenge stays in your browser.

**Can I skip the attempt and just be asked straight away?**
Yes - call `browser_ask_user` yourself, or tell the agent to show you the page instead of trying.

**Which other clients does this work with?**
All of them. [Claude Code](/docs/install-claude-code/), [Codex](/docs/install-codex/), [VS Code](/docs/install-vscode/), [Cline](/docs/install-cline/), [Gemini CLI](/docs/install-gemini-cli/), [Zed](/docs/install-zed/), [Kiro](/docs/install-kiro/), [Continue.dev](/docs/install-continue/).
