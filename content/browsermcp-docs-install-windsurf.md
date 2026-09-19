// KILDE: https://docs.windsurf.com/windsurf/cascade/mcp (hentet 19/9-2026) - den 307-redirecter til https://docs.devin.ai/desktop/cascade/mcp, hvilket er hvorfor siden naevner begge navne. Alle citater herunder er ordret derfra: stien `~/.codeium/windsurf/mcp_config.json`, "Cascade has a limit of 100 total tools that it has access to at any given time", "The MCP configuration on this page applies to the legacy Cascade agent only", "Enterprise users must manually turn this on via settings", "One-click install deeplinks require that the user's team has MCP access enabled". ⚠️ 100-vaerktoejs-loftet er ikke pynt: vi fylder 40 af dem. Skriv ALDRIG siden uden det afsnit.

# Install Browser MCP for Windsurf

*Suggested URL: `/docs/install-windsurf` · Suggested title tag: "Browser MCP for Windsurf: Drive Your Logged-In Chrome (2026)" · Suggested meta description: "Four steps. Cascade drives the Chrome you are already signed in to - your cookies, your sessions, your 2FA - instead of a fresh headless browser." · Last verified: September 19, 2026*

---

**Give Cascade control of your real, already-logged-in Chrome - about 90 seconds, four steps.** Your cookies, your sessions, your 2FA, instead of a blank browser that hits every login wall as a stranger.

## The whole thing, in four steps

**1 - Install the Chrome extension.** One click from the [Chrome Web Store](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl).

**2 - Open the MCP panel.** The **MCPs** icon in the top right of the Cascade panel, or **Settings → Cascade → MCP Servers**. There is a raw editor there for the config file.

**3 - Add the server.** Windsurf uses the same `mcpServers` shape as Claude Desktop:

```json
{
  "mcpServers": {
    "browser-mcp": {
      "command": "npx",
      "args": ["-y", "@agent360/browser-mcp@latest"]
    }
  }
}
```

The file is `~/.codeium/windsurf/mcp_config.json`. The `codeium` in that path is the old company name - it has not moved.

**4 - Say this, to check it worked.** In Cascade:

> Take a screenshot of my current Chrome tab.

You get an image back instead of *"I don't have browser access"*. **That's it - you're running.**

## The thing that will actually bite you: 100 tools

Windsurf's own wording: *"Cascade has a limit of 100 total tools that it has access to at any given time."*

Browser MCP is 40 of them. That is a large share of the budget, and it is a real trade-off rather than something to hide:

- Running Browser MCP plus two or three other large servers will push you over, and tools start disappearing from Cascade's view rather than announcing themselves.
- If you are near the limit, turn off servers you are not using in that session instead of trying to guess which tools got dropped.
- If you only ever use Browser MCP for logged-in pages and screenshots, you are still paying for all 40 definitions. There is no way to load a subset today, in Windsurf or anywhere else.

We would rather you knew that before installing than found it as a mystery three servers later.

## Two names, one product

Windsurf's MCP documentation now redirects to `docs.devin.ai`, and the page carries the note *"The MCP configuration on this page applies to the legacy Cascade agent only. The Devin Local agent - the default agent for new tabs..."*

So: the config above is for **Cascade**, which is the agent most Windsurf users are in. If you have switched to the Devin Local agent, check that page for its own MCP handling before assuming this applies. The config path still says `codeium`, the docs still say Windsurf in most places, and the domain says Devin. All three are the same product mid-rename.

## Things worth knowing before you hit them

**Enterprise has it off by default.** *"Enterprise users must manually turn this on via settings."* If the MCPs icon shows nothing and you are on a team plan, that is the first thing to check - it is an admin setting, not a broken install.

**One-click deeplinks need team access.** *"One-click install deeplinks require that the user's team has MCP access enabled."* On a personal plan, edit the file.

**The marketplace is a shortcut, not a requirement.** Cascade has an MCP marketplace in that same panel. Installing by hand from the JSON above does exactly the same thing.

**Tools, resources and prompts - all three.** *"We currently support an MCP server's tools, resources, and prompts."* Browser MCP uses tools.

## Frequently asked questions

**Why does the extension badge stay grey after step 3?**
The server only takes a port the first time real work arrives. Ask for a screenshot and the badge appears.

**Do I need to restart Windsurf after editing the file?**
Reload from the MCP panel. The docs do not document a file-watch, so assume none.

**Can I use this with the Devin Local agent instead of Cascade?**
The documented config is Cascade's. Check the Devin Local agent's own docs before assuming.

**Is `~/.codeium/windsurf/` right even though the product is called something else now?**
Yes. Verified against their live documentation on September 19, 2026.
