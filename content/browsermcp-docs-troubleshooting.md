// KILDE: egne dogfooding-fund — reliability-audit 2026-07-02 (FIX-1/2/4/5/13/17, staged til næste release), controlled-form-audit 2026-07-08 (R1-R4, rapport-fase), debugger-detach-quirk (kendt siden maj, memory + NOTES 2026-06-29), "extension not connected"-recovery = live-oplevet 2026-07-21 i denne chat. Gustav-godkendt at buggene offentliggøres (21/7). Versions-status: alt beskrevet gælder v1.23.0.

# Browser MCP troubleshooting: the real bugs we found dogfooding it

*Suggested URL: `/docs/troubleshooting` · Suggested title tag: "Browser MCP Troubleshooting: Real Bugs, Real Fixes (2026)" · Suggested meta description: "We drive Browser MCP daily and publish what actually breaks: debugger detach after 2-3 actions, React forms appending text, stale-server reconnects — symptoms, workarounds, fix status." · Last verified: July 21, 2026*

---

**Short answer:** the four issues you are most likely to hit in v1.23.0, with the fastest fix for each: **(1)** "Chrome extension not connected" → kill stale server processes and reload the extension; **(2)** debugger detaches after 2-3 actions on one tab → continue in a fresh tab, or lean on `navigate`/`screenshot` which survive it; **(3)** text *appends* instead of replacing in React/Angular forms on macOS → clear the field first (known select-all bug); **(4)** `execute_script` blocked on strict-CSP sites → prefer the dedicated tools (`fill`, `click`, `set_combobox`) over raw scripts. Details, causes and fix status below — we found every one of these using the tool on our own work, and we would rather publish them than have you discover them.

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

**Workarounds today:** batch actions per tab and continue in a new tab when actions stop landing; `navigate`/`screenshot`/`get_page_content` are unaffected. **Fix status:** a reliability batch (self-recovering attach state, ghost-attach retry, several session-stability fixes) passed review on 2026-07-02 and is staged for the next release after v1.23.0.

## React/Angular forms: filled text appends instead of replacing (macOS)

**Symptom:** on framework-controlled inputs, `browser_fill` on a non-empty field produces old-text + new-text.

**Cause (we published the audit internally on 2026-07-08 and the diagnosis is embarrassingly specific):** the field-clear step sends select-all as **Ctrl+A — but on macOS select-all is Cmd+A**, so nothing gets selected and the new text lands after the old. A second, related gap: `fill` types per-character instead of using the `Input.insertText` primitive that our own `set_date` and `set_combobox` tools already use, which strict frameworks handle better.

**Workarounds today:** for comboboxes/autocompletes use `browser_set_combobox` (unaffected); otherwise clear the field explicitly before filling. **Fix status:** root-caused with file-and-line precision; the fill-rewrite ("make `fill` do what `set_combobox` already does") is queued behind the reliability batch above.

## `execute_script` fails on strict-CSP sites

**Symptom:** raw script execution returns errors (or nothing) on hardened sites — Google properties, Stripe-class dashboards.

**Cause:** layered content-security-policy restrictions: the isolated-world path is constrained by the extension's own CSP, the main-world path by the site's, and the debugger fallback inherits the detach quirk above.

**Workaround (and honestly, the better pattern):** use the purpose-built tools — `fill`, `click`, `set_date`, `set_combobox`, `get_page_content` run through the debugger/trusted-event layer and work on CSP-strict and React/Angular sites. Reach for `execute_script` last, not first. A hardened fallback chain shipped in the staged reliability batch.

## Why publish our own bug list?

Because we use Browser MCP all day on real work, the failure modes above are facts of the product today, and a docs page that pretends otherwise costs more trust than it buys. This page changes when the fixes ship — every claim on it is dated.

## FAQ

**Does the debugger banner ("Browser MCP started debugging this browser") mean something is wrong?**
No — that is Chrome's standard notice whenever the Debugger API is attached. It disappears when the session ends.

**Do these bugs affect what data leaves my machine?**
No. Everything runs locally over stdio and the extension bridge; none of the issues above involve any network egress.

**Where do I report something not listed here?**
[Open a bug report](https://github.com/Agent360dk/browser-mcp/issues/new?template=bug.yml) — the template takes two minutes, and dogfooding plus user reports is exactly how the list above got built.
