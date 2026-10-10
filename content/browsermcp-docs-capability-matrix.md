# What it can and can’t get past

**Short answer:** most of the walls that stop browser automation exist because the tool is a
stranger - a fresh browser with none of your sessions. Browser MCP is not a stranger, so those
walls are not there for it. The walls that remain are listed here too, including the ones we
have measured ourselves and not fixed yet.

This page is deliberately unflattering in places. A capability list that only says yes is a
brochure, and you cannot plan against a brochure.

## The exchange this page is about

```
You:     Buy the cheapest ticket on that page.

Claude:  [browser_click]
         [browser_solve_captcha]
         There is a CAPTCHA. The checkbox did not clear it on its own, so I am
         handing it to you: solve it in the tab and tell me when to carry on.

You:     done

Claude:  [browser_click]
         Booked.
```

That is a wall we clear *partly*, and the table below says so in the same words. The
point of the page is that "can it get past X" has three answers, not two - and the
third one is the agent saying what it cannot do instead of failing quietly.

## How to read the columns

| Mark | Means |
|---|---|
| **Measured** | We ran it against the released version and watched it work. Date in the note. |
| **Fixed in 1.29.1** | Broken in v1.29.0, fixed and tested, and shipped in v1.29.1. Update the extension and the npm package to get it. |
| **Works in 1.30.0** | Measured against the released v1.30.0. |
| **Fixed in 1.30.1** | Fixed, tested, and shipped in v1.30.1. |
| **By design** | The mechanism is there and reviewed, but we have no dated measurement. Treat as likely, not proven. |
| **Needs a switch** | The mechanism is there, but Chrome blocks it until you turn on a setting yourself. The row names the setting and what else it allows. |
| **Not yet** | We ran it and it did not work. Open, with the reason. |
| **Won't** | A deliberate non-goal. The reason is given, not hidden. |

## Walls that exist because the tool isn't you

| Wall | State | Note |
|---|---|---|
| Site requires a login | **Measured** | It is the Chrome you are already signed into. There is no login step to fail. |
| Session expires mid-task | **By design** | Same session as your own tab; it expires when yours does, not sooner. |
| One-time code sent to your email | **Measured** | `browser_navigate` with `new_tab: true` to your webmail (already signed in), `browser_get_page_content`, read it, switch back, type it in. |
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
| React / Vue controlled input that "resets itself" | **Fixed in 1.29.1** | In v1.29.0 `browser_fill` could append instead of replacing. Fixed 2026-09-08: it now reads the field back after clearing it. |
| Native `<select>` | **Measured** | `browser_select_option`, 9 ms, 2026-09-09. |
| A `<select>` inside a React controlled component | **Works in 1.30.0** | ⚠️ This row said **Open** for part of 2026-09-21, and that was wrong. We had measured ourselves against our own test page, which put a value setter and a `_valueTracker` on a `<select>` and called that "the same mechanism React uses". React does neither of those to a `<select>` - it installs a tracker on `input` and `textarea` only, and reads a select's value on the native `change` event. Measured against real React 18.3.1: the plain assignment 1.30.0 already makes does land, and `onChange` fires. So there was no React bug, and we published one about ourselves. |
| A `<select>` that really does put a value setter on the element | **Fixed in 1.30.1** | Some component could do what our test page did, and then a plain assignment is rolled back. The one-line change - go through the prototype's setter, as five other paths in the same file already did - handles it and costs nothing. We have not found a real library that does this to a `<select>`, so treat this row as a precaution, not a measurement. |
| A `<select>` whose framework stores the value elsewhere | **Fixed in 1.29.1** | In v1.29.0 the guard could call a working choice a rollback. Fixed 2026-09-08: it fingerprints the page and only reports a rollback when nothing else changed. |
| Custom combobox / autocomplete (div + listbox) | **By design** | `browser_set_combobox` types a prefix, waits for options, clicks the match. |
| **Custom dropdown that opens on a plain `click`** | **Fixed in 1.29.1** | In v1.29.0 the click fallback fired *two* click events, so anything that toggles opened and closed again. Measured 2026-09-10 in a real page: one click 11\|53\|…\|0 → 11\|69\|…\|1, two clicks unchanged. It now fires one, and judges success by whether the page changed. The tool itself has not been re-run live since. |
| Date picker | **By design** | `browser_set_date`. |
| File upload, including drag-and-drop targets | **Needs a switch** | `browser_upload_file`, `browser_drop_file`. Chrome only hands a file to the page when "Allow access to file URLs" is on for the Agent360 Browser MCP extension, and it is off by default for Chrome Web Store installs. The switch also lets the extension open any local file as a page, so turning it on is your call; otherwise attach the file yourself. From 1.30.2 a "Not allowed" error from the handoff is reported as `file-access-off`, with a note naming the switch, unless Chrome confirms that file access is on. |
| Cookie banner or modal in the way | **By design** | `browser_dismiss_overlays`, with a veto list so it never clicks something dangerous. |
| `alert` / `confirm` freezing the page | **Measured** | `browser_handle_dialog` arms the listener first; a frozen renderer is reported as frozen instead of hanging. |
| Content that only loads on scroll | **Fixed in 1.29.1** | In v1.29.0 pixel scrolling hit a 30-second timeout on every call, on every page. Fixed 2026-09-09/10: the fallback is now reachable, scrolls to a target position instead of adding a second scroll, and reports failure when it fails. |
| Page needs a real keystroke, not a synthetic one | **By design** | Debugger key events carry `isTrusted`. |
| Endless page, need the network to settle | **By design** | `browser_wait_for_network`. |

