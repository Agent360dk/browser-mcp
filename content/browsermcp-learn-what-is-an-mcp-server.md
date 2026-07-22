// KILDE: bevidst DIFFERENTIERET fra /learn/model-context-protocol (protokollen) — denne handler om KOMPONENTEN (hvad en server er, hvad den gør, hvordan man kører/vælger/bygger en). Undgår kannibalisering via distinkt intent + krydslink. Targeting "what is an mcp server"-klyngen (~28.500/md).

# What is an MCP server?

*Suggested URL: `/learn/what-is-an-mcp-server` · Suggested title tag: "What Is an MCP Server? A Practical Explanation (2026)" · Suggested meta description: "An MCP server is a program that gives an AI assistant a specific capability. What one actually is, what runs where, how to add one, and how to tell a good one from a bad one." · Last verified: July 22, 2026*

---

**Short answer:** an MCP server is a small program that hands an AI assistant one specific capability — reading a database, driving a browser, calling an API — through a standard interface. It contains no model and no intelligence of its own. It advertises a list of **tools**, and when the assistant decides to use one, the server does the work and returns the result. Most run locally on your own machine.

*(If you want the protocol itself rather than the component, start with [Model Context Protocol, explained](/learn/model-context-protocol/).)*

## What a server actually is

Strip away the terminology and a typical MCP server is: a process that starts when your AI client starts, says "here are the things I can do," waits, and executes requests. That's it. It's closer to a plugin than to a web server, despite the name — "server" here means "serves capabilities," not "runs in a data centre."

Two things follow from that, and they're the ones worth internalising:

1. **It runs with your permissions.** A local server can do anything you could do from a terminal on that machine. That's the source of both its power and its risk.
2. **It has no model.** The intelligence stays in the client. The server is the hands, not the brain.

## What runs where

| | Local (stdio) | Remote (HTTP) |
|---|---|---|
| Runs on | Your machine | Someone else's |
| Can reach | Your files, your network, your logged-in sessions | Only what you send it |
| Typical use | Filesystem, git, databases, your browser | Hosted SaaS APIs |
| Data exposure | Stays local | Leaves your machine |

If a capability needs *your* environment — your files, your VPN, the browser you're signed into — it has to be local. That's not a preference, it's a constraint.

## Adding one

For most clients it's a config entry naming a command to run. In Claude Code, for example, adding a server is a single `claude mcp add` command; Cursor and VS Code use a small JSON block. You don't build anything — you point your client at a program and restart it. Servers are increasingly discoverable through the official MCP registry rather than word of mouth.

## How to tell a good server from a bad one

Since a local server runs with your permissions, this matters more than feature lists:

- **Can you read the source?** Open source beats a promise. If it's closed and local, you're trusting a binary with your machine.
- **Does it phone home?** Check for telemetry. Plenty of tools collect more than they admit; the honest ones say exactly what leaves.
- **Is it maintained?** Look at the last commit, not the star count. Plenty of popular servers haven't shipped in a year.
- **Does the tool list match the claims?** A README claiming capabilities the tool definitions don't contain is a red flag.
- **Is the scope sane?** A server that wants everything is harder to reason about than one that does a single job well.

## An example: the browser

[Browser MCP](/docs/what-is-browser-mcp/) is a local stdio server plus a Chrome extension. Its single job is to let an agent operate the real, already-logged-in Chrome you use — 34 tools for navigating, reading, clicking, filling and screenshotting. It has to be local, because the whole point is your own browser session, and nothing it reads leaves your machine. It's a fair example of the pattern: narrow job, local by necessity, source you can read.

## FAQ

**Is an MCP server the same as an API?**
No. An API is a service you call; an MCP server is an adapter that makes some capability (which might be an API, or your filesystem, or your browser) available to an AI client in a standard shape.

**Do MCP servers cost money?**
The protocol and most servers are free and open source. Some wrap paid services, in which case you pay that service.

**How many can I run at once?**
Several — clients let you register multiple servers, and the assistant picks tools across them.

**Can an MCP server see my whole computer?**
A local one runs with your user permissions, so treat installing it like installing any local software: prefer readable source and a narrow scope.

**Which should I install first?**
Whichever removes a chore you actually repeat. If that's anything involving a logged-in website, [start here](/docs/install-claude-code/).
