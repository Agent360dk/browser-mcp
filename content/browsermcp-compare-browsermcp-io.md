# Browser MCP by Agent360 vs. browsermcp.io: which one is actually maintained?

*Suggested URL: `/compare/browsermcp-io` · Suggested title tag: "Browser MCP by Agent360 vs. browsermcp.io — Which Is Maintained? (2026)" · Suggested meta description: "A dated, sourced comparison of two same-named MCP browser servers. One has 100k installs. One shipped code this week. Here's the actual data." · Last verified: July 15, 2026*

---

**Short answer:** if you searched "browser mcp" and landed here, you're probably looking for **browsermcp.io** (GitHub: `BrowserMCP/mcp`) — it's bigger, older, and ranks higher. It has a much larger installed base than we do. It also hasn't shipped a code change since April 24, 2025. Both of those things are true at the same time, and this page exists to show you the dated evidence for both rather than ask you to take our word for it.

We are **Browser MCP by Agent360** (`@agent360/browser-mcp`, [browsermcp.dev](https://browsermcp.dev)) — a separate, unaffiliated project that happens to solve the same problem with a nearly identical name: a standard stdio MCP server that gives any MCP client — Claude Code, Cursor, VS Code agent mode, or anything else that speaks the protocol, not just those three — control of your real, already-logged-in Chrome instead of a fresh headless session.

## The two projects, side by side

| | **browsermcp.io** (`BrowserMCP/mcp`) | **Browser MCP by Agent360** (`@agent360/browser-mcp`) |
|---|---|---|
| GitHub stars | **6,824** | 21 |
| Repo created | 2025-03-28 | 2026-03-29 |
| **Last commit pushed** | **2025-04-24** | **2026-07-15 (today)** |
| Published GitHub releases | 0 | 2 (latest `v1.23.0`, 2026-06-09) |
| Latest npm version | `0.1.3` — published 2025-04-11, unchanged since | `1.23.0` — published 2026-06-09 |
| npm downloads, last 7 days | 9,873 (`@browsermcp/mcp`) | 191 (`@agent360/browser-mcp`) |
| Chrome Web Store users | **100,000** | 186 |
| Chrome Web Store rating | 4.8 / 5 | 0 / 5 (no ratings yet) |
| Open GitHub issues | 142 | 2 |
| License | Apache-2.0 | MIT |
| Tools exposed | Not publicly documented (not audited here) | 34, auto-listed at [`/docs/tools`](/docs/tools) |
| Install | `npx @browsermcp/mcp` (npm) or Chrome Web Store | `npx @agent360/browser-mcp install` or Chrome Web Store |

*Every number above was pulled live on 2026-07-15 via the GitHub REST API, the public npm registry API, and the Chrome Web Store listing pages for both extensions (`bjfgambnhccakkhmkepdoekmckoijdlc` and `jdehgalffmffhfhmmhaokfbfnafnmgcl`). See "How we verified this" below.*

## The one thing that actually matters here: maintenance

Scale metrics aside, there's one number in that table that decides whether a tool is safe to build a workflow on: **when did the code last change.**

> **browsermcp.io's repository has not had a commit since April 24, 2025.** Not a bug fix, not a dependency bump, not a README typo fix — nothing, for over 14 months as of this writing. Its npm package has been on version `0.1.3` since April 11, 2025, and it has zero published GitHub releases. Its 142 open issues have had no code response in that window, because there hasn't been a commit to respond with.
>
> **Browser MCP by Agent360 pushed a commit today** (2026-07-15) and has shipped two GitHub releases in the last three months (`v1.16.1` in April, `v1.23.0` in June).

That's the entire pitch of this page, stated as plainly as we can: **actively maintained, this week — not since April 2025.** We're not implying anything about *why* browsermcp.io went quiet — we don't know who runs it or what happened, and we haven't tried to find out. We're only reporting what the commit history, release history, and npm registry actually show, with the dates attached, so you can weigh it yourself.

## Where browsermcp.io genuinely wins

Being honest about the maintenance gap doesn't mean pretending the rest of the table doesn't exist:

- **100,000 Chrome Web Store users vs. our 186.** It has a real, large, established user base. We don't.
- **4.8/5 stars.** People who installed it and stuck around like it.
- **6,824 GitHub stars vs. our 21.** It's the far more visible project if you're browsing GitHub or an "awesome MCP servers" list.
- **It has a real npm package and a one-click Chrome Web Store listing** — for the record, this corrects an old claim in our own README, which described it as "manual clone only." That hasn't been accurate for a while; it installs about as easily as ours does.

If you install it and it does what you need, **there is no reason to switch.** A tool that already works for you, with 100k other people behind it, is a perfectly reasonable choice — we're not going to manufacture a reason to distrust something that's genuinely serving people well. The only thing we'd flag is: if you hit a bug, a Chrome API change, or a Manifest V3 deprecation that needs a code fix, there's no evidence anyone is currently shipping fixes for it.

## Where the maintenance gap shows up in practice

Chrome ships changes to extension APIs, debugger protocols, and Manifest V3 behavior regularly. A project frozen since April 2025 will, over time, accumulate the kind of breakage that only a live commit history fixes — new Chrome versions changing debugger-attach behavior, CAPTCHA providers updating their challenge markup, sites adding new anti-automation detection. We can't tell you which of `browsermcp.io`'s 142 open issues are that kind of drift versus something else, because we haven't audited them — but the count is public and the "zero commits since April 2025" fact means none of them have been closed by a code change in that time.

## Quick answers

**Are these the same product?**
No. Two separate teams, two separate GitHub orgs (`BrowserMCP` vs. `Agent360dk`), two separate npm packages (`@browsermcp/mcp` vs. `@agent360/browser-mcp`), two separate Chrome extensions. The name overlap ("Browser MCP") is coincidental, not a rebrand or a fork of each other.

**Which one has more users?**
browsermcp.io, by a wide margin — 100,000 Chrome Web Store users vs. our 186, as of 2026-07-15.

**Which one is actively maintained?**
Browser MCP by Agent360. Last commit today (2026-07-15) vs. browsermcp.io's last commit on 2025-04-24.

**Should I uninstall browsermcp.io and switch?**
Not automatically. If it's working for your workflow, keep using it. Consider trying ours if you specifically need multi-session support (10 concurrent, color-coded tab groups), a human-in-the-loop tool for 2FA/CAPTCHA/credential prompts (`browser_ask_user`), or you want a project that's currently shipping fixes.

**Is one of them free and the other paid?**
Both are free. browsermcp.io is Apache-2.0 licensed; Browser MCP by Agent360 is MIT licensed. Both permit commercial use.

**Is this page trying to make browsermcp.io look bad?**
No — read the "Where browsermcp.io genuinely wins" section above. The scale numbers favor them and we've published them as-is. The only claim we're making is about commit/release dates, which are objectively checkable by anyone in about two minutes.

## Try it yourself

```bash
npx @agent360/browser-mcp install
```

60-second install, MIT licensed, 34 tools, runs 100% locally. [Full install guide →](/docs/install-claude-code) · [Or install browsermcp.io if that's the right call for you](https://browsermcp.io) — we mean that.

---

### How we verified this (dated, so it can be re-checked)

All figures on this page were pulled directly on **2026-07-15**, from primary sources only — no secondhand blog posts or aggregator sites:

- **GitHub stars, push dates, release counts, license, open issues:** `api.github.com/repos/BrowserMCP/mcp` and `api.github.com/repos/Agent360dk/browser-mcp`, fetched directly.
- **npm download counts:** `api.npmjs.org/downloads/point/last-week/<package>`, fetched directly for both packages.
- **npm version + publish dates:** `registry.npmjs.org/<package>`, `dist-tags.latest` and the corresponding `time` entry, fetched directly.
- **Chrome Web Store users and rating:** the live public listing pages for extension IDs `bjfgambnhccakkhmkepdoekmckoijdlc` (browsermcp.io) and `jdehgalffmffhfhmmhaokfbfnafnmgcl` (Agent360), read directly from the rendered page.

This table will go stale — that's the nature of a dated comparison. We'll refresh it when either project's numbers move meaningfully. If you're reading this significantly after July 2026 and want current numbers, the four sources above take about five minutes to re-check yourself.

---

*Unknowns / not verified on this page: who currently maintains `browsermcp.io` or why its commit activity stopped — we did not investigate and make no claim either way. The exact current Chrome Web Store rating **count** (number of individual ratings behind the 4.8/5 average) was verified at 675 in an earlier check on 2026-07-07 but was not re-extracted in the 2026-07-15 pass (the star average itself, 4.8/5, was re-confirmed live); treat the count as approximate. Whether `browsermcp.io` has undocumented equivalents of our multi-session, human-in-the-loop, or provider-integration features was not audited — we deliberately did not claim they lack these, only that we could not find them publicly documented.*