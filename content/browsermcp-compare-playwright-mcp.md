// KILDE: alle tal genmålt 2026-09-19 (npm downloads-API, GitHub repos-API, microsoft/playwright-mcp README rå-fetch, microsoft/playwright packages/extension README rå-fetch). Playwright-tool-tal 73 = optalt som unikke browser_*-navne i deres README. ⚠️ RETTET 19/9: siden hævdede indtil i dag at Playwright MCP altid starter logget ud. Det er falsk - deres Chrome-udvidelse bruger din egen indloggede browser og giver hver klient sin egen farvede fanegruppe. Skriv aldrig en række her uden at have læst deres nuværende README samme dag.

# Browser MCP vs Playwright MCP: when you need a real, logged-in browser

*Suggested URL: `/compare/playwright-mcp` · Suggested title tag: "Browser MCP vs Playwright MCP (2026): Which One Can Ask You For The Code?" · Suggested meta description: "An honest comparison, corrected September 2026: Playwright MCP wins CI, scale and tool breadth, and it now drives your logged-in Chrome too. One difference is left, and it is measured." · Last verified: September 19, 2026*

---

**Short answer:** for almost everything, use **Playwright MCP**. It is the category default for good reasons: 72 documented tools, 5.97M npm downloads/week, backed by Microsoft, and a release every few weeks (v0.0.78 through v0.0.81, July-September 2026; all checked 2026-09-19). It also ships a Chrome extension that drives the browser you are already signed into - so **"it uses your real logged-in Chrome" is no longer a reason to pick us**, and this page used to say otherwise.

One difference is left, and it is the only one we will defend: **their 72 tools contain nothing that can stop mid-run and ask you for something.** No 2FA code, no CAPTCHA hand-off, no "which of these three accounts did you mean". That is not an oversight - Playwright MCP grew out of a testing tool, and a test that asks for help is a failed test. **Browser MCP** is built the other way round: `browser_ask_user` pauses, asks you on your own screen, and continues in the tab you were already signed into.

## The architectural difference (everything else follows from it)

**Playwright MCP** has two modes, and the difference between this page's two products lives in the first one. By default it launches and manages its own browser: an isolated in-memory profile (`--isolated`) or a persistent-but-dedicated one. That design is what makes it reproducible in CI and safe to parallelize, and it is why a session started that way begins logged out of everything. Since mid-2025 it has also shipped a **Chrome extension** that connects to tabs in the Chrome you already use, with your logins, and supports several clients at once, each in its own coloured tab group. In that mode the logged-in browser is no longer a difference between us at all.

**Browser MCP** is a Chrome extension plus a local stdio server. There is no second browser: tools act on the Chrome window you already use, through the Chrome Debugger API. Nothing to re-authenticate, because it *is* your authenticated browser. The trade-off is symmetrical: you get exactly one browser - yours.

| | Playwright MCP | Browser MCP by Agent360 |
|---|---|---|
| Browser driven | Own managed profile by default; your real Chrome via their extension | Your real Chrome - only mode |
| Logged-in state | Fresh by default; your own session in extension mode | Inherited (cookies, 2FA, extensions) |
| CI / headless | Yes - core use case | No |
| Parallel instances | Yes, and several clients share one browser in extension mode (one tab group each) | One browser, 20 concurrent sessions, one tab group each |
| Tools | 73 documented, none of which can stop and ask you for anything | 40, including `browser_ask_user` for a 2FA code or a CAPTCHA mid-run |
| Install | `npx @playwright/mcp` | Chrome extension + `claude mcp add` (two parts) |
| Scale signal | 5,968,258 npm dl/week (2026-09-19) | 1,456 npm dl/week (2026-09-19) |
| Maintenance | Last push 2026-09-17 · v0.0.81 (2026-09-14) | Last push 2026-09-18 · v1.29.1 (2026-09-13) |
| License · cost | Apache-2.0 · free, local | MIT · free, local |

*(We publish the download gap on purpose. Playwright MCP is the bigger project by three orders of magnitude; this page is about when that is not the deciding axis.)*

## The same task, side by side

```
You:      Sign in to the admin dashboard and export last month's invoices.

Playwright MCP:  [launches its own browser]
                 I'm at the login page. I need credentials.

Browser MCP:     [browser_navigate]
                 You're already signed in. Exporting now.
```

That is the whole difference, and everything below follows from it. The second exchange
has no login step because the tab is in the Chrome you use.

We measured the reverse case too, on 19 September 2026: on a controlled `<select>`
built by a framework, **Playwright MCP lands the choice and we do not**. We answer
honestly that it did not land - but no is still no. That measurement is on
[/learn/tools-that-lie/](https://browsermcp.dev/learn/tools-that-lie/) with the method,
because a comparison page that only lists what we win is not a comparison.

## Can Playwright MCP use my real browser too?

Partly, and it is fair to say so: Playwright MCP has an opt-in `--extension` flag - "Connect to a running browser instance (Edge/Chrome only). Requires the 'Playwright Extension'" (its README, checked 2026-07-21). It is not the default, not the primary documented path, and the managed profile remains the designed-for mode. If real-Chrome sessions are the *core* of your workflow rather than an edge case, a tool where that is the only mode has fewer seams.

## When Playwright MCP is the right choice

- CI/CD pipelines and scheduled jobs - headless, reproducible, no human's browser involved
- Test suites and scraping that benefit from parallel isolated instances
- Anything on infrastructure (serverless, containers) rather than a workstation
- When you want the largest tool surface (72 tools incl. PDF, vision, network interception)

We list these plainly in [When NOT to use Browser MCP](/docs/when-not-to-use/) - they are the same list.

## When Browser MCP is the right choice

- The workflow starts behind a login you already have - dashboards, admin panels, webmail
- 2FA-gated sites: the agent can wait while you approve, or read the code from a tab you are signed into
- Sites where fresh headless profiles get blocked or endlessly challenged
- "Do this in *my* browser" tasks: triage my tabs, fill this form as me, pull a token from my dashboard

## FAQ

**Is Browser MCP a Playwright wrapper?**
No. It is a Chrome extension using the Chrome Debugger API on your running browser; no Playwright, no bundled browser binary.

**Can I run both?**
Yes - they register as separate MCP servers and many setups use Playwright MCP for CI and Browser MCP for logged-in interactive work.

**Which is safer for credentials?**
Both run locally. Browser MCP never asks for your passwords - it operates a browser where you are already signed in, and your cookies stay in that browser unless your agent explicitly reads them.

**Is Playwright MCP really maintained by Microsoft?**
Yes - the repository lives under the `microsoft` GitHub organization (checked 2026-07-21).
