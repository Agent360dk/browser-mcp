# A background-tab click that worked, answered as a failure

When the tab is in the background, Chrome does not deliver CDP mouse events to it, so `browser_click` falls back to a
script click (`el.click()`). It then decides whether the click worked by comparing a fingerprint of the page taken
**in the same instant** as the click. A page that reacts a moment later looks unchanged at that instant. Examples: a
form that starts a request and shows a spinner, or a framework that renders after the event.

On `main` that answer is

```json
{ "ok": false, "method": "scripting-fallback", "landed": false, "maybe_landed": true,
  "error": "CDP did not respond within 1500 ms: Input.dispatchMouseEvent (... call browser_switch_tab and try again ...)" }
```

An agent reads `ok: false` and "try again", and clicks again. On a form without double-submit protection, that
sends it twice.

This page is such a form: Send starts a "request" and shows a spinner `?show=` later. The button stays enabled, and
"Requests sent" counts what a server would receive.

| `?show=` | Spinner appears | `main` | fixed |
|---|---|---|---|
| `sync` | inside the click (control) | `ok: true, landed: true` | same |
| `microtask` | right after the click handler | `ok: false` | `ok: true, landed: null, maybe_landed: true` |
| `50` | 50 ms later (like Apple's form) | `ok: false` -> clicked again -> **2 requests** | `ok: true, landed: null, maybe_landed: true` -> 1 request |

## Start it

```bash
node demo/click-background-submit/serve.mjs     # http://127.0.0.1:8772/?show=50
```

The bug needs the tab in the **background**: keep Chrome behind another window (your terminal, say), or have another
tab active in its window. With the tab in front, the CDP click proves itself and the answer is `ok: true`.

By hand: open `?show=50` in a tab that is not in front, have an agent call `browser_click("#contactForm_saveButton")`,
and read the answer. Then look at "Requests sent". Or run the check:

```bash
node demo/click-background-submit/check.mjs     # needs: npm --prefix mcp-server install; Chrome behind another window
```

`check.mjs` starts its own `mcp-server/index.js` (a separate session in Chrome). It clicks Send the way an agent does
(**clicking once more when the answer is `ok: false`**) and then reads "Requests sent". A case where the click went
through CDP, because the tab was in front, is reported as SKIP.

## See the bug, then the fix

This folder is only on this branch, so keep the branch checked out and load the extension you want to test:

1. **Bug:** load the extension from `main` (`git worktree add ../browser-mcp-main main`, then
   `chrome://extensions` → Load unpacked → `../browser-mcp-main/extension`, store copy disabled).
   `check.mjs` prints FAIL for `microtask` and `50` (`ok:false`, clicked again; `50` ends with 2 requests) and exits 1.
2. **Fix:** load this branch's `extension/` instead (↻ after switching). 3 OK, each with 1 request, exit 0.
