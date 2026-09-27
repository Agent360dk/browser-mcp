# Ærligheds-målingen, 27. september 2026 - 1.30.1-kandidaten, i en isoleret browser

Kørt med `AERLIGHED_MED_OS=1 node scripts/flow-isoleret.mjs --koer test/aerlighed/maal.mjs --kun os`
på main `c6c05d0` (versionen 1.30.1 er skrevet; intet er udgivet).

Det er den måling udgivelses-scriptet kræver før 1.30.1: et resultat der er nyere end koden der
udgives. Den forrige (24/9) var ældre end 1.30.1-rettelserne i broen (#30).

| Værktøj | Styret felt | Styret select | Filfelt |
|---|---|---|---|
| **Browser MCP (os)** | SAND-JA | SAND-JA | SAND-JA |

**Nul løgne i tre målinger.** Værktøjet sagde ja, og komponenten hørte det faktisk: `dom_viser` og
`komponenten_ved` er begge `gennemtraengt`, med 5 hændelser hvoraf 3 betroede.

**Instrumentet kalibreret samme morgen:** den isolerede spærre på samme maskine og samme kode gav
40/40 værktøjer · 52 OK · 0 FEJL lige før målingen. (26-27/9 fejlede den lokale spærre på alt, også
den kendt-gode kontrol; målingen er først taget efter at kontrollen var grøn igen.)

**Kun vores eget produkt er målt.** Konkurrenterne er ikke genmålt; sammenligningen fra 21/9 står
uændret, og denne fil siger intet nyt om Playwright eller Chrome DevTools MCP.

⚠️ **Målingens grænse, sagt højt:** det målte er repoets `extension/` med **én linje ændret** -
standard-portområdet, fra 9876-9895 til 19900-19904, så testbrowseren ikke rammer menneskets egne
chats. Alt andet er byte-identisk med det der udgives. Chrome for Testing 153.0.8010.52, headless,
egen profil.

Rå udskrift: `~/.claude/plans/browsermcp-review-2026-09-26/aerlighed-1.30.1-c6c05d0.log`
