# Vindues-hypotesen - FALSIFICERET 19. september 2026

**Spoergsmaalet (planens spor 8.3, og hele praemissen for 1.30):** hvis en session faar sit
EGET Chrome-vindue, er dens fane altid den viste dér. Leverer Chrome saa input til den,
ogsaa naar vinduet ikke har fokus? Er svaret ja, forsvinder hele vores fejlklasse.

**Svaret er nej.**

| Tilstand | Vaerktoejet svarede | Siden hoerte |
|---|---|---|
| A) Baggrundsfane (som i dag) | `ok: false, landed: false, tasten-blev-ikke-leveret` | **0 taster** |
| B) Eget vindue, uden fokus | `ok: false, landed: false, tasten-blev-ikke-leveret` | **0 taster** |

Tilstanden i B blev faktisk lavet - navigate svarede `eget_vindue: true, fokuseret: false`
med et eget `windowId`. Det er ikke en fane i et delt vindue.

## Hvad det betyder

Det er ikke *fanens* synlighed i sit vindue der afgoer det. Det er om **vinduet har
operativsystemets fokus**. Et eget vindue loeser derfor ingenting, og 1.30's praemis
falder. `eget_vindue` bliver staaende som et tilvalg, men det maa ikke saelges som en
loesning paa noget.

Det passer med maalingen samme dag: vores fejlklasse foelger af at vi styrer en browser et
menneske ogsaa bruger. Den eneste tilstand hvor Chrome leverer input, er den hvor
brugeren kigger paa den - og den kan vi ikke tage uden at tage skaermen fra dem.

## Bemaerk hvad der gik RIGTIGT

Vaerktoejet svarede `ok: false, landed: false` i begge tilfaelde. Foer 1.29.2 ville det
have svaret `ok: true`, og hypotesen ville set ud til at HOLDE - fordi maaleren loej.
Vi kunne ikke have koert denne maaling for en uge siden.

## Faelden undervejs, og den var den samme som om morgenen

Foerste koersel gav ogsaa 0/0 - men Chrome koerte den GAMLE udvidelseskode, saa
`eget_vindue` blev ignoreret i stilhed, og B var i virkeligheden endnu en baggrundsfane.
Det saa ud som en falsifikation og var en maaling af ingenting. Fanget paa at
navigate-svaret ikke naevnte `eget_vindue`. **Genindlaes udvidelsen, og bekraeft at
tilstanden blev lavet, foer resultatet taeller.**

Koer selv: `node test/aerlighed/vindue-maaling.mjs` (kraever udvidelsen forbundet).
