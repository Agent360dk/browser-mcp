# Ærligheds-målingen, 12. oktober 2026 - på GitHubs maskine, bundet til 1.30.2

Kørt som håndkørsel af `spaerre.yml` med `aerlighed=true` (run 38246709646, macos-latest, Chrome for Testing, headless, egen
profil) på grenen `butik/sande-saetninger-1.30.2`. Den målte commit er main efter 1.30.2 (#60), de daglige tal (#64) og
versionsløftet (#65), plus rettelsen af butiksteksten (#66). `extension/background.js`, `extension/offscreen.js`,
`mcp-server/tools.js` og `mcp-server/index.js` er byte-identiske i den målte commit og i main (ac0e3e0); efter målingen er kun
denne fil lagt til.

Målingens egne linjer, ordret fra loggen - udgivelsens port 2c læser dem:

MAALT-COMMIT: 1ca383ee4054fbed99ec98c42829e2ffa1ae3ca2
AERLIGHED-DOM: 0 LOEGN

| Værktøj | Styret felt | Styret select | Filfelt |
|---|---|---|---|
| **Browser MCP (os)** | SAND-JA | SAND-JA | SAND-JA |

Spærren i samme kørsel: 40/40 værktøjer · 52 OK · 0 FEJL · 0 SPRUNGET.

**Kun vores eget produkt er målt.** Sammenligningen med Playwright og Chrome DevTools MCP fra 21/9 står uændret. ⚠️ Målingens grænse:
repoets `extension/` med ÉN linje ændret - standard-portområdet (9876-9895 → 19900-19904), så testbrowseren ikke rammer andre chats.
Alt andet er det der udgives.

Hvorfor en ny måling: port 2c valgte efter 9/10 `RESULTAT-vindueshypotesen-2026-09-19.md` (senest rørt i git af aaeb779), som ingen
bindingslinjer har, og den seneste bundne måling (e534693, 1/10) gælder ikke 1.30.2's kode. Fundet af Opus i R87 (12/10).

Rå udskrift: GitHub Actions run 38246709646.
