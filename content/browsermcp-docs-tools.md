# Tools

Browser MCP exposes **40 tools** to the connected agent. Page and tab tools act on the session's own tabs, inside its own tab group: the tab it last used, or a tab or frame it targets explicitly. `browser_fetch` sends its request from the extension in the background, without a tab, and `browser_about` and `browser_provide_feedback` are answered by the local server. The browser work runs in your Chrome through the Browser MCP extension - no headless browser, no Playwright binary.

---

You never call these by name. You describe what you want, and the client picks:

```
You:     Fill in the address form with my work address and submit it.

Claude:  [browser_fill, browser_fill, browser_fill, browser_click]
         Submitted. The page now shows "Address saved".
```

The list below is what the client has to choose from.

## Navigation & Content - 5 tools

| Tool | Description |
|---|---|
| `browser_navigate` | Navigate the active tab to a URL; reuses the current tab unless `new_tab=true`. |
| `browser_get_page_content` | Return the current page's content as `text` or `html`. |
| `browser_screenshot` | Screenshot the visible viewport; returns base64 PNG or saves to a given path. |
| `browser_execute_script` | Run arbitrary JavaScript in the page context and return the result. |
| `browser_extract_list` | Read every row of a long or virtualised list by scrolling its container until nothing new appears - mail lists, invoice tables, transaction histories. Those UIs keep only a handful of rows in the DOM, so a single page read returns a sliver and looks complete. In the active tab it scrolls with real wheel events, also at the bottom, so feeds that load on wheel (Threads, X) load; in a background tab it scrolls with a script and says so. `reached_end` is true only when the list stood at its bottom with nothing new for several rounds. |

## Interaction - 14 tools

