# A selector that is not valid CSS

`text=` (and `tag:text(...)`) is Browser MCP's own syntax, and it is a text selector only when it is the **whole**
selector. An agent on login.yahoo.com wrote three alternatives in one comma-separated list:

```
input[name="appName"], input[placeholder="App name"], text=App name
```

That string goes to `querySelector`, which throws on it. On `main` no tool says so:

| Tool | `main` answers | fixed |
|---|---|---|
| `fill` | `null` | `invalid-selector` |
| `click`, `hover`, `double_click`, `right_click`, `scroll` | `Element not found: …` | `invalid-selector` |
| `set_date` | `Error: Uncaught` | `invalid-selector` |
| `wait` | `{ found: false }` after the whole timeout | `invalid-selector` at once |

The new answer is `{ ok: false, error: 'invalid-selector', selector, detail, note }`, where `detail` is the browser's
own message and `note` says that `text=` cannot be one entry of a list.

The page is the dialog Yahoo opens on its app-password page: a name field with no `name`, no placeholder and no
`<label for>` (which is why the agent tried several ways at once), a date field and a button.

## Start it

```bash
node demo/invalid-selector/serve.mjs     # http://127.0.0.1:8769/
```

Open the page and have an agent call, for example, `browser_fill` with the selector above. Or run the check:

```bash
node demo/invalid-selector/check.mjs     # needs: npm --prefix mcp-server install
```

`check.mjs` starts its own `mcp-server/index.js` (a separate session in Chrome) and calls every tool in the table
with an invalid list, plus three controls that must not change: a valid selector that matches nothing is still
`Element not found`, a valid CSS list still fills, and `text=App name` on its own is still found.

## See the bug, then the fix

This folder is only on this branch, so keep the branch checked out and load the extension you want to test:

1. **Bug:** load the extension from `main` (`git worktree add ../browser-mcp-main main`, then
   `chrome://extensions` → Load unpacked → `../browser-mcp-main/extension`, store copy disabled).
   `check.mjs` prints 8 FAIL lines (the answers in the `main` column) and exits 1.
2. **Fix:** load this branch's `extension/` instead (↻ after switching). Every line is OK, exit 0.
