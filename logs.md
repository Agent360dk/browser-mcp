
### 2026-09-19 / 2026-09-20 — browser-mcp: 1.30.0 udgivet, sproget lagt om, kanalerne målt

**11:40** — 1.30.0 ude i npm, MCP-registret og GitHub. Chrome Web Store i review (1-3 dage).
53 commits, alt pushet, 692 prøver grønne, flow-spærren 52 OK / 0 FEJL / 40 af 40.

**Det der blev lavet:**
- **Sproget:** ~140 danske strenge, 16 fejlkoder og 13 feltnavne til engelsk. Nul forlader nu
  processen. Gammel→ny-tabel i CHANGELOG.
- **Profil-parring (#10):** valgfri `BROWSER_MCP_TOKEN`, gensidig. Uden nøgle: intet ændret.
- **Syv nye sider** (40 i alt): Windsurf, Trae, opencode, alternatives, vs browser-use,
  control-your-real-chrome, + kommando+svar på alle 40.
- **Ti vagter**, hver født af en fejl der faktisk skete.
- **Tre paneler** (SEO, Astra, Fable) + to rent-rums-målinger af LLM-kanalen.

**Mine egne fejl, navngivet — seks:**
1. «0 danske strenge» committet som sandt. Var falsk; mit instrument var en ORDLISTE. En
   mekanisk vagt fandt 22 mere. Samme fejlklasse som huset skrev ned 7/9.
2. Committede en falsk årsag til at broen ikke starter i en frisk profil — jeg havde målt på
   **Chromes egen betalings-udvidelse**, ikke vores. Rettet i samme fil og i historikken.
3. Tilføjede ét-klik-links til READMEerne uden at tjekke at de allerede fandtes. De gjorde, med
   en anden konfiguration (`-y` manglede).
4. Skrev offentligt at butikken serverede 1.29.1. Den var på 1.29.2. Rettet med synlig note.
5. Fokus-optimeringen af flow-spærren listede PRØVE-navne og brækkede `browser_handle_dialog`.
   Igen: et navn kan ikke bære en regel.
6. Min egen diagnostik printede en del af npm-tokenet i konteksten — præcis det jeg satte mig
   for at undgå.

**Det dyreste fund:** LLM-kanalen er lukket for os. To modeller spurgt i rent rum svarer
«kender jeg ikke fra min træning» om `@agent360/browser-mcp`, og anbefaler det døde
browsermcp.io. Med søgning: ni resultater, vi i nul. Og søgningen fandt **Vibe** — en
konkurrent tre paneler missede, fem gange mindre end os, som står foran os fordi de skrev
blogindlægget med vores eget pitch.

**Indlejring målt: 130×.** 1.849 fremmede repoer konfigurerer dem, 14 konfigurerer os.
