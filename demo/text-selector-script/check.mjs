// Clicks labels that exist only in the page's <script>, <style> and <noscript>, in a real Chrome, and checks that
// text= does not pick those elements. Then clicks a label that is on the page and also in a script (control).
//
//   node demo/text-selector-script/serve.mjs     # in one terminal
//   node demo/text-selector-script/check.mjs     # in another
//
// It starts its own mcp-server/index.js (a separate session in Chrome), so it does not touch the MCP servers your
// agent uses. The extension in Chrome must be the build you want to test. Exit code 1 if any check fails.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const sdk = (p) => import(pathToFileURL(`${repo}/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/${p}`).href);
const { Client } = await sdk('client/index.js');
const { StdioClientTransport } = await sdk('client/stdio.js');

const transport = new StdioClientTransport({ command: process.execPath, args: [`${repo}/mcp-server/index.js`], stderr: 'ignore' });
const client = new Client({ name: 'text-script-demo', version: '0' });
await client.connect(transport);

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { text, json };
};
const kort = (s) => String(s).replace(/\s+/g, ' ').slice(0, 200);

let failed = 0;
const check = (name, ok, got) => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `\n       got: ${kort(got)}`}`);
};

const nav = await call('browser_navigate', { url: 'http://127.0.0.1:8771/', new_tab: true });
const tabId = nav.json?.tab_id;

for (const [selector, kilde] of [['text=Delete account', 'SCRIPT'], ['text=Export data', 'STYLE'], ['text=Continue', 'NOSCRIPT']]) {
  const r = await call('browser_click', { selector });
  check(`${selector.padEnd(22)} (only in a <${kilde.toLowerCase()}>) is "Element not found", not the ${kilde}`,
    /^Element not found/.test(r.json?.error || '') && r.json?.tag !== kilde, r.text);
}
const r = await call('browser_click', { selector: 'text=Change password' });
const log = (await call('browser_get_page_content', { selector: '#log' })).json?.content || '';
check('control: text=Change password (on the page, and in the script) clicks the button', log.includes('clicked #change'), r.text);

if (tabId) await call('browser_close_tab', { tab_id: tabId }).catch(() => {});
await client.close();
console.log(failed ? `\n${failed} checks failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
