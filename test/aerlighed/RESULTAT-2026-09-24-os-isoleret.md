# Ærligheds-målingen, 24. september 2026 - vores eget produkt, i en isoleret browser

Kørt med `AERLIGHED_MED_OS=1 node scripts/flow-isoleret.mjs --koer test/aerlighed/maal.mjs --kun os`.

Det er den måling udgivelses-scriptet kræver før 1.30.1: et resultat der er nyere end koden
der udgives. Den forrige (21/9) var ældre end syv rettelser i broen og parringen.

| Værktøj | Styret felt | Styret select | Filfelt |
|---|---|---|---|
| **Browser MCP (os)** | SAND-JA | SAND-JA | SAND-JA |

**Nul løgne i tre målinger.** Værktøjet sagde ja, og komponenten hørte det faktisk: `dom_viser`
og `komponenten_ved` er begge `gennemtraengt`, med 5 hændelser hvoraf 3 betroede.

## Hvad der er anderledes end 21/9, og hvad det betyder

**Kun vores eget produkt er målt.** Konkurrenterne er ikke genmålt i dag. Sammenligningen fra
21/9 står derfor uændret - denne fil siger ikke noget nyt om Playwright eller Chrome DevTools MCP.

**Målt i en isoleret browser**, ikke i Gustavs Chrome. Den forrige måling tog hans skærm, og
det må den ikke. Chrome for Testing, headless, egen profil, eget portområde.

⚠️ **Målingens grænse, sagt højt:** det der blev målt, er repoets `extension/` med **én linje
ændret** - standard-portområdet, fra 9876-9895 til 19900-19904, så testbrowseren ikke rammer
menneskets egne chats. Alt andet er byte-identisk med det der udgives.

Rå udskrift: `~/.claude/plans/browsermcp-2026-09-07/koersler/aerlighed-isoleret.log`
