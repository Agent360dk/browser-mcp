# Chrome Web Store listing - full audit and paste-ready text

Rewritten 2026-09-08. The listing lives in the CWS dashboard, **not in this repo**, so none of it
can be fixed by a commit: <https://chrome.google.com/webstore/devconsole/> → Agent360 Browser MCP.

Live state read the same day from the public page (861 users, 0 ratings, v1.29.0, updated 7 Sept,
developer Agent360 Group ApS, category Developer Tools).

## What is actually wrong - every field

| Field | State 2026-09-08 | Verdict |
|---|---|---|
| Product name | "Agent360 Browser MCP" | ✅ keep |
| **Summary** (132 char) | "Give Claude Code your real logged-in Chrome. Two parts: this extension + one npx command." | ✅ **already fixed** - `extension/manifest.json`'s `description` overwrote it when 1.29.0 published on 7 Sept. Nothing to paste. |
| **Detailed description** | Says **29 browser tools** and **up to 10 concurrent sessions**; claims **"~80% pass rate"** on CAPTCHAs; the setup block still tells store users to run `npx … install` and load an unpacked extension | 🔴 replace - §1 below |
| **Screenshots** | Three, dated 3 May, all crops of the *old website* | 🔴 replace - §2 |
| **Small promo tile** (440×280) | Not produced in this repo before today | 🟡 upload - §2 |
| **Marquee tile** (1400×560) | Never produced | 🟡 upload - §2 |
| **YouTube video** | Empty. `docs/demo.mp4` exists (20 June) but is on no video host, so the listing's video slot is unused | 🟡 §3 |
| Store icon | Generic blue-gradient sparkle | 🟡 decision - §4 |
| Privacy: single purpose + permission justifications | Not tracked in this repo | 🟡 §5 |
| Ratings | 0 reviews at 861 users | 🟡 §6 - this one moves ranking |

### The three numbers, verified 2026-09-13 - re-run before re-publishing

- **40 tools** - `mcp-server/tools.js` exports 40. The listing says 29 (two generations stale).
- **20 concurrent sessions** - port range 9876-9895 (`mcp-server/index.js:45-46`) is 20 ports, so 20
  sessions can hold one at a time. The listing says 10, which was true before v1.29.0.
  Do **not** confuse this with `MAX_TABS_PER_SESSION = 20` (`extension/background.js:195`) - that is
  20 *tabs* per session and is a different 20.
- **9 built-in integrations** - the comparison table in `README.md:138`.

### ⛔ Den FEMTE usandhed, fundet 20/9 - og den er den vaerste

Den levende beskrivelse (laest i sin helhed 20/9 med `computer_find`, ikke en 200-tegns forsmag)
indeholder dette afsnit:

> ═══ RUNS IN BACKGROUND ═══
> Only the human-in-the-loop dialog (browser_ask_user) activates your tab. Everything else -
> **clicks, fills**, screenshots - runs without stealing focus.

**Det er det modsatte af hvad vi selv har maalt.** Chrome leverer ikke mus- og tastatur-haendelser
til en tab der ikke er den synlige i sit vindue, saa tastetryk, hover, dobbelt-/hoejreklik, koordinatklik og udfyldning af et felt fundet via tekst
i en baggrunds-tab virker netop ikke (klik og udfyldning via CSS-selektor goer) - vaerktoejet siger det, og agenten kan hente fanen frem med browser_switch_tab. Sitet, CHANGELOG og den nye indsaet-tekst
siger alle sandheden; kun butikken lover det modsatte.

Erstatningsteksten i §1 loeser det: den har intet positivt baggrunds-loefte, og den har til
gengaeld et "WHAT IT CANNOT DO"-afsnit der siger praecis hvad der ikke naar frem.

⚠️ Tallet i tabellen ovenfor siger "fire usandheder". Det er **fem**.

### ⚠ Delete the "~80% pass rate" claim and do not replace it with another number

That figure exists **only on the store listing**. It is not in the README, not in
`mcp-server/tools.js`, not in the tool's own description, and there is no measurement behind it
anywhere in this repo. It is an unsourced success-rate claim about CAPTCHA solving, sitting on a
public listing, in the one product area store review treats as sensitive. What the tool actually
does is documented and honest - auto-click first, then a screenshot for the model to look at, then
ask the human - so describe the mechanism instead of inventing a hit rate.

