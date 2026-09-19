// KILDE: tvillingens vaerktoejsnavne laest 19/9-2026 ud af den udgivne pakke `@browsermcp/mcp@0.1.3` (npm pack + grep i dist/). Vores 40 fra `mcp-server/tools.js` samme dag. Hentninger og commit-dato fra npm-API + GitHub-API 19/9. ⚠️ browser_go_back, browser_go_forward og browser_drag findes IKKE hos os - det staar paa siden, fordi en migrationsside der skjuler et hul er en faelde.

# Moving from @browsermcp/mcp to Browser MCP by Agent360

*Suggested URL: `/migrate/from-browsermcp-io` · Suggested title tag: "Migrate from browsermcp.io to Browser MCP by Agent360 (2026)" · Suggested meta description: "Same idea, different package. Nine of thirteen tools have the same name. Here is the config diff, the four that differ, and the three we do not have." · Last verified: September 19, 2026*

---

**Short answer:** change one line in your config. Nine of their thirteen tool names are identical, three have a different name, and three of theirs do not exist here. That last list is the reason to read on before you switch.

## Why you might be here

`@browsermcp/mcp` has not had a commit since **24 April 2025** and its npm version has been `0.1.3` since 11 April 2025. It still gets around 9,000 npm downloads a week, and there are 130 open issues, 59 of which have never had a reply.

If it does what you need, **there is no reason to switch.** A tool that works for you, with your habits around it, is worth more than a newer one. This page is for the case where you have hit something and nobody is answering.

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
You:     Take a screenshot of my current Chrome tab.

Claude:  [browser_screenshot]
         <image>
```

If you get an image back, the migration is done. If you get *"I don't have
browser access"*, the client is still holding the old server - restart it.

## Tool names: nine are identical

`browser_click` · `browser_hover` · `browser_navigate` · `browser_press_key` · `browser_screenshot` · `browser_select_option` · `browser_wait`

Those work unchanged. Prompts and scripts that name them keep working.

## Three have a different name

| Theirs | Ours | Note |
|---|---|---|
| `browser_type` | `browser_fill` | Same job. Ours reads the field back afterwards and tells you if the framework did not hear it |
| `browser_snapshot` | `browser_get_page_content` | Ours takes `selector` and `max_chars`, so you can read one subtree instead of the whole page |
| `browser_get_console_logs` | `browser_console_logs` | Just the name |

## Three of theirs do not exist here

**`browser_go_back`, `browser_go_forward`, `browser_drag`.**

We do not have them. If your flow depends on browser history navigation or dragging, you will have to work around it - `browser_execute_script` can run `history.back()`, and drag has no equivalent. That is a real gap, not a rephrasing, and you should know it before you move rather than after.

## What you get that is not in the thirteen

The useful half of the difference is not the tools with matching names. It is the twenty-seven that have no counterpart: `browser_ask_user` (it stops and asks you for a 2FA code, then carries on in the same tab), `browser_solve_captcha`, `browser_upload_file`, `browser_extract_token`, `browser_set_cookies`, `browser_wait_for_network`, `browser_list_frames` and `browser_select_frame` for cross-origin iframes, and twenty concurrent sessions each in its own colour-coded tab group.

And one difference that does not show up in a tool list: since 1.29.2 these tools measure whether the page actually received the action, rather than trusting that Chrome accepted the command. Nine of them used to answer yes when nothing had happened. [The whole story is written up here](/learn/tools-that-lie/), including the parts that went badly.

## Frequently asked questions

**Are these the same project?**
No. Two teams, two GitHub organisations, two npm packages, two Chrome extensions. The name overlap is a coincidence, not a fork.

**Can I run both at once?**
You can install both extensions, but you should not. Chrome allows one debugger per tab, so the two fight over it and every mouse, key and file tool starts failing with errors that point at the page rather than at the conflict.

**Will my existing prompts break?**
Only where they name `browser_type`, `browser_snapshot`, `browser_get_console_logs`, or one of the three we do not have.

**Is it a drop-in replacement?**
For nine of thirteen tools, yes. We would rather say "mostly, and here is the list" than "yes".
