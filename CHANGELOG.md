# Changelog

Browser MCP by Agent360 (`@agent360/browser-mcp` on npm, "Agent360 Browser MCP" in the Chrome Web Store).
Dates are when the version was published on GitHub. The full notes for each release are on the [releases page](https://github.com/Agent360dk/browser-mcp/releases).

## 1.29.1 (not released yet)

Every change below was written test-first and checked with a mutation test: the fix is removed on purpose, and the test must turn red.

**Privacy and security**
- The extension's action log stored the first 200 characters of every tool call's parameters in Chrome's local storage, including values typed with `browser_fill` (passwords) and cookie values. The log now keeps only time, tool name and session. Entries saved by older versions are removed when the extension updates, and every new write removes them too, so a tool call that happens during the update cannot write them back.
- Several pages and READMEs promised that "nothing leaves your machine". What the agent reads goes to your own AI client and its model provider. The text now says what is true: it runs on your machine, and nothing is sent to Agent360.
- The server's instructions told agents that it "auto-pulls the latest code from git". It updates through npm.
- `hono` (via the MCP SDK) moved from 4.13.3 to 4.13.7, which fixes one moderate advisory.

**Tools that said something happened when it did not, or the reverse**
- `browser_execute_script`: if the page navigated away while the script was still running, the script was run a second time through the debugger. It now answers `ok:false, maybe_ran:true` and does not run it again. When Chrome refuses the isolated-world injection before anything runs, the script still runs once in the page's main world.
- `browser_get_new_tab`: a popup opened by one of the session's own tabs was refused as "not-ours" if that tab had closed in the meantime.
- `browser_click`: a ripple effect added on mousedown hid that the click itself did nothing, so the React fallback was skipped and the answer was `landed:true`.
- `browser_click_xy` / `browser_click`: a click that changed text without changing its length (for example `AAAA` to `BBBB`) was reported as not landed.
- `browser_click` in a background tab: Chrome does not deliver mouse events to a tab that is not active, so the click timed out. It now falls back to a script click and answers `ok:true` only when the page visibly reacted to the click itself; otherwise `ok:false` with `maaske_landet:true` and a hint to switch to the tab. Timeouts on mouse and keyboard input say that the tab is probably in the background.
- `browser_fill`: correct formatting by the page (`1234.5` shown as `1.234,50 kr`) was reported as a failure. The field is now read before and after. If it changed to something else, the answer is `ok:true` with `afviger:true` and the actual value. If it shows the same before and after, the answer is `ok:true` with `afviger:true, uaendret:true`, because a value that was already there and a refused value look the same. Only a field that should have been emptied but was not gives `ok:false`.
- `browser_screenshot`: a standard capture that hung and then disconnected was retried until after the server's 30-second limit. The capture now has one time budget, the `fromSurface:false` fallback is tried in time, and a slow standard capture still wins if it answers first. If both hang — which is what a fully covered window looks like — the window is raised once as a last resort inside that budget, the way 1.29.0 did, and your previous window is put back in front.
- `browser_wait_for_network`: a response body that was slow to arrive could push the tool past the server's 30-second limit. The body now gets at least the 8 seconds it had in 1.29.0 and otherwise only the time left in the tool's budget; if it does not arrive, the answer is `body:null`.
- `browser_scroll`: when the mouse wheel timed out and the fallback scrolled a page with smooth scrolling, the position was read before the animation finished, and a scroll that worked was reported as "the bottom may have been reached". The position is now read again for up to a second, and a scroll that was actually sent is never reported as a failure: if the movement cannot be seen in that time, the answer says so (`uvist`) and includes the measured position.
- `browser_set_date`: a clock time could be read as the year (`02/01 20:26` accepted as 2020), and a correct date with a time zone (`02/01/2026 12:00 GMT`) was rejected.
- `browser_get_cookies`: a parent-domain cookie on another path (`Domain=.example.com; Path=/api`) was missing. Secure cookies are returned only for https pages and localhost, and an incognito tab whose cookie store cannot be identified reads nothing.
- `browser_upload_file`, `browser_drop_file` and the screenshot `path`: with the working directory `/`, every ordinary file was refused.
- `browser_set_cookies` could set a cookie on any domain, including sites the session had never opened, while `browser_get_cookies` was already limited to the session's own pages. Both now follow the same rule.
- The server's instructions now explain `maaske_landet`, `landed`, `afviger` and `uaendret`, so an agent does not repeat an action that may already have happened.
- `browser_provide_feedback` told users with an outdated extension to reload it. For a Chrome Web Store install that does nothing until Google approves the new version, so the advice now covers both cases and says the 1-3 day wait is expected.

**Install**
- `install.sh` (for people who clone the repo) told you to add the server to a config file Claude Code does not read, so it looked right and did nothing. It now runs the package's own install.
- The extension popup without a server showed only the Claude Code command. It now also shows Codex and points to `npx @agent360/browser-mcp install` for Cursor, VS Code and the rest.
- `npx @agent360/browser-mcp install` now also registers the server with Codex (`codex mcp add`), VS Code (`code --add-mcp`, when that version supports it) and Cursor (`~/.cursor/mcp.json`, keeping the servers already there). Clients that are not installed are left alone.

**Release process**
- The package check before publishing accepted a package that crashed on start. It now requires this server's answer to the MCP `initialize` handshake (with tools), requires the package to keep running shortly after, and runs the package with a temporary home folder so it cannot touch the real extension folder.
- A release that stopped after npm could not be resumed on the same version. It now resumes only when the version's git tag points at the code being released, and a new release refuses to start if a tag for that version already exists somewhere else — otherwise a second run could publish newer code while the tag still pointed at the old commit.
- The browser flow test required a cookie URL and upload files that the new guards reject, and it accepted an outdated or duplicate extension. It now requires exactly one connected extension whose version matches the server, and the extension sends a fingerprint of its own `background.js` in the handshake, so the gate can see that Chrome is running the code being released — not another copy with the same version number. The fingerprint is a hash, sent only to the local server.

**Site and npm page**
- `llms-install.md` is published on browsermcp.dev (it returned 404).
- The comparison with browsermcp.io was updated with numbers re-pulled on 2026-09-11.
- The demo GIF on the npm page uses an absolute address.
- The demo video and GIF were re-rendered from the current build. The old ones were from June, before the tool count and the wording changed; the GIF is also smaller than before (1.8 MB against 2.1 MB).

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
