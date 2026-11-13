// KILDE: tabellen GENMAALT 2026-11-13 ca. 14.45 UTC for alle fem raekker paa én gang: GitHub REST API (stjerner + /commits?per_page=1 = nyeste commit paa default-grenen, ikke pushed_at), npm downloads API last-week (= 6.-12. nov.), npm-registrets latest + time, PyPI JSON for browser-use. browsermcp.io's hul: sidste commit foer 9db12f2 2025-04-24, foerste efter 43bcd1d 2026-10-27. De oevrige tal i teksten (72 vaerktoejer, Puppeteer, CrUX) er fra 2026-07-21/09-19 og staar med deres egen dato. ⛔ Ingen relative tider.

# Browser MCP servers, compared

*Suggested URL: `/compare/browser-automation-mcp-servers` · Suggested title tag: "Browser Automation MCP Servers Compared (2026): Playwright, Chrome DevTools, Browser Use, Browser MCP" · Suggested meta description: "Dated, sourced comparison of the five browser automation MCP servers: which browser each one actually drives, maintenance status, tool counts, and when to pick which." · Last verified: November 13, 2026*

---

**Short answer:** for CI/CD and headless scale, use **Playwright MCP**. For performance tracing and DevTools-grade debugging, use **Chrome DevTools MCP**. For a Python agent framework with an optional cloud browser, use **Browser Use**. If the job needs your **real, already-logged-in Chrome** - your cookies, your 2FA, your sessions - that is the niche the two projects named "Browser MCP" occupy: **browsermcp.io** (much larger, and shipping again since 26 October 2026 after eighteen months without a commit in its public GitHub repo) and **Browser MCP by Agent360** (this site - smaller). The table below was pulled from public APIs on 2026-11-13; other figures on the page carry their own dates.

## The five projects at a glance

| Project | GitHub stars | Last commit | npm downloads/week | Latest release | Drives which browser? |
|---|---|---|---|---|---|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | 39,593 | 2026-11-11 | 10,630,264 | 0.0.85 (2026-11-09) | Own managed profile (isolated or persistent); real Chrome only via opt-in `--extension` |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 55,268 | 2026-11-13 | 2,304,340 | 1.13.0 (2026-11-11) | Own dedicated profile; attach to running Chrome via opt-in `--browser-url` |
| [Browser Use](https://github.com/browser-use/browser-use) | 120,918 | 2026-11-13 | n/a (Python/PyPI) | 1.0.3 (2026-11-12) | Own launched instance; real-profile reuse is an opt-in example |
| [browsermcp.io](https://github.com/BrowserMCP/mcp) | 7,350 | 2026-11-12 | 33,714 | 2.5.0 (2026-11-12) | **Your real Chrome** (extension) |
| [Browser MCP by Agent360](https://github.com/Agent360dk/browser-mcp) | 62 | 2026-10-29 | 745 | 1.31.0 (2026-10-29) | **Your real Chrome** (extension) - only mode |

*(All five rows fetched on 2026-11-13 from the GitHub API, the npm registry and downloads APIs, and PyPI. "Last commit" is the newest commit on each default branch, not the repository's `pushed_at`. Downloads are for the week of 6-12 November 2026. Star counts and downloads move daily; the dates are the durable signal.)*

## The one question that separates them

```
You:     Open the billing page - I'm already logged in there.

A server that drives its own browser:
         I'm at the login page. What are the credentials?

A server that drives yours:
         [navigates]
         Here's the invoice total for August.
```

Every other difference in the table below - maintenance, stars, downloads - matters
less than which of those two answers you get.

## Which browser does each one actually drive?

This is the axis that decides most real-world choices, and it splits the field cleanly:

- **Fresh/managed browser by default:** Playwright MCP, Chrome DevTools MCP, Browser Use. Clean-room profiles are a *feature* here - reproducible CI runs, no cookie contamination. The cost: every login wall, 2FA prompt and CAPTCHA is yours to script around.
- **Your real, logged-in Chrome:** the two Browser MCPs. The agent inherits your sessions, password manager state and 2FA-approved devices, and works on sites where a fresh headless profile gets blocked. The cost: it is your actual browser - not something you point at a farm of 50 parallel instances.

Honest note: Playwright MCP does offer an opt-in `--extension` mode to connect to a running Chrome/Edge, and Chrome DevTools MCP can attach via `--browser-url`. Neither is the default or the primary documented path; for both projects the managed profile is the designed-for mode.

## What about the two projects both called "Browser MCP"?

An accident of naming: [browsermcp.io](https://browsermcp.io) (`@browsermcp/mcp`) and this project (`@agent360/browser-mcp`) are unaffiliated but solve the same problem the same way - a Chrome extension plus a local stdio MCP server. Both are maintained: browsermcp.io's public GitHub repo went without a commit from 2025-04-24 to 2026-10-27, and it has shipped six npm versions since, `2.0.0` (2026-10-26) to `2.5.0` (2026-11-12), still with no GitHub release (checked 2026-11-13). The practical difference is shape: since `2.0.0` theirs exposes a single `browser` tool that takes command lines, and it is far larger (100,000 Chrome Web Store users to our 2,000, measured 2026-11-13); this project exposes 40 tools in the current release, each separately named. We keep a dated, sourced side-by-side on the [dedicated comparison page](/compare/browsermcp-io/).

## Which is most actively maintained?

By last commit, from the table above (measured 2026-11-13): Chrome DevTools MCP and Browser Use (2026-11-13), browsermcp.io (2026-11-12), Playwright MCP (2026-11-11), Browser MCP by Agent360 (2026-10-29). The archived official **Puppeteer MCP** (`@modelcontextprotocol/server-puppeteer`) deserves a mention because it still shows ~36k npm downloads/week: it was moved to `modelcontextprotocol/servers-archived` and last saw a commit 2025-05-15 - if you are choosing today, choose something maintained.

## When should you *not* pick each?

Every tool on this page loses somewhere. Playwright MCP is the wrong tool if the job depends on your personal logged-in sessions. The real-Chrome tools (including ours) are the wrong tool for CI pipelines, serverless scale-out, or anything that must run 50 instances in parallel - we say so explicitly in [When NOT to use Browser MCP](/docs/when-not-to-use/). Browser Use assumes a Python stack. Chrome DevTools MCP sends performance-trace URLs to Google's CrUX API and collects usage statistics by default (both can be disabled with flags - documented in its README, checked 2026-07-21).

## FAQ

**Which MCP server should I use for browser automation in CI?**
Playwright MCP - managed profiles, headless mode, 72 documented tools, and the scale evidence of 10.6M npm downloads in the week of 6-12 November 2026. It also ships a Chrome extension for using your own logged-in browser, so that is no longer a reason to pick us over it.

**Which MCP server can use my existing Chrome logins?**
The two "Browser MCP" projects drive your real Chrome by default. Both are shipping code: browsermcp.io's last commit was 2026-11-12 and ours 2026-10-29 (checked 2026-11-13).

**Is Puppeteer MCP still maintained?**
No. The official `@modelcontextprotocol/server-puppeteer` was archived (moved to `servers-archived`, last commit 2025-05-15) and its npm package was last published 2025-05-12.

**Are these tools free?**
All five are open source (Apache-2.0 or MIT). Browser Use additionally offers a paid cloud browser; the others run entirely locally.
