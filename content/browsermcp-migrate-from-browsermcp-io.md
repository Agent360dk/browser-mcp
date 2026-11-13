// KILDE: tvillingens vaerktoejsnavne laest 19/9-2026 ud af den udgivne pakke `@browsermcp/mcp@0.1.3` (npm pack + grep i dist/) og genlaest 13/11-2026: 0.1.3 har 13 browser_*-navne, 2.0.0 har 0 og ét vaerktoej `browser`, 2.5.0 definerer 30 kommandoer + `help` (dist/daemon.js). Vores 40 fra `mcp-server/tools.js`. Hentninger (6.-12. nov.), issues (search-API, is:issue) og commit-datoer (hele /commits-listen: sidste foer hullet 9db12f2 24/4-2025, foerste efter 43bcd1d 27/10-2026) genmaalt 13/11-2026. ⛔ Ingen relative tider - skriv datoparret. ⚠️ browser_go_back, browser_go_forward og browser_drag findes IKKE hos os - det staar paa siden, fordi en migrationsside der skjuler et hul er en faelde.

# Moving from browsermcp.io

*Suggested URL: `/migrate/from-browsermcp-io` · Suggested title tag: "Migrate from browsermcp.io to Browser MCP by Agent360 (2026)" · Suggested meta description: "Same idea, different package. Seven of thirteen tools have the same name. Here is the config diff, the three that are renamed, and the three we do not have." · Last verified: November 13, 2026*

---

**Short answer:** change one line in your config. If your prompts were written for their `0.1.3`, seven of its thirteen tool names are identical here, three have a different name, and three do not exist here. That last list is the reason to read on before you switch.

## Why you might be here

`@browsermcp/mcp`'s public GitHub repo went eighteen months without a commit - 24 April 2025 to 27 October 2026 - and it has shipped six npm versions since, `2.0.0` on 26 October to `2.5.0` on 12 November 2026. It got 33,714 npm downloads in the week of 6-12 November 2026, and its tracker shows 1 open issue and 183 closed (measured 13 November 2026).

**Which version you are on changes this page.** The tool-name mapping below was measured against `0.1.3`, the version that stood through those eighteen months. `2.0.0` replaced those thirteen tools with a single tool called `browser` that takes command lines (30 commands in `2.5.0`), and every 2.x since keeps that shape. So if `npx @browsermcp/mcp@latest` has already upgraded you, none of the old names exist on their side any more, and your prompts need rewriting whichever way you go.

If it does what you need, **there is no reason to switch.** A tool that works for you, with your habits around it, is worth more than a newer one. This page is for the case where you would rather move than rewrite, or need something theirs does not do.

## The config change

Everything else about MCP registration stays the same. Only the package changes:

```diff
 {
   "mcpServers": {
     "browser-mcp": {
       "command": "npx",
-      "args": ["@browsermcp/mcp@latest"]
+      "args": ["-y", "@agent360/browser-mcp@latest"]
     }
   }
 }
```

You also need **our** Chrome extension - theirs will not talk to this server, and both of them wanting the debugger at once is its own kind of bad day. Remove theirs, or disable it: [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

## Checking it worked

```
You:     Open example.com and take a screenshot.

Claude:  [browser_navigate, then browser_screenshot]
         <image>
```

If you get an image back, the migration is done. If you get *"I don't have
browser access"*, the client is still holding the old server - restart it.

## Their `0.1.3` tool names: seven are identical

`browser_click` · `browser_hover` · `browser_navigate` · `browser_press_key` · `browser_screenshot` · `browser_select_option` · `browser_wait`

The names match, but four of the seven take different arguments: our `browser_click`, `browser_hover` and `browser_select_option` take a CSS `selector` (and `option` rather than `values`) instead of a snapshot `ref`, and our `browser_wait` waits for a selector rather than a number of seconds, so a call like `{"time": 1}` fails here. Check each call before you switch.

## Three have a different name

| Theirs | Ours | Note |
|---|---|---|
| `browser_type` | `browser_fill` | Same job. Ours reads the field back afterwards and tells you if the framework did not hear it |
| `browser_snapshot` | `browser_get_page_content` | Ours takes `selector` and `max_chars`, so you can read one subtree instead of the whole page |
| `browser_get_console_logs` | `browser_console_logs` | Just the name |

## Three of theirs do not exist here

**`browser_go_back`, `browser_go_forward`, `browser_drag`.**

We do not have them. If your flow depends on browser history navigation or dragging, you will have to work around it - `browser_execute_script` can run `history.back()`, and drag has no equivalent. That is a real gap, not a rephrasing, and you should know it before you move rather than after.

## What you get that is not in their thirteen

The useful half of the difference is not the tools with matching names. It is the thirty that have no counterpart: `browser_ask_user` (it stops and asks you for a 2FA code, then carries on in the same tab), `browser_solve_captcha`, `browser_upload_file`, `browser_extract_token`, `browser_set_cookies`, `browser_wait_for_network`, `browser_list_frames` and `browser_select_frame` for cross-origin iframes, and twenty concurrent sessions each in its own colour-coded tab group.

And one difference that does not show up in a tool list: since 1.29.2 these tools measure whether the page actually received the action, rather than trusting that Chrome accepted the command. Nine of them used to answer yes when nothing had happened. [The whole story is written up here](/learn/tools-that-lie/), including the parts that went badly.

## Frequently asked questions

**Are these the same project?**
No. Two teams, two GitHub organisations, two npm packages, two Chrome extensions. The name overlap is a coincidence, not a fork.

**Can I run both at once?**
You can install both extensions, but you should not. Chrome allows one debugger per tab, so the two fight over it and every mouse, key and file tool starts failing with errors that point at the page rather than at the conflict.

**Will my existing prompts break?**
Where they name `browser_type`, `browser_snapshot`, `browser_get_console_logs` or one of the three we do not have, and where they call `browser_click`, `browser_hover`, `browser_select_option` or `browser_wait` with their arguments: a snapshot `ref`, `values`, or a number of seconds.

**Is it a drop-in replacement?**
No. Seven tool names match, but four of them take different arguments: ours take a CSS selector instead of a snapshot `ref`, and our `browser_wait` waits for a selector rather than a number of seconds. We would rather say "close, and here is the list" than "yes".
