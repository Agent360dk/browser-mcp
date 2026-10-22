# ask_user repro page

A page that does to the `browser_ask_user` card what real sites do: steal focus, swallow events,
open a modal, cover the card with the top layer. Each scenario is one `?s=` value.

| `?s=` | What the page does | Before the fix | After |
|---|---|---|---|
| `none` | nothing (baseline) | done | done |
| `refocus` | the input takes focus back on blur and every 50 ms | done | done |
| `focustrap` | a `focusin` capture listener pulls focus back to the input | done | done |
| `capture-pd` | `pointerdown`/`mousedown` capture listeners on window call `preventDefault` | done | done |
| `capture-click` | a `click` capture listener on window calls `stopImmediatePropagation` | timeout | timeout (known limit) |
| `dialog` | the form is in a native `<dialog>` opened with `showModal()` | **timeout** | done |
| `popover` | the form is in a page popover (top layer) lying over the card | **timeout** | done |
| `all` | refocus + focustrap + capture-pd + capture-click + dialog | timeout | timeout (capture-click) |
| `ariakit` | 1.5 s after the card appears, a modal sets `inert` on every `<body>` child (what login.yahoo.com's Ariakit dialog does) | **timeout** | done |
| `backdrop-css` | the page styles every `::backdrop` red | done | done, and the page is not tinted |

The black log box shows what the page can see of the events aimed at the card.

## Run it

Needs the extension from this repo loaded unpacked (`chrome://extensions` → Load unpacked →
`extension/`, the store copy disabled, ↻ after every change) and `npm install` in `mcp-server/`.

```bash
node temp/ask-user-repro/serve.mjs     # http://127.0.0.1:8765/
node temp/ask-user-repro/drive.mjs     # every scenario; or: drive.mjs dialog,ariakit
```

`drive.mjs` starts its own `mcp-server/index.js` (a separate session in Chrome), calls
`browser_ask_user`, and while the card is up clicks its Done button with `browser_click_xy` - CDP
mouse input, trusted and hit-tested like a real click. It prints OK/FAIL per scenario against the
expected column above and exits non-zero on a FAIL. `VERBOSE=1` prints each page log.
Do not click the card yourself while it runs.

By hand: open a scenario, have an agent call `browser_ask_user` on that tab, and try Done.
