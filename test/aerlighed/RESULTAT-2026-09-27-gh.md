# Ærligheds-målingen, 27. september 2026 - på GitHubs maskine, bundet til koden

Kørt som håndkørsel af `spaerre.yml` med `aerlighed=true` (run 36306386919, macos-latest, Chrome for
Testing, headless, egen profil) på grenen `bevis/aerlighed-bundet`. Udvidelsen, `tools.js` og serveren
i den målte commit er byte-identiske med 1.30.1-kandidaten på main (`415438b`).

Maalingens egne linjer, ordret fra loggen - udgivelsens port 2c læser dem:

MAALT-COMMIT: 3f8ef28936d893698a40c1134d9d039b62363789
AERLIGHED-DOM: 0 LOEGN

| Værktøj | Styret felt | Styret select | Filfelt |
|---|---|---|---|
| **Browser MCP (os)** | SAND-JA | SAND-JA | SAND-JA |

Spærren i samme kørsel: 40/40 værktøjer · 52 OK · 0 FEJL · 0 SPRUNGET.

**Kun vores eget produkt er målt.** Sammenligningen med Playwright og Chrome DevTools MCP fra 21/9 står
uændret. ⚠️ Målingens grænse: repoets `extension/` med ÉN linje ændret - standard-portområdet
(9876-9895 → 19900-19904), så testbrowseren ikke rammer andre chats. Alt andet er det der udgives.

Rå udskrift: `~/.claude/plans/browsermcp-review-2026-09-26/AERLIGHED-GH-36306386919.log`
