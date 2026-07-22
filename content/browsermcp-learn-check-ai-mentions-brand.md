// KILDE: metoden er den vi FAKTISK kørte 21-22/7 (16-prompt-panel, Perplexity + ChatGPT, citations-log). Fund citeret er vores egne målte (ChatGPT nævnte os #2 og citerede browsermcp.dev; Perplexity nævnte os ikke og påstod fejlagtigt at en død konkurrent var vedligeholdt). INGEN opdigtede tal — kun hvad vi selv målte.

# How to check whether ChatGPT, Perplexity and Claude mention your brand

*Suggested URL: `/learn/check-if-ai-mentions-your-brand` · Suggested title tag: "How to Check if ChatGPT & Perplexity Mention Your Brand (2026 Method)" · Suggested meta description: "A repeatable method for measuring whether AI assistants name your product — a fixed prompt panel, what to log, and how to automate the run in your own browser." · Last verified: July 22, 2026*

---

**Short answer:** pick a fixed set of prompts a real buyer would ask, run them on each assistant on a schedule, and log four things every time: were you named, in what position, which URL was cited, and who got recommended instead. The prompt set has to stay frozen — otherwise you're measuring your own wording, not your visibility. Most of it can be automated in your own logged-in browser.

## Why "just search for your name" doesn't work

Asking an assistant "what is [your brand]" almost always produces a flattering answer — it's reading your own site. That measures nothing. What matters is whether you appear when someone describes **the problem you solve without naming you**. That's the query that decides whether an AI sends you a customer.

## The method

**1. Build a frozen prompt panel (~16 prompts), in three layers:**

- **Category** — "best tool for [job]", "how do I [problem]" — no brand named. This is the one that counts.
- **Lost-intent** — queries you know you should win and currently don't.
- **Brand & collision** — your name, and any competitor you're confused with.

**2. Run every prompt on each assistant** — ChatGPT, Perplexity, Claude, Copilot, Google's AI answers. Use a clean session so prior chat history doesn't contaminate the result.

**3. Log the same four fields every time:**

| Field | Why |
|---|---|
| Mentioned? | The headline metric |
| Position | Being named third is not being named first |
| **Cited URL** | The one people skip — and the most important |
| Who was recommended instead | Tells you who owns the answer today |

**4. Repeat monthly.** A single run is a snapshot; the trend is the signal.

## The trap: verify *which* URL was cited

If your brand name is shared with another project, a mention is ambiguous — the assistant may be citing your competitor. Read the actual cited hostname, not the chip label.

We hit this ourselves: on a prompt describing our core use case, ChatGPT named "Browser MCP" second — and only by checking the cited hosts could we confirm it pointed at **our** domain and not the similarly-named project. Same run, Perplexity didn't mention us at all, and stated that a competitor was actively maintained when its repository had been silent for over a year. Both facts were only visible because we logged the citation, not just the mention.

## Automating the run

Doing this by hand across five assistants monthly gets old fast. The awkward part is that the assistants worth measuring are the ones you're *logged into* — so a headless scraper is the wrong tool: it isn't signed in, and a fresh browser profile gets a different (or blocked) experience.

Running it in your own browser sidesteps that. With [Browser MCP](/docs/what-is-browser-mcp/), an agent drives the Chrome you're already signed into: submit the prompt, wait for the answer to finish rendering, read the response and the cited links, and write the row. Two practical notes from doing it: read the **cited link hostnames** programmatically rather than trusting the visible label, and take a screenshot as evidence — some assistants render answers in ways that plain text extraction misses.

## What to do with the result

- **Not mentioned anywhere** → you're absent from the sources these systems synthesise from. That's a distribution problem (directories, lists, community, coverage), not an on-page one.
- **Mentioned but not cited** → you're known but not linked; you need a page that answers the question directly.
- **A competitor is described inaccurately** → that's a factual gap you can fill with a dated, sourced comparison page.

## FAQ

**How often should I run it?**
Monthly. More often mostly measures model noise.

**Do I need paid accounts?**
Not necessarily — several assistants answer without login, though logged-in sessions better reflect what your buyers see.

**Why not use an API?**
The API and the consumer product often use different retrieval and different system prompts. Measure what your customers actually use.

**Is this the same as SEO rank tracking?**
Related but not the same. Classic tracking measures a ranked list; this measures whether you're named inside a synthesised answer — and which source it credits.
