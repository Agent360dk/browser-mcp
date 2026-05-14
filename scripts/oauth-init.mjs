#!/usr/bin/env node
/**
 * One-shot OAuth setup for Chrome Web Store API.
 *
 * Starts a local HTTP server, builds the OAuth URL with that port as redirect,
 * opens the browser, listens for the auth code, exchanges it for refresh_token,
 * and appends to .env.
 *
 * Run once: `node scripts/oauth-init.mjs`
 * Requires: CWS_CLIENT_ID + CWS_CLIENT_SECRET already in .env
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { exec } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(__dirname, '..', '.env');

// Load .env
const env = Object.fromEntries(
  readFileSync(ENV_PATH, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const CLIENT_ID = env.CWS_CLIENT_ID;
const CLIENT_SECRET = env.CWS_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing CWS_CLIENT_ID or CWS_CLIENT_SECRET in .env');
  process.exit(1);
}

if (env.CWS_REFRESH_TOKEN) {
  console.log('CWS_REFRESH_TOKEN already in .env — skipping. Delete the line if you want to redo.');
  process.exit(0);
}

const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth` +
  `?response_type=code` +
  `&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(SCOPE)}` +
  `&access_type=offline` +
  `&prompt=consent`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'content-type': 'text/html' });
    res.end(`<h1>OAuth error</h1><p>${error}</p>`);
    console.error('OAuth error:', error);
    process.exit(1);
  }
  if (!code) {
    res.writeHead(400);
    res.end('No code in callback');
    return;
  }

  console.log('✓ Got authorization code, exchanging for refresh_token...');
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<h1>✓ Done</h1><p>You can close this tab.</p>`);

  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });
    const data = await resp.json();
    if (!data.refresh_token) {
      console.error('No refresh_token in response:', data);
      process.exit(1);
    }

    const lines = readFileSync(ENV_PATH, 'utf8').split('\n').filter(Boolean);
    lines.push(`CWS_REFRESH_TOKEN=${data.refresh_token}`);
    writeFileSync(ENV_PATH, lines.join('\n') + '\n');

    console.log('✓ Saved CWS_REFRESH_TOKEN to .env');
    console.log('');
    console.log('Setup complete. Now run: npm run publish:cws (from mcp-server/)');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('Token exchange failed:', e.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT_URI} for OAuth callback`);
  console.log('');
  console.log('Opening browser for consent...');
  console.log('If it does not open, paste this URL manually:');
  console.log(authUrl);
  exec(`open "${authUrl}"`, () => {});
});
