# Browser MCP — Wishlist

This is the public list of features people have asked for. Open and curated by Agent360.

## How to add a wish

- **Easy:** [Open a wish issue](https://github.com/Agent360dk/browser-mcp/issues/new?template=wish.yml) — fill the form, we'll triage and roll it in.
- **Faster:** Ask Claude in your session to "submit a wish for browser-mcp to do X" — it knows the format.
- **PR directly:** Edit this file and open a pull request with your bullet under **🟡 Wanted**.

When a wish gets implemented, it moves to **✅ Shipped** with the version it landed in.

---

## 🟡 Wanted

_Nothing on the public list yet — be the first._

- [💡 Submit a wish →](https://github.com/Agent360dk/browser-mcp/issues/new?template=wish.yml)

---

## ✅ Shipped

- **v1.26.0 (2026-07-27) — The "superior" batch** (born from a real all-night Azure/Railway/OWA session):
  - `browser_copy_to_clipboard` / `browser_paste_from_clipboard` / `browser_clipboard_stats` — SECRET-SAFE clipboard bridge: move credentials from page to field/CLI without the value ever entering the LLM conversation
  - `browser_double_click` — true dblclick (OWA month-view opened inline-rename on two single clicks)
  - `browser_right_click` — page-level context menus
  - `browser_click_xy` — raw-coordinate escape hatch for unselectable custom widgets (Azure portal dialogs)
  - `browser_reattach_debugger` — ghost-attach recovery without extension reload
  - `browser_execute_script` now accepts `script` as alias for `code` + fails loudly with guidance instead of silent undefined

---

## Not in scope

Things we've intentionally decided **not** to do (so you don't have to ask twice):

- _Will be filled in as recurring "no"-answers come up._

---

_Last updated: 2026-05-21 · Maintained by [@Agent360dk](https://github.com/Agent360dk)_
