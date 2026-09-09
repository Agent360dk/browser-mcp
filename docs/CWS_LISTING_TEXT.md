# Chrome Web Store listing - full audit and paste-ready text

Rewritten 2026-09-08. The listing lives in the CWS dashboard, **not in this repo**, so none of it
can be fixed by a commit: <https://chrome.google.com/webstore/devconsole/> → Agent360 Browser MCP.

Live state read the same day from the public page (736 users, 0 ratings, v1.29.0, updated 7 Sept,
developer Agent360 Group ApS, category Developer Tools).

## What is actually wrong - every field

| Field | State 2026-09-08 | Verdict |
|---|---|---|
| Product name | "Agent360 Browser MCP" | ✅ keep |
| **Summary** (132 char) | "Give Claude Code your real logged-in Chrome. Two parts: this extension + one npx command." | ✅ **already fixed** - `extension/manifest.json`'s `description` overwrote it when 1.29.0 published on 7 Sept. Nothing to paste. |
| **Detailed description** | Says **29 browser tools** and **up to 10 concurrent sessions**; claims **"~80% pass rate"** on CAPTCHAs; the setup block still tells store users to run `npx … install` and load an unpacked extension | 🔴 replace - §1 below |
| **Screenshots** | Three, dated 3 May, all crops of the *old website* | 🔴 replace - §2 |
| **Small promo tile** (440×280) | Not produced in this repo before today | 🟡 upload - §2 |
| **Marquee tile** (1400×560) | Never produced | 🟡 upload - §2 |
| **YouTube video** | Empty. `docs/demo.mp4` exists (20 June) but is on no video host, so the listing's video slot is unused | 🟡 §3 |
| Store icon | Generic blue-gradient sparkle | 🟡 decision - §4 |
| Privacy: single purpose + permission justifications | Not tracked in this repo | 🟡 §5 |
| Ratings | 0 reviews at 736 users | 🟡 §6 - this one moves ranking |

### The three numbers, verified 2026-09-08 - re-run before re-publishing

- **40 tools** - `mcp-server/tools.js` exports 40. The listing says 29 (two generations stale).
- **20 concurrent sessions** - port range 9876–9895 (`mcp-server/index.js:45-46`) is 20 ports, so 20
  sessions can hold one at a time. The listing says 10, which was true before v1.29.0.
  Do **not** confuse this with `MAX_TABS_PER_SESSION = 20` (`extension/background.js:195`) - that is
  20 *tabs* per session and is a different 20.
- **9 built-in integrations** - the comparison table in `README.md:138`.

### ⚠ Delete the "~80% pass rate" claim and do not replace it with another number

That figure exists **only on the store listing**. It is not in the README, not in
`mcp-server/tools.js`, not in the tool's own description, and there is no measurement behind it
anywhere in this repo. It is an unsourced success-rate claim about CAPTCHA solving, sitting on a
public listing, in the one product area store review treats as sensitive. What the tool actually
does is documented and honest - auto-click first, then a screenshot for the model to look at, then
ask the human - so describe the mechanism instead of inventing a hit rate.

---

## §1 Detailed description - replace the whole thing

Google's own listing guidance: an overview paragraph, then a short feature list; keywords only
where they name a real feature; keyword stuffing can get an item suspended. This follows that
shape and leads with the two-parts warning, because a store-only install lands on "Not connected"
and that is the single biggest cause of an install that never becomes a user.

