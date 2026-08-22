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

## Målt mod Google Ads (22/8-2026)

Tre huller fundet under en rigtig opgave — annoncørverificering, konverterings-opsætning
og pausering af en kampagne. Alle tre kostede tid, og det første kostede en fejldiagnose.

### 1. `click` bør selv aktivere fanen · **høj**

Klik lander ikke når fanen er skjult. Med det nye `landed`-flag kan man se det —
uden det så alt ud til at virke. Under hele opgaven måtte hvert eneste klik forudgås
af et `switch_tab`, ellers kom `landed: false`.

**Forslag:** `click` (og `fill`, `press_key`) aktiverer fanen først, eller advarer
eksplicit i svaret når den er skjult.

### 2. Angular Material-checkboxes kan ikke markeres · **høj**

Google Ads' kampagnetabel bruger `<mat-checkbox role="checkbox">` uden `<input>`.
Den reagerer **hverken** på trusted klik på host-elementet (`landed: true`, men
`aria-checked` blev ved med at være `false`), på syntetisk klik, eller på mellemrum
når elementet har fokus.

**Det der virker:** klik på det indre `.particle-ripple-container`. Fem forsøg gik
til spilde før det blev fundet — pausering af en kampagne var reelt umulig imens.

**Forslag:** når `click` rammer en `[role=checkbox]`/`[role=switch]` og `aria-checked`
ikke ændrer sig, så prøv automatisk det inderste klikbare barn og rapportér hvad der virkede.

### 3. Trusted Types blokerer `execute_script` i iframes · **lav**

`payments.google.com`-iframen (annoncørverificering) afviser al JS-evaluering:
*"Evaluating a string as JavaScript violates this document's Trusted Type assignment
requirements."* Ikke noget vi kan omgå — det er sidens egen politik.

Klik og `upload_file` virker fint der, fordi de går gennem fejlfindings-API'et.
Kun læsning af DOM'en kræver skærmbillede.

**Forslag:** returnér en tydeligere fejl der siger "brug screenshot/click i stedet for
execute_script på denne frame", frem for den rå Trusted-Types-besked.


---

_Last updated: 2026-08-22 · Maintained by [@Agent360dk](https://github.com/Agent360dk)_
