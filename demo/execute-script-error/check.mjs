// Runs code that throws with browser_execute_script, on a page whose CSP has no 'unsafe-eval' (so it runs through the
// debugger) and on the same page without a CSP (so it runs in a scripting world), in a real Chrome, and checks how
// the error is reported.
//
//   node demo/execute-script-error/serve.mjs     # in one terminal
//   node demo/execute-script-error/check.mjs     # in another
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
const client = new Client({ name: 'execute-script-error-demo', version: '0' });
await client.connect(transport);

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json;
  try { json = JSON.parse(text); } catch { json = undefined; }
  return { text, json, isError: !!res.isError };
};
const kort = (s) => String(s).replace(/\s+/g, ' ').slice(0, 220);

// The code the agent wrote on login.yahoo.com.
const KODE = "(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === 'Generate password'); b.click(); })()";

let failed = 0;
const check = (name, ok, got) => {
  if (!ok) failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `\n       got: ${kort(got)}`}`);
};

const nav = await call('browser_navigate', { url: 'http://127.0.0.1:8770/', new_tab: true });
const tabId = nav.json?.tab_id;

let r = await call('browser_execute_script', { code: KODE });
check('CSP page: the TypeError is in the answer', /TypeError: Cannot read properties of undefined/.test(r.text), r.text);
check('CSP page: no scripting-diag / unsafe-eval noise from paths that did not run the code', !/scripting-diag|unsafe-eval/.test(r.text), r.text);
check('CSP page: answered as { ok: false, error, name, method: "debugger" }, like the scripting worlds',
  r.json?.ok === false && r.json?.name === 'TypeError' && r.json?.method === 'debugger', r.text);

// Controls, the same on both builds.
r = await call('browser_execute_script', { code: 'document.title' });
check('control: CSP page, code that returns a value still returns it', r.json?.result === 'execute_script error | demo', r.text);
await call('browser_navigate', { url: 'http://127.0.0.1:8770/no-csp' });
r = await call('browser_execute_script', { code: KODE });
check('control: page without CSP (scripting world) answers { ok: false, error, name, method }',
  r.json?.ok === false && r.json?.name === 'TypeError' && /^scripting-/.test(r.json?.method || ''), r.text);

if (tabId) await call('browser_close_tab', { tab_id: tabId }).catch(() => {});
await client.close();
console.log(failed ? `\n${failed} checks failed` : '\nall checks passed');
process.exitCode = failed ? 1 : 0;
