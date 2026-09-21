// KILDE: alt paa denne side er maalt i vores eget repo mellem 13. og 18. september 2026 og staar i CHANGELOG.md for 1.29.1, 1.29.2 og 1.30.0, med commit pr. rettelse. De to eksterne fund er offentlige paa issue #19. Ingen tal uden en maaling bag.

# Nine tools that said yes when nothing had happened

*Suggested URL: `/learn/tools-that-lie` · Suggested title tag: "Nine Browser Tools That Reported Success Without Doing Anything" · Suggested meta description: "An agent tool that quietly reports success is worse than one that fails. Here is the whole class of bug we found in our own code, how each one was measured, and what the tools answer now." · Last verified: September 18, 2026*

---

**Short answer:** for months, nine of our tools answered `ok: true` because Chrome had **acknowledged** a command, not because the page had **received** it. In a tab you are not looking at, Chrome accepts a keystroke and silently drops it. The tool said the key was pressed. It was not. We found the whole class, closed it, and two of the remaining holes were found by people outside the project reading our code.

## The bug you cannot see

Here is the shape of it, measured in a real browser on 14 September:

```
browser_press_key("Enter")   →  { "ok": true, "key": "Enter" }
page's own keydown listener  →  nothing. Not one event.
```

The page had a listener on `window` recording every key. It recorded none. The tool reported success anyway, and an agent building on that answer would go on to wait for a form submission that never came.

This is the worst kind of failure in an agent tool. A tool that errors makes the agent try something else. A tool that lies makes the agent build on sand, and the damage shows up three steps later somewhere unrelated.

## The three answers, as an exchange

```
You:     Click the Save button.

Claude:  [browser_click]
         The click was sent, but nothing in the page received it. The tab is in
         the background, where Chrome does not deliver mouse input - call
         browser_switch_tab and I'll try again.

You:     do it

Claude:  [browser_switch_tab, browser_click]
         Saved.
```

The first answer is the one this whole page is about. Before the work described below,
it was *"Clicked #save"* - and the agent went on to the next step as if the form had
been saved.

## Why it survived so long

The mouse and the keyboard fail differently, and the difference is the whole explanation.

In a background tab, mouse events **hang**. The command goes out and never comes back, so a 1.5 second deadline fires and the tool reports a timeout. That answer is honest - but it is honest **by accident**. Nothing measured anything; a deadline happened to fire.

Keys are **acknowledged**. Chrome accepts `Input.dispatchKeyEvent`, returns without an error, and never delivers it. There is no deadline to fire, nothing to catch, and the tool has no reason to doubt itself.

So the mouse tools looked fine in testing because an accident was covering for them, and `press_key` lied in the one state that is the default: session tabs are created in the background.

## The full list

Every one of these was measured, fixed test-first, and checked with a mutation test - the fix is removed on purpose and the test has to turn red.

| Tool | What it did | What it does now |
|---|---|---|
| `browser_press_key` | `ok: true` on a key that was never delivered | Places a listener in the extension's own world before the key is sent, and judges on delivery |
| `browser_hover` | `ok: true` unconditionally | Measures whether `mouseover` reached the page |
| `browser_double_click` | `ok: true`, and claimed `double_clicked` when nothing was | Measures `dblclick` |
| `browser_right_click` | `ok: true` unconditionally | Measures `contextmenu` |
| `browser_fill` (text selector) | Typed, then reported success without reading the field | Reads the field back |
| `browser_fill` (CSS selector) | The most used path of the most used tool read the field **zero times** | Both branches now share one verdict |
| `browser_scroll` | Reported the numbers it was *asked* for. On a page that cannot scroll it claimed 600 pixels | Reports the position the page is actually on |
| `browser_upload_file` | `ok: true` the moment Chrome acknowledged the file, without looking at the field | Reads back the names actually attached |
| `browser_drop_file` | Same | Same |
| `browser_select_option` | Judged a `<select>` on the option count plus the **length** of the page's text | Hashes the text, and says "unverified" where no fingerprint can decide |

