// KILDE: MCP-protokol-fakta holdt til det verificerbare (åben standard fra Anthropic, JSON-RPC, stdio/HTTP-transport, tools/resources/prompts, officielt registry). Ingen version-specifikke påstande. Vores information-gain = vi shipper selv en server (34 tools) og skriver fra den vinkel. Pillar targeting "model context protocol"-klyngen (~19.250/md).

# Model Context Protocol (MCP), explained — by someone who ships a server

*Suggested URL: `/learn/model-context-protocol` · Suggested title tag: "Model Context Protocol (MCP), Explained Simply (2026)" · Suggested meta description: "What MCP actually is, why it exists, and how the pieces fit — written from the perspective of maintaining a real MCP server rather than restating the spec." · Last verified: July 22, 2026*

---

**Short answer:** the Model Context Protocol is an open standard, originally from Anthropic, that defines *how an AI application talks to an external capability*. Instead of every AI app inventing its own plugin format, MCP gives one contract: a **client** (Claude Code, Cursor, VS Code agent mode, and others) connects to a **server** that exposes tools the model can call. Write the server once, and every MCP-speaking client can use it.

## The problem MCP solves

Before a shared protocol, connecting an AI assistant to your database, your browser or your ticketing system meant a bespoke integration per assistant. Every vendor had a different plugin shape, so the same capability got rebuilt N times and none of it was portable. MCP collapses that into one interface: capability authors implement the protocol, client authors implement the protocol, and the two sides meet in the middle.

The analogy people reach for is USB-C — and it's a fair one, as long as you remember what it means in practice: **the win isn't magic, it's that nobody has to negotiate a private format anymore.**

## The pieces, in plain terms

| Piece | What it is |
|---|---|
| **Host / client** | The AI app the human uses — Claude Code, Cursor, VS Code agent mode, Codex CLI. It manages the model and decides when to call something |
| **Server** | A program exposing capabilities. It advertises what it can do; it does not contain the model |
| **Tools** | The callable actions a server offers — the thing the model actually invokes ("navigate to this URL", "run this query") |
| **Resources / prompts** | Context a server can expose for reading, and reusable prompt templates |
| **Transport** | How the two talk. **stdio** for a server running locally on your machine; **HTTP** for one running remotely |

Messages are JSON-RPC. The practical consequence for you: a local server is just a process on your machine that speaks a documented format on stdin/stdout — there's no cloud in the loop unless the server itself puts one there.

## Local vs remote — the distinction that matters most

This is the part people get wrong, and it decides what a given server can actually do:

- **Local (stdio)** servers run on your machine, with your files, your network position and your logged-in state. That's what makes things like driving your own browser possible — and it means nothing has to leave your computer.
- **Remote (HTTP)** servers run somewhere else. Easier to distribute, but they only ever see what you send them.

Neither is better; they answer different questions. A server that needs to touch *your* environment has to be local.

## What it looks like when you ship one

We maintain [Browser MCP](/docs/what-is-browser-mcp/), a local stdio server that gives an agent control of the real Chrome you're already signed into. From the inside, the protocol's value is exactly the boring promise above: we implemented the tool interface once, and it works in Claude Code, Cursor, VS Code, Codex and anything else that speaks MCP — without us shipping five integrations. Servers are also discoverable through the official MCP registry, so clients can find them rather than requiring hand-configuration forever.

## FAQ

**Who created MCP?**
Anthropic introduced it as an open standard; it's since been adopted well beyond Anthropic's own products.

**Is MCP only for Claude?**
No. Claude Code was an early client, but Cursor, VS Code agent mode, Codex CLI and others speak it too. That portability is the whole point.

**Do I need to write code to use it?**
No — using an existing server is a config entry in your client. Writing one requires code.

**Is an MCP server a security boundary?**
No, and you shouldn't treat it as one. A local server runs with your permissions. Install servers you trust, and prefer ones whose source you can read.

**Where do I start?**
Pick a client you already use and add one server. If you want the browser one, [installing Browser MCP](/docs/install-claude-code/) takes about a minute.
