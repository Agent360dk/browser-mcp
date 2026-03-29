# Provider Integration Tasks

En agent kan eksekvere disse tasks én-for-én via Agent360 Browser MCP.
Brugeren skal være logget ind på provideren i Chrome inden start.

---

## Workflow per provider

1. `browser_navigate` → provider dashboard
2. `browser_get_page_content` → find token/key sektion
3. `browser_execute_script` eller `browser_ask_user` → extract token
4. POST til vault: `curl -X POST http://localhost:8000/v1/vault/connect -H "Authorization: Bearer {jwt}" -d '{"provider":"slug","token":"..."}'`

---

## Providers

### 1. Stripe (API Key)
- **Vault slug:** `stripe`
- **URL:** `https://dashboard.stripe.com/apikeys`
- **Token format:** `sk_test_...` eller `sk_live_...`
- **Steps:**
  1. `browser_navigate` → URL
  2. `browser_get_page_content` → find "Secret key" sektion
  3. Klik "Reveal test/live key" hvis skjult
  4. Extract token → POST til vault

### 2. HubSpot (Private App Token)
- **Vault slug:** `hubspot`
- **URL:** `https://app.hubspot.com/settings/` → Integrations → Private Apps
- **Token format:** `pat-...`
- **Steps:**
  1. `browser_navigate` → settings URL
  2. Naviger til Private Apps
  3. Opret ny app hvis ingen eksisterer (scopes: crm.objects.contacts.read, crm.objects.deals.read)
  4. Kopier Access Token → POST til vault

### 3. Google Analytics (OAuth via Nango)
- **Vault slug:** `google-analytics`
- **Nango integration ID:** `google-analytics`
- **Steps:**
  1. Kræver Google Cloud OAuth Client ID/Secret i Nango dashboard
  2. `browser_navigate` → `https://console.cloud.google.com/apis/credentials`
  3. Find/opret OAuth 2.0 Client ID (Web application)
  4. Callback URL: `https://api.nango.dev/oauth/callback`
  5. Kopier Client ID + Secret → indsæt i Nango integration settings

### 4. Google Ads (OAuth via Nango)
- **Vault slug:** `google-ads`
- **Nango integration ID:** `google-ads`
- **Steps:** Samme som Google Analytics — deler Google Cloud projekt
  1. Aktiver Google Ads API i Cloud Console
  2. Brug samme OAuth Client
  3. Developer token fra `ads.google.com/aw/apicenter`

### 5. Facebook Ads (User Access Token)
- **Vault slug:** `facebook`
- **URL:** `https://developers.facebook.com/tools/explorer/`
- **Token format:** `EAA...`
- **Steps:**
  1. `browser_navigate` → Graph API Explorer
  2. Vælg app → Get User Access Token
  3. Vælg permissions: `ads_read`, `ads_management`, `pages_read_engagement`
  4. Klik "Generate Access Token"
  5. Extract token → POST til vault
  6. NB: Token udløber efter ~2 timer — brug `browser_ask_user` til at forklare

### 6. Instagram (via Facebook)
- **Vault slug:** `instagram`
- **Steps:** Bruger Facebook Page Token med Instagram permissions
  1. Samme som Facebook Ads men tilføj `instagram_basic`, `instagram_manage_insights`
  2. Token er den samme — POST med provider `instagram`

### 7. LinkedIn (OAuth App)
- **Vault slug:** `linkedin`
- **URL:** `https://www.linkedin.com/developers/apps`
- **Steps:**
  1. `browser_navigate` → developer apps
  2. Vælg/opret app → Auth tab
  3. Kopier Client ID + Client Secret
  4. Alternativt: Nango OAuth flow (integration ID: `linkedin`)

### 8. Shopify (Custom App Token)
- **Vault slug:** `shopify`
- **URL:** `https://admin.shopify.com/store/{store}/settings/apps/development`
- **Steps:**
  1. `browser_ask_user` → "Hvad er dit Shopify store navn?"
  2. `browser_navigate` → admin URL
  3. Settings → Apps → Develop apps → Create app
  4. Configure scopes → Install app → kopier Admin API access token
  5. POST til vault

### 9. Pipedrive (Personal API Token)
- **Vault slug:** `pipedrive`
- **URL:** `https://app.pipedrive.com/settings/api`
- **Token format:** UUID-format
- **Steps:**
  1. `browser_navigate` → URL
  2. `browser_get_page_content` → find "Your personal API token"
  3. Extract → POST til vault

### 10. Slack (Bot OAuth Token)
- **Vault slug:** `slack`
- **URL:** `https://api.slack.com/apps`
- **Token format:** `xoxb-...`
- **Steps:**
  1. `browser_navigate` → URL
  2. Vælg/opret app → OAuth & Permissions
  3. Tilføj scopes: `chat:write`, `channels:read`, `users:read`
  4. Install to Workspace → kopier Bot User OAuth Token
  5. POST til vault

### 11. Calendly (Personal Access Token)
- **Vault slug:** `calendly`
- **URL:** `https://calendly.com/integrations/api_webhooks`
- **Token format:** `eyJ...` (JWT)
- **Steps:**
  1. `browser_navigate` → URL
  2. Klik "Generate new token" eller find eksisterende
  3. Extract → POST til vault

### 12. Mailchimp (API Key)
- **Vault slug:** `mailchimp`
- **URL:** `https://us1.admin.mailchimp.com/account/api/`
- **Token format:** `...-us1` (key + datacenter suffix)
- **Steps:**
  1. `browser_navigate` → URL
  2. Klik "Create A Key" hvis ingen eksisterer
  3. Kopier API key → POST til vault
