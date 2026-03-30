/**
 * Agent360 Browser MCP — Tool Definitions
 *
 * Defines all MCP tools exposed to Claude Code.
 */

export const TOOLS = [
  {
    name: 'browser_navigate',
    description: 'Navigate the active browser tab to a URL. Reuses the current tab by default (no tab spam). Pass new_tab=true only when you need to keep the current page open.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        new_tab: { type: 'boolean', description: 'Open in new tab instead of reusing current (default: false)' },
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
    description: 'Click an element on the page. Supports CSS selectors AND text-based selectors. Auto-scrolls element into view. Uses real mouse events (works on Angular/React SPAs and CSP-strict sites like Google, Stripe). Examples: "button:text(Get started)", "text=Submit", "#my-button", "a.btn-primary"',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or text selector. Text formats: "text=Click me" (any element), "button:text(Submit)" (specific tag)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_fill',
    description: 'Fill a form input field with a value. Supports CSS selectors AND text-based selectors. Auto-scrolls and focuses the element. Works on CSP-strict sites via Chrome Debugger API.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or text selector for the input field' },
        value: { type: 'string', description: 'Value to fill in' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.). Useful for submitting forms, navigating dropdowns, closing dialogs. Supports modifier keys (ctrl, alt, shift, meta).',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press: "Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Backspace", "a", "1", etc.' },
        code: { type: 'string', description: 'Key code (optional, defaults to key name). E.g. "KeyA" for "a"' },
        ctrl: { type: 'boolean', description: 'Hold Ctrl/Cmd key' },
        alt: { type: 'boolean', description: 'Hold Alt key' },
        shift: { type: 'boolean', description: 'Hold Shift key' },
        meta: { type: 'boolean', description: 'Hold Meta (Cmd on Mac) key' },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page to an element or by pixel amount. Useful for reaching elements below the fold.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS or text selector to scroll to (element scrolled into center of viewport)' },
        x: { type: 'number', description: 'Pixels to scroll horizontally (positive = right)' },
        y: { type: 'number', description: 'Pixels to scroll vertically (positive = down, e.g. 500)' },
      },
    },
  },
  {
    name: 'browser_wait',
    description: 'Wait for an element to appear on the page. Supports CSS and text-based selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or text selector (e.g. "text=Success", "button:text(Next)") to wait for' },
        timeout: { type: 'number', description: 'Max wait time in ms (default: 10000)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element to trigger tooltips, dropdown menus, or hover states. Supports CSS and text selectors.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS or text selector to hover over' },
        duration: { type: 'number', description: 'How long to hold hover in ms (default: 500)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_select_option',
    description: 'Select an option from a dropdown menu. Works with native <select> elements AND custom dropdowns (Angular Material, React Select, etc.). For custom dropdowns: clicks the trigger, waits for options, then clicks the matching option by text.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS or text selector for the dropdown trigger / <select> element' },
        option: { type: 'string', description: 'Text of the option to select (partial match supported)' },
        wait: { type: 'number', description: 'Ms to wait after clicking trigger for options to appear (default: 300)' },
      },
      required: ['selector', 'option'],
    },
  },
  {
    name: 'browser_handle_dialog',
    description: 'Handle JavaScript alert(), confirm(), or prompt() dialogs. Call this BEFORE triggering the action that causes the dialog. Waits for the dialog to appear, then accepts or dismisses it.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['accept', 'dismiss'], description: 'Accept or dismiss the dialog (default: accept)' },
        text: { type: 'string', description: 'Text to enter for prompt() dialogs' },
        timeout: { type: 'number', description: 'Max wait for dialog in ms (default: 10000)' },
      },
    },
  },
  {
    name: 'browser_wait_for_network',
    description: 'Wait for a network request to complete. Useful after clicking buttons that trigger API calls — ensures data is loaded before reading the page. Monitors real network traffic via Chrome DevTools Protocol.',
    inputSchema: {
      type: 'object',
      properties: {
        url_pattern: { type: 'string', description: 'Substring to match in the request URL (e.g. "/api/users", "graphql"). Empty = any request.' },
        timeout: { type: 'number', description: 'Max wait in ms (default: 15000)' },
      },
    },
  },
  {
    name: 'browser_fetch',
    description: 'Make an HTTP request from the extension background (NOT subject to CORS). Use this when page-context fetch would be blocked by CORS or CSP. Useful for API calls to Google, Stripe, Slack APIs while on their pages.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        headers: { type: 'object', description: 'Request headers as key-value pairs' },
        body: { type: 'string', description: 'Request body (for POST/PUT)' },
      },
      required: ['url'],
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
