// Clicks the form's Send button the way an agent does - and clicks once more when the answer is ok:false - then
// counts how many requests the page sent. In a real Chrome, with the tab in the background.
//
//   node demo/click-background-submit/serve.mjs     # in one terminal
//   node demo/click-background-submit/check.mjs     # in another; keep Chrome BEHIND another window while it runs
//
// It starts its own mcp-server/index.js (a separate session in Chrome), so it does not touch the MCP servers your
// agent uses. The extension in Chrome must be the build you want to test. Exit code 1 if any check fails.
// A case where the click went through CDP (the tab was in front) is reported as SKIP: the bug is in the background
// path only.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const sdk = (p) => import(pathToFileURL(`${repo}/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/${p}`).href);
const { Client } = await sdk('client/index.js');
const { StdioClientTransport } = await sdk('client/stdio.js');

const transport = new StdioClientTransport({ command: process.execPath, args: [`${repo}/mcp-server/index.js`], stderr: 'ignore' });
const client = new Client({ name: 'click-background-demo', version: '0' });
await client.connect(transport);

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { text, json };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
let skipped = 0;
let tabId = null;
for (const show of ['sync', 'microtask', '50']) {
  const nav = await call('browser_navigate', { url: `http://127.0.0.1:8772/?show=${show}`, ...(tabId ? {} : { new_tab: true }) });
  tabId = nav.json?.tab_id ?? tabId;
  const svar = (await call('browser_click', { selector: '#contactForm_saveButton' })).json || {};
  // The agent's reflex: an answer of ok:false means "it did not work", so click again.
  let igen = false;
  if (svar.ok === false) { igen = true; await call('browser_click', { selector: '#contactForm_saveButton' }); }
  await sleep(800);
  const side = (await call('browser_get_page_content', {})).json?.content || '';
  const sendt = Number((side.match(/Requests sent: (\d+)/) || [])[1]);
  const hvad = `ok:${svar.ok} landed:${svar.landed} maybe_landed:${svar.maybe_landed}${igen ? ', so clicked again' : ''} -> requests sent: ${sendt}`;
  if (svar.method !== 'scripting-fallback') {
    skipped++;
    console.log(`SKIP show=${show.padEnd(9)} the tab was in front (method ${svar.method}); put another window over Chrome and run again`);
    continue;
  }
  const ok = sendt === 1 && svar.ok !== false;
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} show=${show.padEnd(9)} ${hvad}`);
}
if (tabId) await call('browser_close_tab', { tab_id: tabId }).catch(() => {});
await client.close();
console.log(failed ? `\n${failed} checks failed` : skipped ? `\nno failures, ${skipped} skipped` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
