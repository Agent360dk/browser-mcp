// KILDE: grounded i README ("up to 10 concurrent", "Multi-session color-coded tab groups") + extension chrome.tabGroups.update + tools browser_list_tabs/get_new_tab/switch_tab (verificeret). INGEN performance-tal — ren walkthrough.

# Running several AI agent sessions in one Chrome — without them colliding

*Suggested URL: `/use-cases/concurrent-sessions` · Suggested title tag: "Run Multiple AI Agent Sessions in One Chrome (Browser MCP)" · Suggested meta description: "How Browser MCP keeps several concurrent agent sessions isolated inside a single Chrome — up to 10, each in its own color-coded tab group, none able to see the others' tabs." · Last verified: July 22, 2026*

---

**Short answer:** you can run several agent sessions against the same Chrome at once — up to 10 — and Browser MCP keeps them from stepping on each other by giving each session its own **color-coded Chrome tab group**. A session only sees and acts on its own tabs, so a research agent, a testing agent and a monitoring agent can work in parallel in one browser without crossing wires.

## The problem this solves

The moment you run more than one agent against a real browser, they start fighting over it: one navigates away from a page another was mid-task on, tabs pile up with no owner, and you can't tell which session opened what. A single shared browser with no isolation turns parallel work into a mess.

## How isolation works

Browser MCP scopes each session to its own set of tabs, visually separated into a **color-coded tab group** (Chrome's native tab groups, driven by the extension). When a session opens a tab, it lands in that session's group. When a session lists or switches tabs (`browser_list_tabs`, `browser_get_new_tab`, `browser_switch_tab`), it only sees its own — not the tabs another session is working in. You can glance at Chrome and read, by colour, which group belongs to which agent.

## A concrete parallel setup

- **Session A — research:** navigating docs and dashboards, pulling content with `browser_get_page_content`. Blue group.
- **Session B — testing:** driving a form flow with `browser_fill` / `browser_click`, checking `browser_console_logs`. Green group.
- **Session C — monitoring:** watching a status page, taking periodic `browser_screenshot`s. Orange group.

All three run in the same Chrome, at the same time, on your real logged-in profile. None of them can accidentally act on another's tabs.

## Why this matters for real-Chrome automation

Headless tools solve parallelism by spawning many isolated browsers — clean, but none of them are *your* logged-in browser. Browser MCP's whole point is to act as you, in your real Chrome. Multi-session tab-group isolation is what makes that safe to do more than one agent at a time: you keep the real-browser advantage without the sessions colliding.

## FAQ

**How many sessions can run at once?**
Up to 10 concurrent sessions, each in its own color-coded tab group (as documented in the project README).

**Can one session see another session's tabs?**
No — that's the point of the isolation. Each session's tab operations are scoped to its own group.

**Do the sessions share my login state?**
Yes — they all run in your real Chrome, so they share your cookies and sessions. Isolation is about *tabs*, not identity: every session acts as you.

**How do I start a second session?**
Each MCP client session that connects gets its own group automatically. Point a second Claude Code (or Cursor / VS Code) session at Browser MCP and it lands in its own colour.

**How do I set it up?**
[Install Browser MCP](/docs/install-claude-code/), then run more than one agent session against it — the tab groups appear on their own.
