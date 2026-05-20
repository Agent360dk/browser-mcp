# Browser MCP — Use Cases

A growing gallery of things people have built with Browser MCP. The point: spark ideas for what you can do next.

## Add your own

- **Easy:** [Share a use-case](https://github.com/Agent360dk/browser-mcp/issues/new?template=use-case.yml) — fill the form, we'll add it here.
- **Faster:** Ask Claude in your session to "share my browser-mcp use-case" — it knows the format.
- **PR directly:** Edit this file and add your block under **Gallery**.

---

## Gallery

### 🎯 LinkedIn ICP scraping → HeyReach outreach

**Stack:** Browser MCP + Claude Code + HeyReach API
**By:** [@Agent360dk](https://github.com/Agent360dk)

Claude logged into LinkedIn using my existing browser session, scanned search-result profiles, identified Ideal Customer Profile (ICP) matches based on title, company, and industry, then pushed the qualified leads into HeyReach via API where AI-personalised outreach started the sales conversation.

**Why Browser MCP:** Real Chrome session means LinkedIn doesn't trip anti-bot flags the way headless tools do. `browser_fetch` from the extension background also bypassed CORS when calling the HeyReach API directly from the same flow.

---

### 🎯 Daily ops & research

**Stack:** Browser MCP + Claude Code
**By:** [@Agent360dk](https://github.com/Agent360dk)

Catch-all daily driver: vendor research, pricing comparisons across competitor sites, form-filling for partner onboarding, screenshot-evidence for support tickets, and extracting data from internal dashboards without paying for an API tier.

**Why Browser MCP:** "Real browser, real logins" beats every alternative for the long tail of one-off automations where a proper integration would take longer to write than the task itself.

---

_Add yours — what cool thing have you built?_ → [Share a use-case](https://github.com/Agent360dk/browser-mcp/issues/new?template=use-case.yml)

---

_Last updated: 2026-05-21 · Maintained by [@Agent360dk](https://github.com/Agent360dk)_