---

## ⚠️ KLADDEN BAERER EN AELDRE UDGAVE END §1 - laes det her foerst

⛔ **AFLØST 12/10:** teksten der skal ind er nu `~/.claude/plans/browsermcp-1302-2026-10-07/BUTIKSTEKST-1.30.2.txt` (= §1-blokken
herunder). Filen `browsermcp-2026-09-07/BUTIKSTEKST-klar-til-indsaettelse.txt`, som afsnittet nævner, har påstande R87-R90 afviste - brug den ikke.

**Hvad der ER i dashboardets felt `Beskrivelse*` lige nu** (indsat og gemt 20/9, efterproevet
efter en fuld genindlaesning): den rettede tekst uden nogen af de fem usandheder.

**Hvad der IKKE er der:** §1 er forbedret SIDEN indsaettelsen. Den har nu en prompt man indsaetter
i sin AI som skridt 2, i stedet for fem registrerings-kommandoer. Kladden har stadig den gamle
opsaetnings-blok. Den nye tekst ligger klar i
`~/.claude/plans/browsermcp-2026-09-07/BUTIKSTEKST-klar-til-indsaettelse.txt`.

**Rettet 26/9: teksten ER live.** Butikssiden (curl 26/9) siger «40 tools», «Up to 20 agent
sessions» og «⚠ READ FIRST - THIS EXTENSION IS HALF OF BROWSER MCP», og ingen af de fire gamle
paastande (29 tools, 10 concurrent, ~80 %, UNIQUE). Om det er §1-udgaven med prompten eller den
aeldre opsaetnings-blok, er IKKE maalt.

### ⛔ Hvorfor fire forsoeg fejlede foerst - laer af det

Cmd+A/Cmd+V globalt, Cmd+A/Cmd+V maalrettet mod Chrome, AX `set_value`, og
`type`-paa-element: **alle fire kvitterede "ok", ingen af dem landede.** Rodaarsagen blev
fundet ved at liste Chromes menulinje: hele `Rediger`-menuen stod `[disabled]` - ogsaa
"Luk vindue" og "Genindlaes". **Chrome var ikke det aktive program.** En vinduesfokus er
ikke det samme som en program-aktivering, og intet af vaerktoejernes svar afsloerede det.

Opskriften der virkede, i denne raekkefoelge:
1. aktivér programmet (`app focus`), ikke bare vinduet eller fanen
2. klik i feltet
3. **bekraeft med et fokus-opslag at markoeren er i AXTextArea** - ikke i AXWebArea, ikke ingen steder
4. brug programmets EGEN menu (`Rediger > Vaelg alle`, `Rediger > Indsaet`), ikke syntetiske taster
5. laes hele feltets vaerdi tilbage og gem foerst derefter

⚠️ Og: udklipsholderen blev overskrevet af en anden proces midt i forloebet. Tjek den
umiddelbart foer indsaettelsen, aldrig kun da du fyldte den.

## §1 Detailed description - replace the whole thing

Google's own listing guidance: an overview paragraph, then a short feature list; keywords only
where they name a real feature; keyword stuffing can get an item suspended. This follows that
shape and leads with the two-parts warning, because a store-only install lands on "Not connected"
and that is the single biggest cause of an install that never becomes a user.

