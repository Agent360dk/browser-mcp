# Målings-harness

Tre scripts der starter en ægte MCP-serverproces, taler JSON-RPC til den over stdio og tager tid
på svarene mod en rigtig Chrome. De er ikke tests — de måler, og de skriver tal ind i
`docs/PERFORMANCE-2026-09-08.md`.

- `latens.mjs` — rundtur pr. værktøj, N runder, medianer. `RUNDER=5 SIDE=https://… node maaling/latens.mjs`
- `cdp-test.mjs` — skiller "værktøjet er i stykker" fra "debugger-tilkoblingen er i stykker"
- `scroll-hypotese.mjs` — kort side mod lang side (den hypotese faldt: scroll hænger begge steder)
- `hvad.mjs` — printer hvad de enkelte værktøjer faktisk svarer, uden tidtagning

De tager en port i det rigtige spænd mens de kører, så lad være at køre dem parallelt med noget
der har travlt med browseren.
