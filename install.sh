#!/bin/bash
# Agent360 Browser MCP — opsaetning fra et klonet repo.
#
# MAALT 11/9-2026 (Fable, e2e-review): den gamle udgave bad brugeren skrive serveren ind i en konfigurationsfil under
# ~/.claude som Claude Code ikke laeser (se mcp-server/bin/cli.js), saa opskriften saa rigtig ud og gjorde ingenting. Nu koeres pakkens egen
# install, som registrerer serveren hos de klienter der faktisk er installeret (Claude Code, Codex, VS Code, Cursor).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Agent360 Browser MCP ==="
echo ""
echo "1. Henter serverens afhaengigheder..."
(cd "$SCRIPT_DIR/mcp-server" && npm install --silent)
echo "   Faerdig."
echo ""

echo "2. Laegger udvidelsen paa plads og registrerer serveren hos dine klienter..."
node "$SCRIPT_DIR/mcp-server/bin/cli.js" install
echo ""

echo "3. Vil du koere udvidelsen fra dette repo i stedet for ~/.browser-mcp/extension:"
echo "   chrome://extensions → Developer mode → Load unpacked → $SCRIPT_DIR/extension"
echo ""
echo "Genstart din AI-klient, saa den henter serveren."
