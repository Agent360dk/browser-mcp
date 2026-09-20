// KILDE: alle tal MAALT 19-20/9-2026, samme minut for alle projekter: api.npmjs.org (ugentlige hentninger + 90-dages dagsserie), GitHub-API (stjerner, sidste push, aabne issues), npm-registret (udgivelsesdatoer). ⚠️ Siden findes fordi en soegning paa VORES eget pitch 19/9 gav ni resultater uden os. ⚠️ Hentninger er IKKE brugere - npm skelner ikke menneske fra CI, og en udgivelsesdag oppuster ethvert projekts tal, ogsaa vores. Det skal blive staaende paa siden. ⚠️ Opdater naar `konkurrent-vagt.py` bliver roed.

# Browser MCP alternatives: the five that exist, measured

*Suggested URL: `/compare/browser-mcp-alternatives` · Suggested title tag: "Browser MCP Alternatives (2026): Five Options, Measured" · Suggested meta description: "Looking for an alternative to Browser MCP? Five real options with downloads, maintenance status and what each one costs you - including where ours loses." · Last verified: September 20, 2026*

---

**If you are here because `@browsermcp/mcp` stopped working, the short version is: it has had no commit since 24 April 2025**, its tracker has 150 open issues, and the recurring ones all trace to the same cause. You are not doing anything wrong, and there is no setting that fixes it.

If you are here to compare before choosing, the table below is measured, not ranked.

## What it looks like when you have the right one

```
You:     Open the billing page and tell me August's total.

The wrong tool:
         I'm at the login page. What are the credentials?

The right tool:
         [navigates]
         14,204 kr. No login step - you were already signed in.
```

Every option below can give you the second answer. They differ in what it costs you.

## The five, measured 20 September 2026

Downloads are weekly, all fetched the same minute. They count downloads, not people: npm cannot tell a human from a CI job.

| Project | Downloads/week | Last release | Drives your existing Chrome |
|---|---|---|---|
| **Playwright MCP** (Microsoft) | 4,693,665 | active | Optional - extension mode, or a CDP attach you set up |
| **Chrome DevTools MCP** (Google) | 1,054,261 | active | Optional - `--remote-debugging-port` |
| **`@browsermcp/mcp`** (browsermcp.io) | 7,532 | **11 April 2025** | Yes, extension |
| **Browser MCP by Agent360** (ours) | 1,737 | active | Yes, extension |
| **`@vibebrowser/mcp`** (Vibe) | 112 | 21 August 2026 | Yes, extension |

## Why the unmaintained one still has the most downloads

Because downloads measure installs, not health. It had a year of being the obvious answer, and every config that still references it re-fetches it on each run. Its daily number has been flat for two months at roughly 1,500 - which is what an installed base looks like, not growth.

The failures people report there are all one bug wearing different clothes:

- *"No connection to browser extension"*
- *"MV3 service worker killed on idle"*
- *"No tab with given id"* - always the **same** stale id
- *"Read operations work but write operations fail"*

Chrome evicts an MV3 service worker after about 30 seconds idle. That worker holds the socket to the local server and the tab id it was given. When it dies, the socket dies with it and the stored id goes stale, while the connection looks fine from outside. Reads survive because they resolve the active tab at call time; writes do not, because they use the stored id.

It cannot be fixed by configuration, and it will not be fixed there.

## Choosing, in one pass

**You need scale, CI, or many browsers at once** → Playwright MCP. Nothing on this page competes with it, and it would be dishonest to suggest otherwise.

**You need Chrome's own devtools** - performance traces, the protocol itself → Chrome DevTools MCP.

**You need the browser you are already signed into** → the extension group. Judge it by the last-release column, not the download column.

## Where ours wins, and where it loses

**Wins:** the connection lives in an offscreen document rather than the service worker, so the eviction failure above does not occur. And when a step genuinely needs a person - a 2FA code, a CAPTCHA, a choice only you can make - it stops and asks you on your own screen, then carries on in the same tab. We could not find another MCP server in this group with a tool that does that.

**Loses:** on a framework-controlled `<select>`, Playwright MCP lands the choice and we do not. We answer honestly that it did not land, but no is still no. Method and raw results: [/learn/tools-that-lie/](https://browsermcp.dev/learn/tools-that-lie/), where we also publish the nine cases our own tools got wrong before we fixed them.

## If you are switching from `@browsermcp/mcp`

Nine of the thirteen tool names are identical, so an existing config is mostly a one-line change. The full diff, including the three of theirs that do not exist here, is on [/migrate/from-browsermcp-io/](https://browsermcp.dev/migrate/from-browsermcp-io/).

## Frequently asked questions

**Is there an alternative that needs no extension at all?**
Playwright MCP and Chrome DevTools MCP can attach to a Chrome started with `--remote-debugging-port`. The cost is starting Chrome that way every time, and a browser with the debugging port open has a different security posture than your normal one.

**Which is most likely to still work in a year?**
Playwright MCP and Chrome DevTools MCP, by a wide margin - Microsoft and Google maintain them. Among the extension-based three, go by last release.

**Do these see my passwords?**
They see what the page shows, like any extension with page access. Read the permission list before installing any of them, ours included.

**Why does this page name a smaller competitor?**
Because a comparison that only lists the ones we beat is not a comparison. Vibe is smaller than us and we still lost a search to them - that is worth saying out loud.