## The three answers

The fix is not "return false more often". A tool that wrongly reports failure is expensive in its own way: the agent repeats the action, and an Enter that already submitted the form submits it twice.

So every tool in this class now answers one of three things:

- **It landed.** The page received the event. Proven, not assumed.
- **It did not land.** Nothing received it, with the reason and the remedy in the message - usually that the tab is in the background and you should call `browser_switch_tab` first.
- **Unknown.** The action was sent and the effect could not be read. The message says so, and says to check the page rather than repeat blindly.

That third answer is the one that took longest to accept. It looks like weakness in an API. It is the opposite: it is the only honest thing to return when you genuinely cannot tell, and it is what stops an agent from clicking a menu closed that it just opened.

## The proof apparatus had the same bug

The mechanism we built to catch these lies had a false yes of its own, and it is worth describing because it is so easy to write.

The proof works by planting a marker in the page, sending the event, then reading the marker back. If a frame comes back and says "my marker is gone", that used to be read as "the page navigated, so the event landed".

But a frame that never **had** the marker answers exactly the same way. And frames appear constantly: ads, tag managers, reCAPTCHA, embedded video. A hover holds the cursor for 500 milliseconds, which is plenty of time for an ad frame to load.

One ad iframe arriving between the arming and the reading turned "nothing landed" into `landed: true` for four tools. That was found by a reviewer reading the code, reproduced against the running build, and fixed the same day: only the main frame losing its marker counts as a navigation.

## Two of these were found by people outside the project

This is the part worth copying, whatever you are building.

**The select fingerprint.** A maintainer of a competing project read our code, ran our own test harness against a synthetic page - no Chrome, no React, nothing installed - and published fifteen observations. Two of them were wrong answers, pointing in opposite directions: an unrelated status counter going from `9` to `10` changed the text length, so a rejected selection was reported as landed; and an accepted selection whose label changed from `Alfa` to `Beta` kept the same length, so it was reported as rolled back. Both were real. Both are fixed. His five cases are now a test in this repo.

**The click fallback.** When Chrome refuses the debugger entirely, the tool falls back to a script click. That branch returned a bare `ok: true`, with a comment in the code saying "same answer as 1.29.0". Someone driving a real dashboard hit it: a "Create key" button reported clicked, on a page that had not changed.

Neither of those was found by us. Both were found by someone reading the code and measuring, and both landed in the release.

## What you can check yourself, without installing anything

`npm test` runs the extension's real code in a VM against a recorded Chrome stub. It proves what the extension sends, in what order, with what arguments, and how it judges the answers it gets back.

It does **not** prove what those expressions do in a real DOM - in that layer the test answers them rather than executing them. Four tools go further and run the generated expression against a hand-written document, and that is the pattern to copy. It is also how the outside finding above was reproduced: no browser, no framework, no install.

`npm run flow` is the layer that runs them for real, against an actual Chrome. It cannot run in CI, and that is a limitation we would rather state than hide.

If you want to prove us wrong about a tool, the second paragraph is the cheap way in.

## Frequently asked questions

**How do I tell whether an agent tool is lying to me?**
Ask what it measured. A tool that reports success because the command was accepted has measured the messenger, not the message. The cheap test: perform the action on a page whose own listener records events, then compare what the tool said with what the page saw.

**Why not just return false more often?**
Because a wrongly reported failure is expensive in its own way: the agent repeats the action, and an Enter that already submitted the form submits it twice. That is why the third answer - unknown - exists.

**Do other browser automation tools have this bug?**
We measured, on 19 September 2026, and the answer is no - not on any of the three cases we could put to all three identically. A controlled field, a controlled `<select>` and a file input, driven by each tool, with the page recording what it actually received. Nine measurements, no lies: Playwright MCP landed all three; Chrome DevTools MCP refused all three and said exactly why; we landed the field and the file, and honestly failed the select.

