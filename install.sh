#!/bin/bash
# Browser MCP by Agent360 - setup from a cloned repo.
#
# MEASURED 2026-09-11 (Fable, e2e review): the old version told you to add the server to a config file under ~/.claude
# that Claude Code does not read (see mcp-server/bin/cli.js), so the recipe looked right and did nothing. It now runs the
# package's own install, which registers the server with the clients you actually have (Claude Code, Codex, VS Code, Cursor).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Browser MCP by Agent360 ==="
echo ""
echo "1. Installing the server's dependencies..."
(cd "$SCRIPT_DIR/mcp-server" && npm install --silent)
echo "   Done."
echo ""

echo "2. Putting the extension in place and registering the server with your clients..."
node "$SCRIPT_DIR/mcp-server/bin/cli.js" install
echo ""

echo "Note: that registers the published server (npx @agent360/browser-mcp@latest)."
echo "To run THIS clone's code instead, register it directly:"
echo "  claude mcp add --scope user browser-mcp-dev -- node \"$SCRIPT_DIR/mcp-server/index.js\""
echo ""
echo "3. To load the extension from this clone rather than ~/.browser-mcp/extension:"
echo "   chrome://extensions → Developer mode → Load unpacked → $SCRIPT_DIR/extension"
echo ""
echo "Restart your AI client so it picks up the server."
