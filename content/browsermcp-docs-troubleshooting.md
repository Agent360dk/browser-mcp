// KILDE: egne dogfooding-fund — reliability-audit 2026-07-02 (FIX-1/2/4/5/13/17, staged til næste release), controlled-form-audit 2026-07-08 (R1-R4, rapport-fase), debugger-detach-quirk (kendt siden maj, memory + NOTES 2026-06-29), "extension not connected"-recovery = live-oplevet 2026-07-21 i denne chat. Gustav-godkendt at buggene offentliggøres (21/7). Versions-status: opdateret til v1.25.0 (24/7) — BEGGE halvdele af controlled-input-problemet nu fikset og live-verificeret på MUI (3/3 tests). Bonus-fund undervejs: opdigtede CDP key-codes (Key@ / Key.) var formentlig den største årsag, ikke per-tegn-skrivningen i sig selv.

# Browser MCP troubleshooting: the real bugs we found dogfooding it

*Suggested URL: `/docs/troubleshooting` · Suggested title tag: "Browser MCP Troubleshooting: Real Bugs, Real Fixes (2026)" · Suggested meta description: "Extension stuck on 'not connected'? You are probably missing the MCP server half — plus the real bugs we found dogfooding Browser MCP: debugger detach, React forms appending text, stale-server reconnects." · Last verified: July 21, 2026*

---

**Short answer:** the four issues you are most likely to hit, with the fastest fix for each: **(0)** brand-new install that never connects → you are missing the MCP server half; register it with your agent (`claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest` for Claude Code); **(1)** "Chrome extension not connected" on a setup that used to work → kill stale server processes and reload the extension; **(2)** debugger detaches after 2-3 actions on one tab → continue in a fresh tab, or lean on `navigate`/`screenshot` which survive it; **(3)** text *appends* instead of replacing in React/Angular forms on macOS → **fixed in v1.24.0** — upgrade and reload the extension; **(4)** `execute_script` blocked on strict-CSP sites → prefer the dedicated tools (`fill`, `click`, `set_combobox`) over raw scripts. Details, causes and fix status below — we found every one of these using the tool on our own work, and we would rather publish them than have you discover them.

## Brand-new install: the extension says "not connected" and never turns green

**Symptom:** you installed the extension (usually from the Chrome Web Store), clicked the toolbar icon, and it sits on **"Not connected"**. Reconnect does nothing. No tool calls work, and your agent says it has no browser access.

**Cause: nothing is wrong — you have installed half the product.** Browser MCP is a Chrome extension **plus** a local MCP server, and the extension's only job is to connect to that server. The Chrome Web Store cannot ship the server (it is an npm package your agent runs), and npm cannot ship the extension (Chrome forbids self-installing extensions). So each half is installed separately, and installing only the extension leaves it with nothing to connect to.

**Fix — register the missing half with your agent.** Claude Code:

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

Codex:

```bash
codex mcp add browser-mcp -- npx @agent360/browser-mcp@latest
```

Cursor, VS Code, Windsurf or anything else — add this to that client's MCP config:

```json
{"mcpServers": {"browser-mcp": {"command": "npx", "args": ["@agent360/browser-mcp@latest"]}}}
```

Then **restart your agent** so it launches the server, and click the extension icon again. Per-client walkthroughs: [Claude Code](/docs/install-claude-code) · [Cursor](/docs/install-cursor) · [VS Code](/docs/install-vscode) · [Codex](/docs/install-codex).

**Note on `npx @agent360/browser-mcp install`:** that command copies the extension files to `~/.browser-mcp/extension/`, which is useful for an unpacked install — but do not rely on it to register the server with Claude Code. Use `claude mcp add` above.

**How to tell this apart from a real fault:** if you have never run an `npx @agent360/browser-mcp …` command on this machine, this is your problem — not the sections below. A quick check that a server is running at all:

```bash
lsof -iTCP:9876-9885 -sTCP:LISTEN    # macOS/Linux — expect one line per active agent session
```

Nothing listed means no server, which means nothing for the extension to find. (The server is not a daemon: it starts when your agent starts and exits when it disconnects, so an empty list while no agent is running is also normal.)

## "Chrome extension not connected after 5 retries"

**Symptom:** every tool call fails with this error even though Chrome is open and the extension is installed.

**Cause:** a stale MCP server process (or its socket) from a previous session — common after a reboot or when several agent sessions have started servers. The extension keeps trying to reach a bridge that is no longer the live one, and after long outages its reconnect loop can give up entirely.

**Fix:**
1. `pkill -f browser-mcp` (kills stale servers; your MCP client restarts a fresh one on the next call)
2. If calls still fail: open `chrome://extensions` and hit the reload icon on Browser MCP — this restarts the extension's service worker and its reconnect loop
3. Retry the tool call

