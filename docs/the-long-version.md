# The long version - install, step by step

The four steps in the [README](https://github.com/Agent360dk/browser-mcp/blob/main/README.md#the-whole-thing-in-four-steps) are the install. This is the same path with the file-picker, the zip, and the store-only route.

> **Browser MCP is two halves and you need both:** a **Chrome extension** (drives the browser) and a **local MCP server** (what your agent actually talks to). Installing only the extension - e.g. straight from the Chrome Web Store - leaves it stuck on *"Not connected"*, because there is no server for it to reach. Chrome cannot install the server, and npm cannot install the extension. Hence two steps.

### Step 1: Register the MCP server with Claude Code

```bash
claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
```

That is Claude Code's own MCP command, so the entry lands in the config Claude Code actually reads. `--scope user` makes it available in every project.

Want the extension files on disk for the unpacked install in Step 2? Also run:

```bash
npx @agent360/browser-mcp install
```

It copies the extension to `~/.browser-mcp/extension/` and **prints that path in the terminal - copy it.** (It also registers the server with Claude Code, Codex, VS Code and Cursor if it finds them.)

### Step 2: Load the extension in Chrome

> Chrome won't let extensions install themselves from npm - you load it manually one time. To **update** later, re-run the install command and reload it (see [Keeping it updated](https://github.com/Agent360dk/browser-mcp/blob/main/README.md#keeping-it-updated)). Prefer the [Chrome Web Store](#chrome-web-store-no-developer-mode-auto-updating-extension) install if you'd rather have the extension auto-update.

1. **Open Chrome** and type `chrome://extensions` in the address bar
2. **Toggle "Developer mode"** ON (top right corner)
3. **Click "Load unpacked"** (top left, next to "Pack extension")
4. **Navigate to `~/.browser-mcp/extension/`** and click "Select"
   - On Mac: Press `Cmd+Shift+G` in the file picker, paste `~/.browser-mcp/extension/`, press Enter
   - On Windows: Paste `%USERPROFILE%\.browser-mcp\extension\` in the address bar (Windows is not yet verified: our automated tests do not pass there)
   - On Linux: Type `~/.browser-mcp/extension/` in the path field
5. **Restart Claude Code** so it picks up the new MCP server

That's it. The Browser MCP icon will appear in your toolbar, and 40 browser tools are now available in Claude Code.

### Alternative: Manual zip download (no npm)

If you don't want to use npm, download the extension directly:

1. [Download the extension zip](https://github.com/Agent360dk/browser-mcp/releases/latest) (`agent360-browser-mcp-<version>.zip`) from the latest GitHub release
2. Unzip the file (anywhere - e.g. `~/Downloads/browser-mcp-extension/`)
3. Follow Step 2 above, but select the unzipped folder instead of `~/.browser-mcp/extension/`
4. Register the server - run `claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest`, or add this to `~/.claude.json` by hand:
   ```json
   {
     "mcpServers": {
       "browser-mcp": {
         "command": "npx",
         "args": ["@agent360/browser-mcp@latest"]
       }
     }
   }
   ```

### Chrome Web Store (no Developer mode, auto-updating extension)

**This replaces Step 2 only - you still need Step 1.**

1. [**Install the extension from the Chrome Web Store →**](https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl) - no Developer mode toggle, and Chrome keeps it updated for you.
2. Register the MCP server:
   ```bash
   claude mcp add --scope user browser-mcp -- npx @agent360/browser-mcp@latest
   ```
   (For Cursor / VS Code / Codex, use that client's own MCP config instead - see [browsermcp.dev/docs](https://browsermcp.dev/docs/install-claude-code/).)
3. Restart Claude Code.

Skip step 2 and the extension icon will sit on **"Not connected"** forever - that is the symptom of a missing MCP server, not a broken extension.
