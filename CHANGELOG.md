# Changelog

Browser MCP by Agent360 (`@agent360/browser-mcp` on npm, "Agent360 Browser MCP" in the Chrome Web Store).
Dates are when the version was published on GitHub. The full notes for each release are on the [releases page](https://github.com/Agent360dk/browser-mcp/releases).

## 1.29.1 (not released yet)

Every change below was written test-first and checked with a mutation test: the fix is removed on purpose, and the test must turn red.

**Privacy and security**
- The extension's action log stored the first 200 characters of every tool call's parameters in Chrome's local storage, including values typed with `browser_fill` (passwords) and cookie values. The log now keeps only time, tool name and session, and entries saved by older versions are cleaned when the extension updates.
- Several pages and READMEs promised that "nothing leaves your machine". What the agent reads goes to your own AI client and its model provider. The text now says what is true: it runs on your machine, and nothing is sent to Agent360.
- The server's instructions told agents that it "auto-pulls the latest code from git". It updates through npm.
- `hono` (via the MCP SDK) moved from 4.13.3 to 4.13.7, which fixes one moderate advisory.

**Tools that said something happened when it did not, or the reverse**
- `browser_execute_script`: if the page navigated away while the script was still running, the script was run a second time through the debugger. It now answers `ok:false, maybe_ran:true` and does not run it again.
- `browser_get_new_tab`: a popup opened by one of the session's own tabs was refused as "not-ours" if that tab had closed in the meantime.
- `browser_click`: a ripple effect added on mousedown hid that the click itself did nothing, so the React fallback was skipped and the answer was `landed:true`.
- `browser_click_xy` / `browser_click`: a click that changed text without changing its length (for example `AAAA` to `BBBB`) was reported as not landed.
- `browser_fill`: correct formatting by the page (`1234.5` shown as `1.234,50 kr`) was reported as a failure. The field is now read before and after: unchanged means the page refused the value (`ok:false`); changed to something else means `ok:true` with `afviger:true` and the actual value.
- `browser_set_date`: a clock time could be read as the year (`02/01 20:26` accepted as 2020), and a correct date with a time zone (`02/01/2026 12:00 GMT`) was rejected.
- `browser_get_cookies`: a parent-domain cookie on another path (`Domain=.example.com; Path=/api`) was missing.
- `browser_upload_file`, `browser_drop_file` and the screenshot `path`: with the working directory `/`, every ordinary file was refused.

**Release process**
- The package check before publishing accepted a package that crashed on start. It now requires a valid answer to the MCP `initialize` handshake.
- A release that stopped after npm could not be resumed on the same version.
- The browser flow test required a cookie URL and upload files that the new guards reject, and it accepted an outdated or duplicate extension. It now proves that the candidate extension is the one running.

**Site**
- `llms-install.md` is published on browsermcp.dev (it returned 404).
- The comparison with browsermcp.io was updated with numbers re-pulled on 2026-09-11.

## 1.29.0 (2026-09-07)

- The server no longer takes a port when a chat starts. It binds on the first browser call, retries on every call, and releases the port five minutes after the last tab closes.

## 1.28.1 (2026-08-30)

- A click on a button that opens a dialog no longer hangs for 30 seconds.
- The flow test against a real Chrome runs in the publish script and stops a release.
- Known issue at the time: after `browser_handle_dialog`, the tab could stay frozen for the next command.

## 1.28.0 (2026-08-27)

- The bridge between the extension and the server reconnects on its own after a restart and no longer tears itself down every ten minutes.
- Security: another local process could read cookies and stop the server; overlay dismissal could click "Close account" (a veto list was added); dependency advisories went to zero.
- A missing file in the npm package made every `npx` start fail; a package check now runs before anything is published, and npm is published last.

## 1.25.0 (2026-07-24)

## 1.24.0 (2026-07-23)

## 1.23.0 (2026-06-09)

- Tabs are evicted least-recently-used (at most 10 per session), and clicks reach buttons inside shadow DOM web components.

## 1.16.1 (2026-04-09)

- First release on GitHub.
