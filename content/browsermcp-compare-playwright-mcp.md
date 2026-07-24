// KILDE: tal fra fakta-ark 2026-07-21 (GitHub API + npm API + microsoft/playwright-mcp README rå-fetch). Playwright-tool-tal 69 = optalt fra README "### Tools"-sektion; --extension-flag citeret fra samme README.

# Browser MCP vs Playwright MCP: when you need a real, logged-in browser

*Suggested URL: `/compare/playwright-mcp` · Suggested title tag: "Browser MCP vs Playwright MCP (2026): Real Logged-In Chrome vs Managed Profiles" · Suggested meta description: "An honest comparison: Playwright MCP wins CI, scale and tool breadth. Browser MCP exists for one job — driving your real, already-logged-in Chrome. Dated facts, both sides." · Last verified: July 21, 2026*

---

**Short answer:** if you are automating in CI, at scale, or on pages where a fresh browser profile is fine — use **Playwright MCP**. It is the category default for good reasons: 69 documented tools, 6.3M npm downloads/week, backed by Microsoft, shipping weekly (all checked 2026-07-21). **Browser MCP** exists for the jobs Playwright's model deliberately avoids: the agent drives your **real, already-logged-in Chrome** — your cookies, your 2FA-approved sessions, your password-manager state — instead of a clean profile that hits every login wall as a stranger.

## The architectural difference (everything else follows from it)

**Playwright MCP** launches and manages its own browser: an isolated in-memory profile (`--isolated`) or a persistent-but-dedicated one. That design is what makes it reproducible in CI and safe to parallelize — and it is also why a Playwright-driven session starts logged out of everything.

**Browser MCP** is a Chrome extension plus a local stdio server. There is no second browser: tools act on the Chrome window you already use, through the Chrome Debugger API. Nothing to re-authenticate, because it *is* your authenticated browser. The trade-off is symmetrical: you get exactly one browser — yours.

| | Playwright MCP | Browser MCP by Agent360 |
|---|---|---|
| Browser driven | Own managed profile (isolated/persistent) | Your real Chrome — only mode |
| Logged-in state | Fresh by default | Inherited (cookies, 2FA, extensions) |
| CI / headless | Yes — core use case | No |
| Parallel instances | Yes | One (your browser; multi-tab sessions supported) |
| Tools | 69 documented (incl. opt-in vision/pdf/devtools) | 34 |
| Install | `npx @playwright/mcp` | `npx @agent360/browser-mcp install` + Chrome extension |
| Scale signal | 6,369,865 npm dl/week (2026-07-24) | 387 npm dl/week (2026-07-24) |
| Maintenance | Last commit 2026-07-24 · v0.0.78 2026-07-09 | Last commit 2026-07-24 · v1.24.0 2026-07-24 |
| License · cost | Apache-2.0 · free, local | MIT · free, local |

*(We publish the download gap on purpose. Playwright MCP is the bigger project by three orders of magnitude; this page is about when that is not the deciding axis.)*

## Can Playwright MCP use my real browser too?

Partly, and it is fair to say so: Playwright MCP has an opt-in `--extension` flag — "Connect to a running browser instance (Edge/Chrome only). Requires the 'Playwright Extension'" (its README, checked 2026-07-21). It is not the default, not the primary documented path, and the managed profile remains the designed-for mode. If real-Chrome sessions are the *core* of your workflow rather than an edge case, a tool where that is the only mode has fewer seams.

## When Playwright MCP is the right choice

- CI/CD pipelines and scheduled jobs — headless, reproducible, no human's browser involved
- Test suites and scraping that benefit from parallel isolated instances
- Anything on infrastructure (serverless, containers) rather than a workstation
- When you want the largest tool surface (69 tools incl. PDF, vision, network interception)

We list these plainly in [When NOT to use Browser MCP](/docs/when-not-to-use/) — they are the same list.

## When Browser MCP is the right choice

- The workflow starts behind a login you already have — dashboards, admin panels, webmail
- 2FA-gated sites: the agent can wait while you approve, or read the code from a tab you are signed into
- Sites where fresh headless profiles get blocked or endlessly challenged
- "Do this in *my* browser" tasks: triage my tabs, fill this form as me, pull a token from my dashboard

## FAQ

**Is Browser MCP a Playwright wrapper?**
No. It is a Chrome extension using the Chrome Debugger API on your running browser; no Playwright, no bundled browser binary.

**Can I run both?**
Yes — they register as separate MCP servers and many setups use Playwright MCP for CI and Browser MCP for logged-in interactive work.

**Which is safer for credentials?**
Both run locally. Browser MCP never sees your passwords — it operates a browser where you are already signed in; sessions never leave your machine.

**Is Playwright MCP really maintained by Microsoft?**
Yes — the repository lives under the `microsoft` GitHub organization (checked 2026-07-21).
