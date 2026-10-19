# Changelog

Browser MCP by Agent360 (`@agent360/browser-mcp` on npm, "Agent360 Browser MCP" in the Chrome Web Store).
Dates are when the version was published on GitHub. The full notes for each release are on the [releases page](https://github.com/Agent360dk/browser-mcp/releases).


## 1.32.0 (not released yet)

**Partitions for parallel agents (#20).** Thanks to [@ugbodagadave](https://github.com/ugbodagadave), whose PR #20 had the
idea and the first version: an extra listener per partition, and a `partition` parameter on the browser tools. It is built
here on the lanes 1.31 laid down, and #20 is superseded with credit. Agents that share one chat (a coordinator and its
subagents) also share its tab group and active tab, so they took over each other's tabs. `browser_partition` with
`action: "new"` gives an agent its own partition: one more port in the same range, which the extension connects to like
any other, so the partition gets its own tab group and active tab. It chooses its Chrome profile right away by the 1.31
rules (`profile` in the call, otherwise `BROWSER_MCP_PROFILE`) and answers an id like `p1`; ids are never reused while the server runs (after a restart, numbering starts at `p1` again). Every
tool that reaches the browser takes `partition`, `browser_extract_token` too; calls without it go to the default partition
as before, and a call with an unknown or closed id is never sent there instead. `action: "close"` closes the partition's
tabs through its own connection and releases its port. A partition's commands carry no process id, so the extension never
hands its tabs to another partition. At most 4 partitions are open per server, because the ports are shared by every chat
on the machine.

**A late clean-up no longer closes a new connection's tab.** The extension keys a chat's session on the port. Measured in
review: after a new session was created on the same port with a tab, a clean-up still on its way from the connection that
had closed closed that tab and deleted the session. With partitions, ports are reused more often. Now every connection
between the extension and a server has its own generation, and a clean-up applies only to the connection it was ordered
for: a session taken over by a new connection keeps its new tabs, and only the old connection's tabs are closed. A command
that arrives while a session is being cleaned up gets a fresh session.

**`browser_press_key`: Enter and punctuation as on a real keyboard (#76).** Thanks to [@arasmileska](https://github.com/arasmileska),
who measured it and named the cause. Enter was sent without text, so the page got keydown and keyup 13 but no keypress, and
punctuation got key code 0 and a `code` Chrome does not know (`","`). Tag and chip inputs that commit on Enter or comma, by
keypress or by `keyCode === 188`, never made the tag. Now Enter carries its line break (keydown, keypress and keyup 13, not
with ctrl, meta or alt), punctuation is sent as the key it sits on in the US layout (`,` 188 `Comma`, `.` 190 `Period` and
so on), and a shifted character such as `<` or `@` is that key with Shift held, as on a real keyboard. An explicit `code`
still wins (it changes only the `code`, not the key code); a character that is not on a US keyboard, an emoji too, gets no
`code` instead of itself. A capital letter is still sent without Shift, and `shift: true` does not change the character.
The most noticeable change: Enter now acts like the real key. In a text field it submits the form, on a focused button it
presses it, and in a textarea it adds a line break - before, it did none of these, so an agent that pressed Enter without
effect can now submit a form. `browser_press_key("Space")` is now the space bar (key `" "`): in a field it types a space,
on a focused button it presses it, and on a checkbox it ticks it - before, it did none of these; the page got `e.key ""`,
and the answer said `key-not-delivered` although the key had landed.
`browser_fill` had the same gap where it types character by character (a text selector, or a field that does not take
the value directly): the keys now carry the same key codes and Shift, and the text that is typed is the same as before.
A line break, carriage return or tab in the value is no longer sent as a key: before, `"\t"` moved focus (and the answer
read another field), `"\r"` submitted the form, and `"\n"` was lost in a textarea. A tab is inserted as text. Line breaks
follow one rule on every path `browser_fill` writes by (inserting the value at once, and typing it character by character),
checked in the field that has focus at each line break: `"\r\n"` and `"\r"` are one line break, written as a line break only
in a textarea or a contenteditable field (also on an XHTML page). In a single-line input, in a frame, or when the field
cannot be read, it is typed as one space instead - a line break inserted into an input submits the form, and leaving it out
glued the words together - and the answer says so (`line_breaks_as_spaces`, `differs`, `actual`). When a value of only line
breaks leaves the field empty, the answer says how they were sent and that the field did not take them. An emoji is typed whole,
one key per code point, where it used to become two broken halves. When the field is empty after typing, `browser_fill`
says what the tool saw: `keys_delivered: true` (it saw keys arrive - the page either turned the text into something, such as
a tag, or rejected the keys), `false` (it saw no key arrive) or `null` (it could not tell, or the page navigated). In every
case it says to check the page before typing again; the advice to switch tabs and try again is given only when the tool saw
no key arrive. It counts only the browser's own key events, so a key the page fires itself does not count, and an editor
that stops every key event before the tool's listener can make it see no key although the keys arrived.
`browser_set_date`'s masked path now clears a prefilled field on macOS too (Chrome's select-all command, as in #68), so the
field holds exactly the new date. Before each step that writes (select all, delete, typing) it checks that focus is still on
the field, and stops at once when it is not: `focus-moved` names where focus went, `focus-unknown` says it could not be read,
and the answer lists what had been changed by then and where (`value_before`, `field_changed`, `changed` - each field compared
with itself, so a page that reorders its fields does not show up as a change). The field is
found in the main document; a field inside a shadow root or a frame is not reached by this path. When every path fails
after a path wrote to the field, the answer says so (`value_before`, `field_changed`) instead of ending as a bare error.

**`browser_screenshot`: an older picture says so.** When the raised round's own capture does not arrive in time and an
earlier capture is delivered instead, the answer now says `stale: true` with a note, next to the picture (also when it is
saved to a file): the page may have changed since.

**`browser_execute_script` and `browser_select_frame`: the server waits for the extension's answer.** On a page that
navigates 50-200 times a second, Chrome's browser thread stalls. The extension still answered these two tools within its
29.5 seconds, but the answer did not reach the server before the server's own 30-second limit, and the agent got the
general "Command timed out after 30000ms", which does not say whether the code may have run (measured on 1.30.3 too). The
server now waits 45 seconds for these two tools (its 30 seconds plus 15), which gives the extension's answer 15 more seconds
to arrive: `call-timeout` with `sent: false` when nothing was run, or "MAY already have run". The extension's own 29.5 seconds are unchanged. If no
answer arrives within the 45 seconds, the server answers `no-answer` with `sent: "unknown"`: the code MAY have run, it is
not repeated, and the agent should call again only if the code is safe to run twice. Every other tool keeps its limit and
its message.

**New answers an agent can see:**

| Answer | Where | Means |
|---|---|---|
| `partition`, `port`, `profile`, `installation` | `browser_partition` `new` | The partition is open and drives that installation |
| `port_released`, `tabs_closed: true` or `"unknown"` | `browser_partition` `close` | `true` only when the extension confirmed the tabs were closed (or no call ever used the partition) |
| `error: "partition-limit"` | `browser_partition` `new` | 4 partitions are already open on this server |
| `error: "port-capacity-exhausted"` | `browser_partition` `new` | Every port in the range is taken; no partition was created |
| `error: "profile-*"`, `partition_created: false` | `browser_partition` `new` | The partition's profile choice failed; no partition was created and its port was released |
| `error: "partition-not-found"` | every browser tool, `close` | No partition with that id, or `new` is still creating it (every browser tool). Nothing was sent |
| `error: "partition-closed"` | every browser tool, `close`, `new` | The partition was closed (from `new`: while it was being created). With `sent: false` nothing was sent. With `sent: true` the command was sent and was still waiting for its answer when close released the port, so it may have been carried out; a command the extension answers before that gets its normal answer |
| `error: "action-invalid"` | `browser_partition` | `action` is neither `new` nor `close` |
| `partitions` | `browser_about` | The chat's partitions: `partition`, `label`, `state` (`creating`, `open` or `closed`), `port`, `profile`, `installation` |
| `keys_delivered: true`, `false` or `null` | `browser_fill` (empty field after typing) | The tool saw keys arrive / saw none / could not tell. Not proof of what the page did with them: check the page before typing again |
| `line_breaks_as_spaces` | `browser_fill` | That many line breaks were typed as spaces, because the field takes none (a single-line input, a frame, or a field that could not be read) |
| `error: "focus-moved"` or `"focus-unknown"`, `step`, `focused`, `changed` | `browser_set_date` | Before a writing step focus was no longer on the field (or could not be read); the tool stopped there, and `changed` lists what had been changed by then |
| `value_before`, `field_changed: true` | `browser_set_date` (all paths failed) | The field was written to on the way and no longer holds what it did before |
| `stale: true` | `browser_screenshot` | The picture was taken before the window was raised; the page may have changed since |
| `error: "no-answer"`, `sent: "unknown"` | `browser_execute_script`, `browser_select_frame` | No answer reached the server within 45 seconds. The code MAY have run; it is not repeated automatically, so call again only if it is safe to run twice |

## 1.31.0 (not released yet)

**Choose the Chrome profile (#58, joseph-lewis).** The Chrome Web Store extension has the same id in every Chrome profile, so
the server could not tell profiles apart: with the extension enabled in two of them, commands went to one of them, and which
one could change when the other reconnected. 1.30.2 only warned, and the warning that commands had moved to another
connection came after a command had already run there. Now each installation of the extension (one per Chrome profile)
creates a random installation id once, keeps it in the extension's local storage, and sends it with its greeting, together
with a name you can give the profile in the popup ("This Chrome profile"). `BROWSER_MCP_PROFILE=<name>` in a client's MCP
config makes that client drive that profile; it works together with `BROWSER_MCP_EXTENSION_ID`. A chat is locked to the
installation from its first command, also without `BROWSER_MCP_PROFILE`, and the server never moves it to another profile
on its own: when that profile goes away, the next call says so and sends nothing, and only the call after that picks again.
If the same installation comes back in time (the extension reconnects), the chat continues without an error. A call that
was already waiting when the installation went away gets `profile-disconnected` too; it cannot reach another installation
before the agent has seen the error. A chat's first call waits until the port has been open for about 2.5 seconds before it
chooses: the extension scans every 2 seconds in each profile, and without the wait a second profile with the same name, or a
copied profile, could connect just after the choice and never be seen (measured in Chrome: 7 of 20 first calls). The margin is about half a
second on an idle machine; a profile whose scan comes later (for instance under heavy load) can still be missed by the first
choice, and the chat then stays with the profile that did connect. A port released
after the chat's last tab closed keeps the lock; for an extension before 1.31, which reports no installation, it is released
as in 1.30.2. Renaming in the popup greets every connected server again with the new name; no connection or running call is
dropped, and a chat that already drives the installation keeps driving it. The name and the id are labels to choose by, not
credentials: the greeting is not signed, and another program on the machine can claim any name. Both appear in
`browser_about` and in the `profile-*` answers, so they reach the agent and its model provider like any tool answer (README,
Security).

**Groundwork for partitions (#20, ugbodagadave).** The server's bridge now has lanes: one listener code per lane, one map of
pending calls where each call is bound to the connection it was sent to, `terminate` taken only from the lane's own active
connection, and one guard against messages that are not objects. There is still one lane (the default one) and no new tool;
the partition tool from PR #20 comes on top of this in a later version, with credit. The five faults measured in PR #20's own
listener (a reply from another lane's socket accepted in both directions, `null` stopping the server, a later connection
taking over a lane, a dead connection answering only after 30 seconds) are fixed tests against these lanes.

**New answers an agent can see:**

| Answer | Where | Means |
|---|---|---|
| `error: "profile-invalid"` | every browser tool | `BROWSER_MCP_PROFILE` is set but is not a valid name (letters, digits, dot, dash, underscore, 1-32). Nothing was sent; the server does not fall back to some profile. The value is not repeated in the answer |
| `error: "profile-not-connected"`, `profile`, `connected` | every browser tool | No connected installation has the name. The call first waited for it: about 7.5 seconds, and up to about 17.5 seconds when the port opened in the last 10 seconds, as on a chat's first browser call (2.5 seconds before the first choice plus a doubled wait); `connected` lists what the server can see (at most 10) |
| `error: "profile-routing-unsupported"` | every browser tool | `BROWSER_MCP_PROFILE` is set, but every connected extension is older than 1.31 and reports no name |
| `error: "profile-ambiguous"`, `candidates` | every browser tool | Two or more connections carry the name, or the installation the chat drives or is about to drive is connected twice (a copied profile, also without `BROWSER_MCP_PROFILE`). Answered without waiting further; nothing was sent |
| `error: "profile-disconnected"`, `lost`, `connected` | every browser tool | The installation the chat was driving is gone (after waiting the same time for it to come back; at once for an extension before 1.31, which cannot be recognised). Nothing was sent. Calls that were already waiting get the same answer; the next call picks again |
| a note in the answer | the first command | Without `BROWSER_MCP_PROFILE` and with several installations connected: which one the chat now drives, and that it stays with it |
| `installations`, `installations_note` | `browser_about` | The installations connected to the chat: `profile`, `instance`, `version`, `driven` (at most 10) |

All of these errors have `sent: false` and `isError: true`. The 1.30.2 note "commands now go to another one" is gone. The
warning about the same extension connected more than once now only appears for connections that report no installation:
one that greeted without an installation, or one that still has not greeted 3 seconds after connecting (an extension before
1.28 never greets). A connection that has just opened and not greeted yet does not count, neither in the server's log nor in
the next tool answer. `browser_provide_feedback` reports a profile choice that cannot be made instead of "No Chrome extension
is connected": two profiles with the same name or a copied profile give verdict `conflict`, and for a copy the advice is to
close it or reinstall the extension in it (renaming a copy does not help, it keeps the same installation id). When a copy and
another installation both carry the name, the tool's answer and the diagnosis both give both pieces of advice, whatever
order the connections came in.

**The agent's JavaScript runs only through the Chrome debugger.** Up to 1.30.3, `browser_execute_script` first tried
`chrome.scripting.executeScript` with the code compiled by `new Function`, in the extension's isolated world and then in
the page's main world, and only then the debugger; `browser_select_frame` used only the scripting path. Chrome Web Store's
Manifest V3 rules allow code that is not in the package only through an API made for it (the Debugger API or the User
Scripts API), and only for the code that API runs. Both tools now evaluate through the debugger (`Runtime.evaluate`): in
the page's own context, so the page's globals are visible as before, and in a frame's own context for
`browser_select_frame`, also in a frame from another site (Chrome runs those as separate targets; the extension reaches
them with `Target.setAutoAttach` and flat sessions, also when nested). A returned promise is awaited, and code that was
sent is never sent again. The extension compiles no strings anywhere. Measured in headless Chrome 155 against 1.30.3 on a
plain page, a page with a strict CSP, a promise, code that throws, and same-site, cross-site and nested frames. The debugger
was already attached to the tab after `browser_navigate` in both versions, so Chrome's notice that the extension is
debugging the browser is not new. What changes for an agent:

| Before (1.30.3) | Now |
|---|---|
| `method`: `scripting-main`, `scripting-isolated` or `debugger` | always `debugger` |
| A syntax error: a tool error with a `scripting-diag` trail | `ok: false`, `error`, `name: "SyntaxError"`, `method`, `note`, like any code that throws |
| Code that throws: `ok: false` with the note "not run again through the debugger" | the same fields; the note says it is not run again |
| `browser_select_frame` on a frame with a strict CSP: `ok: false` (`unsafe-eval`) | runs |
| `browser_select_frame` with a promise: `{}` | the promise is awaited |
| `browser_select_frame` answer: `result`, `frame_url` | `frame_url` is the address of the document the code ran in (read when the mark is set), which can differ from `browser_list_frames` if the frame navigated in between; also `method: "debugger"`; `ok: false`, `error: "frame-not-reachable"`, `sent: false` and `retry` when the frame cannot be identified through the debugger (nothing is run; `retry: false` only when the extension may not run in that frame at all, where calling again gives the same answer) |
| `browser_select_frame` picks the frame Chrome's scripting API names | the extension puts a random one-time mark in that frame's document, in the extension's own isolated world where the page cannot see or set it, and the code runs only in the frame whose debugger context carries the mark, addressed by the context's `uniqueId` (a numeric context id can be reused by another process after a navigation); address, order and position play no part. Two frames with the same address, `about:blank` frames written with `document.write` and frames in open or closed shadow roots are each reached, and frames are never mixed up; a frame whose document is replaced while the call looks for it is not reached (`retry: true`), so a frame that reloads every second or faster may need several calls. The mark is removed afterwards, without holding up the answer |
| A promise on a page with a strict CSP (debugger path) waited at most 20 seconds | `browser_execute_script` and `browser_select_frame` answer within 29.5 seconds of the extension receiving the call (the server's 30-second limit minus half a second for the answer); the agent's code may wait for what is left after the tab and frame are found, on every page. If the time runs out first, the answer says whether the code was sent: `ok: false`, `error: "call-timeout"`, `sent: false`, `retry: true` when it was not (it is then never sent), or "MAY already have run" when it was |
| Chrome refuses the debugger (enterprise policy, cancelled notice) and the page allows `eval` | the call fails and says the code was not run; there is no fallback through script injection |
| The popup's action log highlights `execute_script` but not `select_frame` | both are highlighted, since both run the agent's JavaScript (alongside `get_cookies` and `get_local_storage`) |

**Manifest and privacy policy.** The unused `activeTab` permission is removed, and the short description says what is
true: the agent *can* ask you for a 2FA code or a decision, and the tools work with MCP clients (not "any client"). The
privacy policy says what the code does: Browser MCP does not read Chrome's history, but `browser_list_tabs` returns the
addresses and titles of the session's tabs to the AI client; the agent's JavaScript runs only through the Debugger API;
answers in `browser_ask_user` go to the AI client, and the page's own listeners can see the keystrokes typed there; and
the Chrome Web Store Limited Use statement.

## 1.30.3 (2026-10-15)

**`browser_navigate` and "Leave site?" (#69).** 1.30.2 said this would come in a later version; it is fixed here. Before,
`browser_navigate` in the current tab answered with the old address and no error when the page asked "Leave site?", and
the prompt stayed open, so the tab did not respond until the user answered it in Chrome. Now one part of the extension
watches the tab's dialogs and is the only part that answers them. When the page asks "Leave site?" after the address was
sent, the answer is Stay, unless the call passed `leave_page: true` or a `browser_handle_dialog` arming is waiting for the
next dialog on the tab; the result is read from Chrome's own report that the dialog closed, not from the reply to the
command that answered it. In the current tab, `ok: true` now means Chrome took the address and the new page was proven
loaded within about 25 seconds. The limit starts before the session's tab is looked up, and every wait after that lookup
(the page, a dialog, the CAPTCHA check) runs under it; the wait for the page ends half a second before the limit, so the
answer itself fits, and a page that finishes in that last half second is reported as `navigation-unconfirmed`. The lookup
itself is waited for to the end, because stopping it halfway could leave Chrome creating a tab with the address afterwards:
if Chrome stalls there, nothing is answered until it is done (`tab-not-responding`, or `dialog-open` for a dialog the
extension saw, when nothing was sent), and if it never finishes, the server's own 30-second limit ends the call. Success is
never answered after the limit. Every other outcome is an error with `sent` (whether the address reached Chrome) and a note
on what the agent can do. A new session's first navigate, whose tab is created with the address, is held to the same rule:
`ok: true` only with a proven load, otherwise `navigation-unconfirmed` with `sent: true`. Other new tabs (`new_tab`) and
`eget_vindue` are unchanged.

**Session guard.** Looking up the session's tab can wait on Chrome for a long time, also past the server's 30-second limit,
which does not stop the work in the extension. Each call therefore notes the session's active tab when it starts and checks
it again before acting: after every lookup of a session tab (also one that succeeds), in the search for another usable
session tab, and before creating a tab. If another call changed the active tab meanwhile (it switched to, opened or closed
a tab - closing the dead active tab counts too), the call stops before sending anything to a tab or creating or activating
one: `browser_navigate` answers `session-changed` with `sent: false`, and other tools fail with that message. Tab ids found
dead on the way may already have been dropped from the session. A call that gets past these checks before the change can
still finish its action in Chrome after the server has given up on it, as in 1.30.2.

**New answers an agent can see:**

| Answer | Where | Means |
|---|---|---|
| `leave_page` (parameter) | `browser_navigate` | Answer "Leave site?" with Leave instead of Stay. The tool text says to ask the user first (`browser_ask_user`), because unsaved work on the page is lost |
| `ok: true`, `answered_by`, `dialog_type` | `browser_navigate` in the current tab | The new page was proven loaded. A page-load report counts only when Chrome took the address and the navigation was seen starting, the tab shows the requested address, or the tab has left its old address; the old page reporting "loaded" again is not proof any more (1.30.2 took it). The same address, a fragment and a redirect are proven as in 1.30.2; a redirect back to the exact old address counts only when Chrome reports the navigation starting, which it did when measured; `answered_by` (`navigate` or `handle_dialog`) when a dialog was answered on the way |
| `error: "beforeunload-blocked"`, `url`, `answered_by` | `browser_navigate` | The page asked "Leave site?" and the answer was Stay, so the tab is still on `url`. The note says to ask the user before calling again with `leave_page: true` |
| `error: "dialog-open"`, `dialog_type`, `message`, `pending_url` | `browser_navigate` | A dialog is open on the tab. With `sent: false` nothing was sent; with `sent: true` the page opened a dialog that is not "Leave site?" after the address was sent, and it was not answered. `pending_url` is a navigation that may still happen when the dialog is answered |
| `error: "navigation-in-progress"`, `op_id` | `browser_navigate` | Another navigate is still working in the tab, Chrome has not yet taken an address sent before, or an earlier answer to a dialog on the tab has not been confirmed (it could land on this call's dialog; then `op_id` is null and the note says so). Nothing was sent. The hold on an unconfirmed answer lasts until Chrome answers, the debugger detaches or the tab closes; `browser_reattach_debugger` releases it |
| `error: "tab-not-responding"` | `browser_navigate` | Chrome did not answer on the tab before anything was sent: a busy page, or a dialog Chrome does not show the extension (one that opened before anything listened). A dialog the extension saw open meanwhile gives `dialog-open` instead |
| `error: "navigation-failed"`, `detail` | `browser_navigate` | Chrome refused the navigation. Before, a refused address could come back as an answer with the old address |
| `error: "dialog-unconfirmed"` | `browser_navigate`, `browser_handle_dialog` | A dialog was answered, but Chrome did not report it closed within 5 seconds, or the debugger left the tab. Nothing more is sent |
| `error: "navigation-unconfirmed"`, `may_complete_later`, `pending_url` | `browser_navigate` | The address was sent, but no load was proven in time (about 25 seconds: the wait ends half a second before the limit, so the answer fits inside it); the navigation may still complete later. A download or an address that answers 204 never loads a page and ends here too; `pending_url` then stays until a later navigate is proven or a "Leave site?" closes, so it is not proof that Chrome still has a navigation waiting. A dialog that opens after that is answered only by a `browser_handle_dialog` arming that is still valid; otherwise nobody answers it: the next call answers `dialog-open` with `pending_url` |
| `error: "tab-closed"` | `browser_navigate`, `browser_handle_dialog` | Chrome no longer has the tab: it was closed while the call was waiting. A tab that moves to a page the debugger cannot stay on (`chrome://`, the Chrome Web Store) is still there and is not reported as closed |
| `warning` | `browser_reattach_debugger` | A dialog the extension saw open was on the tab. After reattaching, the tools cannot answer it, so the user has to |
| `error: "session-changed"` | `browser_navigate` | Another call changed the session's active tab while this one waited for Chrome; nothing was sent. Other tools fail with the same message |
| `captcha_checked: false` | `browser_navigate` | The page loaded, but the CAPTCHA check did not finish inside the 25 seconds, so it was skipped; this is not "no CAPTCHA" |
| `error: "dialog-being-answered"` | `browser_handle_dialog` | `browser_navigate` or an earlier `browser_handle_dialog` is answering the dialog on screen, or an earlier answer on the tab has not been confirmed by Chrome |
| `action` from Chrome's report | `browser_handle_dialog` | A dialog the extension saw open and nobody is answering is answered at once, without waiting for an arming; `action` (`accept` or `dismiss`) is what Chrome reported when the dialog closed. An arming's answer, which a click waits for, now also comes from that report |

These errors are also errors to the MCP client (`isError: true`), so an agent does not read `ok: false` as a call that went through.

## 1.30.2 (2026-10-14)

**Tool texts that match the code, clicks that say when they could not land, and the pull requests from
John H.**

**New answers an agent can see:**

| Answer | Where | Means |
|---|---|---|
| `error: "covered"`, `covered_by` | `browser_click`, `browser_double_click`, `browser_right_click`, `browser_hover`, `browser_fill` with a text selector, a custom dropdown's trigger or option in `browser_select_option` (for the option with `trigger_clicked: true`: the list may still be open) | The mouse would not reach the target at its center: an element lies in front of it, the target does not take clicks there, or (for click, double-click, fill and select_option) a different control inside it would get the click; `covered_by.outside` when the center is outside the visible page. Found before the mouse is sent, nothing is sent. When the cover appears after the target was found, the remaining presses and clicks are stopped at the window, before any element of the page gets them (the element in front may still see the mouse move over it, and a release the page moves elsewhere is let through); because a listener on the window itself still gets them, and the first ones may already have reached the target, the answer is then `landed: null` with `maybe_landed: true`. A release that the page moves elsewhere after the press reached the target (a menu that opens on the press, a slider that captures the pointer) is let through, and the answer is at most `maybe_landed`. Before, `browser_click` answered `ok: true` when the click hit an overlay |
| `error: "field-is-readonly"`, `error: "field-is-disabled"` | `browser_fill` | A disabled field is named before typing; a read-only one only when the text did not land, because some fields are read-only until they get focus (#56) |
| `action`: `tab_closed`, `replaced`, `navigated`, `removed_by_page` | `browser_ask_user` | How a question ended other than with an answer or a timeout (#62) |
| `error: "file-access-off"`, `file_access` | `browser_upload_file`, `browser_drop_file` | Chrome answered "Not allowed" for the file, and the switch "Allow access to file URLs" is off (`file_access: false`) or Chrome could not tell (`file_access: null`, and the note calls the switch the usual cause). If Chrome says the switch is on, Chrome's own error is kept |
| `cleared_by_page`, `seen_in_field`, `input` | `browser_upload_file`, `browser_drop_file` | The field is empty afterwards, but the page's change handler saw the file in it: X and Facebook empty the field after reading the file, and a page that rejects a file can too, so check the page before attaching again. `input` describes the field that got the file (#67) |
| `other_file_inputs` | `browser_drop_file` | No file input at the target and no file chooser opened when it was clicked: the page's other file inputs, none of which got the file, each with a `selector` that matched that input alone (null when none did) (#67) |
| `error: "tab-not-responding"` | `browser_handle_dialog` | Chrome did not answer on the tab, for instance because a dialog is already open, which cannot be answered from here; the note says what can be done (#69, in part) |
| `error: "window-covered"` | `browser_screenshot` | Chrome produced no picture, usually because its window is covered by other windows. Chrome is not raised for it any more; with `bring_to_front: true` (only after asking the user) it is raised and stays in front |
| `visibility`, `windowFocused: null` | `browser_switch_tab` | Chrome is not brought in front of the user any more (`windowFocused: null`); the tab is still made active in its window, and `visibility` says whether the page is hidden. `bring_to_front: true` also brings the window forward, and is only for after asking the user |
| `shortcut` | `browser_press_key` | The editing command sent with a ctrl or meta key: `selectAll`, `copy`, `cut`, `paste`, `undo` or `redo`. `landed` says the page got the key, not what the command did (#68) |
| `error: "no-rows"` | `browser_extract_list` | The selector matched no rows with text. Before, the answer was `count: 0` with `reached_end: true` |
| `scroll_method`, `note` | `browser_extract_list` | Whether the list was scrolled with wheel events or a script, and why; in a hidden page, why `reached_end` is false (#11) |
| `eget_vindue: false`, `advarsel` | `browser_navigate` with `eget_vindue` | The tab did not end up in its own window; `windowId` is the tab's real window |
| a viewport note next to the image | `browser_screenshot` | The CSS viewport and devicePixelRatio for `browser_click_xy`, when Chrome reports them in time (#55) |
| `worked` | `browser_provide_feedback` | The route that did work in the end |
| `extension_connections`, verdict `conflict` | `browser_provide_feedback` | Several open connections from the same extension, for instance one per Chrome profile (#58) |

**Clicks.** A text selector looks inside an open modal dialog first (also inside open shadow roots; of
several, the one on top where they overlap), so `click text=Add` presses the dialog's button, not the page's behind it. The
debugger path and the script fallback find their target with the same function. A covered answer found before the
press moves no mouse; its note says what lies over the target and, when an earlier mouse action may have opened it (a tooltip
or a menu), to move the mouse away with `browser_hover` and try again. The mouse events are bound to the target that was
found: each one at the click point is judged on the element that gets it, and only that very event reaching the target
counts as proof (for a field clicked through its label, the field's own click, only when the label's click was not
cancelled, and once; around the target, only its own control frame (a button, link or summary, or an element with a button, link, menu item, option, tab, checkbox, radio or switch role), not a container that listens for its children, and for a field, a button or any custom element (a tag name with a hyphen, as every form-associated custom field has) as the
target, not even its own box: only an event that reaches the target itself, so a custom icon whose click only reaches the button around it is `maybe_landed`); a click stopped on the way, a target the page replaces during
the click, a dialog that holds the page while the click is read, or no event at all gives `maybe_landed`, not a yes. A real mouse at the same point at the
same time cannot be told apart from the tool's. A label whose center lies on interactive content inside it (as the HTML standard defines it: a link with an
address, a button, a field), or on anything else clickable in it (a link without an address, an element with a button role or an
`onclick`, whose own handler can cancel the click unseen), counts as covered by that element, because a click there does not
activate the label's field, or may not; anything inside the label's
field is the field's own, and so is an element around it that is not itself an action (or is a box with a checkbox,
switch or radio role), and a box with such a role right next to the label's field when the field itself is hidden (a 1x1 or
non-displayed stand-in input, as Base UI and sr-only patterns draw it) and it is the only such box in the nearest label around it, which must be that field's (a box inside a closed shadow root cannot be seen, so it is not counted); next to
a visible field, further from a hidden one, with a second such box in that label, or with no label of that field around it, such a box is another control. That is a rule about the page's structure, not
proof of ownership: a separate control with such a role that is the only one in its label and sits right next to a hidden
field counts as that field's own. With a label that has a field as the target, only the field's own activation
click, counted when it reaches the field, counts as proof: a click on the label that a page listener cancels, or an
activation stopped on the way, is `maybe_landed`, not a yes; when the target lies inside a label whose field is outside
the target (text in a label), that label's activation click to its field is let through and not counted as proof, as
a mouse would send it;
for any other target that takes clicks itself, anything clickable inside it at its center (a link, a button, an element
with a button role or an `onclick`, such as a delete button on a card) counts as covered by that control; for a passive
container (a list item, a card that is not a button) its own link (an `a` with a real address, without a button role or
`onclick`) is its action, and only a button or other action inside it counts, also one around a link however many link
layers lie between, also across an open shadow root and through a slot. An element with a link role that is not an `a`, an `a` with a role
other than link, and an `a` without a real address are actions, not plain links, since a script handler on them cannot be
seen; no real address means none, `#`, `javascript:` (read as the browser reads it, so a tab or line break inside does not
hide it) or a fragment whose target is not on the page, such as `#!` or `#0`, or is the link itself or something around
it; the target is looked up as HTML does (the fragment as written, then percent-decoded, then `top`). The address is
resolved as the browser resolves it, so a link to the same page that differs only in its fragment (`/orders#!`) counts
as a fragment, and a hash route with a path (`#/orders/7`, `#!/orders/7`; not `#/` alone) is a real address. A link that is only a fragment (`#!`)
is read against the page itself, also when `<base>` points elsewhere: such links are placeholders in practice, so this is
a deliberate refusal (a real mouse would load the base page). A web component's own button - a control in its own
shadow root whose box (the rectangle around it) covers at least 90% of the component, button or link, as `ion-button` and `sl-button` draw it - is the
component's action, not a control inside it, and so is an action around it that also covers 90% of the component; a
smaller button inside a component (a delete on a card component), a smaller action around that control, or interactive
content in a checkbox component's own label (a link, a field, a video, but not the box itself), is. A delete
link with a real address (rails-ujs `data-method`), with a fragment whose target is elsewhere on the page, or with
`#top`, cannot be told from a plain link. A field or
other control whose center lies on a button around it is covered by that button: the click would go to the button, and
whether the button changes the field cannot be told. A text selector picks a clickable child only when the text is in it,
so `text=Ordre 7` on a card no longer picks the card's first button (1.30.1 did, and a delete ran); a text next to an
icon button with no text of its own now clicks the row, not the button. A text selector still picks the innermost element
whose text contains it, so on a card whose delete button reads "Slet Ordre 7", `text=Ordre 7` picks that button. Hover and right-click do not click a control inside the target, so for them only something in front
of it is cover; enter events on the target's ancestors are part of the hover. Inside a closed shadow root the guard
cannot see which control gets the click. If the guard cannot be set up in the page, no press or click is sent and the answer says
so (1.30.1 clicked without it). `browser_select_option` goes on to the option only when the trigger's press is
shown to have reached the trigger, or its click landed; otherwise, and when the trigger's click opens a dialog, no option is
clicked, and the answer says so.
A target that had to be scrolled into view is measured again without scrolling, 100 ms apart, until two measurements
agree (at most three times; pushed out of view meanwhile, it is scrolled into view again), so a header that turns fixed on scroll does not move the click to another row. A press that lands in an iframe -
the target itself, or one inside it such as a payment frame in a wrapper - goes into the frame, where the page around it
cannot see it: the answer is `landed: null` with `maybe_landed: true` and a note to check the frame, and no synthetic
click follows; a frame that came in front of the target is `covered`, also with `maybe_landed`. 1.30.1 answered
`ok: false` and sent a second, synthetic click, after the button inside the frame had already been pressed.

**`browser_ask_user`** fails at once, and shows nothing, on Chrome's error page or about:blank, instead of
activating the tab, posting a notification and failing with Chrome's own text. The notification of a
question that ends is cleared once it exists. The prompt is drawn in the extension's isolated world in a
closed shadow root, a prompt without fields is a card the user can drag aside, and a prompt with fields
is bound to the page's origin (or a local file's path) (#61, #62).

**`browser_extract_list`** scrolls with real wheel events in the active tab, also at the bottom, so a
feed that loads on wheel loads (#11). A hidden page (a background tab) gets no scroll events,
IntersectionObserver callbacks or animation frames, so a list that loads or renders while you scroll stops at
what is already there; then `reached_end` is false and `note` says why. `reached_end` is true only when the
list stood at its bottom in a visible page with no new rows, growth or movement for `stable_rounds` rounds in
a row.

**`browser_fetch`** can reach HTTPS addresses (the extension's own content security policy blocked every
outside address, also in 1.30.1). It sends no browser cookies and stores none from the answer, also not
to 127.0.0.1, where 1.30.1 did: pass a token in headers.

**From the reports in #67-#70.** `browser_drop_file` no longer hands the file to the first file input anywhere on the
page when there is none at the target: it uses the target if it is a file input or a file input inside it, and otherwise
clicks the target and fills the file chooser that opens, so an
"Add photo" button that makes its own field gets the file, not a field that belongs to something else. The file chooser path is
judged by the field afterwards, like the other paths, instead of answering yes on Chrome's receipt (#67).
`browser_press_key` with ctrl, meta or alt types no character, sends the key code for letters and digits, and sends
select all, copy, cut, paste, undo and redo as Chrome's own editing commands (with shift, only z: redo). Before, Ctrl+A typed "a" on Windows, did
nothing on macOS, and answered `landed: true` (#68). `browser_handle_dialog` on a tab behind a dialog that is
already open answers `tab-not-responding`, with what can be done, instead of a bare CDP timeout, and a mouse or key timeout
also names an open dialog as a possible cause. `browser_navigate` itself still waits and reports the old address, without an error, when the page
asks "Leave site?", and the prompt stays open, so the tab does not respond until the user answers it in Chrome;
answering that prompt comes in a later version (#69, in part). A text selector prefers a visible clickable match to a hidden copy; `browser_fill` reads a
contenteditable as lines, so multi-line text that landed is no longer reported as `differs`; and `browser_screenshot`
judges a path by the operating system's own canonical path, so a different letter case, a Windows short name such as
`RUNNER~1`, or macOS's `/var` for `/private/var` no longer counts as outside the working directory (#70). `browser_switch_tab` and `browser_screenshot` no longer pull
Chrome in front of the user: `browser_switch_tab` brought the window forward on every call, and a screenshot of a covered window raised
Chrome and left it there, so agents that switched tabs often kept taking the screen. Both now stay put unless the agent
passes `bring_to_front: true`, which the tool texts say is only for after asking the user. Input that may need Chrome in front
(key presses, hover, coordinate clicks) can then answer that it did not land, as before, and the switch_tab answer says to ask;
`browser_extract_list` on a hidden page and the server's instructions to agents say the same, so an agent is not sent round
in a loop. The
server's instructions to agents also no longer say that `browser_drop_file` falls back to the first file input on the page.

**Several Chrome profiles.** With the extension enabled in more than one profile, the next tool answer
(also an error answer) and stderr say how many connections are open and that the server cannot tell which
profile it drives (#58). When the connection the server was driving closes and another takes over, the next
answer says so. Routing to a chosen profile is not in this release.

**`eget_vindue` keeps its tab in its own window.** Before, the tab was moved back into the session's
first window, and the answer still reported the new one. **Corrected:** the 1.30.1 notes say Chrome
"often refuses" focus, and the 19 September measurement said a window without focus gets no input.
Both read that answer, so they probably measured a background tab. Whether a window without focus gets
input in desktop Chrome is unmeasured.

**Also:** `browser_fill` skips Backspace in a field known to be empty (#54); `browser_navigate` with
`new_tab` uses the session's empty placeholder tab (#57), and a new session's first `browser_navigate` opens its tab
with the address directly, so an empty about:blank no longer opens first; `click_grid` takes `grid` (3 or 4); agent-facing
answers that were still in Danish are English (#43); a call over a connection that dies is rejected at
once (#45); `browser_extract_token` answers `Unknown provider` also for a name like `constructor`, and a
tool name like that is an unknown tool; the response-time check ignores bot pull requests.

## 1.30.1 (2026-10-07)

**Pairing is withdrawn, and a new install could get a bridge that never connected. This release
is those two, and the faults found on the way.**

**Pairing (1.30.0) is taken back.** 1.30.0 shipped an optional pairing key so one Chrome profile
takes commands from one server. It did not work - and when we fixed that, a review measured that
it still kept nobody out:

- The extension sent its key in the handshake to any server listening on a port in its range, and
  accepted the same key back as proof. A program on your machine could pair itself by repeating it.
- With only one profile paired, that profile could lock onto the other profile's server and refuse
  every call it made.
- The 1.30.0 extension could never read its own key (an offscreen document only has
  `chrome.runtime`), so setting `BROWSER_MCP_TOKEN` - as the popup told you to - locked you out.

A safety feature that keeps nobody out is worse than none. It is gone from the popup, the extension
sends and requires no key (also not one 1.30.0 stored), and the server ignores `BROWSER_MCP_TOKEN`
and says so when it starts. It will come back redesigned. **The bridge is local and
unauthenticated:** any program running as you on the same machine can connect to it, as before 1.30.0.

Kept from that work, because it holds on its own: a connection can no longer answer a command it
was never sent. Replies were matched on the command id alone, and ids count from 1, so any socket
could guess one and return a forged result. Each pending command is now bound to the connection
it went to.

**A new install could get a half-dead bridge, "Not connected" for good.** Three callers could
build the bridge at the same time, and on a fresh install the install event closed it while
another caller was still building it. The bridge then existed, reported the right ports, and
every call to the server hung. It hit exactly the person installing today; existing installs
never saw it. The bridge is now built one at a time, and a fresh install no longer closes it.
"Reconnect" and extension updates close and rebuild it in the same queue, so they cannot close a
bridge halfway through loading. Known limit: if Chrome ever leaves a build hanging, both the
heartbeat and "Reconnect" wait behind it, and recovery is not guaranteed - an attached debugger
keeps the extension's background worker alive. Reloading the extension in chrome://extensions
clears it.

**Four characters could stop the server.** The text `null` is valid JSON; the next line read
`msg.type`, and the process died. Any program on the machine could send it without saying hello.
Only objects are treated as messages now, on both sides of the bridge.

**One hanging probe could stop the extension finding servers until Chrome restarted.** The
scan lock was released in `finally`, which never runs if a probe never settles - and Chrome can
freeze an offscreen document mid-probe. The lock is now released after 15 seconds (counted from
when the document runs again, if Chrome froze it), and a port with a call still in the air is not
probed again, so the valve cannot stack connections until Chrome's per-host limit is used up. Known
limit: a port whose old call never settles stays skipped until that call ends.

**`eget_vindue` can place its window.** `vindue_x`, `vindue_y`, `vindue_bredde` and
`vindue_hoejde` position the new window, and `fokuser` asks Chrome to give it focus. Chrome often
refuses. When it does give focus, it is exclusive: whatever the person types goes to that window,
even on another display - use it only on a machine nobody is typing on. A position that is not a
number now refuses to open the window instead of letting Chrome put it in front of you (text such
as `"-1920"` is read as a number), and focus without a position warns.

**`eget_vindue` reported what it was asked for.** It answered `fokuseret: true` when Chrome had
refused focus, and gave back the coordinates we requested rather than where the window landed.
It is the one feature whose job is to keep a test run off the user's screen, so the echo read as
permission to continue. The reply now carries the measured position, what was asked for, whether
they match, and a warning when they do not.

**Also:** a controlled `<select>` goes through the prototype's value setter, as five other paths
in the same file already did. See the retraction on /learn/tools-that-lie - this was a
precaution, not a fix for a bug we could reproduce in React.

**Node:** the package now asks for Node 20 or newer - the versions it is tested on (20, 22, 24).
It said 18, which was never tested.

**Credited:** @DorianChn moved the two select suites onto one shared page model (#28), so a
change to what the extension reads from the page lands in both tests instead of one.

## 1.30.0 (2026-09-20)

### The agent-facing answers are now in English

Every message, error code and response field that leaves this server was in Danish -
the language the project is written in. An agent reads them fine; the **person** on the
other end does not. Browser MCP is the browser tool that stops and asks you, so the
agent quotes those answers back to the user in Codex, Cursor or Cline. The first errors
a new user meets - "the port was opened N seconds ago and the extension has not
connected yet" - were the worst affected.

Nothing changed about behaviour, verdicts or honesty. Only the words.

**Renamed response fields.** If you branch on these, update:

| Before | Now |
|---|---|
| `maaske_landet` | `maybe_landed` |
| `vaerdi` | `value` |
| `faktisk` | `actual` |
| `forventet` | `expected` |
| `afviger` | `differs` |
| `uaendret` | `unchanged` |
| `uvist` | `unknown` |
| `uverificeret` | `unverified` |
| `ramme_hoerte_ikke` | `framework_did_not_hear` |
| `vedhaeftet` | `attached` |
| `navigerede` | `navigated` |
| `hjul_fejl` | `wheel_error` |
| `start_ukendt` | `start_unknown` |

**Renamed error codes.** `feltet-er-tomt` → `field-is-empty`, `feltet-viser-andet` →
`field-shows-other`, `feltet-fordoblet` → `field-doubled`, `feltet-toemt` →
`field-cleared`, `filen-blev-ikke-vedhaeftet` → `file-not-attached`,
`soegetekst-blev-ikke-leveret` → `search-text-not-delivered`, `tasten-blev-ikke-leveret`
→ `key-not-delivered`, `dobbeltklik-blev-ikke-leveret` → `double-click-not-delivered`,
`hoejreklik-blev-ikke-leveret` → `right-click-not-delivered`, `hover-blev-ikke-leveret`
→ `hover-not-delivered`, `klikket-aabnede-ikke-listen` → `click-did-not-open-list`,
`scroll-mislykkedes` → `scroll-failed`, `scroll-uvist` → `scroll-unknown`,
`domaene-ikke-i-sessionen` → `domain-not-in-session`, `domain-mangler` →
`domain-missing`, `cookie-lager-ukendt` → `cookie-store-unknown`.

`landed`, `fallbackFired` and `detached` are unchanged - they were already English.

### When the answer is honestly "this is not in a browser"

The server's instructions now tell the agent what to do when the thing being asked for
is not in a web page at all - a desktop application, an OS-level dialog, the native file
picker. No browser tool reaches those. If the agent also has desktop-level tools in the
session (an OS automation MCP server such as computer-mcp), that is the right tool for
that step.

The line says explicitly what it does *not* cover: a background tab, a React-controlled
field and a CAPTCHA are all solved by the browser tools themselves. Of the 26 walls
these tools answer with, exactly one family is genuinely outside the browser.

### Optional pairing: one Chrome profile, one server

> ⚠️ **Retracted on 21 September.** Both promises in this section were false in the shipped
> 1.30.0, and we found it by having two models read the code rather than by testing it.
> The extension could never read its own key: it looked in `chrome.storage`, and an offscreen
> document only has `chrome.runtime`, so the lookup threw, the error was swallowed, and the
> handshake went out empty. Anyone who followed the popup's own instruction was locked out for
> good. And the key kept nobody out either: it was only checked inside the `hello` branch, so a
> program that connected and never said hello skipped the check entirely and could be served
> tool calls. That is precisely the hole the feature was built to close.
>
> ⛔ **Withdrawn in 1.30.1.** A later review measured that even with both halves fixed, the key kept
> nobody out (it was sent to any server in the port range and accepted back as proof). Pairing is
> gone from the popup, the extension and the server; see 1.30.1.

Set `BROWSER_MCP_TOKEN` on the server and type the same key into the extension's popup,
and that profile only takes commands from that server - and ignores any other program
that connects to the local bridge. Leave it unset for the default: no key, no setup.

Specified by **roth-arasys** in #10, down to the opt-in shape and the zero-config default.
Two things ended up different from the request: the variable is `BROWSER_MCP_TOKEN` rather
than `AGENT360_TOKEN`, to match the two that already exist, and changing the key drops open
connections immediately instead of at the next browser restart. The pairing is also mutual -
the extension executes nothing until the server has acknowledged with the same key - which
covers the local-process case roth-arasys and I agreed an opt-in token would otherwise miss.

### Credited

**JADRT22** posted a minimal single-file React 18 form on #19 that isolated the case where the
DOM value is right and the framework has not heard it. That repro is what `framework_did_not_hear`
was built against, and it was missing from the 1.29.2 entry - an oversight, not a judgement.

### Fixed

- `browser_fill` promised a field it did not send. The server's instructions say "read
  `actual`" when `differs` is true; the common code path answered `value` and no
  `actual` at all. Both names are now on every answer.
- A timeout was recognised by matching the text of its own error message, in four
  places. Translating that message would have silently switched off `maybe_landed` and
  the warning against repeating blindly. The timeout now carries a flag.

## 1.29.2 (2026-09-18)

One class of bug, found an hour after 1.29.1 shipped: tools that answered yes because Chrome had **acknowledged** a command rather than because the page had **received** it. Every route that carries that mistake is closed here - every CDP command in the extension that acknowledges without promising delivery was swept, and there are exactly two. Every fix below was written test-first and checked with a mutation test, and the whole release was verified against a real Chrome: 52 checks, 40 of 40 tools, zero failures.

Two related failures are **not** closed, and are named rather than implied: `browser_fill` can set a value that a React-controlled field does not react to (the open half of #19), and `browser_execute_script` cannot run on a strict-CSP page when the debugger is also unavailable. Both are written down with the measurement attached.

**`browser_fill` now says so when the framework did not hear it.** The value still does not reach a React-controlled component - that half is open - but the tool no longer reports a bare success because the DOM shows the right text. React keeps a `_valueTracker` on the element and updates it when it has processed the change; if the tracker and the field disagree, the framework provably did not hear, and the answer carries `ramme_hoerte_ikke` with the remedy. An element without a tracker is not framework-controlled, and there the DOM value is the whole truth. This is a mechanism, not a name check: a library can be renamed in a production bundle, but two values out of step cannot hide.

**Nine tools answered yes because Chrome acknowledged the command, not because the page received it**

`browser_press_key` was the one that lied. In a tab you are not looking at, Chrome accepts `Input.dispatchKeyEvent` and returns without an error, but never delivers the key. The tool reported `ok:true` on a key that never arrived. Measured live against a known-true control: in a visible tab the Enter landed, in a background tab nothing landed and the answer was still yes. That is the exact bug class 1.29.1 was released to remove, and it was in the tool itself. Session tabs are created in the background, so it was the default state.

The mouse is different, and that is why it escaped: in a background tab mouse events *hang*, so the 1.5 second deadline made the answer honest by accident. Keys are acknowledged, and nothing caught them.

- `browser_press_key` now measures delivery. A one-shot listener is placed in the extension's own world before the key is sent, so the page can neither see nor remove it, and a page that stops event propagation cannot hide the delivery. Three answers instead of one: the key landed, it could not be read (`maaske_landet`), or nothing received it, with the remedy in the message. There is deliberately no script fallback: an event dispatched from a script is not trusted by the browser, so Enter would not submit a form and Space would not scroll. Half an Enter is worse than none.
- `browser_hover`, `browser_double_click` and `browser_right_click` returned `ok:true` unconditionally. They now measure whether `mouseover`, `dblclick` and `contextmenu` actually reached the page, and `double_clicked` is no longer claimed when it did not.
- `browser_fill` with a `text=` selector typed and returned success without reading the field. It now reads it back: an empty field is a failure, a different value says the page reformatted it.
- `browser_scroll` reported the numbers it was *asked* for. On a page that cannot scroll it claimed 600 pixels. It now reports the position the page is actually on, and says so when nothing moved.
- `browser_upload_file` and `browser_drop_file` were found by sweeping every CDP command in the extension that acknowledges without promising delivery. Both returned `ok:true` the moment `DOM.setFileInputFiles` came back, without ever looking at the field. A path that does not exist, an `accept` filter that rejects the file type, or the page's own change handler clearing the field all leave an empty `FileList` behind a reported success. Both now read the field back and report the names actually attached, say so when the field took fewer files than were sent, and fail with the reason when it is empty.
- `browser_fill` with an ordinary CSS selector - the most used path of the most used tool - never looked at the field at all. It types with `Input.insertText`, reads the field once to decide whether to fall back, and when the fallback types the value character by character with `Input.dispatchKeyEvent` it stops there. If those keys are not delivered either, nothing throws and the caller is told the field was filled. Both branches of `fill` now share one verdict: the value that is actually in the field, an empty field is a failure with the reason, a different value says the page reformatted it, and an unreadable field says so instead of guessing.
- `browser_set_combobox` answered `ok:true` for an empty list of values, having touched nothing. The guard tested `!params.values`, and an empty array is not falsy.
- `browser_set_combobox` threw away the one measurement it already had. The route to a dropdown starts with a click that opens it, and `debuggerClick` already reports whether that click reached the page - the same rule `click`, `click_xy` and `select_option` share. If it did not, the search text went into whatever field had focus, and three seconds later the answer blamed the site for having no options. A measured no now says so; an unknown still goes the long way.
- `browser_set_combobox` also blamed the page for something it was never asked. When the dropdown never appeared it answered `no-options-rendered`, but the route there runs through two commands that are acknowledged without being delivered. It now reads the field after sending the query: if a real input is still empty, the search text never arrived, and the answer says that instead of pointing at the site.
- The proof apparatus had a false *yes* of its own, and it was the worst one here. A frame that reports "my marker is gone" was read as "the page navigated, so the event landed" - but a frame that never *had* the marker answers exactly the same, and frames appear constantly: ads, tag managers, reCAPTCHA, embedded video. One ad iframe loading between the arming and the reading turned "nothing landed" into `landed:true` for hover, double-click, right-click and press_key. Only the main frame losing its marker is a navigation now; a sub-frame's is noise and counts for nothing.
- `browser_click` had one branch left over from before the class was closed. When Chrome refuses the debugger entirely, the tool falls back to a script click - and that branch returned a bare `ok:true`, with the comment "same answer as 1.29.0". Measured against the Stripe dashboard on 17 September: after an hour of `Debugger attach failed ... ghost`, "Create key" was reported clicked and the page had not changed. The neighbouring branch eight lines below already demanded proof. It now gives the same third answer the rest of the class gives: the click was sent, the effect is unverified. Deliberately not a failure - a menu that opens on mousedown looks like "no effect", and reporting that as failed makes the agent click again and close it.
- `browser_select_option` judged a native `<select>` on a fingerprint of the page: the option count plus the **length** of its text. Hronom, who maintains a competing project, ran our own Chrome stub against a synthetic page and published fifteen observations on #19. Two of them are wrong answers, and they point in opposite directions: an unrelated status going `9` to `10` changes the length, so a rejected selection was reported as landed; and an accepted selection whose label changes `Alfa` to `Beta` keeps the same length, so it was reported as rolled back. The fingerprint is now a hash, which closes the second. The first cannot be closed by any fingerprint - an unrelated change still looks like a reaction - so that branch now gives the third answer the rest of this class gives: the selection was sent, the page moved, and the movement does not prove it was the selection. Exactly what he asked for: a distinct unverified outcome that does not trigger blind replay. Found by Hronom.
- The tool description for `browser_select_option` promised that "it never reports success without the field actually changing". The code deliberately does report success in that case, because a controlled component that resets its own field and stores the choice elsewhere is working correctly. The description now says what the code does.
- A raw NUL byte sat inside `extension/background.js`. It changed nothing at runtime, but it made `grep` answer "no matches" on the largest source file in the project, silently and with a failure exit code. Every grep-based audit of that file, ours included, had been getting empty answers. It is the same character, written as an escape sequence.
- `browser_hover` reported "not delivered" for a perfectly ordinary sequence. Blink fires `mouseover` only when the element under the cursor *changes*, so hovering something you just clicked, or hovering twice, produces only `mousemove` - and the proof was listening for `mouseover` alone. This one has a history worth recording: it was raised as a guess on 13 September by a reviewer who could not measure it, so it was not fixed. Instead the guess was written into the release gate as a check. The first real run of that gate, on 18 September, failed exactly there. The proof now listens for both.
- Two fixes point the other way, at false *failures*. A tool that wrongly reports "not delivered" makes the agent repeat the action, and an Enter that already submitted a form submits it twice. The proof now counts how many frames were armed and only reports a definite no when that many answer; fewer means unknown. And the key proof no longer judges on the *last* key seen, so a person typing in the same tab can no longer turn a delivered keystroke into a reported failure.

**Release process**
- The check that downloads the published package gave npm 45 seconds. npm itself says a publish "may take a few minutes to become available", and that killed a release that had in fact succeeded: it stopped before the MCP registry with npm and GitHub already out. Now six attempts over three minutes.
- One test changed colour with the speed of the machine it ran on, and failed on the fast ones. The Windows job had never been able to run at all.
- The flow gate swallowed its own tab switches. If one failed, every mouse and keyboard step ran in a background tab and the honest "not delivered" answers looked like a regression in the tools. A failed switch now marks the whole run invalid rather than letting it read as a result.
- `npx @agent360/browser-mcp --version` printed the help text. It is the first command someone runs when reporting a bug.
- `gemini-extension.json` is in the repo, so the Gemini CLI gallery can pick the server up. It carries a version and a tool count, so it is swept by the same two passes that keep every other file honest, and a test compares both against the source.

## 1.29.1 (2026-09-13)

Every code change below was written test-first and checked with a mutation test: the fix is removed on purpose, and the test must turn red. The dependency bump, the re-rendered video and GIF, and the wording changes in the READMEs and on the site are not covered by tests - they were checked by hand.

**Which half carries which fix.** This project is two pieces: a Chrome extension and an MCP server published on npm, and a fix only reaches you when the half that carries it is updated.

- **In the npm server**, so `npm update` is enough: the path containment for `browser_upload_file` and `browser_drop_file` (an agent could reach any file on disk before), the corrected agent instructions, `browser_provide_feedback`, and what `npx @agent360/browser-mcp install` registers. (`install.sh` is a repo file, not part of the package - it reaches you by pulling the repo.)
- **In the Chrome extension**, so the extension itself has to be updated: the action log, the cookie rules, tab adoption, and the tools that used to report success without it. For a Chrome Web Store install that happens after Google approves the new version, usually 1-3 days. The npm package refreshes the copy of the extension it ships, so an unpacked install can reload it straight away.
- **The wording fixes land in three places, and not at the same time.** The README you read on npmjs.com changes when the package is published. The extension popup changes when the extension updates, so a store user keeps seeing the old text until Google approves this version. Everything on browsermcp.dev changes the moment the site is pushed.

**Known limitation: working in a tab you are not looking at**

In a tab you are not looking at, the agent can navigate, read, screenshot, run scripts, click and fill a field it finds by CSS selector. Chrome does not deliver mouse and keyboard events to a tab that is not the visible one in its window, so key presses, hover, double-click, right-click, coordinate clicks, combobox typing and filling a field found by its text fail with an error that says so, and the agent will then call `browser_switch_tab`, which brings that tab and its window in front of you. This is not new in 1.29.1, and it is less bad than before: `click` now falls back to a script and works in the background, and the failures that remain say why instead of hanging for 30 seconds. Fully hands-off background work is the goal for 1.30. Parts of it cannot be solved at all: CSS `:hover` is a state the renderer owns, a script-dispatched event is never `isTrusted`, `elementFromPoint` stops at a cross-origin iframe, and a real double-click's text selection is browser behaviour rather than an event.

**Privacy and security**
- The extension's action log stored the first 200 characters of every tool call's parameters in Chrome's local storage, including values typed with `browser_fill` (passwords) and cookie values. The log now keeps only time, tool name, session and the session's own label and colour - nothing the agent typed or read. Entries saved by older versions are removed when the extension updates, and every new write removes them too, so a tool call that happens during the update cannot write them back. Measured honestly: removing them from the log does not scrub Chrome's own storage file on disk - the old bytes can still sit in it until Chrome rewrites that file. If that matters to you, remove the extension in Chrome and install it again: that deletes the storage file itself.
- Several pages and READMEs promised that "nothing leaves your machine". What the agent reads goes to your own AI client and its model provider. The text now says what is true: it runs on your machine, and nothing is sent to Agent360.
- `browser_get_cookies` without a `domain` returned every cookie in your Chrome profile, including httpOnly session cookies the page's own JavaScript cannot see. The tool's schema always asked for a `domain`, but the extension never checked: a client that left it out got everything. The extension now refuses the call without one, and returns only cookies for the http(s) pages the session itself has open.
- `browser_upload_file` and `browser_drop_file` accepted any path on disk, so an agent could upload `~/.ssh/id_rsa`. Paths are now resolved (symlinks, `~`, `..`) and must stay inside the working directory the client started the server in.
- The agent could adopt a tab you opened yourself: a new tab with no opener in the session was treated as the agent's, which made its content readable through screenshots and page text. A tab now has to come from one of the session's own tabs.
- The server's instructions told agents that it "auto-pulls the latest code from git". It updates through npm.
- `hono` (via the MCP SDK) moved from 4.13.3 to 4.13.7, which fixes one moderate advisory.

**Tools that said something happened when it did not, or the reverse**
- `browser_execute_script`: if the page navigated away while the script was still running, the script was run a second time through the debugger. It now answers `ok:false, maybe_ran:true` and does not run it again. When Chrome refuses the isolated-world injection before anything runs, the script still runs once in the page's main world.
- `browser_get_new_tab`: a popup opened by one of the session's own tabs was refused as "not-ours" if that tab had closed in the meantime.
- `browser_click`: a ripple effect added on mousedown hid that the click itself did nothing, so the React fallback was skipped and the answer was `landed:true`.
- `browser_click_xy` / `browser_click`: a click that changed text without changing its length (for example `AAAA` to `BBBB`) was reported as not landed.
- `browser_click` in a background tab: Chrome does not deliver mouse events to a tab that is not active, so the click timed out. It now falls back to a script click and answers `ok:true` only when the page visibly reacted to the click itself; otherwise `ok:false` with `maaske_landet:true` and a hint to switch to the tab. Timeouts on mouse and keyboard input say that the tab is probably in the background.
- `browser_fill`: correct formatting by the page (`1234.5` shown as `1.234,50 kr`) was reported as a failure. When the ordinary path cannot confirm the value, the field is now read before and after. If it changed to something else, the answer is `ok:true` with `afviger:true` and the actual value. If it shows the same before and after, the answer is `ok:true` with `afviger:true, uaendret:true`, because a value that was already there and a refused value look the same. Only a field that should have been emptied but was not gives `ok:false`.
- `browser_screenshot`: a standard capture that hung and then disconnected was retried until after the server's 30-second limit. The capture now has one time budget, the `fromSurface:false` fallback is tried in time, and a slow standard capture still wins if it answers first. If both hang - which is what a fully covered window looks like - the window is raised once as a last resort inside that budget, the way 1.29.0 did, and your previous window is put back in front.
- `browser_wait_for_network`: a response body that was slow to arrive could push the tool past the server's 30-second limit. The body now gets at least the 8 seconds it had in 1.29.0 and otherwise only the time left in the tool's budget; if it does not arrive, the answer is `body:null`.
- `browser_scroll`: a scroll whose movement could not be seen is no longer reported as a failure - the answer is `ok:true` with `uvist` and the measured position. A scroll that could not be sent at all is still `ok:false`. When the mouse wheel timed out and the fallback scrolled a page with smooth scrolling, the position was read before the animation finished, and a scroll that worked was reported as "the bottom may have been reached". The position is now read again for up to a second, and a scroll that was actually sent is never reported as a failure: if the movement cannot be seen in that time, the answer says so (`uvist`) and includes the measured position.
- `browser_set_date`: a clock time could be read as the year (`02/01 20:26` accepted as 2020), and a correct date with a time zone (`02/01/2026 12:00 GMT`) was rejected.
- `browser_get_cookies`: a parent-domain cookie on another path (`Domain=.example.com; Path=/api`) was missing. Secure cookies are returned only for https pages and localhost, and an incognito tab whose cookie store cannot be identified reads nothing.
- `browser_upload_file`, `browser_drop_file` and the screenshot `path`: with the working directory `/`, every ordinary file was refused.
- `browser_set_cookies` could set a cookie on any domain, including sites the session had never opened, while `browser_get_cookies` was already limited to the session's own pages. Both now follow the same rule: the cookie's domain has to be a page the session has open, or a parent domain that page receives cookies from. The address Chrome is given is built from that page, so Chrome enforces its own domain rules, and a cookie set from an incognito tab goes to that tab's own cookie store - or nowhere, if Chrome does not tell us which store it is.
- The server's instructions now explain `maaske_landet`, `landed`, `afviger` and `uaendret`, so an agent does not repeat an action that may already have happened.
- `browser_provide_feedback` told users with an outdated extension to reload it, in the case where it knew which version they had. For a Chrome Web Store install reloading does nothing until Google approves the new version, so that advice now covers both cases and says the 1-3 day wait is expected.

**Install**
- `install.sh` (for people who clone the repo) told you to add the server to a config file Claude Code does not read, so it looked right and did nothing. It now runs the package's own install.
- The extension popup without a server showed only the Claude Code command. It now also shows Codex and points to `npx @agent360/browser-mcp install` for Cursor, VS Code and the rest.
- `npx @agent360/browser-mcp install` now also registers the server with Codex (`codex mcp add`), VS Code (`code --add-mcp`, when that version supports it) and Cursor (`~/.cursor/mcp.json`, keeping the servers already there). Clients that are not installed are left alone.

- The **Add to Cursor** and **Add to VS Code** buttons at the top of the README were images with nothing behind them. They pointed at `cursor://` and `vscode:mcp/`, and neither GitHub nor npmjs.com renders those schemes: both strip the link. They were added after 1.29.0 shipped, so the published page never carried them; this release would have been the first to. They now point at the https forms both vendors provide.
- "Restart your agent and the extension icon turns green" was wrong in sixteen places, and had been since 1.29.0 changed the server to take a port on first use rather than at startup. Worse, the icon never turns green at all: there is one icon and nothing changes its colour. What appears is a small green badge with the number of connected agents. The install pages, the site, the store text and the extension popup now say that, and the popup no longer tells a correctly installed user that no server was found.
- The port range is a setting, not a hard limit. The README now says how to run more than 20 chats at once, that the server and the extension both have to be told, and what each extra port costs your browser.

**Release process**
- The package check before publishing accepted a package that crashed on start. It now requires this server's answer to the MCP `initialize` handshake to declare a tools capability, requires the package to keep running shortly after, and runs the package with a temporary home folder so it cannot touch the real extension folder.
- A release that stopped after npm could not be resumed on the same version. It now resumes only when the version's git tag points at the code being released, and a new release refuses to start if a tag for that version already exists somewhere else - otherwise a second run could publish newer code while the tag still pointed at the old commit.
- The browser flow test required a cookie URL and upload files that the new guards reject, and it accepted an outdated or duplicate extension. It now requires exactly one connected extension whose version matches the server, and the extension sends a fingerprint of its own code files (`background.js` and `offscreen.js`) in the handshake, so the gate can see that Chrome is running the code being released - not another copy with the same version number. The fingerprint is a hash. It goes to the local server, and the server shows it in `browser_provide_feedback`, so your AI client sees it too.

- The check that downloads the published package and talks to it had no time limit. It is the last gate before the registry, and it runs after npm has already published, so a hung download would have stopped the release halfway with nothing to show for it. Each of the three attempts now has 90 seconds.

**Site and npm page**
- `llms-install.md` is published on browsermcp.dev (it returned 404).
- One row of the capability table was broken on the public page: the generator split table rows on `|` without understanding an escaped `\|`, so a measurement written as `11\|53\|...\|0` came out as nine cells in a three-column table, backslashes and all. It had been that way since 10 September. The site check now looks at table shape, which it did not before.
- The long dash is gone from everything we publish. It is the clearest machine fingerprint in written text, and it was in 102 files.
- The comparison with browsermcp.io on the website was updated with numbers re-pulled on 2026-09-11. The table in the README still carries its own date.
- The demo GIF on the npm page uses an absolute address.
- The picture shown whenever browsermcp.dev is shared said "34 tools" and named the wrong domain, and had done so since June - no text check can read a JPEG. It is now built from source (`demo-video-src`), together with a matching image for GitHub, and a test keeps the numbers in those sources equal to the number of tools in the server.
- The demo video and GIF were re-rendered from the current build. The old ones were from June, before the tool count and the wording changed; the GIF is smaller than before (1.8 MB against 2.1 MB); the MP4 grew from 2.8 MB to 3.4 MB.

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
