# Contributing to Browser MCP

Thanks for your interest in contributing! Browser MCP is open source and welcomes contributions of all kinds.

## Quick Start

```bash
# Clone the repo
git clone https://github.com/Agent360dk/browser-mcp.git
cd browser-mcp

# Install MCP server dependencies
cd mcp-server && npm install && cd ..

# Load extension in Chrome
# 1. Go to chrome://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked"
# 4. Select the extension/ folder

# Add to Claude Code
claude mcp add browser-mcp node mcp-server/index.js

# Test it
# Open Claude Code and try: browser_navigate("https://example.com")
```

## Project Structure

```
extension/           # Chrome extension (Manifest V3)
  background.js      # Service worker — all browser automation logic
  manifest.json      # Extension config + permissions
  offscreen.js       # WebSocket bridge to MCP server
  popup.html/js      # Status UI

mcp-server/          # MCP server (Node.js)
  index.js           # MCP server + WebSocket client
  tools.js           # 29 tool definitions
  bin/cli.js         # CLI installer
  package.json       # npm config

docs/                # Landing page (browsermcp.dev)
assets/              # Demo video + GIF
```

## How to Contribute

### Bug Reports
Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser MCP version (`manifest.json` version field)

### Feature Requests
Open an issue describing:
- The use case (what are you trying to do?)
- Proposed solution
- Alternatives you considered

### Code Contributions

1. Fork the repo
2. Create a branch: `git checkout -b my-feature`
3. Make your changes in `extension/background.js` (browser logic) or `mcp-server/tools.js` (tool definitions)
4. Test locally with Claude Code
5. Commit: `git commit -m "feat: add my feature"`
6. Push: `git push origin my-feature`
7. Open a Pull Request

### Adding a New Tool

1. Add tool definition in `mcp-server/tools.js`:
```javascript
{
  name: 'browser_my_tool',
  description: 'What it does',
  inputSchema: {
    type: 'object',
    properties: { /* params */ },
  },
}
```

2. Add handler in `extension/background.js` (in the switch/case block):
```javascript
case 'my_tool': {
  const tab = await getSessionTab(port);
  // implementation
  return { ok: true };
}
```

3. Add to methodMap in `mcp-server/index.js`:
```javascript
browser_my_tool: 'my_tool',
```

4. Update README tool count and table.

### Non-Code Contributions

These are equally valuable:
- Documentation improvements
- README translations (create `README.zh-CN.md`, `README.ja.md`, etc.)
- Bug reports with clear reproduction steps
- Sharing Browser MCP in your community

## Code Style

- No build step — plain JavaScript (ES modules)
- `const` over `let`, `let` over `var`
- Async/await over callbacks
- Error messages should be helpful (include what went wrong + how to fix)
- Comments only for non-obvious "why", not "what"

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
