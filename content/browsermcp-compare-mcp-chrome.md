// KILDE: alle tal selv-verificeret via GitHub API + npm downloads API 2026-07-22 (IKKE fra subagent): mcp-chrome 12.187★/223 åbne issues/sidste push 2026-01-06 · mcp-chrome-bridge 1.037 dl/uge · vores 204 dl/uge · 23★. Bevidst fair: mcp-chrome er større end os og det siges rent ud. Ingen feature-påstande om deres projekt jeg ikke har verificeret.

# Browser MCP vs mcp-chrome: two extensions, one difference that matters

*Suggested URL: `/compare/mcp-chrome` · Suggested title tag: "Browser MCP vs mcp-chrome (2026): Is mcp-chrome Still Maintained?" · Suggested meta description: "Both drive your real Chrome through an extension. A dated, sourced comparison of size, activity and support — including the maintenance question nobody has answered in English." · Last verified: July 22, 2026*

---

**Short answer:** these two are the closest thing to direct equivalents in the MCP world — both are a Chrome extension plus a local MCP server that let an AI agent drive your **real, already-logged-in browser** rather than a headless one. [mcp-chrome](https://github.com/hangwin/mcp-chrome) is by far the bigger project (12,187 stars to our 23). The difference that decides it for most people is activity: mcp-chrome's last commit was **6 January 2026** — a little over six months ago — while this project ships regularly. If you want the larger community, take mcp-chrome. If you want something being maintained right now with English-language support, that is the gap we fill.

## The numbers, dated

All figures pulled from the GitHub and npm APIs on **2026-07-22**. They move; the dates are what matter.

| | mcp-chrome | Browser MCP by Agent360 |
|---|---|---|
| GitHub stars | **12,187** | 23 |
| Last commit | **2026-01-06** (~6.5 months ago) | 2026-07-22 (today) |
| Open issues | 223 | 3 |
| npm downloads/week | **1,037** (`mcp-chrome-bridge`) | 204 (`@agent360/browser-mcp`) |
| Primary support language | Chinese | English |
| License | MIT | MIT |
| Runs locally | Yes | Yes |

We are the smaller project by every measure of adoption, and there is no point pretending otherwise. What we can point at is the trend line: our commit history is current, and theirs stopped in January.

## Is mcp-chrome still maintained?

This is the question people actually search for, and it has no clear English-language answer — which is part of why we wrote this page.

The honest reading of the public record: **the repository has not received a commit since 6 January 2026**, and 223 issues are open. It is not archived, and the maintainer has not announced anything, so "abandoned" would be too strong a word — projects go quiet and come back. But if you are choosing a dependency today, "no commits in six months and 223 open issues" is the fact to weigh, and you should check the repo yourself rather than take our word for it: [github.com/hangwin/mcp-chrome](https://github.com/hangwin/mcp-chrome).

One practical note that has nothing to do with quality: mcp-chrome's issue tracker is largely in Chinese. If you file a bug in English, you may wait. That is a real support consideration for English-speaking teams, and it is not a criticism of the project.

## Where mcp-chrome is the better pick

We would rather you choose correctly than choose us:

- **You want the larger, more proven user base.** 12,187 stars and 1,037 weekly downloads represent a lot more real-world usage than we have.
- **You already run it and it works.** A quiet repo is not a broken one. If mcp-chrome does what you need today, switching costs you time for no gain.
- **You read Chinese** — in which case the support-language gap disappears entirely.

## Where this project fits instead

- **You need a maintained dependency.** If a bug blocks you, someone should be shipping fixes. Our commit history is public; judge it the same way we just asked you to judge theirs.
- **You want English docs and support** — including [install guides per client](/docs/install-claude-code/), a [full tool reference](/docs/tools/), and a published [troubleshooting page listing our own known bugs](/docs/troubleshooting/).
- **You want the boundaries stated.** We publish [when *not* to use this](/docs/when-not-to-use/), including that we deliberately do not build bot-detection evasion.

## The wider field

Neither of these is the biggest browser-automation MCP server. Google's [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) (47,408 stars, updated 2026-07-22) and [Playwright MCP](https://github.com/microsoft/playwright-mcp) are larger and better resourced — but both are built around browser instances they manage, not the Chrome you are already signed into. The full dated matrix is on the [all-servers comparison](/compare/browser-automation-mcp-servers/).

## FAQ

**Is mcp-chrome dead?**
No announcement says so, and it is not archived. The verifiable fact is no commits since 2026-01-06 and 223 open issues (checked 2026-07-22).

**Are these two projects related?**
No. Different authors, different codebases, independently built around the same idea.

**Can I run both?**
Technically yes — they register as separate MCP servers — but they both drive your Chrome, so running them at once mostly creates confusion about which one owns a tab.

**Which has more tools?**
We document 34. We have not counted mcp-chrome's tool list, and would rather say that than guess.

**Why should I trust your comparison of a competitor?**
You shouldn't, entirely — we make one of these. Every number above is from the public GitHub and npm APIs with the date we pulled it, so you can check all of it in about two minutes.
