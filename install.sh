#!/bin/bash
# Agent360 Browser MCP — Install Script
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Agent360 Browser MCP Setup ==="
echo ""

# 1. Install MCP server dependencies
echo "1. Installing MCP server dependencies..."
cd "$SCRIPT_DIR/mcp-server"
npm install --silent
echo "   Done."

# 2. Instructions
echo ""
echo "2. Load Chrome Extension:"
echo "   → Open chrome://extensions"
echo "   → Enable Developer mode (toggle top-right)"
echo "   → Click 'Load unpacked'"
echo "   → Select: $SCRIPT_DIR/extension"
echo ""

# 3. Add to Claude Code MCP config
echo "3. Add to ~/.claude/mcp.json:"
echo '   "agent360-browser": {'
echo '     "command": "node",'
echo "     \"args\": [\"$SCRIPT_DIR/mcp-server/index.js\"]"
echo '   }'
echo ""
echo "=== Done! Restart Claude Code to use browser tools. ==="