```
Browser MCP gives Claude Code, Codex, Cursor, VS Code and Windsurf control of the
Chrome you already use - the one with your sessions, your cookies, your logins.
Not a fresh headless browser that hits a login wall on the first page.

⚠ READ FIRST - THIS EXTENSION IS HALF OF BROWSER MCP

Browser MCP is a Chrome extension PLUS a local MCP server. This page can only give
you the extension. On its own it will sit on "Not connected" forever, because there
is no server for it to talk to. The other half takes one paste.

═══ SETUP ═══

1. Install this extension (you are here).

2. Paste this to your AI assistant. It sets up the other half itself,
   whether you are in Claude Code, Cursor, Codex, VS Code, Windsurf or Cline:

   ----------------------------------------------------------------
   Set up Browser MCP for me. Read https://browsermcp.dev/llms-install.md
   and follow it for whichever AI client you are running in. One step
   only I can do - tell me which one, and wait for me. When I confirm,
   call browser_list_tabs to prove both halves are talking.

   If you cannot open URLs: npx @agent360/browser-mcp install --skip-extension
   (it registers the server in Claude Code, Codex, VS Code and Cursor; in
   other clients, add it by hand as below)
   ----------------------------------------------------------------

3. Restart your AI client when it tells you to. A green badge appears on the extension's icon
   the first time the browser is actually used - no badge before that is normal.

Rather do it by hand? Pick your client:

   Claude Code:
      claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest

   OpenAI Codex:
      codex mcp add browser-mcp -- npx @agent360/browser-mcp@latest

   Cursor / Windsurf - add to that client's MCP config:
      {"mcpServers": {"browser-mcp": {"command": "npx",
       "args": ["@agent360/browser-mcp@latest"]}}}

   VS Code - same block, but the root key is "servers" (in mcp.json).

   Per-client guides: https://browsermcp.dev/docs/install-claude-code/

Why two steps? Chrome does not allow an extension to install itself from npm, and
npm cannot install a Chrome extension. Neither half can install the other, so you
install each once.

Stuck on "Not connected"? https://browsermcp.dev/docs/troubleshooting/

═══ WHAT TO SAY ONCE IT WORKS ═══

Nothing happens until you ask. Paste one of these to your agent (put your own
site where it says example.com):

  "Open example.com and take a screenshot."
     Start here - a screenshot back means both halves are talking.

  "Open Gmail and tell me who sent my last 3 emails."
     The one that shows the difference: it works because it is YOUR
     browser, already signed in. A fresh browser without your login would
     hit a login wall here.

  "Go to my analytics dashboard, pull this month's numbers, and put
   them in a table."
     A dashboard you are already logged into, when the numbers are on the
     page - no API key, no export.

  "Fill in the signup form at example.com/signup with my details. Stop
   and ask me before anything sensitive."
     You stay in the loop for passwords and payment details.

  "Log me in at app.example.com. If it emails a code, open Gmail, read
   the code and continue."
     No email API to set up - it reads the code the way you would.

The pattern: many of the browser tasks you would do yourself, on sites you
are already signed into. Strongest where there is no API - internal
dashboards, admin panels, portals.

═══ WHAT IT CAN DO ═══

40 tools, including:

  • Navigate, click, double-click, right-click, hover, scroll, press keys
  • Read page content, extract lists, take screenshots, read console logs
  • Fill forms, including React and Vue controlled inputs, dropdowns,
    comboboxes, date pickers and file uploads
  • Work inside iframes, switch and close tabs, wait for network activity
  • Read and write cookies and localStorage, extract API tokens
  • Detect CAPTCHAs (reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile,
    FunCaptcha): it tries the reCAPTCHA checkbox; for an image grid your
    agent takes a screenshot and picks the cells; if that does not work,
    it asks you to finish it yourself
  • Ask you directly - an in-page dialog for 2FA codes, passwords and
    anything else it should not decide alone

═══ TWENTY AGENTS, ONE BROWSER ═══

Up to 20 agent sessions can use one Chrome at the same time. Each MCP server
gets its own colour-coded tab group, can only see its own tabs, and can hold up
to 20 of them. Clients that start one server per chat, such as Claude Code, get
one group per chat; chats that share a server share its group. When the server
goes away, its tabs close with it.

═══ WHAT IT DOES WITH YOUR DATA ═══

Nothing is sent to us. The extension takes its orders from one place: a server
on 127.0.0.1 that you started. The pages your agent opens, and the HTTPS calls
of browser_fetch, go to the sites you point it at. There is no account, no telemetry, no server of ours,
and no payment. What your agent reads goes to your AI client and its model
provider, the same as anything else you show it. The extension keeps a short local log of the agent's recent actions, with
cookie, storage and script reads highlighted, so you can look at what
happened.

═══ WHAT IT CANNOT DO ═══

In a tab you are not looking at, the agent can navigate, read, screenshot,
run scripts, click, and fill a field it finds by CSS selector. It cannot press
keys, hover, double-click, right-click, click by coordinate, type into a
combobox, or fill a field found by its visible text - Chrome does not deliver
mouse and keyboard events to a tab that is not the visible one in its window.
When one of those is needed, the tool says so instead of failing silently,
and the agent can bring the tab in front of you with browser_switch_tab. This is a Chrome limitation, not a bug we
are about to fix.

MIT licensed, source at https://github.com/Agent360dk/browser-mcp
```

