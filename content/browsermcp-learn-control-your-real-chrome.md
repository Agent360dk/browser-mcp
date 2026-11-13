// KILDE: tabellen GENMAALT 2026-11-13 kl. 14.44 UTC med api.npmjs.org/downloads/point/last-week (= 6.-12. nov., hentet samme minut for alle fem) + GitHub-API /commits?per_page=1 (nyeste commit paa default-grenen, ikke pushed_at) samme dag. browsermcp.io's hul: sidste commit foer 9db12f2 2025-04-24, foerste efter 43bcd1d 2026-10-27; npm 2.0.0 2026-10-26 til 2.5.0 2026-11-12. ⛔ Ingen relative tider. Vibe fundet 19/9 ved at soege paa vores EGET pitch: de staar nr. 1, vi staar ingen steder. ⚠️ Tallene er ugentlige hentninger, IKKE brugere - npm skelner ikke menneske fra CI, og det skal staa paa siden. ⚠️ Opdater tabellen naar `konkurrent-vagt.py` bliver roed; skriv ALDRIG et tal her uden at hente det samme dag.

# Control your logged-in Chrome with AI

*Suggested URL: `/learn/control-your-real-chrome` · Suggested title tag: "Control Your Real Logged-In Chrome From an AI Agent (2026)" · Suggested meta description: "Five ways to give Claude Code, Cursor or Codex your actual Chrome instead of a headless one - what each costs you, measured, including where ours loses." · Last verified: November 13, 2026*

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

Weekly npm downloads for 6-12 November 2026, all fetched the same minute on 13 November 2026; the last commit is the newest one on each default branch, from the GitHub API the same day. Downloads count downloads, not people: npm cannot tell a human from a CI job, and a release day inflates any project's number including ours.

| Project | Downloads/week | Drives your existing Chrome? | Last commit |
|---|---|---|---|
| **Playwright MCP** (Microsoft) | 10,630,264 | Optional, via an extension or a CDP attach you set up | 11 November 2026 |
| **Chrome DevTools MCP** (Google) | 2,304,340 | Optional, via `--remote-debugging-port` | 13 November 2026 |
| **browsermcp.io** (`@browsermcp/mcp`) | 33,714 | Yes, extension | 12 November 2026 |
| **Browser MCP by Agent360** (ours) | 745 | Yes, extension | 29 October 2026 |
| **Vibe Browser** (`@vibebrowser/mcp`) | 115 | Yes, extension | 6 November 2026 |

## How to choose, in one pass

**You want scale, CI, or many browsers at once →** Playwright MCP. Nothing here competes with it, and pretending otherwise would waste your afternoon.

**You want Chrome's own devtools - performance traces, network, the protocol itself →** Chrome DevTools MCP. It is Google's, and it exposes things no wrapper will.

**You want the Chrome you are already signed into, and you want it to keep working →** that is the extension group: browsermcp.io, Vibe, and ours.

**One thing to know about the most-downloaded of those three.** `@browsermcp/mcp`'s public GitHub repo went eighteen months without a commit - 24 April 2025 to 27 October 2026 - and it has shipped six npm versions since, `2.0.0` on 26 October to `2.5.0` on 12 November 2026. Through the gap, the recurring reports - "No connection to browser extension", "MV3 service worker killed on idle", "No tab with given id" - had, as we read them at the time, one root cause: an MV3 service worker holds the connection, and Chrome evicts it after about 30 seconds idle. `2.0.0` was a rewrite: it replaced the thirteen named tools with a single `browser` tool, and the published `2.5.0` README describes reconnecting after a service-worker restart. We have not run `2.5.0`, so whether that ends the failure is unmeasured. If your prompts name the old tools, read [/compare/browsermcp-io/](https://browsermcp.dev/compare/browsermcp-io/) first.

## What we do differently, and where we lose

Ours keeps the connection in an **offscreen document** instead of the service worker, which is why the eviction failure above does not happen. And when a step genuinely needs a person - a 2FA code or a choice only you can make - it stops and asks you on your own screen, then carries on in the same tab. A CAPTCHA it cannot clear, the agent asks you to solve. If its dialog covers the page, press Skip, solve the CAPTCHA in the tab, and tell the agent.

**Where we thought we lost, measured on 19 September 2026:** a framework-controlled `<select>`. The fault was our own test page, not React; 1.30.0 lands the choice on real React. The method, the raw result and the retraction are on [/learn/tools-that-lie/](https://browsermcp.dev/learn/tools-that-lie/), including the two other cases we measured where nobody lied.

**And where the field beats us on size:** Vibe is 6.5 times smaller than us by downloads (115 against our 745 in the week of 6-12 November 2026) and still ranked above us in the search that produced this page. They wrote the page answering the question; we had only per-client install guides. That is not a product gap, it is a writing gap, and this page exists because of it.

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

**Why does the biggest extension-based one have the most downloads?**
Because downloads measure installs, not fit. It was the obvious answer from its first npm release in April 2025, and configurations that reference it keep re-fetching it. That is also why this page leads with the measurement rather than with the ranking.
