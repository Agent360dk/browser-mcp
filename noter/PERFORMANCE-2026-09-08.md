# Where the time goes in Browser MCP

Measured 2026-09-08 on the machine that ships it - macOS 25.4, Node v25.9.0, Chrome, server
v1.29.0, extension v1.29.0. Every number below came out of a harness that spawns a real MCP server
process, speaks JSON-RPC to it over stdio and times the round trip, against real pages. Nothing
here is estimated.

Method: `maaling/latens.mjs` (5 rounds per tool, medians), `maaling/cdp-test.mjs` (isolates
the debugger path), `maaling/scroll-hypotese.mjs` (short page vs long page). Pages:
`example.com` and `en.wikipedia.org/wiki/Model_Context_Protocol`.

## The measurements

| Tool | min | median | max | What it exercises |
|---|---:|---:|---:|---|
| `browser_get_page_content` | 1 | **1** | 2 | server → WS → extension → page text |
| `browser_list_tabs` | 1 | **2** | 3 | transport only, touches no page |
| `browser_console_logs` | 5 | **7** | 18 | transport + stored buffer |
| `browser_wait` | 7 | **8** | 74 | element poll, element already present |
| `browser_get_cookies` | 47 | **56** | 111 | Chrome cookie store |
| `browser_screenshot` | 46 | **91** | 96 | tab capture + base64 |
| `browser_navigate` | 56 | **93** | 104 | full page load, cached |
| `browser_press_key` | - | **128** | - | through the debugger |
| `browser_reattach_debugger` | - | **161** | - | clean debugger attach |
| `browser_click` | - | **6 056** | - | through the debugger, `landed:false` |
| **`browser_scroll` (pixels)** | 30 002 | **30 007** | 30 105 | **times out, every call, every page** |
| `browser_scroll` (selector) | - | **7** | - | returns before touching the debugger |
| cold start, first call ever | - | **1 511** | - | port acquisition + extension wake |

## Finding 1 - the transport is not the problem, so stop optimising it

A round trip that touches the page and comes back with its text costs **1 ms**. Listing tabs costs
2 ms. Whatever is slow about this product, it is not the MCP layer, not the WebSocket, and not JSON
serialisation. An optimisation aimed there would be aimed at roughly 0.02 % of a slow call.

This is worth stating plainly because it is where performance work instinctively goes first.

## Finding 2 - `browser_scroll` burns 30 seconds and then fails. Every time.

Six calls out of six, on both a page with nothing to scroll and a page with plenty. It is not the
page, and it is not the two-extension conflict that was also live on this machine: `press_key` and
`reattach_debugger` went through the *same* debugger on the *same* tab in 128 ms and 161 ms.

The mechanism, from `extension/background.js`:

```js
// cdpSend, line 531
await debuggerAttach(tabId);
…
return await chrome.debugger.sendCommand({ tabId }, method, params);   // no timeout
```

```js
// case 'scroll', line 3050
await cdpSend(tab.id, 'Input.dispatchMouseEvent', { type: 'mouseWheel', … });
…
} catch (e) {
  await debuggerEval(tab.id, `window.scrollBy(${dx}, ${dy})`);   // the fallback
}
```

`Input.dispatchMouseEvent` with `type: 'mouseWheel'` never resolves its promise. `cdpSend` awaits it
with no timeout, so the call hangs until the MCP server's own 30-second ceiling fires. The
`window.scrollBy` fallback that was written for exactly this case **cannot run**, because it lives in
a `catch` - and a hang is not an exception.

Two costs, and the second is the larger one. Thirty seconds of wall clock, and then an agent that
has been told scrolling is impossible on this page and goes looking for another way.

**Fix:** race the CDP call against a short timer inside `cdpSend`, and let a lost race throw. That
one change converts a 30-second failure into a sub-second success down the path that already exists:

```js
const svar = await Promise.race([
  chrome.debugger.sendCommand({ tabId }, method, params),
  new Promise((_, afvis) => setTimeout(() => afvis(new Error('CDP svarede ikke: ' + method)), 1500)),
]);
```

Anything with a fallback should be reached by timeout, not only by exception. This is the single
largest latency win available in the product, and it is a handful of lines.

## Finding 3 - `browser_click` takes six seconds and says it did not land

`{"ok": true, "method": "debugger", "tag": "A", "fallbackFired": true, "landed": false}` - six
seconds, on an `<a>` on example.com. `fallbackFired: true` says the debugger path did not do the
job and the synthetic path took over; `landed: false` says the click was not observed to have any
effect. The tool is at least honest about it, which is how this was visible at all.

Six seconds is roughly sixty times the cost of `press_key` through the same debugger, so the time is
being spent in retries and settle-waits, not in CDP itself. This one needs its own measurement pass
before anybody changes it - the honest statement today is that click is slow and knows it is
unreliable, not that the cause is understood.

## Finding 4 - the fixed sleeps are real but smaller than they look

There are **25 unconditional sleeps in `extension/background.js` totalling 6 620 ms**, and a first
count of 27/15 820 ms was wrong: four of the longest are ceilings inside a `Promise.race`, which are
only paid when something has already gone wrong. Counting a ceiling as a cost inflates the number
by more than half.

They do not all run in one call. The `click` path carries about 650 ms of them and `fill` about
720 ms, spread across retry branches. Each was written for a real reason - a wheel event that
lazy-loading needs time to notice, a React input that needs a tick before its value sticks - and
the honest fix is not to delete them but to replace the ones that guard an *observable* condition
with a wait on that condition:

- after a wheel event, wait for `scrollY` to change (or 600 ms, whichever comes first)
- after a fill, wait for the field to read back the value (or 250 ms)
- after a navigation, wait for the load event rather than a fixed pause

Every one of those turns a fixed cost into a typical cost, and the typical case is far below the
constant. This is worth maybe a few hundred milliseconds per interactive call - real, but an order
of magnitude below Finding 2, and it should be done second.

## Finding 5 - cold start is 1.5 s and is mostly a one-off worth keeping

The first browser call in a chat costs 1 511 ms: acquiring a port, waking the extension's service
worker, establishing the socket. Every call after it is in the single- to double-digit millisecond
range.

That cost is the price of v1.29.0's port-on-use design, and it bought something bigger than it
costs - before it, every chat took a port at startup and twenty ports were exhausted by chats that
never touched the browser. It could be shaved (speculative connect on the first `tools/list`), but
that reintroduces the thing that was just fixed. Leave it.

## What to do, in order

1. **Timeout inside `cdpSend`.** Turns `browser_scroll` from a 30-second failure into a sub-second
   success, and protects every other CDP call from the same class of hang. Small, testable, with a
   regression test that asserts a hung command falls back rather than waits.
2. **Measure `browser_click` properly** before touching it. Six seconds and `landed: false` is two
   problems, and it is not yet known whether they are the same one.
3. **Convert the sleeps that guard an observable condition into waits on that condition.** Start
   with `fill` and `scroll`, which are the ones agents call in loops.
4. **Leave the transport and the cold start alone.** Both are already cheap, and the second one is
   load-bearing.

## Caveat on the environment

Two Browser MCP extensions were loaded in Chrome while these numbers were taken (`browser_provide_
feedback` reported `verdict: "conflict"`). That affects which extension owns which tab group; it
was ruled out as the cause of Findings 2 and 3 by showing that other debugger calls on the same tab
succeeded in the same session. It could still add noise to the wall-clock figures, so treat the
medians as good to roughly ±20 %, and the 30-second timeout as exact - it is a ceiling being hit,
not a measurement.