---

### Known limitation to keep in the listing

In a tab you are not looking at, the agent can navigate, read, screenshot, run scripts, click
and fill a field it finds by CSS selector. Chrome does not deliver mouse and keyboard events to a tab that is not the visible one in
its window, so key presses, hover, double-click, right-click, coordinate clicks, combobox typing and filling a field found by its text fail with an
error that says so, and the agent can then bring that tab in front of you with browser_switch_tab. ~~Fully hands-off background work is the goal for 1.30.~~ **Trukket tilbage 20/9:** 1.30 er ude og
leverede det ikke. Chrome leverer ikke input til en tab der ikke er den synlige i sit vindue - det er
maalt, ikke antaget, og det er ikke noget vi kan rette. Formuleringen ovenfor staar nu i selve
indsaet-teksten som en begraensning, ikke som et loefte.

## §2 Images - replace all three, add the two tiles

The three live images are not product screenshots. They are cropped captures of the *old website*,
dated 3 May. `docs/screenshots/multi-session.png` - the one whose name promises the differentiator -
shows the April-2025 hero *"Your AI can't use a browser. Until now."*, a large empty black box, and
`npx @agent360/browser-mcp install` as the install command, which copies extension files but does
not register the server. It sold the exact failure this listing rewrite exists to fix. Delete all
three; do not reuse.

Google's rule for screenshots is that they must *"demonstrate the actual user experience, focusing
on the core features and content."* So four of the five below are the product's own interface -
the popup, the session cards, the action log and the in-page dialog are rendered from
`extension/popup.html` and the overlay code in `extension/background.js`, not drawn freehand.

New set: `docs/store-2026-09-08/`, upload in this order.

⛔ **12/10 (R90 Astra + Opus): upload INGEN af `01.png`-`05.png`.** 01 siger «the icon stays red» (ikonet skifter aldrig; badget er tomt), 03 siger at
agenten kan læse koden fra «your own Gmail tab» (den ser kun sine egne faner) og «It never guesses», 05 siger «Solves CAPTCHAs» og «Asks before
anything sensitive» (at spørge er agentens valg, ikke en spærre), og kilden `demo-video-src/src/Store.tsx` (l.116, 205-209, 301-319) siger det samme.
Genrender først efter rettet kilde, og læs hvert billede mod koden. Herunder: hvorfor 02 og 04 blev trukket tilbage først.

⛔ **12/10 (R89 Astra): upload IKKE `02.png` og `04.png`.** 02 siger «Each chat claims its own…» og «Close a chat, its tabs go with it»
(adskillelsen følger MCP-serveren); 04 siger «Every action, written down» og at udvidelsen kun taler med localhost (loggen er kort, og
`browser_fetch` laver HTTPS-kald), og den farver `ask_user`/`fill` følsomme, som koden ikke gør. Kilden `demo-video-src/src/Store.tsx`
(l.155, 183, 266) siger det samme, så en genrendering skal ske efter rettet kilde. Billedtekst 2 og 4 nedenfor er trukket tilbage.

| # | File | Shows | Caption (optional in the store) |
|---|---|---|---|
| 1 | `01.png` | The popup in its real not-connected state, with the setup card and the command | Two parts: this extension plus one command. The extension tells you so itself. |
| 2 | `02.png` | Real Chrome tab strip with four agent groups, plus the popup listing who owns what | ⛔ trukket tilbage 12/10 - se ovenfor |
| 3 | `03.png` | The in-page dialog asking for a 2FA code, over a dimmed login page | It asks you. It never guesses. |
| 4 | `04.png` | The action log, sensitive entries in amber | ⛔ trukket tilbage 12/10 - se ovenfor |
| 5 | `05.png` | 40 tools · 20 sessions · 9 integrations · $0, plus the capability chips | Free, MIT, open source. Works with Claude Code, Codex, Cursor, VS Code, Windsurf. |

Two more image fields, both empty today:

- `promo-tile-440x280.png` - the **small promo tile**, which is what appears in store search results
  and on category pages. Without it the listing is weaker in exactly the place people browse.
- `marquee-1400x560.png` - the **marquee**, used only if the store features an extension. It costs
  nothing to have and cannot be earned without it.

