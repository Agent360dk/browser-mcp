/**
 * Agent360 Browser MCP - Tool Definitions
 *
 * Defines all MCP tools exposed to Claude Code.
 */

export const TOOLS = [
  {
    name: 'browser_navigate',
    description: 'Navigate the active browser tab to a URL. Reuses the current tab by default (no tab spam). Pass new_tab=true only when you need to keep the current page open. In the current tab the answer is ok:true only when Chrome took the address and the new page is proven loaded within about 25 s (the wait ends half a second before that limit). If the page asks "Leave site?", the default answer is Stay (an armed browser_handle_dialog answers instead) and the reply is error beforeunload-blocked with the tab\'s actual url: the page may hold unsaved work, so ask the user (browser_ask_user) before you call again with leave_page:true. Other errors, each with sent (was the address sent to Chrome?) and a note on what to do: navigation-in-progress (another navigate is working in this tab, or - with op_id null - an earlier answer to a dialog on the tab is not confirmed yet; wait a moment), dialog-open (a dialog is on screen - answer it with browser_handle_dialog), tab-not-responding (busy page, or a dialog Chrome does not show us), navigation-failed, dialog-unconfirmed, navigation-unconfirmed (no load proven in time; may_complete_later and pending_url say it can still happen - read the tab before sending it again; a download or a 204 answer never loads a page and ends here too), tab-closed (Chrome no longer has the tab), session-changed (another call changed the session\'s active tab while this one waited; nothing was sent).',
    inputSchema: {
      type: 'object',
      properties: {
        eget_vindue: { type: 'boolean', description: 'Requires new_tab. Opens the page in its own Chrome window, without focus unless you pass fokuser:true. Whether Chrome delivers mouse and keyboard input to a window without focus is unmeasured in desktop Chrome (a measurement on 19 Sept probably tested a background tab, because the tab was moved back into the session\'s first window; fixed in 1.30.2), so read landed in each input tool\'s answer. On a machine with more than one display, you can put the window on a screen nobody is looking at and pass fokuser:true - but focus is exclusive: while this window has it, whatever the person types lands in it. Use that only on a machine nobody is typing on.' },
        fokuser: { type: 'boolean', description: 'With eget_vindue: ASK for the new window to get the operating system\'s focus. Chrome can refuse it. The reply carries what actually happened - read `fokuseret` and `placeret_som_bedt` rather than assuming this worked. Do not rely on vindue_x to keep a run off the user\'s screen.' },
        vindue_x: { type: 'number', description: 'With eget_vindue: the window\'s left edge in global screen points. A NEGATIVE value is a display to the left of the main one - that is how you put it on another screen. No tool lists the displays: use a coordinate you know is on an unused screen, and read `placeret_som_bedt` in the reply.' },
        vindue_y: { type: 'number', description: 'With eget_vindue: the window\'s top edge in global screen points.' },
        vindue_bredde: { type: 'number', description: 'With eget_vindue: window width in points.' },
        vindue_hoejde: { type: 'number', description: 'With eget_vindue: window height in points.' },
        url: { type: 'string', description: 'URL to navigate to' },
        new_tab: { type: 'boolean', description: 'Open in new tab instead of reusing current (default: false). If the session\'s only tab is still an empty about:blank placeholder, that tab is used instead of opening another.' },
        leave_page: { type: 'boolean', description: 'Answer "Leave site?" with Leave instead of Stay (default: false), so unsaved changes on the current page are lost. Only after the user has agreed (browser_ask_user). An armed browser_handle_dialog on the tab takes precedence over this.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_get_page_content',
    description: 'Get the content of the current page as text or HTML. Pass `selector` to read one part of a large page instead of all of it - on a big logged-in app the full HTML can run past a million characters. The answer is capped at 30000 characters by default and says so when it had to cut, with the real length, so a truncated page is never mistaken for a whole one.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['text', 'html'], description: 'Output format (default: text)' },
        selector: { type: 'string', description: 'CSS selector. Reads only that element instead of the whole page. If it matches nothing the call fails rather than silently returning the whole page.' },
        max_chars: { type: 'number', description: 'Cap on returned characters (default: 30000). Over the cap the answer carries truncated: true and total_chars.' },
      },
    },
  },
  {
    name: 'browser_extract_list',
    description: 'Read the rows of a long or virtualised list by scrolling its container until no new rows appear. Use this instead of browser_get_page_content whenever a page shows a repeating list longer than the viewport - mail lists (Outlook, Gmail), invoice/billing tables, search results, transaction histories. Those UIs keep only ~7 rows in the DOM at a time, so a single page read returns a sliver and looks complete. Pass the CSS selector of one repeating row (e.g. \'[role="option"]\', \'tr\', \'[role="listitem"]\'); the scrollable ancestor is found automatically. When the tab is the active one in its window, it scrolls with real wheel events, also at the bottom, so a feed that loads more rows on wheel (Threads, X) loads them. A hidden page (a background tab) gets no wheel or scroll events, IntersectionObserver callbacks or animation frames, so a list that loads or renders rows while you scroll stops at what is already there; then reached_end is false and `note` says why. Returns deduplicated row text, scroll_method (wheel or script) and reached_end, which is true only when the list stood at its bottom in a visible page with no new rows, growth or movement for stable_rounds rounds in a row. If the selector matches no rows with text, the answer is error "no-rows".',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector matching ONE repeating row (e.g. \'[role="option"]\' in Outlook, \'tr\' in a table)' },
        container: { type: 'string', description: 'Optional CSS selector for the scrollable container. Omit to auto-detect the row\'s nearest scrollable ancestor.' },
        max_rows: { type: 'number', description: 'Stop after this many unique rows (default 500, max 5000)' },
        stable_rounds: { type: 'number', description: 'Rounds in a row with no new rows, growth or movement before stopping, and at the bottom before reached_end (default 3)' },
        scroll_step: { type: 'number', description: 'Pixels per scroll. Omit for 85% of the container height.' },
        wait_ms: { type: 'number', description: 'Wait after each scroll so new rows can render (default 350)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the visible area of the current tab. Returns base64 PNG, or saves to disk if path is provided. The image is in device pixels; when Chrome reports them in time, the answer also gives the CSS viewport size and devicePixelRatio, which browser_click_xy coordinates need. Chrome stays where it is: if its window is covered by other windows, there is no picture and the answer is error "window-covered".',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to save the screenshot to (e.g. /path/to/screenshot.png)' },
        bring_to_front: { type: 'boolean', description: 'Raise Chrome in front of the user if its window is covered, and leave it there. Takes the user\'s screen: only after the user agreed (browser_ask_user). Default false.' },
      },
    },
  },
  {
    name: 'browser_execute_script',
    description: 'Execute JavaScript in the current page, through the Chrome debugger (Runtime.evaluate) in the page\'s own context: the page\'s globals are visible and its Content Security Policy does not block it. A returned promise is awaited. If the code throws, the answer is ok:false with error and name, and the code is not run again. The call answers within 29.5 s; if the time runs out before the code is sent, the answer is error call-timeout with sent:false (nothing ran). If no answer reaches the server within 45 s (Chrome itself stalled), the answer is error no-answer with sent:"unknown": the code MAY have run, it is not repeated, and you should call again only if it is safe to run twice. IMPORTANT: the parameter is `code` (NOT `script` - though that alias is accepted), and it must be an EXPRESSION, not statements: use an IIFE `(() => { ...; return x; })()`. Top-level `return` is a syntax error (the handler wraps code in parentheses).',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript EXPRESSION to evaluate in page context. For multi-statement logic use an IIFE: (() => { ...; return result; })()' },
      },
      required: ['code'],
    },
  },
{
    name: 'browser_double_click',
    description: 'True double-click on an element (two trusted press/release pairs with escalating clickCount). Use for open-item actions (calendar events, file lists) where two single clicks would trigger inline-rename instead (e.g. OWA month view). If the mouse would not reach the target at its center - another element lies in front of it (an overlay, a dialog\'s backdrop), the target does not take clicks there (pointer-events, visibility, clipping), or a different control inside it would get the click (a delete button on a card; for a container that is not clickable itself, its own plain link with a real address (a hash route with a path, such as #/orders, counts; a fragment with no target on the page does not) does not count, nor does a web component\'s own button that covers it, nor a box with a checkbox, switch or radio role right next to a hidden field and the only one in the nearest label around it, a label of that field (a box inside a closed shadow root cannot be seen and is not counted), which counts as that field) - the answer is ok:false with error "covered" and covered_by. Found before the mouse is sent, nothing is sent; if it comes in front afterwards, the rest of the presses and clicks are stopped (a release the page moves elsewhere is let through), and the answer also has maybe_landed: true, because the page may already have reacted.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS or text selector' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_right_click',
    description: 'Right-click an element (trusted CDP mouse events) to open page-level context menus (web apps like OWA/Google Docs render their own). Note: Chrome\'s NATIVE context menu does not open via CDP - only in-page menus. If the mouse would not reach the target at its center - another element lies in front of it (an overlay, a dialog\'s backdrop), or the target does not take clicks there (pointer-events, visibility, clipping) - the answer is ok:false with error "covered" and covered_by. Found before the mouse is sent, nothing is sent; if it comes in front afterwards, the rest of the presses and clicks are stopped (a release the page moves elsewhere is let through), and the answer also has maybe_landed: true, because the page may already have reacted.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS or text selector' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_click_xy',
    description: 'ESCAPE HATCH: Click at raw viewport coordinates (CSS pixels) with fully trusted mouse events. Use when a visible button resists every selector strategy (Azure portal dialogs, Knockout-bound divs, canvas UIs): take a screenshot, read the button\'s position, click its center. Coordinates are CSS pixels, NOT image pixels: convert with the viewport line browser_screenshot returns: x_css = x / W * css_width and y_css = y / W * css_width, where (x, y) is the point in the image and W is the width the image is shown to you at.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate (CSS pixels, from left of viewport)' },
        y: { type: 'number', description: 'Y coordinate (CSS pixels, from top of viewport)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser_reattach_debugger',
    description: 'RECOVERY: Force-detach and re-attach the Chrome debugger on the current tab. Use when interactive tools (click/fill/press_key) start timing out or reporting ghost-attach ("Debugger attach failed ... ghost") while list_tabs still works - faster than reloading the extension.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_click',
    description: 'Click an element on the page. Supports CSS selectors AND text-based selectors. Auto-scrolls element into view. Uses real mouse events (works on Angular/React SPAs and CSP-strict sites like Google, Stripe). A text selector looks inside an open modal dialog first (a <dialog> opened with showModal, or a visible element with aria-modal="true"), exact text before partial. If the mouse would not reach the target at its center - another element lies in front of it (an overlay, a dialog\'s backdrop), the target does not take clicks there (pointer-events, visibility, clipping), or a different control inside it would get the click (a delete button on a card; for a container that is not clickable itself, its own plain link with a real address (a hash route with a path, such as #/orders, counts; a fragment with no target on the page does not) does not count, nor does a web component\'s own button that covers it, nor a box with a checkbox, switch or radio role right next to a hidden field and the only one in the nearest label around it, a label of that field (a box inside a closed shadow root cannot be seen and is not counted), which counts as that field) - the answer is ok:false with error "covered" and covered_by. Found before the mouse is sent, nothing is sent; if it comes in front afterwards, the rest of the presses and clicks are stopped (a release the page moves elsewhere is let through), and the answer also has maybe_landed: true, because the page may already have reacted. Examples: "button:text(Get started)", "text=Submit", "#my-button", "a.btn-primary"',
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
    description: 'Fill a form input field with a value. Supports CSS selectors AND text-based selectors. Auto-scrolls and focuses the element. Works on CSP-strict sites via Chrome Debugger API. For date inputs use browser_set_date, for autocomplete/combobox use browser_set_combobox. With a text selector the field is clicked first, so the same check as browser_click applies: if the mouse would not reach it at its center, nothing is typed and the answer is ok:false with error "covered".',
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
    description: 'Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.). Useful for submitting forms, navigating dropdowns, closing dialogs. Supports modifier keys (ctrl, alt, shift, meta). Enter acts like the real key (the page gets keydown, keypress and keyup 13): in a text field it submits the form, on a focused button it presses it, and in a textarea it adds a line break - from 1.32; before, it did none of these, so press Enter only when that is what you want. "Space" is the space bar: in a field it types a space, on a focused button it presses it, and on a checkbox it ticks it (from 1.32; before, it did none of these). Key codes follow the US layout: punctuation is sent as the key it sits on ("," is keyCode 188, code "Comma"), and a shifted character such as "<" or "@" is that key with Shift held; a capital letter is sent without Shift. shift does not change the character ("," with shift is still a comma). While ctrl, meta or alt is held, no character is typed. With ctrl or meta (and no shift), the letters a, c, x, v, z and y are sent with Chrome\'s own editing command - select all, copy, cut, paste, undo, redo; z with shift is redo - including on macOS, where Chrome runs no shortcut for a synthetic key without it. The answer names the command that was sent in `shortcut`; `landed` says the page received the key, not what the command did. Paste inserts the user\'s real clipboard into the page, and copy and cut replace what is on it.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press: "Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Backspace", "a", "1", etc.' },
        code: { type: 'string', description: 'Physical key code (optional). Without it, the key it sits on in the US layout: "KeyA" for "a", "Comma" for ",", "Digit2" for "@"; a character not on a US keyboard gets none. Setting it changes only the code, not the key code' },
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
    description: 'Hover over an element to trigger tooltips, dropdown menus, or hover states. Supports CSS and text selectors. If the mouse would not reach the target at its center - another element lies in front of it (an overlay, a dialog\'s backdrop), or the target does not take clicks there (pointer-events, visibility, clipping) - the answer is ok:false with error "covered" and covered_by. Found before the mouse is sent, nothing is sent; if it comes in front afterwards, the rest of the mouse movement is stopped and the answer also has maybe_landed: true, because the page may already have reacted.',
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
    description: 'Select an option from a dropdown menu. Works with native <select> elements AND custom dropdowns (Angular Material, React Select, etc.). For custom dropdowns: clicks the trigger, waits for options, then clicks the matching option by text. For autocomplete (typing filters options) use browser_set_combobox instead. A custom dropdown\'s trigger gets the same check as browser_click: if the mouse would not reach it at its center, nothing is opened and the answer is ok:false with error "covered". So does the option once the list is open: if it is covered, it is not clicked, and the answer is ok:false with error "covered" and trigger_clicked: true - the list may still be open. If the click on the trigger was sent, but neither its press is shown to have reached it nor its click landed, no option is clicked and the answer is ok:false with maybe_landed: true; a click that cannot be checked in the page is not sent, and the answer says so; if it opens a dialog, or the option is not found, the answer has trigger_clicked: true.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS or text selector for the dropdown trigger / <select> element' },
        option: { type: 'string', description: 'Text OR value of the option to select. Exact value match wins, then exact text, then partial text. Aliases: `value`, `label`. Fails loudly with the available options if nothing matches. A controlled component may reset the field and store the choice elsewhere, so a success can come with `landed: null` and `maybe_landed: true`: the page changed, but the change does not prove it was the selection. Read the page before selecting again.' },
        wait: { type: 'number', description: 'Ms to wait after clicking trigger for options to appear (default: 300)' },
      },
      required: ['selector', 'option'],
    },
  },
  {
    name: 'browser_dismiss_overlays',
    description: 'Dismiss visible popups, modals, tooltips, banners, and "Are you sure?"-style overlays in one call. Heuristic-based: finds close affordance via aria-label, text content (Skip/Cancel/Ikke nu/Don\'t show/Got it/Close), or × character button. Use when a flow is interrupted by unexpected dialogs (cookie banners, onboarding tooltips, draft-confirm prompts on Meta Ads, etc.). Returns list of what was dismissed.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['non_critical', 'aggressive'], description: 'non_critical (default): skip dialogs containing editable form inputs (preserves user data). aggressive: dismiss everything.' },
        max_passes: { type: 'number', description: 'Number of dismissal passes (some overlays reveal others when closed). Default: 3' },
      },
    },
  },
  {
    name: 'browser_set_combobox',
    description: 'Set value(s) on an autocomplete/combobox input. Handles the click → type query → wait for filtered listbox → click option flow as one MCP call. Supports multi-select (e.g., Languages on Meta Ads). Use when browser_select_option fails because options render lazily after typing.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the combobox/autocomplete input' },
        value: { type: 'string', description: 'Single value to select (use this OR values)' },
        values: { type: 'array', items: { type: 'string' }, description: 'Array of values for multi-select. E.g. ["Danish", "English", "Swedish"]' },
        multi: { type: 'boolean', description: 'True if combobox accepts multiple values (chips). Default: auto-detected from presence of values array' },
        query_chars: { type: 'number', description: 'How many characters to type as filter query (default: 4 or full value length, whichever is smaller)' },
        wait_ms: { type: 'number', description: 'Max ms to wait for options listbox to appear after typing (default: 3000)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_drop_file',
    description: 'Handing a file to the page needs "Allow access to file URLs" for the Agent360 Browser MCP extension (off by default for Chrome Web Store installs); that switch also lets the extension open any local file as a page, so whether to turn it on is the user\'s call. A "Not allowed" error from the handoff is reported as file-access-off unless Chrome confirms that file access is on. Upload a file when browser_upload_file fails. Two strategies: (1) uses the target itself when it is a file input, or a hidden <input type="file"> inside it; (2) if there is none, clicks the target and intercepts the NATIVE OS file-chooser it opens - pass the selector of the button that opens the dialog, and the file is supplied programmatically without the dialog ever appearing. Other file inputs on the page do not get the file: when neither strategy works, the error lists them in other_file_inputs, each with a `selector` to pass if it is the right field - a CSS selector that matched that input alone when the tool looked (built from its id, its name or its position on the page), or null when none did, for instance for an input inside a shadow root. The answer describes the input that got the file in `input`. If the field is empty afterwards although the page\'s change handler saw the file in it, the answer is ok with cleared_by_page: true and seen_in_field - X and Facebook empty the field after reading the file, and a page that rejects the file can do the same, so check the page before attaching again. Files must be regular files inside the working directory the MCP server runs in - folders, symlinks and hardlinks that point outside it are refused.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the drop-zone target element (e.g. ".upload-area")' },
        file: { type: 'string', description: 'Single absolute file path. Alias: `file_path`.' },
        files: { type: 'array', items: { type: 'string' }, description: 'Array of absolute file paths' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_set_date',
    description: 'Robustly set a date input - handles native <input type="date">, masked text inputs (e.g. MM/DD/YYYY), and calendar pickers (MUI, react-datepicker, AntD, Lexical/Meta). Tries native value-set, format-aware typing via Input.insertText, and ARIA-based picker navigation in sequence with read-back verification. Use instead of browser_fill when fill fails or for any input that opens a calendar widget.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the date input element' },
        date: { type: 'string', description: 'ISO date string (YYYY-MM-DD), e.g. "2026-05-15"' },
        skip_picker: { type: 'boolean', description: 'If true, only try native + masked paths and skip calendar-picker navigation (default: false)' },
      },
      required: ['selector', 'date'],
    },
  },
  {
    name: 'browser_handle_dialog',
    description: 'Answer a JavaScript alert/confirm/prompt or "Leave site?" on the active tab. If a dialog this extension saw open is on screen and nobody is answering it, it is answered now, and the reply says what Chrome reports happened (action accept or dismiss). Otherwise this arms automatic handling of the next dialog on the tab and returns immediately - call it BEFORE the click that opens the dialog, because a dialog freezes the tab. Pass wait=true only when the dialog is already opening. Errors: dialog-being-answered (browser_navigate or an earlier call is answering it - wait), dialog-unconfirmed (answered, but Chrome did not confirm it closed), tab-not-responding (a dialog that opened before anything listened, or a busy page; the note says what to do).',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['accept', 'dismiss'], description: 'Accept or dismiss the dialog (default: accept)' },
        text: { type: 'string', description: 'Text to enter for prompt() dialogs' },
        timeout: { type: 'number', description: 'How long the arming stays active in ms (default: 60000)' },
        wait: { type: 'boolean', description: 'Block until a dialog appears instead of arming and returning (default: false). Only use when the dialog is already on its way.' },
      },
    },
  },
  {
    name: 'browser_wait_for_network',
    description: 'Wait for a network request to complete. Useful after clicking buttons that trigger API calls - ensures data is loaded before reading the page. Monitors real network traffic via Chrome DevTools Protocol.',
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
    description: 'Make an HTTPS request from the extension background. It is not subject to the page\'s CORS or CSP, so it works for API calls (Google, Stripe, Slack) where a fetch from the page would be blocked. Your browser cookies are not sent and the answer\'s cookies are not stored: pass a token in headers. Plain http works only to 127.0.0.1.',
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
    description: 'List the tabs this session owns (tabs it opened or adopted): id, URL, title, and each tab\'s active flag (whether Chrome shows it in front of its window, not which tab this session is working in). Tabs of other sessions are not included.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_get_cookies',
    description: 'Get cookies for a site this session has open in one of its tabs (the site itself, a parent domain or a subdomain). Navigate to the site first - cookies for sites the session is not working on are refused.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to get cookies for (e.g. ".stripe.com"). Must match a tab this session has open.' },
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
    name: 'browser_set_cookies',
    description: 'Set one or more cookies for a domain.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Cookie name' },
        value: { type: 'string', description: 'Cookie value' },
        domain: { type: 'string', description: 'Cookie domain (e.g. ".example.com")' },
        url: { type: 'string', description: 'URL for the cookie (alternative to domain)' },
        path: { type: 'string', description: 'Cookie path (default: /)' },
        secure: { type: 'boolean', description: 'Secure flag (default: true)' },
        httpOnly: { type: 'boolean', description: 'HttpOnly flag (default: false)' },
        sameSite: { type: 'string', enum: ['no_restriction', 'lax', 'strict'], description: 'SameSite attribute (default: lax)' },
        cookies: { type: 'array', description: 'Array of cookie objects to set multiple at once', items: { type: 'object' } },
      },
      required: ['name', 'value'],
    },
  },
  {
    name: 'browser_set_local_storage',
    description: 'Set a localStorage key-value pair on the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'localStorage key to set' },
        value: { type: 'string', description: 'Value to store (string)' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'browser_console_logs',
    description: 'Get recent console.log/warn/error messages from the page. Installs a lightweight interceptor on first call. Returns the last N console messages.',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of recent messages to return (default: 50)' },
      },
    },
  },
  {
    name: 'browser_ask_user',
    description: 'Ask the user to do something or give information. Without fields it shows a small card in the bottom-left corner that the user can drag away while they act on the page (log in, solve a CAPTCHA, give consent); with fields it shows a dialog over the page. The prompt is drawn again after a navigation in the tab, but a prompt with fields ends with action navigated if the tab moves to another origin (another domain, subdomain or port) or, on a local file, to another file. Returns acknowledged, action (done, skip, timeout, tab_closed, replaced when a newer question in the same tab takes over, navigated, or removed_by_page when the page keeps removing the prompt) and, for done, values. The page cannot read the field values, but it can see the keystrokes, so ask only for secrets that belong to the page the tab is on. The tab must show a page that loaded (a web page or a local file): on Chrome\'s error page or about:blank the call fails at once and shows nothing. It makes the tab the active one in its window and restores a minimized window, but it does not bring Chrome in front of other apps.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'What the user needs to do or provide' },
        title: { type: 'string', description: 'Dialog title (default: "Agent360 - Action Required")' },
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
    description: 'Execute JavaScript in a specific frame by frame index, through the Chrome debugger in that frame\'s own context - also a frame from another site. Use browser_list_frames first to find the right index. A returned promise is awaited; without code it returns the frame\'s text (first 5000 characters). The frame is identified by a one-time mark the extension puts in that frame\'s document, not by its address or position; if the mark is not found, nothing is run (error frame-not-reachable, and retry says whether calling again can help; a frame whose document is replaced while the call looks for it gives retry: true). The call answers within 29.5 s; if the time runs out before the code is sent, the answer is error call-timeout with sent:false (nothing ran). If no answer reaches the server within 45 s (Chrome itself stalled), the answer is error no-answer with sent:"unknown": the code MAY have run, it is not repeated, and you should call again only if it is safe to run twice.',
    inputSchema: {
      type: 'object',
      properties: {
        frame_index: { type: 'number', description: 'Frame index from browser_list_frames (0 = main frame)' },
        code: { type: 'string', description: 'JavaScript EXPRESSION to evaluate in the frame (default: returns its text content)' },
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
    description: 'Switch to a specific browser tab by ID. Get tab IDs from browser_list_tabs or browser_get_new_tab. The other tools then act on that tab. Chrome is not brought in front of the user: the tab is made active in its window, and visibility says whether the page is hidden behind other windows.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: { type: 'number', description: 'Tab ID to switch to' },
        bring_to_front: { type: 'boolean', description: 'Also bring the Chrome window in front of the user. Takes the user\'s screen: only after the user agreed (browser_ask_user). Default false.' },
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
    name: 'browser_upload_file',
    description: 'Handing a file to the page needs "Allow access to file URLs" for the Agent360 Browser MCP extension (off by default for Chrome Web Store installs); that switch also lets the extension open any local file as a page, so whether to turn it on is the user\'s call. A "Not allowed" error from the handoff is reported as file-access-off unless Chrome confirms that file access is on. Upload a file to a <input type="file"> element on the page. Uses Chrome Debugger API to set files programmatically - no dialog needed. For drag-drop zones without visible file input use browser_drop_file. If the field is empty afterwards although the page\'s change handler saw the file in it, the answer is ok with cleared_by_page: true and seen_in_field - X and Facebook empty the field after reading the file, and a page that rejects the file can do the same, so check the page before attaching again. Files must be regular files inside the working directory the MCP server runs in - folders, symlinks and hardlinks that point outside it are refused.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the file input (default: input[type="file"])' },
        files: { type: 'array', items: { type: 'string' }, description: 'Array of absolute file paths to upload. E.g. ["/Users/me/photo.jpg"]' },
        file: { type: 'string', description: 'Single file path (alternative to files array). Alias: `file_path`.' },
      },
      required: ['files'],
    },
  },
  {
    name: 'browser_extract_token',
    description: 'Open a known provider\'s API page (stripe, hubspot, slack, shopify, mailchimp, pipedrive, calendly, google, linkedin) and get instructions for finding or creating its API credentials there. It reads nothing itself: read the page with browser_get_page_content or browser_screenshot afterwards. For HubSpot, Slack, Shopify and LinkedIn the page is a settings or app list on the way to the token, not the token page itself. Any other provider answers Unknown provider; use browser_navigate and read the page yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'One of: stripe, hubspot, slack, shopify, mailchimp, pipedrive, calendly, google, linkedin' },
      },
      required: ['provider'],
    },
  },
  {
    name: 'browser_solve_captcha',
    description: 'Detect CAPTCHAs on the current page and work through them, one action per call. "detect" reports reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile and FunCaptcha. "click_checkbox" tries the reCAPTCHA checkbox and detects again. "click_grid" clicks the reCAPTCHA image-challenge cells you choose; this tool returns no image, so take one with browser_screenshot first. "ask_human" returns the message to show the user with browser_ask_user.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['detect', 'click_checkbox', 'click_grid', 'ask_human'], description: 'Action to take. "detect" scans for CAPTCHAs. "click_checkbox" clicks the reCAPTCHA checkbox. "click_grid" clicks specific reCAPTCHA grid cells (pass cells, and grid 3 or 4). "ask_human" returns the message to show the user with browser_ask_user; it shows nothing itself. Default: "detect"' },
        cells: {
          type: 'array',
          items: { type: 'integer' },
          description: 'Grid cell indices to click (0-indexed, left-to-right, top-to-bottom) for image challenges. E.g. [2, 5, 7] to click cells 3, 6, 8. Pass grid to say which grid you see; without it, the grid is read as 4x4 only when an index is 9 or higher.',
        },
        grid: {
          type: 'number',
          enum: [3, 4],
          description: 'For click_grid: the size of the reCAPTCHA image grid in your screenshot, 3 (3x3) or 4 (4x4).',
        },
      },
    },
  },
  {
    name: 'browser_about',
    description: 'Returns Browser MCP info and pre-filled URLs the user can click to submit feature wishes, share use-cases, or report bugs. Call this PROACTIVELY whenever the user (a) mentions a feature they wish existed ("I wish browser-mcp could...", "it would be nice if..."), (b) says something is missing, broken, or unexpected, (c) asks how Browser MCP works or who maintains it, or (d) describes something cool they built with browser-mcp. Pass intent="wish" | "use_case" | "bug" | "info" plus an optional title and body, and offer the returned submit_url to the user. Browser MCP is community-shaped - this tool is how the user contributes back. It also lists the Browser MCP installations connected to this chat (installations: the profile name set in the extension popup, the installation id, the version), so you can see which names BROWSER_MCP_PROFILE can choose; it lists nothing before the browser has been used in the chat.',
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          enum: ['wish', 'use_case', 'bug', 'info'],
          description: 'What the user wants to share. "wish" = feature request, "use_case" = share what they built, "bug" = something broken, "info" = general (default: "info").',
        },
        title: {
          type: 'string',
          description: 'Optional pre-filled issue title (e.g. "Support hCaptcha v3"). Will be URL-encoded into the submit link.',
        },
        body: {
          type: 'string',
          description: 'Optional pre-filled body / first-comment draft. Will be URL-encoded into the submit link. Keep it short; user can expand on GitHub.',
        },
      },
    },
  },
  {
    name: 'browser_provide_feedback',
    description: 'Self-diagnosis + feedback in one call. Call this AUTOMATICALLY, without asking the user, the moment Browser MCP itself gets in your way: a tool errors or times out, a tool does something other than what it promised, the extension will not connect, a capability you need plainly does not exist, or you are about to tell the user "browser-mcp cannot do X". It first CHECKS THE INSTALL - the connected Chrome extension\'s version against this server (set BROWSER_MCP_CHECK_NPM=1 to also compare this server against the latest published on npm; it is off by default so the call stays fast and works offline), and whether more than one Browser MCP extension is connected at once, also the same extension connected more than once, for instance from several Chrome profiles or browsers (a known cause of tabs and sessions behaving randomly) - so a problem that is really "your copy is outdated" or "you have two extensions loaded" is identified as such instead of reported as a bug. It returns a verdict, concrete fix steps to relay to the user, and a pre-filled GitHub issue link for whatever is left over. Cheap to call speculatively. It uploads nothing: it returns the report to you and tries to add one line to ~/.browser-mcp/feedback.jsonl on this machine (a report with the same kind, tool and first 160 characters of what_happened, with numbers and long hex strings ignored, is written once per server run, and again only if the earlier write failed; logged_locally says whether a line was written). Email addresses and numbers of six or more characters are replaced with [email] and [number] in what_happened, attempted and worked before they are written or put in the issue link. With BROWSER_MCP_CHECK_NPM=1 it also runs `npm view` against your configured npm registry.',
    inputSchema: {
      type: 'object',
      properties: {
        what_happened: {
          type: 'string',
          description: 'Required. What you tried and what actually happened, in one or two plain sentences. Include the exact error text if there was one.',
        },
        kind: {
          type: 'string',
          enum: ['blocked', 'broken', 'missing', 'wish', 'use_case'],
          description: '"blocked" = you could not complete the task (default). "broken" = a tool misbehaved or lied about its result. "missing" = the capability does not exist. "wish" = a feature idea. "use_case" = something worth sharing that you built.',
        },
        tool: {
          type: 'string',
          description: 'The browser_* tool involved, e.g. "browser_click". Omit if none in particular.',
        },
        url: {
          type: 'string',
          description: 'The page it happened on, if relevant. Strip query strings that contain tokens.',
        },
        attempted: {
          type: 'string',
          description: 'What you already tried (other selectors, other tools, retries) so the report does not suggest what you have ruled out.',
        },
        worked: {
          type: 'string',
          description: 'The route that did work in the end, if any. This is the most useful part.',
        },
      },
      required: ['what_happened'],
    },
  },
  // 1.32 (#20, idéen er ugbodagadave's): én partition pr. parallel agent - sin egen fanegruppe og sin egen aktive fane.
  {
    name: 'browser_partition',
    description: 'Give a parallel agent its own part of the browser. action "new" opens a partition: its own listener port, so the extension gives it its own tab group and its own active tab, and agents that share this chat no longer take over each other\'s tabs. It answers an id like "p1"; pass partition: "p1" to every browser tool that agent calls (calls without partition go to the default partition). Ids are never reused while the server runs (when the MCP client restarts the server, numbering starts at p1 again). "new" chooses the Chrome profile right away by the same rules as BROWSER_MCP_PROFILE: pass profile to choose by the name in the extension popup, otherwise the partition uses BROWSER_MCP_PROFILE (or, without it, the same choice as the default partition: it waits about 2.5 seconds for the installations to connect, then takes the newest extension version, on a tie the one that connected last, and the answer says which one it took). It takes a few seconds, because the extension scans for new ports every 2 seconds. Errors: partition-limit (4 open partitions per server), port-capacity-exhausted (every port in the range is taken), the profile-* answers (profile-not-connected and the others; no partition is created and its port is released), and partition-closed when the partition is closed while "new" is still creating it. action "close" closes the partition\'s tabs through its own connection and releases its port: port_released, and tabs_closed true only when the extension confirmed it or when no tool call ever used the partition (it then has no tabs, and the extension is not asked), otherwise "unknown". Calls with a closed id answer partition-closed with sent: false. A command that is still waiting for the extension\'s answer when close releases the port answers partition-closed with sent: true (it may have been carried out); one answered before that gets its normal answer. An unknown id, or the id of a partition "new" is still creating, answers partition-not-found. Nothing is sent to the default partition instead. browser_about lists the partitions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['new', 'close'], description: '"new" opens a partition, "close" closes one.' },
        profile: { type: 'string', description: 'With new: the name of the Chrome profile in the extension popup ("This Chrome profile") the partition drives. Default: BROWSER_MCP_PROFILE.' },
        label: { type: 'string', description: 'With new: an optional label for your own overview, shown in browser_about (up to 64 characters).' },
        partition: { type: 'string', description: 'With close: the id of the partition to close, e.g. "p1". The default partition cannot be closed.' },
      },
      required: ['action'],
    },
  },
];

// 1.32 (#20): `partition` paa hvert vaerktoej, der naar browseren - ogsaa browser_extract_token, som selv navigerer. De
// server-lokale (about, provide_feedback) og partitionsvaerktoejet selv har den ikke.
const PARTITION_PARAM = {
  type: 'string',
  description: 'Run this call in a partition from browser_partition (an id like "p1"). Leave it out for the default partition. An unknown or closed id is an error; the call is never sent to the default partition instead.',
};
for (const t of TOOLS) {
  if (['browser_about', 'browser_provide_feedback', 'browser_partition'].includes(t.name)) continue;
  t.inputSchema.properties.partition = PARTITION_PARAM;
}

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
