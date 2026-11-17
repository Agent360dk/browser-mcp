// Runs every scenario of the repro page against a real Chrome, no human needed: asks with
// browser_ask_user and, while the prompt is pending, clicks its Done button with
// browser_click_xy (CDP mouse input - trusted and hit-tested like a real click).
// action "done" = the click reached Done; "timeout" = it did not.
//
//   node temp/ask-user-repro/serve.mjs        # in one terminal
//   node temp/ask-user-repro/drive.mjs        # in another; optional: a comma list of scenarios
//
// It starts its own mcp-server/index.js (a separate session in Chrome), so it does not touch the
// MCP servers your agent uses. The extension in Chrome must be the build you want to test.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const sdk = (p) => import(pathToFileURL(`${repo}/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/${p}`).href);
const { Client } = await sdk('client/index.js');
const { StdioClientTransport } = await sdk('client/stdio.js');

const transport = new StdioClientTransport({ command: process.execPath, args: [`${repo}/mcp-server/index.js`], stderr: 'ignore' });
const client = new Client({ name: 'ask-user-repro', version: '0' });
await client.connect(transport);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (name, args, timeout = 60000) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  try { return JSON.parse(text); } catch { return text; }
};

// What a fixed build should answer. capture-click is a known limit: a page listener on window
// that swallows every click in the capture phase runs before anything inside the page.
const EXPECTED = {
  none: 'done', refocus: 'done', focustrap: 'done', 'capture-pd': 'done', 'capture-click': 'timeout',
  dialog: 'done', popover: 'done', all: 'timeout', ariakit: 'done', 'backdrop-css': 'done',
};
const scenarios = (process.argv[2] || Object.keys(EXPECTED).join(',')).split(',');

// The card may sit where a user last dragged it, and its shadow root is closed: find it by
// hit-testing a grid, with the page's own top-layer elements and inert switched off for the probe.
const PROBE = `(() => {
  const h = document.getElementById('a360-overlay'); if (!h) return null;
  const wasInert = h.inert; h.inert = false;
  const hidden = [...document.querySelectorAll('dialog[open], :popover-open')].filter((d) => d !== h && !h.contains(d) && !d.contains(h)).map((d) => [d, d.style.visibility]);
  hidden.forEach(([d]) => d.style.visibility = 'hidden');
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < innerHeight; y += 6) for (let x = 0; x < innerWidth; x += 6) {
    if (document.elementFromPoint(x, y) === h) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  hidden.forEach(([d, v]) => d.style.visibility = v); h.inert = wasInert;
  return x1 < 0 ? null : JSON.stringify({ x0, x1, y0, y1 });
})()`;

const results = [];
let tabId = null;
let lastBox = null;
for (const s of scenarios) {
  const nav = await call('browser_navigate', { url: `http://127.0.0.1:8765/?s=${s}`, ...(tabId ? {} : { new_tab: true }) });
  tabId = nav.tab_id ?? tabId;
  const ask = call('browser_ask_user', { title: 'Automated test - please do not click', message: `Scenario ${s}. This card is clicked by the test itself.`, timeout: 12000 }, 30000);
  await sleep(1500);
  const probe = await call('browser_execute_script', { code: PROBE });
  const box = typeof probe.result === 'string' ? JSON.parse(probe.result) : null;
  // When the probe cannot see the card (a page modal blocks it), click where it was last seen.
  const b = box || lastBox;
  if (box) lastBox = box;
  // Done: the left of two buttons in the bottom row - 16 px padding + half of a ~140 px button,
  // 16 px padding + half of a ~36 px button up from the card's bottom edge.
  const x = b ? b.x0 + 16 + 70 : 102;
  const y = b ? b.y1 - 16 - 18 : 0;
  await sleep(s === 'ariakit' ? 3000 : 1000);   // ariakit opens its modal 1.5 s after the card appears
  const click = await call('browser_click_xy', { x, y }).catch((e) => ({ error: String(e) }));
  const answer = await ask;
  const log = await call('browser_get_page_content', { selector: '#log' });
  const ok = !EXPECTED[s] || EXPECTED[s] === answer.action;
  results.push({ scenario: s, action: answer.action, expected: EXPECTED[s], ok, click, log: (log.content || '').trim().split('\n') });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${s.padEnd(14)} -> ${String(answer.action).padEnd(8)} (expected ${EXPECTED[s] ?? '?'})`);
}
if (tabId) await call('browser_close_tab', { tab_id: tabId }).catch(() => {});
if (process.env.VERBOSE) console.log(JSON.stringify(results, null, 2));
await client.close();
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
