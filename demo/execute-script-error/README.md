# `execute_script`: the error of code that ran through the debugger

On a page whose Content-Security-Policy has no `'unsafe-eval'` (login.yahoo.com, Google, Stripe, ...), neither
scripting world can compile the agent's code, so `browser_execute_script` runs it through the debugger. When that code
throws, `main` throws its error **plus** `| scripting-diag: {...}`: two long CSP `'unsafe-eval'` messages from the
two paths that never ran the code. They read as the cause.

```
Error: TypeError: Cannot read properties of undefined (reading 'click')
    at <anonymous>:1:119 ... | scripting-diag: {"tried":[...],"isolated_error":"Evaluating a string as JavaScript
    violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source ...",
    "main_error":"Evaluating a string as JavaScript violates ... 'unsafe-eval' ..."}
```

Fixed, it answers like the scripting worlds already do for code that ran and threw:

```json
{ "ok": false, "error": "TypeError: Cannot read properties of undefined (reading 'click')\n    at <anonymous>:1:119 ...",
  "name": "TypeError", "method": "debugger", "note": "The code RAN and threw this error. It is not run again." }
```

The page is Yahoo's app-password dialog. Its button label has a no-break space, so the code an agent wrote there,
`find(x => x.innerText.trim() === 'Generate password')`, finds nothing and throws. That TypeError is the agent's own.
The demo is about how the tool reports it.

## Start it

```bash
node demo/execute-script-error/serve.mjs     # http://127.0.0.1:8770/  (CSP)   and  /no-csp  (no CSP, control)
```

Open the page and have an agent run the code above with `browser_execute_script`. Or run the check:

```bash
node demo/execute-script-error/check.mjs     # needs: npm --prefix mcp-server install
```

`check.mjs` starts its own `mcp-server/index.js` (a separate session in Chrome). It checks the answer on the CSP page.
It also runs two controls that must not change: code that returns a value still returns it, and on `/no-csp` the
same throwing code is answered by a scripting world as `{ ok: false, error, name, method }`.

## See the bug, then the fix

This folder is only on this branch, so keep the branch checked out and load the extension you want to test:

1. **Bug:** load the extension from `main` (`git worktree add ../browser-mcp-main main`, then
   `chrome://extensions` → Load unpacked → `../browser-mcp-main/extension`, store copy disabled).
   `check.mjs` prints 2 FAIL lines (the CSP noise, and the thrown error instead of an answer) and exits 1.
2. **Fix:** load this branch's `extension/` instead (↻ after switching). Every line is OK, exit 0.