## The debugger detaches after 2-3 actions on one tab

**Symptom:** a sequence of clicks/fills on the same tab works, then actions silently stop landing; `browser_navigate` and `browser_screenshot` keep working.

**Cause:** a Chrome Debugger API attach/detach lifecycle issue in the extension — the attach state can drop after a few debugger-driven actions on one tab. This is our oldest known quirk and the top item on the reliability roadmap.

**Workarounds today:** batch actions per tab and continue in a new tab when actions stop landing; `navigate`/`screenshot`/`get_page_content` are unaffected. **Fix status:** a reliability batch (self-recovering attach state, ghost-attach retry, several session-stability fixes) **shipped in v1.24.0**. It reduces the failure rate but we are not claiming the underlying attach/detach lifecycle is solved — if you still hit it on v1.24.0, please open an issue with the tab and action sequence.

## React/Angular forms: filled text appends instead of replacing (macOS)

**Symptom:** on framework-controlled inputs, `browser_fill` on a non-empty field produces old-text + new-text.

**Cause (we published the audit internally on 2026-07-08 and the diagnosis is embarrassingly specific):** the field-clear step sent select-all as **Ctrl+A — but on macOS select-all is Cmd+A**, so nothing got selected and the new text landed after the old. A second, related gap: `fill` types per-character instead of using the `Input.insertText` primitive that our own `set_date` and `set_combobox` tools already use, which strict frameworks handle better.

**Fix status: both halves are now fixed** — the Cmd+A clear in **v1.24.0**, the typing itself in **v1.25.0**. (An earlier release note claimed the typing rewrite had already shipped when it had not; we corrected the record rather than let it stand, and then actually shipped it.)

**What v1.25.0 changed, and the part we did not expect.** The plan was simply to send `Input.insertText` instead of typing character by character. While doing it we found a second, unrelated defect that was probably the larger cause: the per-character path built the CDP `code` field as `"Key" + character`, which is only correct for letters. `"1"` became `Key1`, `"@"` became `Key@`, a space became `Key `. Frameworks that branch on `event.code` — masked inputs, shortcut handlers, several React form libraries — see an unknown code and drop the keystroke. Typing `user@example.com` was sending two invalid codes, on precisely the characters that make it an email address.

So v1.25.0 does both: `fill` now sends one `Input.insertText`, verifies the field is non-empty, and only falls back to character-by-character typing if nothing landed — and that fallback now emits real US-layout key codes (`@` reports `Digit2`, the physical key it sits on). Characters with no sensible mapping (accented, CJK, emoji) omit the field rather than invent one. This also closes a silent failure: a swallowed insert used to return success with an empty field.

**Verified on MUI (React-controlled inputs):** an email with `@` and `.` lands exactly and floats the Material label — which only happens when React's own state registers the input, not merely the DOM value; a pre-filled field is replaced cleanly with no leftover text; and a 55-character value now produces **one** `input` event instead of 55.

## `execute_script` fails on strict-CSP sites

**Symptom:** raw script execution returns errors (or nothing) on hardened sites — Google properties, Stripe-class dashboards.

**Cause:** layered content-security-policy restrictions: the isolated-world path is constrained by the extension's own CSP, the main-world path by the site's, and the debugger fallback inherits the detach quirk above.

**Workaround (and honestly, the better pattern):** use the purpose-built tools — `fill`, `click`, `set_date`, `set_combobox`, `get_page_content` run through the debugger/trusted-event layer and work on CSP-strict and React/Angular sites. Reach for `execute_script` last, not first. A hardened fallback chain shipped in the staged reliability batch.

## Why publish our own bug list?

Because we use Browser MCP all day on real work, the failure modes above are facts of the product today, and a docs page that pretends otherwise costs more trust than it buys. This page changes when the fixes ship — every claim on it is dated.

## FAQ

**I installed it from the Chrome Web Store. Why do I still have to run a terminal command?**
Because the store can only give you the extension, and the extension is a bridge — it needs the local MCP server on the other end. That server is the npm package your agent runs, and Google has no way to register it for you. One command, once: `claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest` (or the equivalent for your client).

**Does the debugger banner ("Browser MCP started debugging this browser") mean something is wrong?**
No — that is Chrome's standard notice whenever the Debugger API is attached. It disappears when the session ends.

**Do these bugs affect what data leaves my machine?**
No. Everything runs locally over stdio and the extension bridge; none of the issues above involve any network egress.

**Where do I report something not listed here?**
[Open a bug report](https://github.com/Agent360dk/browser-mcp/issues/new?template=bug.yml) — the template takes two minutes, and dogfooding plus user reports is exactly how the list above got built.
