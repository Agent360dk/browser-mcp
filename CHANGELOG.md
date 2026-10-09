# Changelog

Browser MCP by Agent360 (`@agent360/browser-mcp` on npm, "Agent360 Browser MCP" in the Chrome Web Store).
Dates are when the version was published on GitHub. The full notes for each release are on the [releases page](https://github.com/Agent360dk/browser-mcp/releases).


## 1.30.2 (not released yet)

**Tool texts that match the code, clicks that say when they could not land, and the pull requests from
John H.**

**New answers an agent can see:**

| Answer | Where | Means |
|---|---|---|
| `error: "covered"`, `covered_by` | `browser_click`, `browser_double_click`, `browser_right_click`, `browser_hover`, `browser_fill` with a text selector, a custom dropdown's trigger or option in `browser_select_option` (for the option with `trigger_clicked: true`: the list may still be open) | The mouse would not reach the target at its center: an element lies in front of it, the target does not take clicks there, or (for click, double-click, fill and select_option) a different control inside it would get the click; `covered_by.outside` when the center is outside the visible page. Found before the mouse is sent, nothing is sent. When the cover appears after the target was found, the remaining presses and clicks are stopped at the window, before any element of the page gets them (the element in front may still see the mouse move over it, and a release the page moves elsewhere is let through); because a listener on the window itself still gets them, and the first ones may already have reached the target, the answer is then `landed: null` with `maybe_landed: true`. A release that the page moves elsewhere after the press reached the target (a menu that opens on the press, a slider that captures the pointer) is let through, and the answer is at most `maybe_landed`. Before, `browser_click` answered `ok: true` when the click hit an overlay |
| `error: "field-is-readonly"`, `error: "field-is-disabled"` | `browser_fill` | A disabled field is named before typing; a read-only one only when the text did not land, because some fields are read-only until they get focus (#56) |
| `action`: `tab_closed`, `replaced`, `navigated`, `removed_by_page` | `browser_ask_user` | How a question ended other than with an answer or a timeout (#62) |
| `error: "file-access-off"`, `file_access` | `browser_upload_file`, `browser_drop_file` | Chrome answered "Not allowed" for the file, and the switch "Allow access to file URLs" is off (`file_access: false`) or Chrome could not tell (`file_access: null`, and the note calls the switch the usual cause). If Chrome says the switch is on, Chrome's own error is kept |
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
cancelled, and once; around the target, only its own button or
link frame, not a container that listens for its children); a click stopped on the way, a target the page replaces during
the click, a dialog that holds the page while the click is read, or no event at all gives `maybe_landed`, not a yes. A real mouse at the same point at the
same time cannot be told apart from the tool's. A label whose center lies on interactive content inside it (as the HTML standard defines it: a link with an
address, a button, a field), or on anything else clickable in it (a link without an address, an element with a button role or an
`onclick`, whose own handler can cancel the click unseen), counts as covered by that element, because a click there does not
activate the label's field, or may not; anything that holds the
label's field or lies inside it is the field's own, and so is a box with a checkbox, switch or radio role when the label's
field itself is hidden (a 1x1 stand-in input, as Base UI and sr-only patterns draw it); next to a visible field, such a box
is another control. With a label that has a field as the target, only the field's own activation
click, counted when it reaches the field, counts as proof: a click on the label that a page listener cancels, or an
activation stopped on the way, is `maybe_landed`, not a yes;
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
