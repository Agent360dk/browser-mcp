# `text=` and labels whose spaces are not plain spaces

A page with five buttons. Each label looks like words separated by single spaces, but only the
first one is: the others are written the way real sites write them.

| Button | What is between the words | Selector to try | `main` | fixed |
|---|---|---|---|---|
| Change password | plain spaces (control) | `text=Change password` | found | found |
| Create app password | no-break space before the last word, as on login.yahoo.com | `text=Create app password` | **Element not found** | found |
| Generate password | no-break space, as in Yahoo's app-password dialog | `button:text(Generate password)` | **Element not found** | found |
| Save changes | a line break and indentation in the HTML source | `text=Save changes` | **Element not found** | found |
| Open file | a tab | `text=Open file` | **Element not found** | found |

Every click is written to the black log box, so you can see whether it reached the button.

## Start it

```bash
node demo/text-selector-whitespace/serve.mjs     # http://127.0.0.1:8768/
```

Open the page, then have an agent call `browser_click` with a selector from the table, or run the check:

```bash
node demo/text-selector-whitespace/check.mjs     # needs: npm --prefix mcp-server install
```

`check.mjs` starts its own `mcp-server/index.js` (a separate session in Chrome), clicks each button by its text and
reads the log. It prints OK/FAIL per button and exits 1 when any button was not reached.

## See the bug, then the fix

This folder is only on this branch, so keep the branch checked out and load the extension you want to test:

1. **Bug:** load the extension from `main` (`git worktree add ../browser-mcp-main main`, then
   `chrome://extensions` → Load unpacked → `../browser-mcp-main/extension`, store copy disabled).
   `check.mjs` prints 4 FAIL lines, each `Element not found`, and exits 1.
2. **Fix:** load this branch's `extension/` instead (↻ after switching). `check.mjs` prints 5 OK lines and exits 0.

Keep the labels out of everything else on the page (the hints, the `<script>`): a `text=` search that misses the
button would otherwise find that text instead. On `main` it clicked a hint that quoted the selector.
