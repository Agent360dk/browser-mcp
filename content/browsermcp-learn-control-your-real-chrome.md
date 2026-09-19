// KILDE: alle tal MAALT 19/9-2026 med api.npmjs.org (ugentlige hentninger, hentet samme minut for alle fem) + GitHub-API for commit-datoer. Vibe fundet 19/9 ved at soege paa vores EGET pitch: de staar nr. 1, vi staar ingen steder. ⚠️ Tallene er ugentlige hentninger, IKKE brugere - npm skelner ikke menneske fra CI, og det skal staa paa siden. ⚠️ Opdater tabellen naar `konkurrent-vagt.py` bliver roed; skriv ALDRIG et tal her uden at hente det samme dag.

# How to control your real, logged-in Chrome from an AI coding agent

*Suggested URL: `/learn/control-your-real-chrome` · Suggested title tag: "Control Your Real Logged-In Chrome From an AI Agent (2026)" · Suggested meta description: "Five ways to give Claude Code, Cursor or Codex your actual Chrome instead of a headless one - what each costs you, measured, including where ours loses." · Last verified: September 19, 2026*

---

**Short answer:** there are five real options, they are not interchangeable, and the right one depends on a single question - *do you need the browser you are already signed into, or just a browser?*

If you only need a browser, use Playwright MCP or Chrome DevTools MCP. They are enormous, maintained by Microsoft and Google, and they will outlive everything else on this page.

If you need **the** browser - your cookies, your sessions, your 2FA state - the field is much smaller, and this page is about that half.

## What "the browser you are already signed into" actually looks like

```
You:     Open the billing page and tell me August's total.

A tool that drives its own browser:
         I'm at the login page. What are the credentials?

A tool that drives yours:
         [navigates]
         14,204 kr. No login step - you were already signed in.
```

Everything below is about which tools can give you the second answer, and what each one costs
you to get it.

## The five, measured

Weekly npm downloads, all fetched the same minute on 19 September 2026. These count downloads, not people: npm cannot tell a human from a CI job, and a release day inflates any project's number including ours.

| Project | Downloads/week | Drives your existing Chrome? | Last commit |
|---|---|---|---|
| **Playwright MCP** (Microsoft) | 4,693,665 | Optional, via an extension or a CDP attach you set up | active |
| **Chrome DevTools MCP** (Google) | 1,054,261 | Optional, via `--remote-debugging-port` | active |
| **browsermcp.io** (`@browsermcp/mcp`) | 7,532 | Yes, extension | **24 April 2025** |
| **Browser MCP by Agent360** (ours) | 1,737 | Yes, extension | active |
| **Vibe Browser** (`@vibebrowser/mcp`) | 112 | Yes, extension | active |

## How to choose, in one pass

**You want scale, CI, or many browsers at once →** Playwright MCP. Nothing here competes with it, and pretending otherwise would waste your afternoon.

**You want Chrome's own devtools - performance traces, network, the protocol itself →** Chrome DevTools MCP. It is Google's, and it exposes things no wrapper will.

**You want the Chrome you are already signed into, and you want it to keep working →** that is the extension group: browsermcp.io, Vibe, and ours.

**One warning about the most-downloaded of those three.** `@browsermcp/mcp` has 7,532 downloads a week and **no commit since 24 April 2025**. Its tracker has 150 open issues, and the recurring ones - "No connection to browser extension", "MV3 service worker killed on idle", "No tab with given id" - all have the same root cause: an MV3 service worker holds the connection, and Chrome evicts it after about 30 seconds idle. That is not fixable by configuration, and the fix is not coming. If you are installing it today because it is the biggest, install it knowing that.

## What we do differently, and where we lose

Ours keeps the connection in an **offscreen document** instead of the service worker, which is why the eviction failure above does not happen. And when a step genuinely needs a person - a 2FA code, a CAPTCHA, a choice only you can make - it stops and asks you on your own screen, then carries on in the same tab.

**Where we lose, measured on 19 September 2026:** on a framework-controlled `<select>`, Playwright MCP lands the choice and we do not. We answer honestly that it did not land, but no is still no. The method and the raw result are on [/learn/tools-that-lie/](https://browsermcp.dev/learn/tools-that-lie/), including the two other cases we measured where nobody lied.

**And where the field beats us on size:** Vibe is five times smaller than us by downloads and still ranked above us in the search that produced this page. They wrote the page answering the question; we had only per-client install guides. That is not a product gap, it is a writing gap, and this page exists because of it.

## The question worth asking before any of them

All five give an agent your browser. Only some of them tell you when they failed.

A tool that answers "clicked" when nothing was clicked is worse than one that errors: the agent builds three more steps on top of a click that never happened, and the damage shows up somewhere unrelated. We measured our own tools against that and found nine cases where we lied - the whole list is on the page linked above, our own failures included.

Whichever you pick, try this once: point it at a background tab and ask it to click something. Then check whether the page actually changed.

## Frequently asked questions

**Is there one that works without any extension?**
Yes - Playwright MCP and Chrome DevTools MCP can attach to a Chrome you started with `--remote-debugging-port`. The cost is that you have to start Chrome that way every time, and a browser with the debugging port open is a different security posture than your normal one.

**Do any of these see my passwords?**
They see what the page shows, the same as any extension with page access. That includes a password field's contents if the page renders them. Read the permission list before installing any of the three extension-based ones, ours included.

**Which one is most likely to still work in a year?**
Playwright MCP and Chrome DevTools MCP, by a wide margin - they are maintained by Microsoft and Google. Among the extension-based three, judge by the last-commit column above rather than by the download column.

**Why does the biggest extension-based one have the most downloads if it is unmaintained?**
Because downloads measure installs, not health. It had a year of being the obvious answer, and configurations that reference it keep re-fetching it. That is also why this page leads with the measurement rather than with the ranking.
