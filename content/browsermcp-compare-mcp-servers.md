// KILDE: alle tal fra fakta-ark 2026-07-21 (GitHub REST API + npm downloads API + PyPI JSON + README-fetches) — hvert tal dateret i teksten. Verificeret af research-agent + spot-tjekket (181 dl/uge, 2025-04-24 tvilling-commit, 23 stars) samme dag.

# Browser automation MCP servers, compared: Playwright MCP, Chrome DevTools MCP, Browser Use, and the two Browser MCPs

*Suggested URL: `/compare/browser-automation-mcp-servers` · Suggested title tag: "Browser Automation MCP Servers Compared (2026): Playwright, Chrome DevTools, Browser Use, Browser MCP" · Suggested meta description: "Dated, sourced comparison of the five browser automation MCP servers: which browser each one actually drives, maintenance status, tool counts, and when to pick which." · Last verified: July 21, 2026*

---

**Short answer:** for CI/CD and headless scale, use **Playwright MCP**. For performance tracing and DevTools-grade debugging, use **Chrome DevTools MCP**. For a Python agent framework with an optional cloud browser, use **Browser Use**. If the job needs your **real, already-logged-in Chrome** — your cookies, your 2FA, your sessions — that is the niche the two projects named "Browser MCP" occupy: **browsermcp.io** (larger, but no code change since April 24, 2025) and **Browser MCP by Agent360** (this site — smaller, actively maintained). All numbers below were pulled from public APIs on 2026-07-21 and are individually dated.

## The five projects at a glance

| Project | GitHub stars | Last commit | npm downloads/week | Latest release | Drives which browser? |
|---|---|---|---|---|---|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | 35,458 | 2026-07-24 | 6,369,865 | 0.0.78 (2026-07-09) | Own managed profile (isolated or persistent); real Chrome only via opt-in `--extension` |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 47,510 | 2026-07-24 | 1,758,530 | 1.6.0 (2026-07-14) | Own dedicated profile; attach to running Chrome via opt-in `--browser-url` |
| [Browser Use](https://github.com/browser-use/browser-use) | 106,521 | 2026-07-24 | n/a (Python/PyPI) | 0.13.6 (2026-07-17) | Own launched instance; real-profile reuse is an opt-in example |
| [browsermcp.io](https://github.com/BrowserMCP/mcp) | 6,868 | **2025-04-24** | 10,326 | 0.1.3 (2025-04-11) | **Your real Chrome** (extension) |
| [Browser MCP by Agent360](https://github.com/Agent360dk/browser-mcp) | 24 | 2026-07-24 | 387 | 1.24.0 (2026-07-24) | **Your real Chrome** (extension) — only mode |

*(All figures fetched 2026-07-21 from the GitHub API, npm downloads API and PyPI. Star counts and downloads move daily; the maintenance dates are the durable signal.)*

## Which browser does each one actually drive?

This is the axis that decides most real-world choices, and it splits the field cleanly:

- **Fresh/managed browser by default:** Playwright MCP, Chrome DevTools MCP, Browser Use. Clean-room profiles are a *feature* here — reproducible CI runs, no cookie contamination. The cost: every login wall, 2FA prompt and CAPTCHA is yours to script around.
- **Your real, logged-in Chrome:** the two Browser MCPs. The agent inherits your sessions, password manager state and 2FA-approved devices, and works on sites where a fresh headless profile gets blocked. The cost: it is your actual browser — not something you point at a farm of 50 parallel instances.

Honest note: Playwright MCP does offer an opt-in `--extension` mode to connect to a running Chrome/Edge, and Chrome DevTools MCP can attach via `--browser-url`. Neither is the default or the primary documented path; for both projects the managed profile is the designed-for mode.

## What about the two projects both called "Browser MCP"?

An accident of naming: [browsermcp.io](https://browsermcp.io) (`@browsermcp/mcp`) and this project (`@agent360/browser-mcp`) are unaffiliated but solve the same problem the same way — a Chrome extension plus a local stdio MCP server. The practical difference in 2026 is maintenance: browsermcp.io's repository has had no code change since 2025-04-24 and has never shipped a GitHub release (checked 2026-07-21), while this project ships regularly (34 tools as of v1.24.0). We keep a dated, sourced side-by-side on the [dedicated comparison page](/compare/browsermcp-io/).

## Which is most actively maintained?

As of 2026-07-21, by last commit: Browser Use and Chrome DevTools MCP (2026-07-20), Playwright MCP (2026-07-15), Browser MCP by Agent360 (2026-07-21). browsermcp.io: 2025-04-24. The archived official **Puppeteer MCP** (`@modelcontextprotocol/server-puppeteer`) deserves a mention because it still shows ~36k npm downloads/week: it was moved to `modelcontextprotocol/servers-archived` and last saw a commit 2025-05-15 — if you are choosing today, choose something maintained.

## When should you *not* pick each?

Every tool on this page loses somewhere. Playwright MCP is the wrong tool if the job depends on your personal logged-in sessions. The real-Chrome tools (including ours) are the wrong tool for CI pipelines, serverless scale-out, or anything that must run 50 instances in parallel — we say so explicitly in [When NOT to use Browser MCP](/docs/when-not-to-use/). Browser Use assumes a Python stack. Chrome DevTools MCP sends performance-trace URLs to Google's CrUX API and collects usage statistics by default (both can be disabled with flags — documented in its README, checked 2026-07-21).

## FAQ

**Which MCP server should I use for browser automation in CI?**
Playwright MCP — managed profiles, headless mode, 69 documented tools, and the scale evidence of 6.3M weekly npm downloads (2026-07-21).

**Which MCP server can use my existing Chrome logins?**
The two "Browser MCP" projects drive your real Chrome by default. Of the two, only Browser MCP by Agent360 has shipped code since April 2025 (checked 2026-07-21).

**Is Puppeteer MCP still maintained?**
No. The official `@modelcontextprotocol/server-puppeteer` was archived (moved to `servers-archived`, last commit 2025-05-15) and its npm package was last published 2025-05-12.

**Are these tools free?**
All five are open source (Apache-2.0 or MIT). Browser Use additionally offers a paid cloud browser; the others run entirely locally.
