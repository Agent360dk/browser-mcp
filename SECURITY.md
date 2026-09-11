# Security

Browser MCP drives a real, signed-in Chrome, so a security problem in it can reach the user's accounts. Please report it privately.

## How to report

Email **hello@agent360.dk** with:

- what an attacker could do, and what they need first (for example: a web page the agent visits, another program on the same machine, a malicious MCP client),
- the steps to reproduce it,
- the Browser MCP version (`browser_about` prints it) and the Chrome version.

Please do not open a public GitHub issue for a security problem.

## Supported versions

Fixes land in the latest release on npm (`@agent360/browser-mcp`) and the Chrome Web Store. Older versions are not patched separately.

## Known limits

These are documented on the [privacy page](https://browsermcp.dev/privacy.html) and are not treated as new reports:

- The localhost WebSocket bridge between the extension and the MCP server is not password-protected. Any software already running on the same computer could connect to the same local ports (9876-9895). Removing or disabling the extension closes it.
- What the agent reads from a page is passed to the user's own AI client and its model provider, like anything else the user shows that client.
