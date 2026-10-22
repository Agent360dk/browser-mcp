// Serves index.html on http://127.0.0.1:8769/. Reads the file on every request, so edits show up on reload.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const page = fileURLToPath(new URL('./index.html', import.meta.url));
const port = Number(process.env.PORT || 8769);
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(readFileSync(page));
}).listen(port, '127.0.0.1', () => console.log(`invalid selector demo: http://127.0.0.1:${port}/`));
