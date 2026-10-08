// KILDE: vaerktoejerne laest i mcp-server/tools.js 8/10-2026 (browser_navigate, browser_get_page_content, browser_extract_list, browser_screenshot, browser_ask_user). Eksemplet bygger paa forsidens og README'ens forsoegsprompt «Go to my analytics dashboard, pull this month's numbers, and put them in a table».

# Pull numbers from your dashboards

*Suggested URL: `/use-cases/pull-numbers-from-dashboards` · Suggested title tag: "Pull Numbers From Any Dashboard With an AI Agent, No API Key (Browser MCP)" · Suggested meta description: "Your agent reads the dashboards you are already signed in to, in your own Chrome, and puts the numbers in a table. No API key, no export, no integration to build." · Last verified: October 8, 2026*

---

**The problem in one line:** the number you need is on a dashboard you can see, and the tool has no API, or the API needs a key you do not have.

Your agent opens the dashboard in your Chrome, where you are already signed in, reads it and hands you the numbers.

## What it looks like

```
You:    Go to my analytics dashboard, pull this month's numbers,
        and put them in a table.

Claude: [browser_navigate, browser_get_page_content]
        | Metric   | September | August |
        | MRR      | $48,210   | $46,900 |
        | Churn    | 4.2%      | 5.1%   |
        | New      | 312       | 287    |
        The drop in churn is almost entirely in the annual plans.
```

## Setting it up

Two halves, both required:

**1 - The Chrome extension.** [One click from the Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - The MCP server**, for Claude Code:

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

Restart your agent. Other clients: [the install guides](/docs/install-cursor/).

## Long tables

Many apps show only the rows that fit on the screen and load the rest as you scroll. `browser_extract_list` scrolls the list and reads every row until no new ones appear, so a table of 400 invoices is read as 400 rows, not the first 20.

## Two things to know before you rely on it

**It reads what you can see.** If a number is behind a filter or a date picker, say which one. It can set them, and it reads the page after.

**Check the first run.** Dashboards label things in their own way. Look at the first table it gives you, and name the columns you want in your request.

## Frequently asked questions

**Does it need an API key?**
No. It reads the page in your signed-in Chrome, the same way you do.

**Which dashboards work?**
Any page you can open and read in Chrome: analytics, billing, admin panels, internal tools.

**Does the data leave my machine?**
The server is local and sends nothing to us. What the agent reads goes to your AI client and its model provider, like anything else you show it.