```
Browser MCP gives Claude Code, Codex, Cursor, VS Code and Windsurf control of the
Chrome you already use - the one with your sessions, your cookies, your logins.
Not a fresh headless browser that hits a login wall on the first page.

⚠ READ FIRST - THIS EXTENSION IS HALF OF BROWSER MCP

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

   Cursor / VS Code / Windsurf - add to that client's MCP config:
      {"mcpServers": {"browser-mcp": {"command": "npx",
       "args": ["@agent360/browser-mcp@latest"]}}}

   Per-client guides: https://browsermcp.dev/docs/install-claude-code/

3. Restart your AI client. Click this extension's icon - it turns green.

Why two steps? Chrome does not allow an extension to install itself from npm, and
npm cannot install a Chrome extension. Neither half can install the other, so you
install each once.

Stuck on "Not connected"? https://browsermcp.dev/docs/troubleshooting/

═══ WHAT TO SAY ONCE IT WORKS ═══

Nothing happens until you ask. Paste one of these to your agent:

  "Take a screenshot of my current Chrome tab."
     Start here - an image back means both halves are talking.

  "Open my Gmail tab and tell me who sent my last 3 emails."
     The one that shows the difference: it works because it is YOUR
     browser, already signed in. A headless tool hits a login wall here.

  "Go to my analytics dashboard, pull this month's numbers, and put
   them in a table."
     Any dashboard you are already logged into - no API key, no export.

  "Fill in this signup form with my details. Stop and ask me before
   anything sensitive."
     You stay in the loop for passwords and payment details.

  "Log me in here. If it emails a code, read it from my Gmail tab and
   continue."
     The move no API can make.

The pattern: anything you would do yourself in a browser, on a site you
are already signed into. Strongest where there is no API - internal
dashboards, admin panels, portals.

═══ WHAT IT CAN DO ═══

40 tools, including:

  • Navigate, click, double-click, right-click, hover, scroll, press keys
  • Read page content, extract lists, take screenshots, read console logs
  • Fill forms, including React and Vue controlled inputs, dropdowns,
    comboboxes, date pickers and file uploads
  • Work inside iframes, switch and close tabs, wait for network activity
  • Read and write cookies and localStorage, extract API tokens
  • Detect CAPTCHAs (reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile,
    FunCaptcha): it tries the checkbox, then hands you a screenshot to
    look at, then asks you to finish it yourself
  • Ask you directly - an in-page dialog for 2FA codes, passwords and
    anything else it should not decide alone

═══ TWENTY AGENTS, ONE BROWSER ═══

Every chat gets its own colour-coded Chrome tab group and can only see its own
tabs - up to 20 at a time. Close the chat and its tabs go with it. Other browser
automation tools take over the whole profile, so a second agent has to wait.

═══ WHAT IT DOES WITH YOUR DATA ═══

Nothing leaves your machine. The extension talks to one thing: a server on
127.0.0.1 that you started. There is no account, no telemetry, no server of ours,
and no payment. The extension keeps a local log of every action the agent took,
and marks the sensitive ones, so you can look at what happened.

MIT licensed, source at https://github.com/Agent360dk/browser-mcp
```

---

## §2 Images - replace all three, add the two tiles

The three live images are not product screenshots. They are cropped captures of the *old website*,
dated 3 May. `docs/screenshots/multi-session.png` - the one whose name promises the differentiator -
shows the April-2025 hero *"Your AI can't use a browser. Until now."*, a large empty black box, and
`npx @agent360/browser-mcp install` as the install command, which copies extension files but does
not register the server. It sold the exact failure this listing rewrite exists to fix. Delete all
three; do not reuse.

Google's rule for screenshots is that they must *"demonstrate the actual user experience, focusing
on the core features and content."* So four of the five below are the product's own interface -
the popup, the session cards, the action log and the in-page dialog are rendered from
`extension/popup.html` and the overlay code in `extension/background.js`, not drawn freehand.

New set: `docs/store-2026-09-08/`, upload in this order.

| # | File | Shows | Caption (optional in the store) |
|---|---|---|---|
| 1 | `01.png` | The popup in its real not-connected state, with the setup card and the command | Two parts: this extension plus one command. The extension tells you so itself. |
| 2 | `02.png` | Real Chrome tab strip with four agent groups, plus the popup listing who owns what | Twenty agents in one signed-in browser - each sees only its own tabs. |
| 3 | `03.png` | The in-page dialog asking for a 2FA code, over a dimmed login page | It asks you. It never guesses. |
| 4 | `04.png` | The action log, sensitive entries in amber | Every action written down. 100% local, no account. |
| 5 | `05.png` | 40 tools · 20 sessions · 9 integrations · $0, plus the capability chips | Free, MIT, open source. Works with Claude Code, Codex, Cursor, VS Code, Windsurf. |

Two more image fields, both empty today:

- `promo-tile-440x280.png` - the **small promo tile**, which is what appears in store search results
  and on category pages. Without it the listing is weaker in exactly the place people browse.
