# What Is Browser MCP?

**Browser MCP is an MCP (Model Context Protocol) server that hands any MCP-connected AI agent — Claude Code, Cursor, or any other MCP client — the wheel of your real, already-logged-in Chrome browser, instead of spinning up a fresh, unauthenticated headless browser.** It runs as a Chrome extension paired with a local MCP server (package: `@agent360/browser-mcp`), exposes 34 tools over the protocol, and never sends your browsing data anywhere — everything stays on your machine.

That one distinction — *your* browser versus *a* browser — is the whole reason it exists. A headless tool like Playwright or Puppeteer starts a browser with no cookies, no session, and no identity. Browser MCP starts from the browser you were already signed into. The agent inherits your logins, your 2FA-trusted device, and your session state, so it can act on sites that have no API and no tolerance for bots.

## What is an MCP server?

The Model Context Protocol (MCP) is an open standard, published by Anthropic, that defines how an AI model connects to external tools and data sources through a common interface — instead of every integration needing its own custom, one-off wiring. An **MCP server** is a program that implements that standard on the "tool" side: it exposes a set of callable functions (in Browser MCP's case, 34 of them — navigate, click, fill, screenshot, solve a CAPTCHA, and so on) that any MCP-compatible client can call over a shared, structured protocol.

The full specification is maintained at [modelcontextprotocol.io](https://modelcontextprotocol.io). Browser MCP is one implementation of that spec, scoped specifically to browser control.

## What does Browser MCP specifically do?

Browser MCP is an MCP server for **browser automation through your real Chrome profile**. Concretely, it is two cooperating pieces:

- A **Chrome extension** (Manifest V3), which holds the tab groups, reads cookies/localStorage, and executes actions through Chrome's own APIs (including Chrome's `debugger` API / DevTools Protocol, so it can act on tabs that aren't in focus).
- A **local MCP server** (`npx @agent360/browser-mcp`) that your MCP client talks to over stdio, and that bridges to the extension over a local WebSocket connection (ports 9876–9885, one per concurrent session).

An AI agent connected to it can navigate pages, read and fill forms, click by CSS or by visible text, take screenshots, run JavaScript in page context, manage tabs and iframes, read cookies and localStorage, make CORS-free fetch calls from the extension, wait for a specific network call to finish, attempt CAPTCHA solves, pull an API token straight off a provider's dashboard (zero-config shortcuts for common ones like Stripe, HubSpot, or Slack — and general-purpose navigate-and-read support for any provider that isn't preconfigured), and hand control back to you mid-task for anything that needs a human (2FA code, a password, a judgment call). The full list of the 34 tools, grouped by category, is in the [tools reference](/docs/tools).

## How does Browser MCP work, mechanically?

1. Your MCP client — Claude Code, Cursor, VS Code agent mode, or any other MCP-compatible client — starts a conversation and spawns the Browser MCP server as a subprocess over stdio.
2. That server binds to the first free port in its 9876–9885 range.
3. The Chrome extension's offscreen document polls that port range every ~2 seconds and opens a WebSocket connection once it finds a live server.
4. From then on, tool calls flow: **your AI client → MCP server → Chrome extension → Chrome's extension/debugger APIs → the page.**
5. Each conversation gets its own color-coded Chrome tab group and can only see and act on tabs it opened — so several agent sessions can run against the same Chrome instance without stepping on each other (up to 10 concurrent sessions).
6. The server process exits on its own when the client disconnects (stdin-close detection) or after a 4-hour idle timeout — there's no daemon left running in the background.

## Browser MCP vs. headless automation (Playwright, Puppeteer)

Headless frameworks like Playwright and Puppeteer are excellent at what they were built for: fast, disposable, CI-friendly browser instances for testing your own app. They are not built to *be you* on someone else's site. Browser MCP solves a different problem — acting as an authenticated human — which is why the two are usually complementary rather than competing:

| | Browser MCP | Playwright / Puppeteer (headless) |
|---|---|---|
| **Browser instance** | Your actual Chrome — the one you already use | A new, disposable browser context |
| **Logins & cookies** | Inherited from your real session | None — must authenticate every run |
| **2FA / OTP mid-flow** | Can switch to another open tab (e.g. Gmail) to read the code, then return and continue — with `browser_ask_user` available to hand off to you if the step genuinely needs a human | Not supported — typically blocks or requires a stored/bypassed credential |
| **CAPTCHA / anti-bot walls** | Dedicated `browser_solve_captcha` tool; Attempts the checkbox challenge, then shows it to you to finish (human-in-the-loop). We publish no solve-rate figure - we haven't benchmarked it rigorously enough to stand behind one. | Frequently detected and blocked outright — these tools identify as automation by default |
| **Best fit** | Operating real accounts on sites with no API: dashboards, LinkedIn, internal tools, your own app as a logged-in user | Fast, repeatable CI/E2E test suites against your own app in a clean, reproducible state |
| **Session persistence** | Native — it's your live browser | Requires manually saving/restoring storage state |
| **Where it runs** | Locally, via a Chrome extension you load yourself | Locally or in CI, via a downloaded browser binary |
| **Install** | `npx @agent360/browser-mcp install`, load the extension once | Framework install + browser binary download |

If your task is "verify my checkout flow still works in a clean environment," reach for Playwright. If your task is "log into the tool I already use and do something in it," that's the gap Browser MCP fills.

## Why does controlling a real, logged-in browser matter?

Most of the software a person actually uses in a day — a CRM, an internal admin panel, LinkedIn, a bank portal, a SaaS dashboard with no public API — is guarded by exactly the things headless automation struggles with: a login wall, a 2FA prompt, or a bot-detection layer that headless browsers trip by default (see [Chrome Web Store distribution model](https://developer.chrome.com/docs/webstore) for how the extension itself is delivered like any other Chrome extension, not a special automation binary).

Because Browser MCP drives your real, already-authenticated Chrome, an agent using it doesn't need to solve the login problem at all — it's already logged in, the same way you are. When a site does throw a one-time verification step mid-flow, the agent can pause, read the code from another tab you have open (your email client, an authenticator page), and continue — with you watching and able to step in via `browser_ask_user` at any point that needs a human decision.

## Is Browser MCP free, and where does my data go?

Browser MCP is MIT-licensed, free, and 100% local. There is no cloud relay, no hosted backend, and no API key — the MCP server runs on your own machine and talks to your own Chrome extension over a local WebSocket connection. Source is public on [GitHub](https://github.com/Agent360dk/browser-mcp).

## How do I install it?

```bash
npx @agent360/browser-mcp install
```

That configures the local MCP server and copies the extension files to `~/.browser-mcp/extension/`, which you then load once via `chrome://extensions` → Developer mode → Load unpacked (or install the packaged version from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl)). Client-specific walkthroughs:

- [Install in Claude Code](/docs/install-claude-code)
- [Install in Cursor](/docs/install-cursor)
- [Install in VS Code / Claude Desktop](/docs/install-vscode)

## Frequently asked questions

**Is Browser MCP the same thing as an MCP server for a specific app, like a GitHub or Slack MCP server?**
No. Those expose one product's API through MCP. Browser MCP exposes *browser control itself* — it works on any site you can already reach in Chrome, API or not, which is why it pairs with per-app MCP servers rather than replacing them.

**Does Browser MCP replace Playwright MCP?**
Not for testing your own app in a clean environment — that's still Playwright's job. It replaces headless tools for the specific case of acting as an authenticated human on a site you don't control.

**Which AI clients can use Browser MCP?**
Any MCP-compatible client: Claude Code, Cursor, VS Code in agent mode, and others that implement the [Model Context Protocol](https://modelcontextprotocol.io) client side.

**How many tools does it expose?**
34, spanning navigation, page content, interaction (click/fill/select/date-pickers), tabs and iframes, cookies and storage, network waiting, CAPTCHA solving, and human-in-the-loop handoff. Full reference: [/docs/tools](/docs/tools).