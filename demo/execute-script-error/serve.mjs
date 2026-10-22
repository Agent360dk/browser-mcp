// Serves index.html on http://127.0.0.1:8770/ with a CSP like login.yahoo.com's (inline scripts allowed,
// 'unsafe-eval' not), and on http://127.0.0.1:8770/no-csp without one. Reads the file on every request.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const page = fileURLToPath(new URL('./index.html', import.meta.url));
const port = Number(process.env.PORT || 8770);
createServer((req, res) => {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (!req.url.startsWith('/no-csp')) headers['content-security-policy'] = "script-src 'self' 'unsafe-inline'";
  res.writeHead(200, headers);
  res.end(readFileSync(page));
}).listen(port, '127.0.0.1', () => console.log(`execute_script error demo: http://127.0.0.1:${port}/ (and /no-csp)`));
