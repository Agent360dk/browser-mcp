/**
 * Agent360 Browser MCP — Tool Definitions
 *
 * Defines all MCP tools exposed to Claude Code.
 */

export const TOOLS = [
  {
    name: 'browser_navigate',
    description: 'Navigate the active browser tab to a URL. Returns page title and final URL after load.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_get_page_content',
    description: 'Get the content of the current page as text or HTML.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['text', 'html'], description: 'Output format (default: text)' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the visible area of the current tab. Returns base64 PNG.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_execute_script',
    description: 'Execute JavaScript code in the context of the current page. Returns the result.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript expression to evaluate (runs in page context)' },
      },
      required: ['code'],
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the element to click' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_fill',
    description: 'Fill a form input field with a value.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input field' },
        value: { type: 'string', description: 'Value to fill in' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for an element matching a CSS selector to appear on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Max wait time in ms (default: 10000)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_list_tabs',
    description: 'List all open browser tabs with their URLs and titles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_get_cookies',
    description: 'Get cookies for a specific domain.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to get cookies for (e.g. ".stripe.com")' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'browser_get_local_storage',
    description: 'Read localStorage from the current page. Pass key for a specific value, or omit for all.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Specific localStorage key to read (omit for all)' },
      },
    },
  },
  {
    name: 'browser_ask_user',
    description: 'Show an overlay dialog asking the user to perform an action or provide information (credentials, 2FA, CAPTCHA, OAuth consent). Can include input fields for the user to fill in. Returns user responses.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What the user needs to do or provide' },
        title: { type: 'string', description: 'Dialog title (default: "Agent360 — Action Required")' },
        fields: {
          type: 'array',
          description: 'Input fields for user to fill in. Each field has: name (key), label (display text), type (text/password/email). Omit for simple "Done/Skip" confirmation.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Field key (returned in response)' },
              label: { type: 'string', description: 'Display label' },
              type: { type: 'string', enum: ['text', 'password', 'email', 'number'], description: 'Input type (default: text)' },
            },
            required: ['name', 'label'],
          },
        },
        timeout: { type: 'number', description: 'Max wait time in ms (default: 120000 = 2 min)' },
      },
      required: ['message'],
    },
  },
  {
    name: 'browser_list_frames',
    description: 'List all frames (iframes) in the current page with their URLs and indices.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_select_frame',
    description: 'Execute JavaScript in a specific iframe by frame index. Use browser_list_frames first to find the right index.',
    inputSchema: {
      type: 'object',
      properties: {
        frame_index: { type: 'number', description: 'Frame index from browser_list_frames (0 = main frame)' },
        code: { type: 'string', description: 'JavaScript to execute in the frame (default: returns text content)' },
      },
      required: ['frame_index'],
    },
  },
  {
    name: 'browser_get_new_tab',
    description: 'Get the most recently opened tab (useful after clicking links that open new tabs, OAuth popups, etc.).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_switch_tab',
    description: 'Switch to a specific browser tab by ID. Get tab IDs from browser_list_tabs or browser_get_new_tab.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: { type: 'number', description: 'Tab ID to activate' },
      },
      required: ['tab_id'],
    },
  },
  {
    name: 'browser_close_tab',
    description: 'Close a browser tab by ID. Only tabs owned by the current session can be closed.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: { type: 'number', description: 'Tab ID to close (get from browser_list_tabs)' },
      },
      required: ['tab_id'],
    },
  },
  {
    name: 'browser_extract_token',
    description: 'Navigate to a provider\'s API settings page and extract the API token. Optionally store it in Agent360 vault.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Provider slug (stripe, hubspot, slack, etc.)' },
        store_in_vault: { type: 'boolean', description: 'If true, POST token to Agent360 vault API' },
      },
      required: ['provider'],
    },
  },
];

// Known provider token pages for browser_extract_token
export const PROVIDER_PAGES = {
  stripe: {
    url: 'https://dashboard.stripe.com/apikeys',
    instructions: 'Look for the Secret key starting with sk_live_ or sk_test_',
  },
  hubspot: {
    url: 'https://app.hubspot.com/settings/',
    instructions: 'Navigate to Integrations → Private Apps → create or find existing app → Access Token',
  },
  slack: {
    url: 'https://api.slack.com/apps',
    instructions: 'Select app → OAuth & Permissions → Bot User OAuth Token (xoxb-...)',
  },
  shopify: {
    url: 'https://admin.shopify.com/store/',
    instructions: 'Settings → Apps → Develop apps → find app → Admin API access token',
  },
  mailchimp: {
    url: 'https://us1.admin.mailchimp.com/account/api/',
    instructions: 'Look for the API key or create a new one',
  },
  pipedrive: {
    url: 'https://app.pipedrive.com/settings/api',
    instructions: 'Copy the personal API token shown on the page',
  },
  calendly: {
    url: 'https://calendly.com/integrations/api_webhooks',
    instructions: 'Copy the personal access token or generate a new one',
  },
  google: {
    url: 'https://console.cloud.google.com/apis/credentials',
    instructions: 'Find or create an API key / OAuth client',
  },
  linkedin: {
    url: 'https://www.linkedin.com/developers/apps',
    instructions: 'Select app → Auth → Client credentials',
  },
};
