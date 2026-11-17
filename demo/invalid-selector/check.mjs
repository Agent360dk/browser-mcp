// Calls every tool that looks an element up with a selector that is not valid CSS, in a real Chrome, and checks
// that each one says so - instead of null, "Element not found", or waiting out its timeout.
//
//   node demo/invalid-selector/serve.mjs     # in one terminal
//   node demo/invalid-selector/check.mjs     # in another
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
const client = new Client({ name: 'invalid-selector-demo', version: '0' });
await client.connect(transport);

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { text, json };
};
const kort = (s) => String(s).replace(/\s+/g, ' ').slice(0, 160);

// What the agent wrote on Yahoo, and the same mistake for the other tools.
const LISTE = 'input[name="appName"], input[placeholder="App name"], text=App name';
const KNAP = 'button.w-full, text=Generate';
const DATO = 'input[type=date], text=Expires on';

let failed = 0;
const check = (name, ok, got) => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `\n       got: ${kort(got)}`}`);
};
const ugyldig = (r) => r.json?.error === 'invalid-selector';

const nav = await call('browser_navigate', { url: 'http://127.0.0.1:8769/', new_tab: true });
const tabId = nav.json?.tab_id;

const fyld = await call('browser_fill', { selector: LISTE, value: 'Claude IMAP MCP' });
check('fill   with the list answers invalid-selector', ugyldig(fyld), fyld.text);
const log1 = (await call('browser_get_page_content', { selector: '#log' })).json?.content || '';
check('fill   typed nothing into the field', !log1.includes('app name'), log1);
for (const [tool, args] of [
  ['browser_click', { selector: KNAP }],
  ['browser_hover', { selector: KNAP }],
  ['browser_double_click', { selector: KNAP }],
  ['browser_right_click', { selector: KNAP }],
  ['browser_scroll', { selector: KNAP }],
  ['browser_set_date', { selector: DATO, date: '2026-10-22' }],
]) {
  const r = await call(tool, args);
  check(`${tool.replace('browser_', '').padEnd(12)} with a list answers invalid-selector`, ugyldig(r), r.text);
}
const start = Date.now();
const w = await call('browser_wait', { selector: KNAP, timeout: 4000 });
const brugt = Date.now() - start;
check(`wait         answers invalid-selector at once (${brugt} ms of a 4000 ms timeout)`, ugyldig(w) && brugt < 2500, w.text);

// Controls: what is valid keeps its old answer.
const mangler = await call('browser_click', { selector: '#missing' });
check('control: a valid selector that matches nothing is still "Element not found"', /^Element not found/.test(mangler.json?.error || ''), mangler.text);
const gyldig = await call('browser_fill', { selector: 'input[name="appName"], [role=dialog] input[type=text]', value: 'Claude IMAP MCP' });
check('control: a valid comma-separated CSS list still fills', gyldig.json?.ok === true, gyldig.text);
const tekst = await call('browser_wait', { selector: 'text=App name', timeout: 2000 });
check('control: text=App name on its own is still found', tekst.json?.found === true, tekst.text);

if (tabId) await call('browser_close_tab', { tab_id: tabId }).catch(() => {});
await client.close();
console.log(failed ? `\n${failed} checks failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
