// KILDE: HELE siden genmaalt 2026-11-13 (ca. 14.40 UTC) mod GitHub REST API (repos, /commits for hele listen, search/issues med is:issue, /releases, /tags), npm registry API (versioner + time), npm downloads API (last-week = 6.-12. nov.) og de to Chrome Web Store-sider (raa HTML). Deres vaerktoej laest i den UDGIVNE pakke `@browsermcp/mcp@2.5.0` (npm-tarball, dist/daemon.js: COMMANDS = 27 poster + back/forward/reload = 30 kommandoer, plus `help`; MAX_BROWSERS 8 staar i deres udgivne README). 0.1.3 og 2.0.0 ogsaa laest: 0.1.3 har 13 browser_*-navne, 2.0.0 har 0 og ét vaerktoej `browser`. Stilheden: sidste commit foer = 9db12f2 2025-04-24, foerste efter = 43bcd1d 2026-10-27; npm 2.0.0 2026-10-26 23.33 UTC. ⛔ RETTET 13/11 efter review (PR #102): deres GitHub-repo er et Copybara-SPEJL af et privat repo (9fcac1a «mirror oss/ to BrowserMCP/mcp with Copybara», 43bcd1d = ét commit med 153 filer; 33 af 34 commits fra 27/10 har GitOrigin-RevId, maalt 13/11) - commit-antal maaler spejlet, ikke hvor tit de udgiver, saa brug dem ALDRIG som maal for udgivelsestakt. Hullet gaelder det OFFENTLIGE repo; npm 2.0.0 kom 9,5 time foer foerste offentlige commit. Deres 8 er et loft over Chrome-profiler, ikke sessioner. ⛔ Skriv ALDRIG at de er forladt, tavse eller uvedligeholdte. ⛔ Brug ALDRIG relative tider («last week», «nine days since») - skriv datoparret. ⛔ Og skriv ALDRIG siden som et angreb: de har 100.000 butiksbrugere mod vores 2.000.

# Browser MCP vs browsermcp.io

*Suggested URL: `/compare/browsermcp-io` · Suggested title tag: "Browser MCP by Agent360 vs. browsermcp.io - The Actual Numbers (2026)" · Suggested meta description: "Two unaffiliated MCP servers, nearly the same name. One has 100,000 users and rewrote its tools in October 2026. Dated, sourced numbers for both." · Last verified: November 13, 2026*

---

**Short answer:** if you searched "browser mcp" and landed here, you are probably looking for **browsermcp.io** (GitHub: `BrowserMCP/mcp`) - it is bigger, older, and ranks higher, with fifty times our installed base on the Chrome Web Store. We are a separate, unaffiliated project with a nearly identical name.

Until November 2026 this page argued one thing: that they had stopped shipping and we had not. **That argument is dead, and we have rewritten the page rather than leave it standing.** browsermcp.io's public GitHub repo went eighteen months without a commit - 24 April 2025 to 27 October 2026 - and it has shipped six npm versions since, `2.0.0` on 26 October to `2.5.0` on 12 November 2026. Both projects are maintained. So the question is not "which one is alive", it is **which shape fits your setup**, and that is what the numbers below are for.

