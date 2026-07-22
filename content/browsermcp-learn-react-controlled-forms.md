// KILDE: root-cause + fix er vores egen verificerede audit (per-tegn-typing vs Input.insertText · Ctrl+A vs Cmd+A på macOS · native value-setter + input/change-events til React controlled components). Fixet er brugt live af os selv flere gange 21-22/7 (Smithery-kodefelter, Cloudflare-settings, GSC/GA4). Ingen opdigtede tal.

# Why browser automation fails on React forms — and the fix that works

*Suggested URL: `/learn/browser-automation-react-forms` · Suggested title tag: "Why Browser Automation Fails on React Forms (And How to Fix It)" · Suggested meta description: "Your script sets the value, the field looks right, and the app submits empty. The root cause in React-controlled inputs, plus the native-setter fix that actually works." · Last verified: July 22, 2026*

---

**Short answer:** setting `input.value` on a React-controlled field updates the DOM but not React's internal state — so the framework either ignores your text or wipes it on the next render, and the form submits empty. The fix is to write through the **native value setter** and then dispatch a bubbling `input` event, which is what React actually listens for. Same class of bug affects Angular, Vue and Google's Closure-based apps.

## The symptom

You automate a form. The value appears in the field. You submit — and the app behaves as if the field were empty, or reverts it the moment anything else re-renders. Nothing errors. That's the tell: **the DOM and the framework disagree about what's in the box.**

## The root cause

React doesn't read `input.value` when you submit. It keeps its own copy of the state and re-renders the input from that copy. It updates its copy only in response to the events its synthetic event system observes.

So when a script assigns `el.value = "text"` directly:

- The DOM node updates → the field *looks* correct
- React's state does not → the app still believes the field is empty
- The next render writes React's state back over your text → it visibly disappears

Assigning the property also doesn't fire an `input` event, so nothing tells React to catch up.

## The fix

Write through the prototype's native setter, then dispatch the events React is listening for:

```js
const setter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;

setter.call(el, 'text');
el.dispatchEvent(new Event('input',  { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

For a `<textarea>`, use `HTMLTextAreaElement.prototype`. Bubbling matters — React attaches its listener high up, so a non-bubbling event never reaches it.

## Three related traps

**1. Per-character typing detaches.** Sending a key event per character means two debugger round-trips per character. On a long value that's enough to drop the connection mid-word, leaving a half-filled field. Insert the text in one operation instead of simulating a hundred keystrokes.

**2. Select-all is `Cmd+A` on macOS, not `Ctrl+A`.** A clear step that sends Ctrl+A on a Mac selects nothing — so backspace deletes one character and your new text **appends** to the old. If you're seeing `oldtextnewtext`, this is why.

**3. Multi-box code inputs need real key events.** Six single-character boxes (2FA codes) are usually controlled *and* auto-advance. The native-setter approach works; typing into the first box often doesn't, because focus moves on a real `keydown` the script never produces.

## When even that fails: check CSP

If you're injecting via an extension and nothing runs at all, the page's Content-Security-Policy may block evaluated script — common on hardened sites. Symptoms are an outright evaluation error rather than a silently-empty field. Purpose-built tooling that drives the input through the browser's debugger protocol avoids the eval path entirely.

This is the approach [Browser MCP](/docs/what-is-browser-mcp/) takes: form interaction runs through trusted browser-level events rather than injected scripts, which is why it works on CSP-strict and framework-controlled pages where naive automation goes quiet. We hit every trap above while automating our own dashboards — the fixes here are the ones we ended up using.

## FAQ

**Does this affect Vue and Angular too?**
Yes — any framework holding its own copy of input state. The native-setter + bubbling-event pattern is the general fix.

**Why does it work in the console but not in my script?**
Typing in the console fires real trusted events. Your script doesn't, unless you dispatch them.

**Do I need both `input` and `change`?**
React primarily needs `input`; `change` helps with libraries that listen for it. Firing both is safe.

**My value sticks but the submit button stays disabled.**
The form's validation state is separate. Make sure the events bubble, and that any blur/touched logic gets its event too.