- `marquee-1400x560.png` - the **marquee**, used only if the store features an extension. It costs
  nothing to have and cannot be earned without it.

Source: `demo-video-src/src/Store.tsx`, compositions `Store` (1280×800, one slide per frame),
`PromoTile` and `MarqueeTile`. Re-render:
`cd demo-video-src && ./node_modules/.bin/remotion still Store out.png --frame=N`.
The tab strip is `demo-video-src/public/fanegrupper.png`, cropped from
`assets/raw-2026-09-07/fanegrupper-live.png` - the crop drops the fifth group on purpose, because
the raw capture shows *two* groups both labelled "Claude 1", which was issue #17, fixed the same day.

---

## §3 The video slot is empty

A CWS listing can carry a YouTube video that shows above the screenshots. Ours is unset, and there
is no YouTube link anywhere in this repo. `docs/demo.mp4` exists but is from 20 June - before
v1.29.0, before 40 tools, before the port-on-use change - so it is stale as well as unhosted.

This is the highest-leverage empty field after the screenshots, and it is also the most work: the
video has to be re-cut against the current product, uploaded to YouTube (unlisted is fine) and
pasted in. Worth doing, not worth blocking the text and image fixes on.

---

## §4 The store icon - a decision, not a fix

The icon today is a blue-gradient rounded square with a white four-point sparkle, shared with
browsermcp.dev's `docs/logo.svg`. Two things are true about it:

- It is **generic**. A blue gradient plus a sparkle is the default AI-product mark; a dozen
  extensions in the same search results are within a shade of it. Google's own icon guidance asks
  for something *"simple and recognizable to your brand"* - this is simple but recognizes nothing.
- Because it is generic, "someone copied our logo" is very hard to establish, and equally hard to
  act on. A search on 8 Sept found no extension using the Agent360 mark. What it did find is
  **Yolo Chrome MCP for Claude** (SeedX LLC, 3,000 users, updated 25 Aug), whose pitch - *"turns
  your real, logged-in Chrome session into a tool Claude can drive"* - is our positioning almost
  word for word. That is the real copying, and it is of the words, not the picture.

**Recommendation: do not adopt the Agent360 corporate logo, and do replace the sparkle.**

Adopting the corporate mark works against the goal. Nobody searches the Chrome store for Agent360;
they search for browser MCP. The publisher line already says "Agent360 Group ApS" directly under
the title, which is where the company-behind-it trust actually comes from. And if a copycat really
is using the Agent360 mark, moving *onto* that mark increases the collision instead of ending it -
the lever against impersonation is a report under the store's impersonation policy and the
publisher name, never the icon.

What the icon should be instead is a mark specific to Browser MCP that survives 16 px in the
toolbar. One caveat worth pricing in: 736 people currently find this extension in their toolbar by
its icon. Change it once, deliberately, and then never again.

If you want to move on this, the next step is a handful of concrete marks to choose between, not
a swap to the corporate logo. Say the word and I will draw them.

---

## §5 Privacy tab - worth a read-through, not yet audited

The listing's privacy section carries a single-purpose statement and one justification per
permission. This extension requests twelve permissions plus `<all_urls>` plus `debugger` - the
heaviest combination the store allows without special review. Those justification fields are what
a reviewer reads, and they are also shown to users. Nothing in this repo tracks what is currently
written in them, so they need a read-through in the dashboard before the next submit. If they still
describe a 29-tool extension, they carry the same drift as the description.

---

## §6 Zero reviews at 736 users is a ranking problem

Google ranks store items on a heuristic that includes user ratings and the download-versus-uninstall
trend. 736 users and no reviews at all means the ratings input is empty. The README already carries
an ungated review request; the listing description should not beg, but the popup's connected state
is the right place to ask once, at the moment it just worked.

Not urgent, and not something to fake. Worth one deliberate ask.

---

## Notes for next time

- The summary field is **generated from `extension/manifest.json`'s `description`** on publish.
  Editing it in the dashboard is temporary; edit the manifest.
- Do not put a hard tool count in the summary unless the matching npm version ships at the same
  time - the count belongs to the MCP server, not the extension, and the two halves drift apart the
  moment only one publishes. The stale "29" is exactly that drift, twice over.
