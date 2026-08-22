#!/usr/bin/env node
/**
 * Agent360 Browser MCP Server
 *
 * Bridges Claude Code (stdio MCP) to Chrome Extension (WebSocket).
 * Auto-selects first available port in range 9876-9895 for multi-session support.
 *
 * Architecture:
 *   Claude Code ←(stdio)→ this process ←(WS :port)→ Offscreen Doc ←(sendMessage)→ Service Worker → Chrome APIs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import { execSync, execFile } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { TOOLS, PROVIDER_PAGES } from './tools.js';

// Read version from package.json — single source of truth, never drifts
const PKG_VERSION = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8')
).version;

// ── Auto-update on startup ─────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoDir = dirname(__dirname); // parent of mcp-server/

// FJERNET 22/8: her koerte `git pull --ff-only` + `npm install` ved hver serveropstart,
// med cwd = pakkens foraeldremappe. I en npm-installation er det node_modules/@agent360/ —
// og git soeger OPAD, saa kaldet landede i BRUGERENS EGET repo. Maalt: fra
// node_modules/@agent360 opløser git toplevel til det omkringliggende projekt.
// En agent-session maatte altsaa ikke mutere brugerens git-trae uden samtykke.
// `npx @agent360/browser-mcp@latest` opdaterer allerede serveren; blokken var overfloedig.
let extensionUpdated = false;

const BASE_PORT = 9876;
const MAX_PORT = 9895; // 20 ports instead of 10 — zombies die within 5s via parent check

// ── Extension connections ───────────────────────────────────────────────────
// FEJL MAALT 21/8: her stod `let extensionSocket = null`, og hver ny forbindelse
// overskrev den. Er der to udgaver af udvidelsen indlaest i den samme Chrome —
// fx en "load unpacked"-kopi ved siden af en anden — scanner BEGGE de samme porte
// og forbinder til hver eneste server. Maalt med lsof: 2 ESTABLISHED forbindelser
// paa hver af de fire aktive porte. Kommandoerne gik til den der forbandt sidst,
// mens den anden holdt sit eget sessions-kort og sine egne fane-grupper — og et
// `terminate` fra den forkerte kopi lukkede serveren ned under den rigtige.
//
// Nu holdes alle forbindelser med deres identitet, kommandoer sendes kun til den
// nyeste udgave, og konflikten kan ses (browser_provide_feedback) i stedet for at
// vise sig som faner der "forsvinder".
const connections = new Set(); // { ws, seq, extensionId, version, name, since }
let connSeq = 0;
let activePort = null;

function cmpVersion(a, b) {
  const pa = String(a || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

let sidsteKonfliktNoegle = '';
function advarOmKonflikt(conn) {
  const alle = distinctExtensions();
  if (alle.length < 2) return;
  // Samme konflikt maa ikke skrige ved hver eneste hello — kun naar billedet aendrer sig.
  const noegle = alle.map(c => `${c.extensionId || 'ukendt'}@${c.version || '?'}`).sort().join('|');
  if (noegle === sidsteKonfliktNoegle) return;
  sidsteKonfliktNoegle = noegle;
  const aktiv = activeConnection();
  // Oplyser INGEN af dem en version (alle udgivne udgaver er fra foer haandtrykket),
  // er der intet grundlag for at vaelge. Det skal staa der — ellers laeser man
  // "kommandoer sendes kun til X" som om X var det rigtige valg.
  const kanVaelge = alle.some(c => c.version);
  process.stderr.write(
    `[MCP] ADVARSEL: ${alle.length} Browser MCP-udvidelser er forbundet til denne server samtidig ` +
    `(${alle.map(c => `${c.extensionId || 'ukendt id'}${c.version ? ' v' + c.version : ''}`).join(', ')}). ` +
    'De deler faner og sessions-tilstand, saa faner kan se ud til at forsvinde. ' +
    (kanVaelge
      ? `Kommandoer sendes kun til den nyeste (${aktiv?.extensionId}). `
      : `Ingen af dem oplyser sin version, saa valget (${aktiv?.extensionId}) er vilkaarligt og kan skifte. `) +
    'Ret det ved at slaa alle paa naer én fra paa chrome://extensions.\n',
  );
}

function liveConnections() {
  return [...connections].filter(c => c.ws.readyState === 1);
}

// Valget LAASES for serverens levetid.
//
// MAALT 21/8 i flow-harnessen: uden laasen skiftede den aktive udvidelse MIDT i en
// koersel. Foerste kommando (navigate) gik til udvidelse A, som aabnede fanen. Et
// oejeblik senere forbandt udvidelse B og overtog, fordi den var nyere i raekken —
// men B kendte ikke A's fane og lavede en frisk about:blank. Alt derefter fejlede med
// "Cannot access contents of url about:blank". 21 af 43 vaerktoejer faldt paa det, og
// symptomet lignede praecis "faner forsvinder" og "kun én session virker".
//
// Faner hoerer til den udvidelse der aabnede dem. Skifter man udvidelse, strander de.
// Derfor: vaelg én gang, og bliv ved den saa laenge dens forbindelse lever. Doer den,
// vaelges der forfra — det er en aegte genopretning, ikke et vilkaarligt skift.
let laastForbindelse = null;
let harSendtKommando = false;
const PINNET_UDVIDELSE = (process.env.BROWSER_MCP_EXTENSION_ID || '').trim() || null;

function activeConnection() {
  if (laastForbindelse && laastForbindelse.ws.readyState === 1) return laastForbindelse;

  // Nyeste udvidelse vinder. Ved uafgjort: den der forbandt sidst. En udvidelse fra
  // foer haandtrykket har ingen version og taber til en der har én — haandtrykket kom
  // med den nyere udgave.
  let best = null;
  for (const c of liveConnections()) {
    if (!best) { best = c; continue; }
    const d = cmpVersion(c.version, best.version);
    if (d > 0 || (d === 0 && c.since > best.since)) best = c;
  }
  laastForbindelse = best;
  return best;
}

// Én post pr. udvidelse. En udvidelse uden identitet taelles for sig selv (dens
// socket er noeglen), saa to gamle kopier stadig ses som to.
function distinctExtensions() {
  const byKey = new Map();
  for (const c of liveConnections()) {
    const key = c.extensionId || `legacy:${c.seq}`;
    if (!byKey.has(key)) byKey.set(key, c);
  }
  return [...byKey.values()];
}
let wss = null; // Track WSS for graceful shutdown
let cmdId = 0;
let lastActivity = Date.now();
const pending = new Map();

// Timers hoisted to module scope so gracefulShutdown can clear them deterministically.
let heartbeat = null;
let parentCheck = null;

// ── WebSocket Server ───────────────────────────────────────────────────────

function createWSS(port = BASE_PORT) {
  const server = new WebSocketServer({ host: '127.0.0.1', port });
  wss = server;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      if (port < MAX_PORT) {
        process.stderr.write(`[MCP] Port ${port} in use, trying ${port + 1}...\n`);
        createWSS(port + 1);
      } else {
        process.stderr.write(`[MCP] All ports ${BASE_PORT}-${MAX_PORT} in use. Cannot start.\n`);
      }
    } else {
      process.stderr.write(`[MCP] WebSocket error: ${err.message}\n`);
    }
  });

  server.on('connection', (ws, req) => {
    // WebSocket-handshaket fra en udvidelse baerer Origin: chrome-extension://<id>.
    // Den identificerer afsenderen UDEN at udvidelsen behoever at kende haandtrykket,
    // saa en konflikt mellem to indlaeste udvidelser kan opdages ogsaa naar begge er
    // gamle udgaver — hvilket er praecis den situation konflikten opstaar i.
    // Maalt 21/8: to distinkte origins ringede op til hver eneste server.
    const origin = req?.headers?.origin || '';
    const fraOrigin = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)?.[1] || null;

    // Noedudgang naar flere udvidelser er indlaest og brugeren ikke kan eller vil
    // slaa dem fra: BROWSER_MCP_EXTENSION_ID=<id> binder serveren til én bestemt.
    // Uden den er valget vilkaarligt naar ingen af dem oplyser en version.
    if (PINNET_UDVIDELSE && fraOrigin && fraOrigin !== PINNET_UDVIDELSE) {
      process.stderr.write(`[MCP] Afviser udvidelse ${fraOrigin} — bundet til ${PINNET_UDVIDELSE}\n`);
      try { ws.close(1008, 'not the pinned extension'); } catch {}
      return;
    }

    const conn = { ws, seq: ++connSeq, extensionId: fraOrigin, version: null, name: null, since: Date.now() };
    connections.add(conn);
    // Har vi endnu ikke sendt en eneste kommando, er ingen faner i spil, og en
    // nytilkommen udvidelse maa gerne komme i betragtning igen.
    if (!harSendtKommando) laastForbindelse = null;
    process.stderr.write(`[MCP] Chrome extension connected on port ${port}${fraOrigin ? ` (${fraOrigin})` : ''}\n`);
    advarOmKonflikt(conn);

    // If extension was auto-updated, trigger reload
    if (process.env.BROWSER_MCP_EXTENSION_UPDATED === '1') {
      process.env.BROWSER_MCP_EXTENSION_UPDATED = '';
      process.stderr.write('[MCP] Extension files updated — triggering auto-reload\n');
      setTimeout(() => {
        sendToExtension('reload_extension', {}, 5000).catch(() => {});
      }, 1000);
    }

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }

      // Identitets-haandtryk fra offscreen-dokumentet (v1.28+).
      if (msg.type === 'hello') {
        if (typeof msg.extensionId === 'string') conn.extensionId = msg.extensionId;
        conn.version = typeof msg.version === 'string' ? msg.version : null;
        conn.name = typeof msg.name === 'string' ? msg.name : null;
        advarOmKonflikt(conn);
        return;
      }

      if (msg.type === 'terminate') {
        // Kun den udvidelse vi faktisk styrer maa lukke serveren ned. Uden denne
        // gate kunne en gammel sidelaebende kopi, der lukkede sin sidste fane,
        // rive serveren vaek under den udvidelse der reelt loeste opgaven.
        if (activeConnection() !== conn) {
          process.stderr.write('[MCP] terminate ignoreret — kom fra en inaktiv udvidelses-forbindelse\n');
          return;
        }
        gracefulShutdown('Terminate signal from extension (last tab closed)');
        return;
      }

      const { id, result, error } = msg;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    });

    ws.on('close', () => {
      connections.delete(conn);
      process.stderr.write(`[MCP] Chrome extension disconnected (${liveConnections().length} tilbage)\n`);
    });
  });

  server.on('listening', () => {
    activePort = port;
    process.stderr.write(`[MCP] WebSocket server listening on ws://127.0.0.1:${port}\n`);
  });

  // Heartbeat + idle timeout (4 hours) — hoisted to module scope so gracefulShutdown can clear it
  heartbeat = setInterval(() => {
    for (const c of liveConnections()) c.ws.ping();
    if (Date.now() - lastActivity > 4 * 60 * 60 * 1000) {
      gracefulShutdown('Idle timeout (4h)');
    }
  }, 20000);
}

createWSS();

// ── Send command to extension ───────────────────────────────────────────────

async function sendToExtension(method, params = {}, timeoutMs = 30000, _retries = 5) {
  // Retry if extension is temporarily disconnected (reconnects every 2s)
  const conn = activeConnection();
  if (!conn) {
    if (_retries > 0) {
      await new Promise(r => setTimeout(r, 1500));
      return sendToExtension(method, params, timeoutMs, _retries - 1);
    }
    // This is the other half of the two-part setup: the server is clearly running (it is
    // throwing this), so what is missing is the extension, Chrome itself, or the connection
    // between them. Say which, and where to get it — the agent relays this text to the user.
    throw new Error(
      'Chrome extension not connected after 5 retries.\n' +
      'Browser MCP needs BOTH halves: this MCP server (running) and the Agent360 Browser MCP ' +
      'Chrome extension (apparently not reachable).\n' +
      'Check, in order:\n' +
      '  1. Chrome is actually open and running.\n' +
      '  2. The extension is installed and enabled at chrome://extensions — install it from\n' +
      '     https://chromewebstore.google.com/detail/agent360-browser-mcp/jdehgalffmffhfhmmhaokfbfnafnmgcl\n' +
      '  3. Click the extension icon -> Reconnect, and wait 2-3 seconds.\n' +
      'Still stuck: https://browsermcp.dev/docs/troubleshooting/'
    );
  }
  return new Promise((resolve, reject) => {
    const id = ++cmdId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Command timed out after ${timeoutMs}ms: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    // pid = Claude Code-processen der ejer denne server. Udvidelsen bruger den til at
    // skelne 'samme chat, ny forbindelse' fra 'en anden chat' naar den adopterer sessioner.
    harSendtKommando = true;
    conn.ws.send(JSON.stringify({ id, method, params, pid: process.ppid }));
  });
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const INSTRUCTIONS = `You control the user's real Chrome browser via this MCP server. Each session gets its own color-coded Chrome Tab Group.

## Key behaviors
- **Always use browser_ask_user** when you need credentials, 2FA codes, CAPTCHA help, or any user input. Never guess passwords or tokens.
- **ALWAYS close tabs when done** with browser_close_tab after completing each task. Don't leave tabs open — close them immediately after extracting the data you need. Use browser_list_tabs to find and close all session tabs when a task is complete.
- **Check existing tabs first** with browser_list_tabs before navigating — reuse tabs instead of opening duplicates.
- **One task per tab** — navigate to a URL, do your work, then close or move on.
- **Tell the user what you're doing** in the browser. "I'm navigating to Stripe to find the API key" not just silently calling tools.

## Tab management
- navigate creates tabs in your session's tab group (visible in Chrome as colored groups)
- list_tabs only shows YOUR session's tabs — other Claude sessions have their own
- switch_tab lets you jump between your tabs
- close_tab cleans up when you're done

## Authentication flows
1. Navigate to login page
2. Use browser_ask_user with fields for email/password
3. Fill credentials with browser_fill
4. Click submit with browser_click
5. If 2FA required, use browser_ask_user again: "Please enter the 2FA code shown in your authenticator app"
6. After success, extract what you need with browser_get_page_content

## Screenshots
- browser_screenshot captures the visible tab — useful for visual verification
- The tab is auto-activated before capture, so it always shows the right page

## Text-based selectors (preferred for dynamic sites)
- browser_click("text=Get started") — clicks any element containing "Get started"
- browser_click("button:text(Submit)") — clicks a button containing "Submit"
- browser_fill("text=Email", "user@example.com") — fills input near "Email" label
- browser_wait("text=Success") — waits for text to appear
- These work on ALL sites including Google Cloud, Stripe, Slack (CSP-strict)

## Keyboard
- browser_press_key("Enter") — submit forms
- browser_press_key("Tab") — navigate between fields
- browser_press_key("Escape") — close dialogs
- browser_press_key("ArrowDown") — navigate dropdowns
- browser_press_key("a", ctrl=true) — select all

## CAPTCHA handling
Use browser_solve_captcha to detect and solve CAPTCHAs automatically:
1. Call browser_solve_captcha() — detects CAPTCHA type on page
2. If reCAPTCHA v2 checkbox found → call browser_solve_captcha(action="click_checkbox") — auto-clicks; often passes when signed into Google
3. If image challenge appears → call browser_screenshot, analyze the grid visually, then call browser_solve_captcha(action="click_grid", cells=[2,5,7]) with the correct cell indices
4. If all else fails → call browser_solve_captcha(action="ask_human") to show overlay to user
5. After solving, retry the action that was blocked

For image grid challenges: cells are 0-indexed, left-to-right, top-to-bottom. A 3x3 grid has cells 0-8. A 4x4 grid has cells 0-15.

## OAuth popups
- OAuth popups (Google, Microsoft, GitHub, Slack, HubSpot) are automatically intercepted and added to your session's tab group
- Use browser_get_new_tab to access them, or they'll become your active tab automatically

## Shadow DOM (Shopify, Salesforce, etc.)
- CSS selectors automatically search inside shadow DOM
- If a standard selector fails, the extension recursively searches shadow roots
- Text-based selectors ("text=Submit") also traverse shadow DOM

## Hard inputs — use the specialised tools first
- **Date inputs** → use browser_set_date (NOT browser_fill). Handles native date inputs, masked text inputs (MM/DD/YYYY etc.), AND calendar pickers (MUI, react-datepicker, AntD, Lexical/Meta). 3-path fallback with read-back verification.
- **Autocomplete / combobox** (Languages on Meta Ads, country selects, async dropdowns) → use browser_set_combobox (NOT browser_select_option). Types partial query, waits for filtered listbox, clicks option. Supports multi-value chips.
- **Drag-drop file zones without visible file input** → use browser_drop_file (NOT browser_upload_file). Finds hidden input in subtree/parent.
- **Annoying popups blocking the flow** (cookie banners, "Don't show again", Advantage+ tooltips, draft-confirm prompts) → call browser_dismiss_overlays before each major step. It only clicks safe close affordances by default; preserves forms with editable text fields.

## When things fail
- Element not found → try text-based selector instead of CSS
- Screenshot fails → debugger fallback is automatic
- Click doesn't work on SPA → debugger mouse events are used automatically
- CAPTCHA blocks page → use browser_ask_user, let human solve it
- browser_fill seemingly succeeds but value reverts → switch to browser_set_date or browser_set_combobox (most reverts are React-controlled validators)

## Extension updates
The MCP server auto-pulls the latest code from git on every new session startup.
If the extension files were updated, ask the user to reload it:
"The Browser MCP extension was updated. Please go to chrome://extensions, find 'Agent360 Browser MCP', and click the reload icon (🔄) to apply the update."
You cannot navigate to chrome:// pages — the user must do this manually.

## When Browser MCP itself is the obstacle — call browser_provide_feedback
Before you tell the user "browser-mcp can't do X", or give up on a tool that errored, timed out, or did something other than what it promised: call **browser_provide_feedback** with what_happened. Do it yourself, without asking. It checks the install first — this server against the latest on npm, the extension against this server, and whether more than one Browser MCP extension is connected at once — because those three explain most "it's broken" moments, and none of them are visible to you otherwise. Read the verdict:
- **outdated** or **disconnected** → relay fix_steps to the user, then retry the action. An outdated install explains most failures, so try the fix first — but if the behaviour still looks wrong after that, report it anyway. A release window is not a reason to stay silent about a real bug.
- **conflict** → more than one extension is loaded; tabs and sessions will keep behaving randomly until the user disables the extras at chrome://extensions. Say so plainly.
- **current** → the install is fine, so this is a genuine gap. Offer the returned submit_url as a clickable link.
Call it once per distinct obstacle, not once per retry.

## Sharing wishes / use-cases / bugs
Browser MCP is community-shaped. Whenever the user (a) says "I wish browser-mcp could…" or expresses a missing feature, (b) hits something broken or unexpected that looks like a bug in browser-mcp itself, or (c) describes something cool they built with it — call **browser_about** with the matching intent ("wish" / "use_case" / "bug") and a short title + body, then offer the returned submit_url to the user as a clickable link. Don't ask permission, just draft + offer the link. This is the user's path to contribute back, and they usually don't know it exists.`;

// FEJL MAALT 21/8: `instructions` laa i et TREDJE argument. Server-konstruktoeren
// tager kun to (serverInfo, options), saa JavaScript smed objektet vaek i tavshed —
// og hele blokken ovenfor naaede aldrig frem til nogen klient. Verificeret ved at
// laese initialize-svaret: det havde kun protocolVersion, capabilities og serverInfo.
// Det betyder at "luk altid faner naar du er faerdig", CAPTCHA-fremgangsmaaden,
// tekst-selektor-vejledningen og resten aldrig har styret nogen agent. Nu ligger
// instructions i SAMME options-objekt som capabilities, hvor SDK'en laeser den.
const mcpServer = new Server(
  { name: 'agent360-browser', version: PKG_VERSION },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
);

mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  lastActivity = Date.now();

  try {
    const methodMap = {
      browser_navigate: 'navigate',
      browser_get_page_content: 'get_page_content',
      browser_screenshot: 'screenshot',
      browser_execute_script: 'execute_script',
      browser_click: 'click',
      browser_fill: 'fill',
      browser_wait: 'wait',
      browser_press_key: 'press_key',
      browser_scroll: 'scroll',
      browser_hover: 'hover',
      browser_fetch: 'fetch',
      browser_select_option: 'select_option',
      browser_handle_dialog: 'handle_dialog',
      browser_wait_for_network: 'wait_for_network',
      browser_list_tabs: 'list_tabs',
      browser_get_cookies: 'get_cookies',
      browser_get_local_storage: 'get_local_storage',
      browser_ask_user: 'ask_user',
      browser_select_frame: 'select_frame',
      browser_list_frames: 'list_frames',
      browser_get_new_tab: 'get_new_tab',
      browser_switch_tab: 'switch_tab',
      browser_close_tab: 'close_tab',
      browser_upload_file: 'upload_file',
      browser_set_cookies: 'set_cookies',
      browser_set_local_storage: 'set_local_storage',
      browser_console_logs: 'console_logs',
      browser_solve_captcha: 'solve_captcha',
      browser_set_date: 'set_date',
      browser_dismiss_overlays: 'dismiss_overlays',
      browser_set_combobox: 'set_combobox',
      browser_drop_file: 'drop_file',
      browser_copy_to_clipboard: 'copy_to_clipboard',
      browser_paste_from_clipboard: 'paste_from_clipboard',
      browser_clipboard_stats: 'clipboard_stats',
      browser_double_click: 'double_click',
      browser_right_click: 'right_click',
      browser_click_xy: 'click_xy',
      browser_reattach_debugger: 'reattach_debugger',
      browser_extract_list: 'extract_list',
    };

    if (name === 'browser_about') {
      return handleAbout(args);
    }

    if (name === 'browser_provide_feedback') {
      return await handleProvideFeedback(args);
    }

    if (name === 'browser_extract_token') {
      return await handleExtractToken(args);
    }

    const method = methodMap[name];
    if (!method) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    // extract_list scrolls a container in a loop (up to 300 rounds × wait_ms), so the 30 s
    // default would kill a long mail list mid-walk and report a partial set as complete.
    const timeout = method === 'ask_user' ? (args?.timeout || 120000) + 5000 :
                    method === 'solve_captcha' ? 60000 :
                    method === 'extract_list' ? 180000 : 30000;
    const result = await sendToExtension(method, args || {}, timeout);

    if (name === 'browser_screenshot' && result?.image) {
      const isJpeg = result.image.startsWith('data:image/jpeg');
      const prefix = isJpeg ? /^data:image\/jpeg;base64,/ : /^data:image\/png;base64,/;
      const mimeType = isJpeg ? 'image/jpeg' : 'image/png';
      const base64 = result.image.replace(prefix, '');

      if (args && args.path) {
        const targetPath = resolve(process.cwd(), args.path);
        mkdirSync(dirname(targetPath), { recursive: true });
        writeFileSync(targetPath, Buffer.from(base64, 'base64'));
        return {
          content: [
            { type: 'text', text: `Screenshot successfully saved to: ${targetPath}` },
            { type: 'image', data: base64, mimeType }
          ]
        };
      }

      return { content: [{ type: 'image', data: base64, mimeType }] };
    }

    const response = {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };

    // Notify on first call if extension was updated
    if (extensionUpdated) {
      extensionUpdated = false;
      response.content.push({
        type: 'text',
        text: '\n⚠️ Extension was updated on startup. Ask the user to reload the extension in chrome://extensions (click 🔄 on Agent360 Browser MCP).',
      });
    }

    return response;
  } catch (err) {
    return {
      content: [{ type: 'text', text: forklarSkaevhed(err.message) }],
      isError: true,
    };
  }
});

// Naar udvidelsen er aeldre end serveren, svarer den `Unknown method: X` — og det er
// alt brugeren ser. Det sker GARANTERET: serveren kommer fra npm og opdateres straks,
// mens udvidelsen skal gennem Chrome Web Stores review paa 1-3 dage. I det vindue
// findes otte vaerktoejer i serveren som en 1.25.0-udvidelse ikke kender
// (click_xy, double_click, right_click, extract_list, reattach_debugger og de tre
// udklipsholder-vaerktoejer, alle fra v1.26.0).
//
// Serveren VED at udvidelsen er gammel: den sendte intet haandtryk. Saa i stedet for
// en gaadefuld fejl faar brugeren at vide hvorfor — og hvad de kan goere imens.
const ERSTATNINGER = {
  double_click: 'kald `browser_click` to gange',
  right_click: 'brug `browser_execute_script` med et contextmenu-event',
  click_xy: 'brug `browser_click` med en selector',
  extract_list: 'brug `browser_get_page_content` og scroll med `browser_scroll`',
  reattach_debugger: 'genindlaes udvidelsen paa chrome://extensions',
  copy_to_clipboard: 'laes vaerdien med `browser_execute_script`',
  paste_from_clipboard: 'skriv vaerdien med `browser_fill`',
  clipboard_stats: 'ingen erstatning — vent paa opdateringen',
};

function forklarSkaevhed(besked) {
  const m = /Unknown method: ([a-z_]+)/.exec(besked || '');
  if (!m) return `Error: ${besked}`;
  const aktiv = activeConnection();
  // Kun hvis udvidelsen faktisk er for gammel. Er den ny og metoden alligevel ukendt,
  // er det en aegte fejl og skal ikke bortforklares.
  if (aktiv && aktiv.version) return `Error: ${besked}`;
  const alt = ERSTATNINGER[m[1]];
  return `Error: browser_${m[1]} findes i denne server, men ikke i din Chrome-udvidelse.\n\n` +
    'Udvidelsen opdateres via Chrome Web Store og kan vaere 1-3 dage bagud efter en ' +
    'udgivelse — serveren opdateres med det samme via npm. Alt andet virker imens.\n' +
    (alt ? `\nIndtil da: ${alt}.\n` : '') +
    '\nTjek om en opdatering venter: chrome://extensions → Agent360 Browser MCP. ' +
    'Er den indlaest som "unpacked", saa koer `npx @agent360/browser-mcp install`.';
}

const REPO_URL = 'https://github.com/Agent360dk/browser-mcp';
const ISSUE_TEMPLATES = { wish: 'wish.yml', use_case: 'use-case.yml', bug: 'bug.yml' };

function handleAbout(args) {
  const intent = args?.intent || 'info';
  const title = args?.title || '';
  const body = args?.body || '';

  const submit_url = intent === 'info' || !ISSUE_TEMPLATES[intent]
    ? `${REPO_URL}/issues/new/choose`
    : `${REPO_URL}/issues/new?template=${ISSUE_TEMPLATES[intent]}` +
      (title ? `&title=${encodeURIComponent(title)}` : '') +
      (body ? `&body=${encodeURIComponent(body)}` : '');

  const instruction =
    intent === 'wish'
      ? `Share this exact submission link with the user as a clickable link, with a short note like "Click to submit your wish — it'll open a pre-filled GitHub issue you can review before submitting": ${submit_url}`
      : intent === 'use_case'
      ? `Share this exact submission link with the user as a clickable link, with a short note like "Click to share your use-case — pre-filled, you can edit before submitting": ${submit_url}`
      : intent === 'bug'
      ? `Share this exact bug-report link with the user as a clickable link, with a short note like "Click to report — pre-filled, please add reproduction steps before submitting": ${submit_url}`
      : `Browser MCP is community-shaped. Open wishlist: ${REPO_URL}/blob/main/WISHLIST.md · Use-cases: ${REPO_URL}/blob/main/USE_CASES.md · Submit anything: ${REPO_URL}/issues/new/choose`;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        name: 'Browser MCP by Agent360',
        version: PKG_VERSION,
        repo: REPO_URL,
        wishlist: `${REPO_URL}/blob/main/WISHLIST.md`,
        use_cases: `${REPO_URL}/blob/main/USE_CASES.md`,
        submit_url,
        instruction,
      }, null, 2),
    }],
  };
}

// ── Selv-diagnose: er installationen overhovedet frisk? ─────────────────────
// Baggrund (21/8): den udgave der koerte lokalt var npm 1.25.0, mens rettelserne
// laa uudgivet i repoet. Fejlen viste sig som "sessioner opfoerer sig underligt",
// ikke som "du koerer en gammel version" — og der fandtes ingen maade at spoerge
// paa. Derfor spoerger vaerktoejet selv, foer det konkluderer noget som helst.

// Friskheds-tjek mod npm. SLUKKET SOM STANDARD siden 22/8.
//
// Produktet lover paa forsiden "nothing leaves your machine ... no telemetry", og et
// opslag i npm-registret ER et kald ud af maskinen — ogsaa selv om det kun sender et
// pakkenavn og ingen brugerdata. Loeftet vejer tungere end bekvemmeligheden, saa
// tjekket er nu opt-in: saet BROWSER_MCP_CHECK_NPM=1.
//
// Alt det der betyder mest er ren LOKAL maaling og koerer altid: er udvidelsen aeldre
// end serveren, og er der flere udvidelser forbundet paa én gang.
const TJEK_NPM = process.env.BROWSER_MCP_CHECK_NPM === '1';
let npmLatestCache = null;                 // { version, at }
const NPM_LATEST_TTL_MS = 10 * 60 * 1000;

function npmLatestVersion() {
  if (!TJEK_NPM) return Promise.resolve(null);
  if (npmLatestCache && Date.now() - npmLatestCache.at < NPM_LATEST_TTL_MS) {
    return Promise.resolve(npmLatestCache.version);
  }
  return new Promise((resolve) => {
    // Offline, bag proxy, eller npm mangler paa PATH: svar null i stedet for at fejle.
    // En friskheds-kontrol maa aldrig vaere det der braekker vaerktoejet.
    execFile('npm', ['view', '@agent360/browser-mcp', 'version'], { timeout: 6000 }, (err, stdout) => {
      if (err) return resolve(null);
      const v = String(stdout).trim();
      const ok = /^\d+\.\d+\.\d+/.test(v) ? v : null;
      if (ok) npmLatestCache = { version: ok, at: Date.now() };
      resolve(ok);
    });
  });
}

// ── Lokal logbog over hver graense agenten render ind i ─────────────────────
//
// Formaalet er loekken: hver gang et vaerktoej spaerrer vejen, skal det kunne taelles og
// rettes. Logbogen ligger LOKALT og forlader ikke maskinen.
//
// Bevidst ikke auto-indsendelse til et offentligt GitHub-issue: rapporten baerer URL og
// fejltekst fra den side agenten stod paa — og det er ofte en annoncekonto, en indbakke
// eller et kundesystem. Et offentligt issue kan ikke tages tilbage.
const FEEDBACK_LOG = join(homedir(), '.browser-mcp', 'feedback.jsonl');
const setteFingeraftryk = new Set();   // samme graense logges én gang pr. serverliv

function fingeraftryk(kind, tool, what) {
  // Tal, id'er og lange hex-strenge varierer fra gang til gang og maa ikke goere to ens
  // haendelser forskellige.
  const kerne = String(what).toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, '#')
    .replace(/\d+/g, '#')
    .slice(0, 160);
  return `${kind}|${tool || '-'}|${kerne}`;
}

// URL'en reduceres til oprindelse + sti. Query og fragment baerer tokens, sessions-id'er
// og soegetermer — de har intet at goere i en logbog nogen senere kopierer ind i et issue.
function afkortUrl(u) {
  if (!u) return null;
  try { const x = new URL(u); return x.origin + x.pathname; } catch { return '(ulaeselig url)'; }
}

function skrivTilLogbog(post) {
  const fp = fingeraftryk(post.kind, post.tool, post.what_happened);
  const foerste = !setteFingeraftryk.has(fp);
  setteFingeraftryk.add(fp);
  if (!foerste) return { logged: false, reason: 'allerede logget i denne session', fingerprint: fp };
  try {
    mkdirSync(dirname(FEEDBACK_LOG), { recursive: true });
    appendFileSync(FEEDBACK_LOG, JSON.stringify({ ...post, fingerprint: fp }) + '\n');
    return { logged: true, path: FEEDBACK_LOG, fingerprint: fp };
  } catch (e) {
    // En logbog der ikke kan skrives maa aldrig vaere det der braekker vaerktoejet.
    return { logged: false, reason: e.message, fingerprint: fp };
  }
}

async function handleProvideFeedback(args) {
  const what = String(args?.what_happened || '').trim();
  const kind = args?.kind || 'blocked';
  const tool = args?.tool || null;
  const url = args?.url || null;
  const attempted = args?.attempted || null;

  const npmLatest = await npmLatestVersion();
  const exts = distinctExtensions();
  const active = activeConnection();

  const serverOutdated = npmLatest ? cmpVersion(npmLatest, PKG_VERSION) > 0 : null;
  // Udvidelse og server udgives sammen under samme versionsnummer, saa en
  // udvidelse der er AELDRE end serveren mangler per definition rettelser.
  const extVersion = active ? active.version : null;
  const extOutdated = active
    ? (extVersion === null ? true : cmpVersion(PKG_VERSION, extVersion) > 0)
    : null;

  const findings = [];
  const fix_steps = [];

  if (exts.length > 1) {
    const kanVaelge = exts.some(c => c.version);
    findings.push(
      `${exts.length} Browser MCP-udvidelser er indlaest i Chrome og forbundet til denne server samtidig ` +
      `(${exts.map(c => `${c.extensionId || 'ukendt id'}${c.version ? ' v' + c.version : ' (oplyser ikke version)'}`).join(' + ')}). ` +
      'Hver af dem foerer sit eget sessions-kort og sine egne fane-grupper i den samme browser, ' +
      'saa faner kan se ud til at forsvinde og sessioner til at smelte sammen. ' +
      (kanVaelge
        ? `Denne server sender kun til den nyeste (${active?.extensionId}).`
        : `Ingen af dem oplyser sin version, saa hvilken der styres (${active?.extensionId}) er vilkaarligt og kan skifte mellem sessioner.`),
    );
    fix_steps.push(
      'Aabn chrome://extensions og slaa alle Browser MCP-udvidelser fra paa naer én. ' +
      'Det skal brugeren selv goere — chrome:// kan ikke styres herfra. Behold den nyeste.',
    );
  }
  if (!active) {
    findings.push('Ingen Chrome-udvidelse er forbundet til denne MCP-server lige nu.');
    fix_steps.push('Tjek at Chrome koerer og at udvidelsen er slaaet til paa chrome://extensions, klik derefter paa ikonet → Reconnect.');
  }
  if (serverOutdated) {
    findings.push(`MCP-serveren koerer v${PKG_VERSION}, men npm har v${npmLatest}. Fejlen kan allerede vaere rettet.`);
    fix_steps.push(`Genstart klienten — den henter selv @agent360/browser-mcp@latest (v${npmLatest}).`);
  }
  if (extOutdated) {
    findings.push(
      extVersion === null
        ? `Den forbundne udvidelse er saa gammel at den ikke oplyser sin version (foer v${PKG_VERSION}). Den mangler alt hvad der er rettet siden.`
        : `Udvidelsen er v${extVersion}, serveren er v${PKG_VERSION}. Udvidelsen mangler rettelser fra de mellemliggende udgaver.`,
    );
    // MAALT 22/8: "↻ reload" er ubrugeligt for en Chrome Web Store-bruger. Butikken
    // skubber paa Googles tidsplan efter et review paa 1-3 dage — der er ingen nyere
    // version at hente endnu, saa raadet foerer i ring. Serveren kan ikke se hvilken
    // slags installation det er (den gamle udvidelse oplyser intet), saa begge tilfaelde
    // skal staa der — og det skal siges at ventetiden er forventet, ikke en fejl.
    fix_steps.push(
      extVersion === null
        ? 'Kommer udvidelsen fra Chrome Web Store: der er sandsynligvis en nyere version i review ' +
          '(1-3 dage efter en udgivelse). ↻ reload henter den IKKE foer Google har godkendt — ' +
          'det er forventet og gaar over af sig selv. Alt andet virker imens. ' +
          'Er den indlaest som "unpacked": koer `npx @agent360/browser-mcp install` og derefter ' +
          'chrome://extensions → Agent360 Browser MCP → ↻ reload.'
        : 'Opdatér udvidelsen: chrome://extensions → Agent360 Browser MCP → ↻ reload. ' +
          'Er den indlaest som "unpacked", saa koer `npx @agent360/browser-mcp install` foerst.',
    );
  }

  const verdict =
    exts.length > 1 ? 'conflict'
    : (serverOutdated || extOutdated) ? 'outdated'
    : !active ? 'disconnected'
    : (npmLatest === null ? 'unknown' : 'current');

  const environment = {
    mcp_server_version: PKG_VERSION,
    npm_latest_version: npmLatest,
    server_up_to_date: serverOutdated === null ? null : !serverOutdated,
    extensions_connected: exts.map(c => ({
      name: c.name,
      version: c.version,
      extension_id: c.extensionId,
      active: c === active,
    })),
    extension_up_to_date: extOutdated === null ? null : !extOutdated,
    ws_port: activePort,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
  };

  const issueBody = [
    what && `**What happened**\n${what}`,
    tool && `\n**Tool**: \`${tool}\``,
    // MAALT 22/8 ved sikkerhedsreview: her stod den RAA url, mens den lokale logbog
    // nedenfor bruger afkortUrl(). Query-strengen — hvor tokens bor — blev altsaa
    // strippet fra filen paa disken, men sendt uredigeret ind i et link til et
    // OFFENTLIGT GitHub-issue. Praecis den forkerte vej rundt.
    url && `\n**URL**: ${afkortUrl(url)}`,
    attempted && `\n**Already tried**\n${attempted}`,
    `\n**Environment**\n\`\`\`json\n${JSON.stringify(environment, null, 2)}\n\`\`\``,
  ].filter(Boolean).join('\n');

  const template = kind === 'wish' ? ISSUE_TEMPLATES.wish
                 : kind === 'use_case' ? ISSUE_TEMPLATES.use_case
                 : ISSUE_TEMPLATES.bug;
  const issueTitle = what.split('\n')[0].slice(0, 90) || 'Browser MCP feedback';
  const submit_url = `${REPO_URL}/issues/new?template=${template}` +
    `&title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(issueBody)}`;

  const instruction =
    verdict === 'conflict' || verdict === 'outdated' || verdict === 'disconnected'
      ? 'Fortael brugeren hvad der blev fundet, og giv fix_steps som konkrete skridt. Proev derefter handlingen igen. ' +
        'Del KUN submit_url hvis problemet stadig staar efter at fix_steps er fulgt — det er sandsynligvis installationen, ikke en fejl i Browser MCP.'
      : 'Installationen er frisk, saa det her er sandsynligvis en aegte mangel eller fejl. Fortael brugeren kort hvad der ikke kunne lade sig goere, ' +
        'og tilbyd submit_url som et klikbart link ("forudfyldt — du kan rette i den foer du sender"). Spoerg ikke om lov foerst.';

  const logbog = skrivTilLogbog({
    at: new Date().toISOString(),
    kind, tool, what_happened: what, attempted,
    url: afkortUrl(url),
    verdict,
    server_version: PKG_VERSION,
    extension_version: extVersion,
    extensions_connected: exts.length,
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        reported: { kind, what_happened: what, tool, url, attempted },
        verdict,
        findings,
        fix_steps,
        environment,
        logged_locally: logbog,
        submit_url,
        instruction,
      }, null, 2),
    }],
  };
}

async function handleExtractToken(args) {
  const { provider } = args;
  const info = PROVIDER_PAGES[provider];

  if (!info) {
    return {
      content: [{
        type: 'text',
        text: `Unknown provider: ${provider}. Known: ${Object.keys(PROVIDER_PAGES).join(', ')}\n\nYou can still use browser_navigate + browser_get_page_content to extract tokens from any provider manually.`,
      }],
    };
  }

  const nav = await sendToExtension('navigate', { url: info.url });
  return {
    content: [
      { type: 'text', text: `Navigated to ${info.url} (${nav.title})\n\nInstructions: ${info.instructions}\n\nUse browser_get_page_content or browser_screenshot to find the token, then use browser_execute_script to extract it.` },
    ],
  };
}

// ── Graceful shutdown ──────────────────────────────────────────────────────
// All shutdown paths funnel through gracefulShutdown so the cleanup chain runs
// deterministically — even on abrupt parent-exit. Without this, process.exit(0)
// was racing against WS close-handshake, leaving zombie tabs in Chrome.

let shuttingDown = false;
function gracefulShutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write(`[MCP] ${reason} — shutting down\n`);

  // Stop timers so they can't re-enter gracefulShutdown
  if (parentCheck) clearInterval(parentCheck);
  if (heartbeat) clearInterval(heartbeat);

  // Close WS with explicit close-frame so extension's onclose handler fires
  for (const c of liveConnections()) {
    try { c.ws.close(1000, 'mcp-shutdown'); } catch {}
  }
  if (wss) try { wss.close(); } catch {}

  // 300ms grace for FIN-flush + extension session_disconnect cleanup
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('exit', () => {
  // Safety net for direct process.exit calls that bypass gracefulShutdown
  if (wss) try { wss.close(); } catch {}
  for (const c of connections) try { c.ws.close(); } catch {}
});

// Detect Claude Code exit — check if parent process is still alive
// stdin.on('end') doesn't work because MCP SDK's StdioServerTransport owns stdin
const parentPid = process.ppid;
parentCheck = setInterval(() => {
  try {
    process.kill(parentPid, 0); // signal 0 = check if process exists
  } catch {
    gracefulShutdown(`Parent process ${parentPid} died`);
  }
}, 5000); // check every 5 seconds

// Also listen for stdin close as backup
process.stdin.on('end', () => gracefulShutdown('stdin closed'));

const transport = new StdioServerTransport();
await mcpServer.connect(transport);
process.stderr.write(`[MCP] Agent360 Browser MCP server running (stdio)\n`);