| Tool | Description |
|---|---|
| `browser_click` | Click an element via CSS or text selector (`text=Submit`, `button:text(Next)`); auto-scrolls into view, uses real mouse events. A text selector looks inside an open modal dialog first. If something lies over the target (an overlay, a dialog's backdrop), nothing is clicked and the answer is `covered`. |
| `browser_double_click` | Double-click an element - for editors and grids that open on double-click rather than single. Nothing is done (`covered`) when something lies over the target. |
| `browser_right_click` | Right-click an element to open its context menu. Nothing is done (`covered`) when something lies over the target. |
| `browser_click_xy` | Click at absolute viewport coordinates. Last resort for canvas, maps, and custom-rendered UI where no element can be selected. |
| `browser_fill` | Fill a form input via CSS or text selector; works on CSP-strict sites via the Chrome Debugger API. |
| `browser_press_key` | Send a keyboard key press (Enter, Tab, Escape, arrows, letters...) with optional ctrl/alt/shift/meta modifiers. |
| `browser_scroll` | Scroll to a matched element, or by a pixel offset. |
| `browser_wait` | Wait for an element matching a CSS or text selector to appear. |
| `browser_hover` | Hover an element to trigger tooltips, dropdowns, or hover states. Nothing is done (`covered`) when something lies over the target. |
| `browser_select_option` | Select an option from a native `<select>` or a custom dropdown (Angular Material, React Select, etc.). |
| `browser_set_combobox` | Drive an autocomplete/combobox: click, type filter query, wait for the listbox, click the option(s); supports multi-select chips. |
| `browser_set_date` | Set a date input robustly - native value-set, masked-text typing, or calendar-picker navigation (MUI/AntD/react-datepicker/Lexical), with read-back verification. |
| `browser_dismiss_overlays` | Bulk-dismiss popups, modals, tooltips, and banners via heuristics on close affordances (aria-label, "Skip"/"Ikke nu"/"Got it", × button). |
| `browser_handle_dialog` | Accept or dismiss a native `alert()`/`confirm()`/`prompt()` dialog; call before the action that triggers it. |

## Tabs & Frames - 6 tools

| Tool | Description |
|---|---|
| `browser_list_tabs` | List the current session's own open tabs (URL + title) - each concurrent session has its own tab group and can't see another session's tabs. |
| `browser_switch_tab` | Activate a specific tab by ID. |
| `browser_close_tab` | Close a tab by ID (session-owned tabs only). |
| `browser_get_new_tab` | Return the most recently opened tab - useful after a link opens a new tab or an OAuth popup. |
| `browser_list_frames` | List all iframes on the current page with URL and index. |
| `browser_select_frame` | Execute JavaScript inside a specific iframe, targeted by index. |

## Data & Storage - 5 tools

| Tool | Description |
|---|---|
| `browser_get_cookies` | Get cookies for a site this session has open. |
| `browser_set_cookies` | Set one or more cookies for a domain (single cookie or a `cookies[]` batch). |
| `browser_get_local_storage` | Read `localStorage` from the current page - a single key or all of it. |
| `browser_set_local_storage` | Write a `localStorage` key/value pair on the current page. |
| `browser_console_logs` | Return recent `console.log`/`warn`/`error` messages captured from the page. |

## Files - 2 tools

| Tool | Description |
|---|---|
| `browser_upload_file` | Upload file(s) to an `<input type="file">` via the Chrome Debugger API - no OS file dialog needed. Files must be regular files inside the folder your agent's server runs in; anything else is refused. Chrome only hands a file to the page when "Allow access to file URLs" is on for the Agent360 Browser MCP extension (off by default for Chrome Web Store installs); the switch also lets the extension open any local file as a page, so turning it on is your call. A "Not allowed" error from the handoff is reported as `file-access-off` unless Chrome confirms that file access is on. |
| `browser_drop_file` | Upload into a drag-drop zone by locating a hidden file input in its subtree, then up to 2 parent levels, and as a last resort the first file input on the page (which can belong to a different upload field); with no input at all it intercepts the native file chooser. Use when `browser_upload_file` finds no input. Needs the same switch as `browser_upload_file`. Files must be regular files inside the folder your agent's server runs in; anything else is refused. |

## Network - 3 tools

| Tool | Description |
|---|---|
| `browser_fetch` | Make an HTTPS request from the extension background - not subject to the page's CORS or CSP. Your browser cookies are not sent and the answer's cookies are not stored, so pass a token in headers. Plain http works only to 127.0.0.1. |
| `browser_wait_for_network` | Wait for a network request matching a URL substring to complete, via Chrome DevTools Protocol. |
| `browser_extract_token` | Opens a known provider's API page and returns instructions for finding or creating the credentials there, for 9 providers (Stripe, HubSpot, Slack, Shopify, Mailchimp, Pipedrive, Calendly, Google, LinkedIn). It reads nothing itself; the agent then reads the page with `browser_get_page_content`. For HubSpot, Slack, Shopify and LinkedIn the page is a settings or app list on the way to the token, not the token page itself. Any other provider answers `Unknown provider`; the agent can still navigate and read the page itself. |

## CAPTCHA - 1 tool

| Tool | Description |
|---|---|
| `browser_solve_captcha` | Detect reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile or FunCaptcha and work through it one step per call: try the reCAPTCHA checkbox, click the reCAPTCHA image-challenge cells the agent picks from a screenshot it takes first, or hand it to you through `browser_ask_user`. |

## Human-in-the-Loop - 1 tool

| Tool | Description |
|---|---|
| `browser_ask_user` | Ask the user to act or answer: without fields, a small card they can drag aside while they act on the page (log in, solve a CAPTCHA); with fields, a dialog over the page. It is drawn again after a navigation in the tab, but a prompt with fields ends if the tab moves to another origin (another domain, subdomain or port) or, on a local file, to another file. The page can see the keystrokes, so ask only for secrets that belong to that page. It needs a page that loaded: on Chrome's error page or about:blank it fails at once and shows nothing. It makes the tab active and restores a minimized window, but does not bring Chrome in front of other apps. |

## Frequently asked questions

**How many tools are there?**
40. A check on every release counts the tool definitions in the server and compares them with every "N tools" claim on the site and in the README.

**What does it mean when a tool answers "unverified"?**
That the action was sent and the effect could not be read back. It is not a failure and not a success. Repeating the action blindly is the one thing you should not do - read the page instead. Nine tools were changed in 1.29.2 to be able to give this answer rather than a false yes.

**Why do some tools need the tab in front?**
Chrome accepts mouse and keyboard commands for a background tab and silently drops them. Since 1.29.2 the tools measure whether the page actually received the event, so you get an honest failure with the remedy - call `browser_switch_tab` - instead of a silent one.

**Can a tool ask me something in the middle of a run?**
Yes. `browser_ask_user` pauses, asks you on your own screen - a 2FA code, a CAPTCHA, a choice only you can make - and carries on in the same tab.

## Meta & Recovery - 3 tools

| Tool | Description |
|---|---|
| `browser_provide_feedback` | Self-check plus report in one call. Compares the connected extension against this server and detects more than one Browser MCP extension connected at once; with `BROWSER_MCP_CHECK_NPM=1` it also compares this server against the latest on npm - the three things that explain most "it just stopped working" moments. Returns a verdict, concrete fix steps, and a pre-filled issue link for whatever is genuinely missing. The agent calls it on its own whenever a tool blocks it. |
| `browser_about` | Return Browser MCP info plus pre-filled links for the user to submit a feature wish, share a use-case, or report a bug. |
| `browser_reattach_debugger` | Force-detach and re-attach the Chrome debugger on the current tab. Use when click/fill/press_key start timing out or report a ghost attach while `browser_list_tabs` still works - faster than reloading the extension. |

---

**Total: 40 tools** (5 + 14 + 6 + 5 + 2 + 3 + 1 + 1 + 3), verified against `mcp-server/tools.js` line-by-line - no invented tools.