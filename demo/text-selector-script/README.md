# `text=` and the page's own source

`textContent` includes the source of `<script>`, `<style>`, `<noscript>` (when JavaScript is on) and `<template>`
elements. On `main`, `text=` searches it: a label that is **not on the page** but appears in an inline script is
"found" - as the `<script>` - and the answer is

```
{ "ok": false, "error": "Element found but not visible (0x0) - a click would hit the page corner: text=…",
  "hidden": true, "tag": "SCRIPT" }
```

That sends the agent after a hidden element (scroll, wait, open a menu) that does not exist. The honest answer is
`Element not found`.

Any page that ships text in inline scripts can hit this. Measured: Next.js's RSC payload (`self.__next_f.push(...)`)
on nextjs.org. Other places such text lives, not measured here: `__NEXT_DATA__`, inline i18n bundles, analytics
calls that name a button.

| Selector on this page | The text is only in | `main` | fixed |
|---|---|---|---|
| `text=Delete account` | an inline `<script>` (i18n strings) | found but not visible, tag SCRIPT | Element not found |
| `text=Export data` | a `<style>` comment | found but not visible, tag STYLE | Element not found |
| `text=Continue` | a `<noscript>` | found but not visible, tag NOSCRIPT | Element not found |
| `text=Change password` | the page **and** the script (control) | clicks the button | clicks the button |

## Start it

```bash
node demo/text-selector-script/serve.mjs     # http://127.0.0.1:8771/
```

Open the page and have an agent call `browser_click` with a selector from the table, or run the check:

```bash
node demo/text-selector-script/check.mjs     # needs: npm --prefix mcp-server install
```

`check.mjs` starts its own `mcp-server/index.js` (a separate session in Chrome), clicks each selector and checks the
answer. For the control, it checks the page's own click log.

## See the bug, then the fix

This folder is only on this branch, so keep the branch checked out and load the extension you want to test:

1. **Bug:** load the extension from `main` (`git worktree add ../browser-mcp-main main`, then
   `chrome://extensions` → Load unpacked → `../browser-mcp-main/extension`, store copy disabled).
   `check.mjs` prints 3 FAIL lines (SCRIPT, STYLE, NOSCRIPT) and exits 1.
2. **Fix:** load this branch's `extension/` instead (↻ after switching). 4 OK, exit 0.

On a real site: open https://nextjs.org/ and call `browser_click("text=This page could not be found.")` or
`browser_click("text=GitHub repository")`. Both strings are in the page's RSC payload, not on screen. `main`
answers "found but not visible", tag SCRIPT; fixed, it answers "Element not found".
