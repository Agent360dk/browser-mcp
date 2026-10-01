# Ærligheds-målingen, 1. oktober 2026 - på GitHubs maskine, bundet til den rettede kode

Kørt som håndkørsel af `spaerre.yml` med `aerlighed=true` (run 36850556396, macos-latest, Chrome for
Testing, headless, egen profil) på grenen `kandidat/samlet-1.30.1`. Den målte commit er den samlede kandidat:
main (d05e612) + stram ærlighedsgate (#42) + scanner-rettelsen (#46: ingen dobbelt sokkel, kun ejeren slipper låsen) + udgivelsesvejens
hemmeligheder (#47). `extension/background.js`, `extension/offscreen.js`, `mcp-server/tools.js` og `mcp-server/index.js` er
byte-identiske i den målte commit og i commit'en der udgives (kun denne fil er lagt til efter målingen).

Målingens egne linjer, ordret fra loggen - udgivelsens port 2c læser dem:

MAALT-COMMIT: e534693981e3a0bcaa2d5d5a8c2e9bccb61a653b
AERLIGHED-DOM: 0 LOEGN

| Værktøj | Styret felt | Styret select | Filfelt |
|---|---|---|---|
| **Browser MCP (os)** | SAND-JA | SAND-JA | SAND-JA |

Spærren i samme kørsel: 40/40 værktøjer · 52 OK · 0 FEJL · 0 SPRUNGET.

**Kun vores eget produkt er målt.** Sammenligningen med Playwright og Chrome DevTools MCP fra 21/9 står uændret. ⚠️ Målingens grænse:
repoets `extension/` med ÉN linje ændret - standard-portområdet (9876-9895 → 19900-19904), så testbrowseren ikke rammer andre chats.
Alt andet er det der udgives. ⚠️ Målingen dækker IKKE scanner-kapløbet i levende Chrome (frekvens umålt); det er dækket af
`test/dobbelt-sokkel.test.mjs` mod den ægte `offscreen.js` med syntetiske netværkssvar.

Rå udskrift: GitHub Actions run 36850556396.
