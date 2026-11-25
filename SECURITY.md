# Security

Browser MCP drives a real, signed-in Chrome, so a security problem in it can reach the user's accounts. Please report it privately.

## How to report

Use GitHub's private vulnerability reporting: **[Report a vulnerability](https://github.com/Agent360dk/browser-mcp/security/advisories/new)**
(the Security tab of this repository). Only the maintainers see the report. If you cannot use GitHub, email **hello@agent360.dk**.

Include:

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

## Before Browser MCP's code runs

`npx @agent360/browser-mcp` reads npm's settings and packages in the folder it is run from, in the nearest folder above it that has a `package.json` or `node_modules`, and in a folder further up whose `package.json` lists it as a workspace. A folder you do not trust can point npm to another registry with a `.npmrc`, replace the package with its own copy in `node_modules`, or, on Windows, where npx starts the package through `cmd.exe`, put a program there that runs first - all before Browser MCP's own code runs. Start the server and the installer from a folder you trust, such as your home folder, and do not keep a `node_modules`, `package.json` or `.npmrc` you did not create in a folder above it (on Windows, any user can create `C:\node_modules`).
