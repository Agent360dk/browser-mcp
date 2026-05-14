# Chrome Web Store auto-publish — one-time OAuth setup

Configures `scripts/publish-cws.sh` to publish without dashboard-clicks.

After setup: every release is one command:

```bash
./scripts/publish-cws.sh
```

---

## What you need

Four secrets stored in `.env` (already gitignored):

- `CWS_CLIENT_ID`
- `CWS_CLIENT_SECRET`
- `CWS_REFRESH_TOKEN`
- `CWS_EXTENSION_ID`

Below: how to obtain each.

---

## Step 1 — Find your extension ID

1. Go to https://chrome.google.com/webstore/devconsole/
2. Click on "Agent360 Browser MCP" in the list
3. URL becomes `.../devconsole/<long-hash>/<EXTENSION_ID>/edit` — the second hash is your `CWS_EXTENSION_ID`
4. Alternative: from the dashboard, the "Item ID" field is the same value

---

## Step 2 — Enable the Chrome Web Store API in Google Cloud

1. Go to https://console.cloud.google.com/
2. Top bar → create new project (e.g. "agent360-cws-publish") OR pick existing
3. Left sidebar → "APIs & Services" → "Library"
4. Search "Chrome Web Store API" → click → "Enable"

Wait ~30 sec for it to activate.

---

## Step 3 — Create OAuth credentials

1. Left sidebar → "APIs & Services" → "Credentials"
2. "Create Credentials" → "OAuth client ID"
3. If prompted: configure OAuth consent screen first
   - User type: "External" (or "Internal" if you have Workspace org)
   - App name: "Agent360 CWS Publish"
   - User support email: your email
   - Scopes: skip — added later via API call
   - Test users (if External): add your own Google email
   - Save and back to Credentials
4. Create Credentials → OAuth client ID → application type **"Desktop app"**
5. Name: "agent360-cws-cli"
6. Click Create — modal shows `client_id` + `client_secret`
7. Copy both → that's your `CWS_CLIENT_ID` and `CWS_CLIENT_SECRET`

---

## Step 4 — Get refresh token (one-time browser flow)

The refresh token lasts forever (unless revoked). Run this once:

```bash
# Replace CLIENT_ID with your actual client_id from step 3
CLIENT_ID="<your-client-id-here>"

# 1. Open this URL in browser — log in with Google, approve
open "https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&prompt=consent&client_id=${CLIENT_ID}&scope=https%3A//www.googleapis.com/auth/chromewebstore&redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

After approval, Google shows you a code on-screen (or copies to clipboard). Copy the code.

Exchange code for refresh_token:

```bash
CODE="<paste-code-here>"
CLIENT_ID="<your-client-id>"
CLIENT_SECRET="<your-client-secret>"

curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${CLIENT_ID}" \
  -d "client_secret=${CLIENT_SECRET}" \
  -d "code=${CODE}" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

JSON response has `refresh_token` field → that's `CWS_REFRESH_TOKEN`.

⚠ **Save the refresh_token now** — Google only shows it once. If lost, redo Step 4.

---

## Step 5 — Add to .env

Append these to `/Users/gl/browser-mcp/.env`:

```bash
CWS_CLIENT_ID=...
CWS_CLIENT_SECRET=...
CWS_REFRESH_TOKEN=...
CWS_EXTENSION_ID=...
```

`.env` is already gitignored — secrets stay local.

---

## Step 6 — First publish

```bash
./scripts/publish-cws.sh
```

What happens:
1. Reads current version from `extension/manifest.json`
2. Builds `/tmp/agent360-browser-mcp-<version>.zip`
3. Refreshes OAuth access_token using saved refresh_token
4. Uploads zip via CWS Publish API
5. Submits for review (target: public)
6. Prints status — review typically 1-3 days, email on completion

### Useful flags

- `./scripts/publish-cws.sh --draft` → upload only, leave as unpublished draft (manual review-submit via dashboard)
- `./scripts/publish-cws.sh --trusted` → publish to trusted-testers track only (not public)

---

## Troubleshooting

**`OAuth failed: invalid_grant`** — refresh_token expired or revoked. Redo Step 4.

**`Upload failed: ITEM_NOT_UPDATABLE`** — previous version still in review. Wait, OR use `--draft` to replace the queued version.

**`Publish status: ITEM_PENDING_REVIEW`** — already in review queue. Your upload replaced the queued version. Normal.

**Wrong extension ID** — verify Step 1 ID matches what's at devconsole URL.

---

## Future: GitHub Actions auto-publish

When pushing a git tag like `v1.21.0`, automate via:

```yaml
# .github/workflows/cws-publish.yml
name: CWS Publish
on:
  push:
    tags: ['v*']
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/publish-cws.sh
        env:
          CWS_CLIENT_ID:     ${{ secrets.CWS_CLIENT_ID }}
          CWS_CLIENT_SECRET: ${{ secrets.CWS_CLIENT_SECRET }}
          CWS_REFRESH_TOKEN: ${{ secrets.CWS_REFRESH_TOKEN }}
          CWS_EXTENSION_ID:  ${{ secrets.CWS_EXTENSION_ID }}
```

Add secrets at github.com/Agent360dk/browser-mcp/settings/secrets/actions

Then `git tag v1.21.0 && git push --tags` ships to both npm AND CWS.
