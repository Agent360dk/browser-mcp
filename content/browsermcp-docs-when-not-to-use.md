// KILDE: alternativ-tal fra fakta-ark 2026-07-21. Anti-evasion-linjen = produkt-beslutning (reliability frontier-notat 2026-06-29, godkendt til offentliggørelse som holdning — ikke som internt dokument).

# When NOT to use Browser MCP

*Suggested URL: `/docs/when-not-to-use` · Suggested title tag: "When NOT to Use Browser MCP (Honest Guide, 2026)" · Suggested meta description: "Browser MCP drives your real logged-in Chrome — which makes it the wrong tool for CI, parallel scraping, clean-room testing and bot evasion. Here is what to use instead." · Last verified: July 21, 2026*

---

**Short answer:** Browser MCP does one thing — it gives an AI agent your real, already-logged-in Chrome. If your job does not need *your* browser, you are probably better served elsewhere: **CI/CD and headless scale → Playwright MCP**, **performance tracing → Chrome DevTools MCP**, **Python agent stacks → Browser Use**. And if the goal is evading bot detection on sites that prohibit automation, no — that is explicitly out of scope for this project.

## Don't use it for CI/CD or scheduled server jobs

There is no headless mode and no server mode, by design: the extension drives a real Chrome on a real desktop. A pipeline has no "your browser". Use [Playwright MCP](https://github.com/microsoft/playwright-mcp) — managed profiles, headless, 6.3M npm downloads/week and weekly releases (checked 2026-07-21). This is not a grudging concession; it is the correct tool for that job.

## Don't use it for parallel scraping fleets

One user, one Chrome. Browser MCP supports multiple tabs and sessions inside that Chrome, but it will never fan out to 50 isolated instances. High-volume scraping wants isolated managed browsers (Playwright MCP, or Browser Use's cloud offering if you are in Python).

## Don't use it when a clean profile is the point

Reproducible tests, signed-out UX checks, "what does a first-time visitor see" — all argue for a fresh profile with no cookies. That is exactly what the managed-profile tools give you by default and exactly what Browser MCP never gives you: it inherits your logged-in state, which here would contaminate the result.

## Don't use it for performance auditing

Chrome DevTools MCP (47,285 stars, v1.6.0 2026-07-14) exposes DevTools-grade tracing, network and memory tooling — 52 tools of it. Browser MCP's 34 tools are interaction-focused (click, fill, navigate, extract, upload); it has no performance-trace surface. One factual note for the privacy-minded: Chrome DevTools MCP sends performance-trace URLs to Google's CrUX API and collects usage statistics by default — both are documented and can be disabled with flags (its README, checked 2026-07-21).

## Don't use it to evade bot detection

Some automation tooling competes on defeating anti-bot systems. We made the opposite product decision, in public: Browser MCP is for **authorized** automation — your accounts, your dashboards, sites that permit what you are doing. We do not build detection-evasion features, and "it runs in a real browser" is not a licence to violate a site's terms. If a site blocks automated access and you do not have permission, the answer is permission, not a better disguise.

## So when is it the right tool?

When the job is *yours*: behind your logins, on your machine, in workflows where re-authenticating a fresh browser is the actual obstacle — 2FA approvals, session-gated dashboards, password-managed accounts. That case is documented across [What is Browser MCP](/docs/what-is-browser-mcp/), the [install guides](/docs/install-claude-code/) and the [full comparison](/compare/browser-automation-mcp-servers/).

## FAQ

**Can Browser MCP run headless?**
No, and it never will — driving your real, visible Chrome is the product. Headless is Playwright MCP's territory.

**Can it run on a server?**
Not meaningfully. It needs a desktop Chrome with the extension installed and a logged-in human profile worth driving.

**Will you add CAPTCHA/anti-bot evasion?**
No. CAPTCHA assistance exists for accessibility on sites you are authorized to use; defeating bot detection on sites that prohibit automation is out of scope, permanently.

**What should a Python team use?**
Browser Use (105,795 stars, checked 2026-07-21) — an agent framework rather than a plain MCP toolset, with an optional cloud browser.
