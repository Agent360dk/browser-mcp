# Aerligheds-maalingen, 21. september 2026 - alle tre

Koert med `AERLIGHED_MED_OS=1 node test/aerlighed/maal.mjs` mod aegte Chrome. Konkurrenternes
pakker hentes med npx i samme koersel, saa alle tre moeder den SAMME fixtur.

| Vaerktoej | Styret felt | Styret select | Filfelt |
|---|---|---|---|
| **Browser MCP (os)** | SAND-JA | **SAND-JA** | SAND-JA |
| **Playwright MCP (Microsoft)** | SAND-JA | SAND-JA | SAND-JA |
| **Chrome DevTools MCP (Google)** | SAND-NEJ | SAND-NEJ | SAND-NEJ |

**Nul loegne i ni maalinger.** Alle tre svarede sandt om hvad der skete.

## Det der aendrede sig siden 19/9

Den 19. september stod vi **SAND-NEJ** paa det styrede select - det eneste sted vi tabte, og
det vi selv publicerede som vores tab. **Nu er vi lige med Playwright paa alle tre.**

⛔ **Lige med. Ikke bedre.** Playwright landede ogsaa alle tre, baade dengang og nu. Det eneste
der er sket er at vores egen mangel er vaek. At skrive andet ville vaere praecis den slags
overdrivelse siden handler om.

Aarsagen var én linje: `sel.value = opt.value`. En styret komponent laegger en value-saetter paa
**instansen** der ruller en naiv tilskrivning tilbage. Prototypens saetter gaar uden om. Fem
andre steder i `background.js` gjorde det allerede saadan; `select_option` var det eneste sted
uden grebet.

## Chrome DevTools MCP svarer nej paa alt tre - og det er ikke en loegn

Deres fill og select naaede timeout («the element did not become interactive»), og filfeltet
blev afvist af deres indeslutnings-vagt: *«Access denied: path …»*. **Vi har praecis samme
vagt** - vores foerste koersel 19/9 blev afvist paa samme maade, fordi proevefilen laa i
`/tmp`. Playwright uploadede fra samme sti uden at sige noget. To af tre begraenser hvor en fil
maa komme fra; det er en aegte forskel, og den er ikke vores alene.

## Hvad maalingen IKKE siger

Den maaler **aerlighed paa tre sager**, ikke hvem der er bedst. Playwright og Chrome DevTools
koerer deres **egen** browser som ingen anden bruger - de har ikke en fane der kan komme i
baggrunden midt i en opgave, og de kan derfor heller ikke roere en Chrome et menneske allerede
er logget ind i. Vores fejlklasse foelger af vores arkitektur; deres begraensning goer ogsaa.
