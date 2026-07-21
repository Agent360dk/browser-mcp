# Tools

Browser MCP exposes **34 tools** to the connected agent. Every tool acts on the active Chrome tab (or a tab/frame you target explicitly) via the Browser MCP extension — no headless browser, no Playwright binary.

Source of truth: `mcp-server/tools.js` (`TOOLS` array). Regenerate this page from that file if tool names, params, or descriptions change.

---

## Navigation & Content — 4 tools

| Tool | Description |
|---|---|
| `browser_navigate` | Navigate the active tab to a URL; reuses the current tab unless `new_tab=true`. |
| `browser_get_page_content` | Return the current page's content as `text` or `html`. |
| `browser_screenshot` | Screenshot the visible viewport; returns base64 PNG or saves to a given path. |
| `browser_execute_script` | Run arbitrary JavaScript in the page context and return the result. |

## Interaction — 11 tools

| Tool | Description |
|---|---|
| `browser_click` | Click an element via CSS or text selector (`text=Submit`, `button:text(Next)`); auto-scrolls into view, uses real mouse events. |
| `browser_fill` | Fill a form input via CSS or text selector; works on CSP-strict sites via the Chrome Debugger API. |
| `browser_press_key` | Send a keyboard key press (Enter, Tab, Escape, arrows, letters...) with optional ctrl/alt/shift/meta modifiers. |
| `browser_scroll` | Scroll to a matched element, or by a pixel offset. |
| `browser_wait` | Wait for an element matching a CSS or text selector to appear. |
| `browser_hover` | Hover an element to trigger tooltips, dropdowns, or hover states. |
| `browser_select_option` | Select an option from a native `<select>` or a custom dropdown (Angular Material, React Select, etc.). |
| `browser_set_combobox` | Drive an autocomplete/combobox: click, type filter query, wait for the listbox, click the option(s); supports multi-select chips. |
| `browser_set_date` | Set a date input robustly — native value-set, masked-text typing, or calendar-picker navigation (MUI/AntD/react-datepicker/Lexical), with read-back verification. |
| `browser_dismiss_overlays` | Bulk-dismiss popups, modals, tooltips, and banners via heuristics on close affordances (aria-label, "Skip"/"Ikke nu"/"Got it", × button). |
| `browser_handle_dialog` | Accept or dismiss a native `alert()`/`confirm()`/`prompt()` dialog; call before the action that triggers it. |

## Tabs & Frames — 6 tools

| Tool | Description |
|---|---|
| `browser_list_tabs` | List the current session's own open tabs (URL + title) — each concurrent session has its own tab group and can't see another session's tabs. |
| `browser_switch_tab` | Activate a specific tab by ID. |
| `browser_close_tab` | Close a tab by ID (session-owned tabs only). |
| `browser_get_new_tab` | Return the most recently opened tab — useful after a link opens a new tab or an OAuth popup. |
| `browser_list_frames` | List all iframes on the current page with URL and index. |
| `browser_select_frame` | Execute JavaScript inside a specific iframe, targeted by index. |

## Data & Storage — 5 tools

| Tool | Description |
|---|---|
| `browser_get_cookies` | Get cookies for a domain. |
| `browser_set_cookies` | Set one or more cookies for a domain (single cookie or a `cookies[]` batch). |
| `browser_get_local_storage` | Read `localStorage` from the current page — a single key or all of it. |
| `browser_set_local_storage` | Write a `localStorage` key/value pair on the current page. |
| `browser_console_logs` | Return recent `console.log`/`warn`/`error` messages captured from the page. |

## Files — 2 tools

| Tool | Description |
|---|---|
| `browser_upload_file` | Upload file(s) to an `<input type="file">` via the Chrome Debugger API — no OS file dialog needed. |
| `browser_drop_file` | Upload into a drag-drop zone by locating a hidden file input in its subtree or parent (up to 2 levels); use when `browser_upload_file` finds no input. |

## Network — 3 tools

| Tool | Description |
|---|---|
| `browser_fetch` | Make an HTTP request from the extension background — not subject to page CORS/CSP. |
| `browser_wait_for_network` | Wait for a network request matching a URL substring to complete, via Chrome DevTools Protocol. |
| `browser_extract_token` | Extract an API token from any provider's account-settings page; ships zero-config shortcuts (known URL + extraction hint) for 9 common providers (Stripe, HubSpot, Slack, Shopify, Mailchimp, Pipedrive, Calendly, Google, LinkedIn) — any other provider still works via manual navigate + read. Optionally stores the token in the Agent360 vault. |

## CAPTCHA — 1 tool

| Tool | Description |
|---|---|
| `browser_solve_captcha` | Detect and solve reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, or FunCaptcha — auto-click checkbox (~80% solve rate, logged-in Google), then AI-vision-guided grid click, then human fallback for the rest. |

## Human-in-the-Loop — 1 tool

| Tool | Description |
|---|---|
| `browser_ask_user` | Show an overlay asking the user to perform an action or provide input (credentials, 2FA, CAPTCHA, OAuth consent); returns their response. |

## Meta — 1 tool

| Tool | Description |
|---|---|
| `browser_about` | Return Browser MCP info plus pre-filled links for the user to submit a feature wish, share a use-case, or report a bug. |

---

**Total: 34 tools** (4 + 11 + 6 + 5 + 2 + 3 + 1 + 1 + 1 = 34), verified against `mcp-server/tools.js` line-by-line — no invented tools.