We are **Browser MCP by Agent360** (`@agent360/browser-mcp`, [browsermcp.dev](https://browsermcp.dev)) - a standard stdio MCP server that gives any MCP client control of your real, already-logged-in Chrome instead of a fresh headless session.

## The two projects, side by side

Every number below was measured on **2026-11-13**, both columns the same hour, from the GitHub API, the npm registry and downloads APIs, and the two store pages. Open issue counts use the search API with `is:issue`, so pull requests are excluded from both columns.

| | **browsermcp.io** (`BrowserMCP/mcp`) | **Browser MCP by Agent360** (`@agent360/browser-mcp`) |
|---|---|---|
| Chrome Web Store users | **100,000** | 2,000 |
| Chrome Web Store rating | 4.7 / 5 (764 ratings) | 5.0 / 5 (4 ratings) |
| GitHub stars | **7,350** | 62 |
| npm downloads, 6-12 November 2026 | **33,714** | 745 |
| Repo created | 2025-03-28 | 2026-03-29 |
| Last commit (default branch) | 2026-11-12 | 2026-10-29 |
| npm versions ever published | 10 | **20** |
| Latest npm version | `2.5.0` (2026-11-12) | `1.31.0` (2026-10-29) |
| Published GitHub releases | **0** (one tag, `v2.1.0`) | 14 (latest `v1.31.0`) |
| Open / closed GitHub issues | 1 / 183 | 8 / 24 |
| License | Apache-2.0 | MIT |
| Tool surface | one tool, `browser`, taking command lines: **30 commands** in `2.5.0`, plus `help` | **40 tools**, each separately named, listed at [`/docs/tools`](/docs/tools) |
| Agents at once | each AI app gets tabs of its own; no limit documented | up to 20, each in its own colour-coded tab group |
| Chrome profiles at once | up to 8, from one daemon | one per client, named with `BROWSER_MCP_PROFILE` (from 1.31); no limit documented |
| Asks you mid-task | a pairing click at setup; nothing mid-task in their README | `browser_ask_user` - a 2FA code, a CAPTCHA, a choice |
| Install | `npx @browsermcp/mcp` + Chrome Web Store | Chrome Web Store extension + `claude mcp add` |

*npm's public download API reports some days as zero for every package, including both of these, so both weekly totals understate equally. Chrome Web Store user counts are the store's own rounded buckets - "100,000" and "2,000" are what the listings show, not exact figures. "Last commit" is the newest commit on each default branch, not the repository's `pushed_at`, which also counts other branches. Their public repo has been a mirror of a private one since 27 October 2026 (commit `9fcac1a`, made with Copybara; every commit after the first carries a `GitOrigin-RevId`), so its commits show when code was mirrored, not how often they work on it - which is why this table does not compare commit counts.*

## What changed in October 2026, and why it may affect you

The two maintenance records, as the public APIs returned them on 2026-11-13:

> **browsermcp.io's public GitHub repo had no commit between 24 April 2025 and 27 October 2026, and npm had no new version between `0.1.3` (11 April 2025) and `2.0.0` (late on 26 October 2026, UTC).** Since then: six npm versions, `2.0.0` to `2.5.0` on 12 November 2026, and the public repo has become a mirror of a private one - its first commit after the gap (`43bcd1d`, 27 October) is a single commit of 153 files. It has still published zero GitHub releases.
>
> **Browser MCP by Agent360's last commit on `main` was 29 October 2026**, with 14 published GitHub releases and 20 npm versions since the repo opened on 29 March 2026.

If you have a working `@browsermcp/mcp` setup, the rest of this section is the part worth reading.

The 2.x line is not an incremental release - it is a **rewrite of the tool surface**, and it landed in `2.0.0`, the first version after the silence. The thirteen separate tools the old `0.1.3` exposed (`browser_navigate`, `browser_click`, `browser_snapshot` and the rest) are gone, replaced by a single tool called `browser` that takes command lines. Measured in the published packages themselves: `0.1.3` carries thirteen `browser_*` names; `2.0.0` carries none and one tool named `browser`; `2.5.0` defines 30 commands for it, plus `help`. Their built-in `help` lists fewer, because some are folded into one line (`back | forward | reload`), one is shown only with several browsers connected, and `cdp` needs a capability flag.

Two practical consequences:

- **A config or a prompt written for `0.1.3` names tools that no longer exist on their side.** If your agent started reporting unknown tools after 26 October 2026, that is why - not a bug in your setup.
- **The old failure mode may or may not be fixed.** Through the eighteen months without a public commit, the recurring reports were "No connection to browser extension", "MV3 service worker killed on idle" and "No tab with given id". Our reading of them at the time, not re-measured since: one root cause, an MV3 service worker holding the connection that Chrome evicts after about 30 seconds idle. Their published `2.5.0` README describes the 2.x answer: a daemon that waits up to 10 seconds for a browser whose service worker restarted, and keeps each session's tabs meanwhile. **We have not run `2.5.0`, so we have not measured whether that ends the failure**, and we are not going to guess. Their tracker shows 1 open issue against 183 closed.

If your config broke on the renamed tools and you would rather move than rewrite it, we keep a tool-by-tool mapping at [`/migrate/from-browsermcp-io/`](/migrate/from-browsermcp-io/) - including which of their old names have no equivalent here.

## Where browsermcp.io genuinely wins

The scale numbers are theirs, and we publish them as-is:

- **100,000 Chrome Web Store users vs. our 2,000.** A real, large, established base. We do not have one.
- **4.7/5 from 764 ratings vs. our 5.0 from 4.** Ours is a rounding artifact of a tiny sample; theirs is a verdict from a real population.
- **7,350 GitHub stars vs. our 62.** Far more visible on GitHub and on every "awesome MCP servers" list.
- **33,714 npm downloads in the week of 6-12 November 2026 vs. our 745.** Roughly forty-five to one.
- **It is being actively developed,** with the rewrite shipped between 26 October and 12 November 2026.

**If browsermcp.io works for you, there is no reason to switch.** We are not going to manufacture a reason to distrust something serving a hundred thousand people. This page exists because the names collide and people need to tell the two apart, not because we think you are making a mistake.

## Where the two actually differ

Three differences worth weighing:

**Tool surface: 40 tools vs. one tool with 30 commands.** Neither is wrong. A single dispatching tool keeps the client's tool list short, which matters when a model has limited room for tool definitions. Separate named tools let the model pick from descriptions it can read, and let a client allow or deny them individually. Pick the one that fits how your client handles tools.

**Release record.** They have published zero GitHub releases and ten npm versions; we have published 14 releases and 20 npm versions. If you pin versions and read changelogs before upgrading, that difference is the one to weigh - and it is checkable in two minutes on either repo.

**Issue tracker.** They are ahead of us here: 1 open issue against 183 closed, where we have 8 open against 24.

## Frequently asked questions

**Are these the same product?**
No. Two separate teams, two separate GitHub orgs (`BrowserMCP` vs. `Agent360dk`), two separate npm packages (`@browsermcp/mcp` vs. `@agent360/browser-mcp`), two separate Chrome extensions. The name overlap is coincidental - neither is a fork or rebrand of the other.

**Which one has more users?**
browsermcp.io, by a wide margin - 100,000 Chrome Web Store users vs. our 2,000, as of 2026-11-13.

**Was this page wrong about browsermcp.io before?**
Yes. It went on describing them as no longer shipping after that stopped being true. Their public GitHub repo had no commit between 24 April 2025 and 27 October 2026, and they have shipped six npm versions since, `2.0.0` on 26 October to `2.5.0` on 12 November 2026. We have corrected every page on this site that said otherwise.

**Why did my `@browsermcp/mcp` tool names stop working?**
Because `2.0.0` replaced the thirteen named tools with a single `browser` tool that takes command lines, and every 2.x since keeps that shape. See the section above, and the [migration mapping](/migrate/from-browsermcp-io/) if you want the equivalents here.

**Should I uninstall browsermcp.io and switch?**
Not automatically. If it works for your workflow, keep it. Consider ours if you need the agent to stop and ask you something mid-task - a 2FA code, a CAPTCHA, a choice - through `browser_ask_user`, or if you want separate named tools rather than one dispatching tool.

**Is one of them free and the other paid?**
Both are free. browsermcp.io is Apache-2.0; Browser MCP by Agent360 is MIT. Both permit commercial use.

**Is this page trying to make browsermcp.io look bad?**
Read the section above where every scale number favours them. The one thing we will say plainly: this page used to lead with their silence, and when that stopped being true we rewrote it rather than leave a convenient claim standing.

## Try it yourself

```bash
# 1. the Chrome extension: chromewebstore.google.com - search "Agent360 Browser MCP"
# 2. the MCP server (Claude Code):
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

Two parts, both required. MIT licensed, 40 tools, runs on your own machine. [Full install guide →](/docs/install-claude-code) · [Or install browsermcp.io if that is the right call for you](https://browsermcp.io) - we mean that.

---

### How we verified this (dated, so it can be re-checked)

All figures were pulled directly on **2026-11-13**, from primary sources only - no secondhand blog posts or aggregator sites:

- **Stars, repo creation, license and commit dates:** `api.github.com/repos/BrowserMCP/mcp` and `api.github.com/repos/Agent360dk/browser-mcp`, plus the full `/commits` list for the default-branch dates and the gap (last commit before it `9db12f2`, 24 April 2025; first after it `43bcd1d`, 27 October 2026). That their repo is a mirror is in the commits themselves: `9fcac1a` is titled "mirror oss/ to BrowserMCP/mcp with Copybara", 33 of the 34 commits since 27 October 2026 carry a `GitOrigin-RevId` line, and the one that does not, `43bcd1d`, adds 153 files in a single commit.
- **Release counts:** `api.github.com/repos/<repo>/releases?per_page=100`, counted. browsermcp.io returns an empty array; `/tags` returns one tag, `v2.1.0`.
- **Open and closed issues:** the search API with `is:issue`, so pull requests are excluded. The repo object's `open_issues_count` counts PRs as issues and is not what the table uses.
- **npm versions, publish dates and download counts:** `registry.npmjs.org/<package>` for `dist-tags.latest`, the full version list and the `time` map; `api.npmjs.org/downloads/point/last-week/<package>` for downloads (the week of 6-12 November 2026).
- **Their tool surface:** read in their published packages from the npm registry - `0.1.3` and `2.0.0` for the change, and `2.5.0`'s `dist/daemon.js`, which registers one tool named `browser` and defines its 30 commands. The eight-profile limit (`MAX_BROWSERS`) and the reconnect behaviour are from the `2.5.0` README as published on npm.
- **Chrome Web Store users and rating:** the live public listing pages for extension IDs `bjfgambnhccakkhmkepdoekmckoijdlc` (browsermcp.io) and `jdehgalffmffhfhmmhaokfbfnafnmgcl` (Agent360). Chrome blocks extensions from scripting the store, so the figures were read out of the raw HTML rather than the rendered DOM.

This table will go stale - that is the nature of a dated comparison, and an earlier version of this page went stale in a way that flattered us. The sources above take about five minutes to re-check yourself.

---

*Not verified on this page: whether `2.5.0` ends the service-worker eviction failure, whether their documented features behave as described (we have not run `2.5.0`), and who maintains `browsermcp.io` or why its commits stopped and restarted.*
