# Chrome Web Store listing — text to paste

The store listing lives in the CWS dashboard, **not in this repo**, so it cannot be fixed by a
commit. Paste the two blocks below at
<https://chrome.google.com/webstore/devconsole/> → Agent360 Browser MCP → **Store listing**.

**Why it needs fixing (measured 2026-08-19 against the live listing):**

| Field | Live today | Problem |
|---|---|---|
| Summary (the only text visible without expanding) | "Control your real Chrome from Claude Code — navigate, click, fill, screenshot, solve CAPTCHAs. 40 tools, multi-session." | Never mentions that a local MCP server is required. A store-only installer lands on "Not connected" with no idea why. |
| "HOW IT WORKS" in the long description | "1. Install this extension 2. Run: npx @agent360/browser-mcp install 3. Restart Claude Code — **29** browser tools" | Buried under ~40 lines of features, the tool count is two generations stale, and the command **does not register the server with Claude Code** — `npx … install` writes `~/.claude/mcp.json`, which Claude Code does not read (verified 2026-08-19). It also tells a store user to load an unpacked extension they do not need. |

---

## 1. Summary field (max 132 characters)

```
Give Claude Code your real logged-in Chrome. Two parts: this extension + one npx command. Multi-session, local, MIT.
```

(116 characters. Keep the "two parts" clause — it is the whole point of the change.)

---

## 2. Detailed description — replace the top of the existing text with this

Put this **above** everything else, before the feature bullets. Everything below the divider in
the current listing can stay, except the stale "HOW IT WORKS" block, which this replaces.

```
⚠ READ FIRST — THIS EXTENSION IS HALF OF BROWSER MCP

Browser MCP is a Chrome extension PLUS a local MCP server. This page can only give
you the extension. On its own it will sit on "Not connected" forever, because there
is no server for it to talk to. The other half is one command.

═══ SETUP (2 minutes) ═══

1. Install this extension (you are here).

2. Register the MCP server with your AI client.

   Claude Code:
      claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest

   OpenAI Codex:
      codex mcp add browser-mcp -- npx @agent360/browser-mcp@latest

   Cursor / VS Code / Windsurf — add to that client's MCP config:
      {"mcpServers": {"browser-mcp": {"command": "npx",
       "args": ["@agent360/browser-mcp@latest"]}}}

   Per-client guides: https://browsermcp.dev/docs/install-claude-code/

3. Restart your AI client. Click this extension's icon — it turns green.

Why two steps? Chrome does not allow an extension to install itself from npm, and
npm cannot install a Chrome extension. Neither half can install the other, so you
install each once.

Stuck on "Not connected"? https://browsermcp.dev/docs/troubleshooting/

═══ WHAT TO SAY ONCE IT WORKS ═══

Nothing happens until you ask. Paste one of these to your agent:

  "Take a screenshot of my current Chrome tab."
     Start here — an image back means both halves are talking.

  "Open my Gmail tab and tell me who sent my last 3 emails."
     The one that shows the difference: it works because it is YOUR
     browser, already signed in. A headless tool hits a login wall here.

  "Go to my analytics dashboard, pull this month's numbers, and put
   them in a table."
     Any dashboard you are already logged into — no API key, no export.

  "Fill in this signup form with my details. Stop and ask me before
   anything sensitive."
     You stay in the loop for passwords and payment details.

  "Log me in here. If it emails a code, read it from my Gmail tab and
   continue."
     The move no API can make.

The pattern: anything you would do yourself in a browser, on a site you
are already signed into. Strongest where there is no API — internal
dashboards, admin panels, portals.

More: https://browsermcp.dev/#try
```

---

## Notes

- Do **not** re-add a hard tool count to the summary unless you are also publishing the
  matching npm version — the count belongs to the MCP server (`mcp-server/tools.js`), not to
  the extension, so the two drift apart the moment only one half ships. The stale "29" and
  "34" in the current listing are exactly that drift.
- `extension/manifest.json`'s `description` field becomes the store summary on the next
  publish, so keep the two in sync.

---

## 3. Screenshots — replace all three (produced 2026-09-08)

**The three images live in the listing today are not product screenshots.** They are cropped
captures of the *old website*, dated 3 May. `docs/screenshots/multi-session.png` — the one whose
name promises the differentiator — shows the April-2025 hero *"Your AI can't use a browser. Until
now."*, a large empty black box, and `npx @agent360/browser-mcp install` as the install command,
which copies extension files but does not register the server (the same stale command this doc
already replaces in the description). Delete all three; do not reuse.

New set: `docs/store-2026-09-08/01.png` … `05.png`, 1280×800, upload in that order. Slot 1 is the
only one most people see, so it carries the two-parts warning rather than a feature claim.

| # | File | What it says | Caption to paste |
|---|---|---|---|
| 1 | `01.png` | This extension is one half — the 3-step setup, step 1 already ticked | Two parts: this extension plus one command. Neither half can install the other. |
| 2 | `02.png` | Real Chrome tab strip, four agent sessions colour-coded side by side | Twenty agents in one signed-in browser — each chat sees only its own tabs. |
| 3 | `03.png` | The 2FA moment: hits a login wall, reads the code from your own Gmail tab | The move no API can make — because it is your browser, not a bypass. |
| 4 | `04.png` | Four prompts to paste once it works, starting with the screenshot smoke test | Nothing happens until you ask. Start with "take a screenshot of my current tab". |
| 5 | `05.png` | 40 tools · 20 concurrent sessions · 9 integrations · $0 | Free, MIT, 100% local. No account, no telemetry. |

**Numbers on the images, verified 2026-09-08 — re-check before any re-render:**

- **40 tools** — `mcp-server/tools.js` exports 40.
- **20 concurrent sessions** — port range 9876–9895 (`mcp-server/index.js:45-46`) is 20 ports, so
  20 sessions can hold one at a time. Not to be confused with `MAX_TABS_PER_SESSION = 20`
  (`extension/background.js:195`), which is 20 *tabs* per session.
- **9 built-in integrations** — the comparison table in `README.md:138`.

Source: `demo-video-src/src/Store.tsx`, composition `Store` (1280×800, one slide per frame).
Re-render with `cd demo-video-src && ./node_modules/.bin/remotion still Store out.png --frame=N`.
The tab-strip image is `demo-video-src/public/fanegrupper.png`, cropped from
`assets/raw-2026-09-07/fanegrupper-live.png`. The crop deliberately drops the fifth group: the raw
capture shows *two* groups both labelled "Claude 1" — that was issue #17, fixed the same day.
