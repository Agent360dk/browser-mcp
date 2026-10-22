// Looks up every button of the demo page by its text, in a real Chrome, then clicks it.
//
//   node demo/text-selector-whitespace/serve.mjs     # in one terminal
//   node demo/text-selector-whitespace/check.mjs     # in another
//
// It starts its own mcp-server/index.js (a separate session in Chrome), so it does not touch the MCP servers your
// agent uses. The extension in Chrome must be the build you want to test. Exit code 1 if any button is not found.
//
// Pass/fail is the lookup (browser_wait, which resolves the selector and clicks nothing). The click after it is
// reported but not judged: whether Chrome delivers the mouse to a tab depends on the window, not on the selector.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const sdk = (p) => import(pathToFileURL(`${repo}/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/${p}`).href);
const { Client } = await sdk('client/index.js');
const { StdioClientTransport } = await sdk('client/stdio.js');

const transport = new StdioClientTransport({ command: process.execPath, args: [`${repo}/mcp-server/index.js`], stderr: 'ignore' });
const client = new Client({ name: 'text-whitespace-demo', version: '0' });
await client.connect(transport);

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  try { return { text, json: JSON.parse(text) }; } catch { return { text }; }
};

const CASES = [
  ['text=Change password', 'plain', 'control: plain spaces'],
  ['text=Create app password', 'nbsp', 'no-break space before the last word (Yahoo)'],
  ['button:text(Generate password)', 'nbsp-dialog', 'no-break space, tag:text() (Yahoo dialog)'],
  ['text=Save changes', 'newline', 'label broken over two source lines'],
  ['text=Open file', 'tab', 'tab between the words'],
];

const nav = await call('browser_navigate', { url: 'http://127.0.0.1:8768/', new_tab: true });
const tabId = nav.json?.tab_id;
let failed = 0;
for (const [selector, id, what] of CASES) {
  const found = (await call('browser_wait', { selector, timeout: 2000 })).json?.found === true;
  if (!found) failed++;
  const r = await call('browser_click', { selector });
  // "Reached" is what the page saw, not what the tool said.
  const log = (await call('browser_get_page_content', { selector: '#log' })).json?.content || '';
  const klik = !found ? '' : log.includes(`clicked #${id}`) ? '  (click reached it)'
    : `  (click did not reach it this time: ${r.text.replace(/\s+/g, ' ').slice(0, 120)})`;
  console.log(`${found ? 'OK  ' : 'FAIL'} ${selector.padEnd(34)} ${what}${klik}`);
}
if (tabId) await call('browser_close_tab', { tab_id: tabId }).catch(() => {});
await client.close();
console.log(failed ? `\n${failed} of ${CASES.length} checks failed` : `\nall ${CASES.length} checks passed`);
process.exitCode = failed ? 1 : 0;