One of Chrome DevTools' refusals is worth separating out. Its file upload failed with *"Access denied: path"* - a containment guard, not a missing capability. We have the same guard, and it rejected our own first attempt. Playwright uploaded from that path without comment. Two of three restrict where a file may come from; that is a real difference, and it is not ours alone. The harness is in the repo at `test/aerlighed/` and you can run it yourself.

The uncomfortable line in that table is ours. On the controlled select - the exact case this whole release came from - Playwright landed the choice on 19 September and we did not. We answered honestly, which is better than the false yes we used to give, but honest and working are not the same thing.

**Update, 21 September.** We found the cause, and it does us no credit. One line set the value the way a controlled component is built to refuse: `sel.value = opt.value`. React, and the fixture in this measurement, put a setter on the *instance* that rolls a naive assignment back, so the component never heard anything. The prototype's setter goes around the instance and means the same thing. **Five other places in the same file already did it that way** - filling a field, clearing one, setting a date, typing into a combobox. `select_option` was the only one without the trick. We had written the fix five times and missed the one place an outside measurement found us.

It is fixed on `main`, with a test that models a controlled select and goes red if the line is put back. ⚠️ **What we have not done is re-run the three-way measurement**, so the table above still says what it said on 19 September. A unit test proving our own code is not the same claim as beating another tool on the same fixture, and this page is the wrong place to blur the two. The table changes when the measurement is re-run, not before.

The honest reading goes further than the table. This bug class comes from driving a browser a human is also using: Chrome acknowledges a keystroke for a tab you are not looking at and never delivers it. Playwright and Chrome DevTools run their own browser, which nobody else is using, so they do not have a tab that can fall into the background mid-task. **Our failure class followed from our architecture.** The nine lies we closed were problems our own design created, not problems we solved before anyone else.

That does not make the work worth less. It makes the claim about it smaller, and we would rather write that here than let you find it.

**What can I check without installing anything?**
`npm test` runs the extension's real code in a VM against a recorded Chrome stub, so you can prove what it sends and how it judges the answers. Four tools go further and run the generated expression against a hand-written document. That is the cheap way in if you want to prove us wrong.

## Two more, found after this page went up

Publishing the list did not end the class. Two more came out of our own code in the days after,
and both are about the *reporting* rather than the doing - which is the part this page is about.
They shipped fixed in 1.30.0 on 20 September.

**`browser_fill` promised a field it never sent.** The server's own instructions tell the agent:
when `differs` is true, read `actual` to see what the field really holds. The common code path
answered with `value` and no `actual` at all. So an agent following our documented advice, on the
exact answer where it matters most, read a field that was not there. The instruction was right and
the code did not keep it. Both names are on every answer now.

**The honesty mechanism was one translation away from switching itself off.** When a command times
out, the tool is supposed to answer `maybe_landed` - the third answer this whole page argues for -
and warn against repeating blindly. It recognised that timeout by matching the *text of its own
error message*, in four separate places. We translated every agent-facing string to English in the
same release. Had we shipped the translation without noticing, the timeout would have stopped being
recognised, `maybe_landed` would have quietly become a plain failure, and the agent would have been
told to retry an action that may already have gone through. The behaviour we are proudest of was
resting on a sentence in Danish. It now carries a flag.

That second one is the more uncomfortable of the two. The first was a tool lying about a page. The
second was our safeguard against lying, held together by something that was never meant to be load
bearing - and we found it because a translation forced us to read the code, not because a test
caught it. There is now a test that does.

## The honest remainder

This class is not finished, and saying otherwise would repeat the exact mistake this page is about. Two known holes, both measured, both public:

- `browser_fill` sets a value that a React-controlled field does not react to. The field shows the right text and the app behaves as if it were empty. This is the open half of [issue #19](https://github.com/Agent360dk/browser-mcp/issues/19), and the fix is a new tool that types character by character rather than inserting text.
- `browser_execute_script` cannot run on pages with a strict Content Security Policy when the debugger is also unavailable. Both string-evaluation paths are blocked, one by the page and one by the extension's own policy.

Both are written down in the repo's wishlist with the measurement attached. If either of them is in your way, that is the place to start.
