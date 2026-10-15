# Ærligheds-målingen, 15. oktober 2026 - på GitHubs maskine, bundet til 1.30.3 (#69: navigate ved «Leave site?»)

Kørt som håndkørsel af `spaerre.yml` med `aerlighed=true` (run 38676212474, macos-latest, Chrome for Testing, headless, egen
profil) på grenen `fix/1.30.3-dialog` (PR #73). Den målte commit er grenens hoved, 5b035c1: dialog-koordinatoren, navigate der svarer
«Leave site?» uden at melde den gamle adresse som succes, og sessionsvagten. Efter målingen er kun denne fil lagt til, så
`extension/background.js`, `extension/offscreen.js`, `mcp-server/tools.js` og `mcp-server/index.js` er byte-identiske i den målte
commit og i den der flettes.

Målingens egne linjer, ordret fra loggen - udgivelsens port 2c læser dem:

MAALT-COMMIT: 5b035c18a895ad880547b1420820778855a20295
AERLIGHED-DOM: 0 LOEGN

| Værktøj | Styret felt | Styret select | Filfelt |
|---|---|---|---|
| **Browser MCP (os)** | SAND-JA | SAND-JA | SAND-JA |

Spærren i samme kørsel: 40/40 værktøjer · 52 OK · 0 FEJL · 0 SPRUNGET.

**Kun vores eget produkt er målt.** Sammenligningen med Playwright og Chrome DevTools MCP fra 21/9 står uændret. ⚠️ Målingens grænse:
repoets `extension/` med ÉN linje ændret - standard-portområdet (9876-9895 → 19900-19904), så testbrowseren ikke rammer andre chats.
Alt andet er det der udgives.

Rå udskrift: GitHub Actions run 38676212474.