Source: `demo-video-src/src/Store.tsx`, compositions `Store` (1280×800, one slide per frame),
`PromoTile` and `MarqueeTile`. Re-render:
`cd demo-video-src && ./node_modules/.bin/remotion still Store out.png --frame=N`.
The tab strip is `demo-video-src/public/fanegrupper.png`, cropped from
`assets/raw-2026-09-07/fanegrupper-live.png` - the crop drops the fifth group on purpose, because
the raw capture shows *two* groups both labelled "Claude 1", which was issue #17, fixed the same day.

---

## §3 The video slot is empty

A CWS listing can carry a YouTube video that shows above the screenshots. Ours is unset, and there
is no YouTube link anywhere in this repo. `docs/demo.mp4` exists but is from 20 June - before
v1.29.0, before 40 tools, before the port-on-use change - so it is stale as well as unhosted.

This is the highest-leverage empty field after the screenshots, and it is also the most work: the
video has to be re-cut against the current product, uploaded to YouTube (unlisted is fine) and
pasted in. Worth doing, not worth blocking the text and image fixes on.

---

## §4 The store icon - a decision, not a fix

The icon today is a blue-gradient rounded square with a white four-point sparkle, shared with
browsermcp.dev's `docs/logo.svg`. Two things are true about it:

- It is **generic**. A blue gradient plus a sparkle is the default AI-product mark; a dozen
  extensions in the same search results are within a shade of it. Google's own icon guidance asks
  for something *"simple and recognizable to your brand"* - this is simple but recognizes nothing.
- Because it is generic, "someone copied our logo" is very hard to establish, and equally hard to
  act on. A search on 8 Sept found no extension using the Agent360 mark. What it did find is
  **Yolo Chrome MCP for Claude** (SeedX LLC, 3,000 users, updated 25 Aug), whose pitch - *"turns
  your real, logged-in Chrome session into a tool Claude can drive"* - is our positioning almost
  word for word. That is the real copying, and it is of the words, not the picture.

**Recommendation: do not adopt the Agent360 corporate logo, and do replace the sparkle.**

Adopting the corporate mark works against the goal. Nobody searches the Chrome store for Agent360;
they search for browser MCP. The publisher line already says "Agent360 Group ApS" directly under
the title, which is where the company-behind-it trust actually comes from. And if a copycat really
is using the Agent360 mark, moving *onto* that mark increases the collision instead of ending it -
the lever against impersonation is a report under the store's impersonation policy and the
publisher name, never the icon.

What the icon should be instead is a mark specific to Browser MCP that survives 16 px in the
toolbar. One caveat worth pricing in: 736 people currently find this extension in their toolbar by
its icon. Change it once, deliberately, and then never again.

If you want to move on this, the next step is a handful of concrete marks to choose between, not
a swap to the corporate logo. Say the word and I will draw them.

---

## §5 Privacy tab - worth a read-through, not yet audited

The listing's privacy section carries a single-purpose statement and one justification per
permission. This extension requests eleven permissions, `debugger` among them, plus `<all_urls>` - the
heaviest combination the store allows without special review. Those justification fields are what
a reviewer reads, and they are also shown to users. Nothing in this repo tracks what is currently
written in them, so they need a read-through in the dashboard before the next submit. If they still
describe a 29-tool extension, they carry the same drift as the description.

---

## §6 Zero reviews at 861 users is a ranking problem

Google ranks store items on a heuristic that includes user ratings and the download-versus-uninstall
trend. 861 users and no reviews at all means the ratings input is empty. The README already carries
an ungated review request; the listing description should not beg, but the popup's connected state
is the right place to ask once, at the moment it just worked.

Not urgent, and not something to fake. Worth one deliberate ask.

---

## Notes for next time

- The summary field is **generated from `extension/manifest.json`'s `description`** on publish.
  Editing it in the dashboard is temporary; edit the manifest.
- Do not put a hard tool count in the summary unless the matching npm version ships at the same
  time - the count belongs to the MCP server, not the extension, and the two halves drift apart the
  moment only one publishes. The stale "29" is exactly that drift, twice over.

---

# ⛔ MÅLT PÅ DEN LEVENDE LISTNING 19/9-2026 — fire usandheder står der stadig

