# Ærligheds-målingen, 13. oktober 2026 - på GitHubs maskine, bundet til 1.30.2 (#67, #68, #70 og #69 delvist)

Kørt som håndkørsel af `spaerre.yml` med `aerlighed=true` (run 38432694415, macos-latest, Chrome for Testing, headless, egen
profil) på grenen `fix/1.30.2-issues-67-70` (PR #72). Den målte commit er grenens hoved, fe6ac5a: rettelserne af #67, #68 og #70
og `browser_handle_dialog`-delen af #69, uden navigate-vagten. Efter målingen er kun denne fil lagt til, så
`extension/background.js`, `extension/offscreen.js`, `mcp-server/tools.js` og `mcp-server/index.js` er byte-identiske i den
målte commit og i den der flettes.

Målingens egne linjer, ordret fra loggen - udgivelsens port 2c læser dem:

MAALT-COMMIT: fe6ac5a99624ffccaaf5a53607e029170d629c38
AERLIGHED-DOM: 0 LOEGN

| Værktøj | Styret felt | Styret select | Filfelt |
|---|---|---|---|
| **Browser MCP (os)** | SAND-JA | SAND-JA | SAND-JA |

Spærren i samme kørsel: 40/40 værktøjer · 52 OK · 0 FEJL · 0 SPRUNGET.

**Kun vores eget produkt er målt.** Sammenligningen med Playwright og Chrome DevTools MCP fra 21/9 står uændret. ⚠️ Målingens grænse:
repoets `extension/` med ÉN linje ændret - standard-portområdet (9876-9895 → 19900-19904), så testbrowseren ikke rammer andre chats.
Alt andet er det der udgives.

Hvorfor en ny måling: den forrige bundne måling (RESULTAT-2026-10-12-gh.md, 1ca383e) gælder ikke koden efter rettelserne af
#67-#70, og port 2c afviser en måling, hvis de fire filer er ændret siden.

Rå udskrift: GitHub Actions run 38432694415.
