# What Browser MCP can and cannot get past

**Short answer:** most of the walls that stop browser automation exist because the tool is a
stranger - a fresh browser with none of your sessions. Browser MCP is not a stranger, so those
walls are not there for it. The walls that remain are listed here too, including the ones we
have measured ourselves and not fixed yet.

This page is deliberately unflattering in places. A capability list that only says yes is a
brochure, and you cannot plan against a brochure.

## How to read the columns

| Mark | Means |
|---|---|
| **Measured** | We ran it and watched it work. Date in the note. |
| **By design** | The mechanism is there and reviewed, but we have no dated measurement. Treat as likely, not proven. |
| **Not yet** | We ran it and it did not work. Open, with the reason. |
| **Won't** | A deliberate non-goal. The reason is given, not hidden. |

## Walls that exist because the tool isn't you

| Wall | State | Note |
|---|---|---|
| Site requires a login | **Measured** | It is the Chrome you are already signed into. There is no login step to fail. |
| Session expires mid-task | **By design** | Same session as your own tab; it expires when yours does, not sooner. |
| One-time code sent to your email | **Measured** | `browser_navigate` to the webmail tab you are already in, `browser_get_page_content`, read it, type it back. |
| One-time code from an authenticator app | **By design** | `browser_ask_user` puts the question on the page in front of you. The agent never guesses it. |
| Password or payment step | **By design** | Same dialog. This is a checkpoint, not a limitation. |
| SSO / corporate identity provider | **By design** | Already signed in, same as any other session. |
| Content behind a subscription you pay for | **By design** | Your account, your session. |

## Walls in the page itself

| Wall | State | Note |
|---|---|---|
| Content Security Policy blocks injected script | **By design** | The debugger path does not go through `eval`, so CSP-strict pages (Google Cloud, Stripe, Angular Material) work where script injection is refused. |
| Content inside an iframe | **By design** | `browser_list_frames` and `browser_select_frame`. |
| Shadow DOM | **By design** | The click path resolves through shadow roots before dispatching. |
| React / Vue controlled input that "resets itself" | **Measured** | `browser_fill` uses the native value setter and reads the field back afterwards. Fixed 2026-09-08 after it was found appending instead of replacing. |
| Native `<select>` | **Measured** | `browser_select_option`, 9 ms, 2026-09-09. |
| A `<select>` whose framework stores the value elsewhere | **Measured** | Fixed 2026-09-08: the guard used to call a working choice a rollback. It now fingerprints the page and only reports a rollback when nothing else changed. |
| Custom combobox / autocomplete (div + listbox) | **By design** | `browser_set_combobox` types a prefix, waits for options, clicks the match. |
| **Custom dropdown that opens on a plain `click`** | **Not yet** | Measured 2026-09-09: `browser_click` on a div-based dropdown took 5.2 s, did not open the menu, and reported `landed: false`. The honesty half is fixed - the tool now answers `ok: false` instead of claiming success. Why the click does not land is open. |
| Date picker | **By design** | `browser_set_date`. |
| File upload, including drag-and-drop targets | **By design** | `browser_upload_file`, `browser_drop_file`. |
| Cookie banner or modal in the way | **By design** | `browser_dismiss_overlays`, with a veto list so it never clicks something dangerous. |
| `alert` / `confirm` freezing the page | **Measured** | `browser_handle_dialog` arms the listener first; a frozen renderer is reported as frozen instead of hanging. |
| Content that only loads on scroll | **Measured** | Fixed 2026-09-09: pixel scrolling hit a 30-second timeout on every call, on every page, because the wheel dispatch never resolved and the fallback sat in a `catch` where a hang could not reach it. |
| Page needs a real keystroke, not a synthetic one | **By design** | Debugger key events carry `isTrusted`. |
| Endless page, need the network to settle | **By design** | `browser_wait_for_network`. |

## Walls we clear partly, and say so

| Wall | State | Note |
|---|---|---|
| CAPTCHA | **Partly** | `browser_solve_captcha` tries the checkbox first (often enough when you are signed into Google), then hands the model a screenshot to look at, then asks you. There is no success-rate claim on this page on purpose: we have not measured one, and a number we cannot show the working for is worth nothing. |
| Anti-automation sites that detach the debugger | **Partly** | The CDP layer re-attaches and retries reads. Side-effectful calls are never retried blindly - a repeated keystroke is worse than a failed one. |

## Walls we will not cross

| Wall | Why not |
|---|---|
| Bot-detection systems (Cloudflare, DataDome, fingerprinting) | Browser MCP works because it **is** your browser, not because anything is being circumvented. That sentence is the whole product. Selling evasion would delete it, and it would be an arms race we would lose while promising otherwise. |
| Accounts that are not yours | The one-time code still lands in an inbox only you control. That boundary is not a technical one. |
| `chrome://` pages, the extension gallery, `data:` URLs | Chrome forbids scripting them. Not a gap we can close; the tools say so explicitly rather than failing vaguely. |
| A second Chrome profile | Not supported today. It is a real request, tracked as issue #10. |

## If you hit a wall that is not on this list

Ask your agent to call `browser_provide_feedback`. It checks your install first - an outdated
copy, or two Browser MCP extensions loaded at once, are both common and both look exactly like
bugs - and then hands you a pre-filled issue link for whatever is left.

That is not a courtesy line. This table is how the tool gets better: every row in the **Not yet**
column started as somebody hitting it, and the fastest of them were fixed the same day.