Audit'en ovenfor er fra 8/9. **Intet af den detaljerede beskrivelse er rettet siden.** Målt
direkte på den offentlige butiksside i dag (973 brugere, 0 anmeldelser, v1.29.2):

| Står live | Sandt | Hvorfor det betyder noget |
|---|---|---|
| «Restart Claude Code - **29 browser tools** are now available» | **40** | Summary-feltet siger 40. Listningen modsiger sig selv på samme side |
| «Run **10 concurrent** AI sessions in one Chrome» | **20** | Portspændet 9876-9895 |
| «Auto-clicks reCAPTCHA checkbox (**~80% pass rate** with Google login)» | **Umålt** | Tallet findes kun her. Ingen måling bag det, nogen steder. Succesrate-påstand om CAPTCHA i det ene område butikkens review behandler som følsomt |
| «CAPTCHA SOLVING (**UNIQUE** - no other browser MCP has this)» | **Falsk** | Vores egen kapabilitets-tabel siger *Partly* om CAPTCHA, og «ingen andre har det» er en konkurrentpåstand vi ikke kan holde |

## Paste-klar erstatning for de fire afsnit

⛔ **AFLØST 12/10 af hele §1** (`BUTIKSTEKST-1.30.2`): brug ikke blokkene herunder; de har bl.a. «often clears it» uden måling.

**Installations-linjen:**
> 3. Restart your client - 40 browser tools are now available

**Multi-session-linjen:**
> • Run up to 20 concurrent AI sessions in one Chrome
> • Each session gets its own colour-coded tab group

**Hele CAPTCHA-afsnittet** (erstat blokken, inklusive overskriften):
> CAPTCHA AND 2FA - THE PART OTHER TOOLS HAND BACK TO YOU:
> • Detects reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, FunCaptcha
> • Tries the reCAPTCHA checkbox first, which often clears it when you are signed in to Google
> • Hands the image-grid case to the model to look at
> • If it still cannot be solved, it asks you on your own screen and carries on in the same tab
>
> We publish no success rate, because we have not measured one. What the tool does is described
> above; what it cannot do, it says out loud instead of reporting success.

**Hvorfor ordlyden er ændret og ikke bare tallet:** «~80 %» var det eneste sted i hele produktet
hvor vi opgav en succesrate uden måling bag. Et nyt tal ville være samme fejl i ny indpakning.
Beskrivelsen af mekanikken er både sand og mere overbevisende - og den er den eneste af de fire
rettelser der også fjerner en risiko i butikkens review.

## Hvad der IKKE kan rettes herfra

Listningen bor i CWS-dashboardet. Ingen commit og intet script rører den - heller ikke
`publish:cws`, som kun uploader pakken. Det kræver login på
<https://chrome.google.com/webstore/devconsole/> → Agent360 Browser MCP → Store listing.

**12/10: erstat HELE den detaljerede beskrivelse med §1-blokken** (ikke kun enkelte sætninger - den levende tekst er en ældre udgave),
gem den som kladde, og lad udgivelsen indsende pakken. Efterprøv bagefter, at §1 står live, med anden kommando herunder.

**Efterprøv efter rettelsen - hele teksten, ikke stikprøver** (R90: de gamle kontroller søgte kun efter enkelte strenge og kunne melde
«rent» om en forkert tekst; «UNIQUE» findes desuden altid i Googles egen D-U-N-S-tekst). Kør fra repoets rod; den sammenligner HELE
§1-blokken i denne fil, med mellemrum udjævnet, med butikssidens tekst og navngiver den første linje der mangler:

```
curl -s -L "https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl" > /tmp/butik.html
python3 - /tmp/butik.html <<'PY'
import sys,re,html
side=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',open(sys.argv[1],encoding='utf-8').read())))
s=open('noter/CWS_LISTING_TEXT.md',encoding='utf-8').read(); i=s.index('## §1 Detailed description'); a=s.index('```\n',i)+4; blok=s[a:s.index('\n```',a)]
mangler=[l.strip() for l in blok.splitlines() if l.strip() and re.sub(r'\s+',' ',l.strip()) not in side]
print('hele §1 live' if not mangler and re.sub(r'\s+',' ',blok).strip() in side else 'MANGLER: '+(mangler[0] if mangler else 'rækkefølge/ombrydning'))
PY
```