## Walls we clear partly, and say so

| Wall | State | Note |
|---|---|---|
| CAPTCHA | **Partly** | With `browser_solve_captcha` the agent can try the reCAPTCHA v2 checkbox (`click_checkbox`), take its own screenshot and click the grid cells it chooses (`click_grid`), or ask you with `browser_ask_user`. Each step is one call, and none of them follows another by itself. There is no success-rate claim on this page on purpose: we have not measured one, and a number we cannot show the working for is worth nothing. |
| Anti-automation sites that detach the debugger | **Partly** | The CDP layer re-attaches and retries DOM reads. Since 1.29.1, script evaluations are no longer retried automatically, because some of them click. That includes your own code in `browser_execute_script`: once sent, it is not retried. |

## Walls we will not cross

| Wall | Why not |
|---|---|
| Bot-detection systems (Cloudflare, DataDome, fingerprinting) | Browser MCP works because it **is** your browser, not because anything is being circumvented. That sentence is the whole product. Selling evasion would delete it, and it would be an arms race we would lose while promising otherwise. |
| Accounts that are not yours | The one-time code still lands in an inbox only you control. That boundary is not a technical one. |
| `chrome://` pages, the extension gallery, `data:` URLs | Chrome forbids scripting them. Not a gap we can close; the tools say so explicitly rather than failing vaguely. |
| A second Chrome profile | Not supported today: with the extension enabled in more than one profile, every command goes to one of them, and the server cannot tell which. Since 1.30.2 it says so in the next tool answer and in `browser_provide_feedback`. Keep the extension enabled in one profile. Routing to a chosen profile is tracked as issue #58. |

## Frequently asked questions

**Does Browser MCP work on sites with a strict Content Security Policy?**
Partly. The Chrome Debugger API carries most of the work, but `browser_execute_script` cannot run on pages with a strict CSP when the debugger is also unavailable - both string-evaluation paths are blocked, one by the page and one by the extension's own policy. It is written down rather than hidden.

**Does it work headless, or in CI?**
No, and it never will. The extension drives a real Chrome on a real desktop. For CI, use Playwright MCP - that is what it was built for.

**What happens on a page it cannot handle?**
It says so. Since 1.29.2 the tools in this class answer one of three things: it landed, it did not land with the reason and the remedy, or it is unknown. They no longer report success because Chrome accepted the command.

## If you hit a wall that is not on this list

Ask your agent to call `browser_provide_feedback`. It checks your install first - an outdated
copy, or two Browser MCP extensions loaded at once, are both common and both look exactly like
bugs - and then hands you a pre-filled issue link for whatever is left.

That is not a courtesy line. This table is how the tool gets better: every row in the **Not yet**
column started as somebody hitting it, and the fastest of them were fixed the same day.
