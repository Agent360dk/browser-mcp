/**
 * Et frit portspaend til en proeve der starter den AEGTE server.
 *
 * ⛔ MAALT 21/9 af to uafhaengige gennemgange: tre proevefiler bandt faste spaend, og det
 * kostede paa to maader.
 *
 *  1. `parring.test.mjs` bandt 9876/9877 - Gustavs EGET spaend. Hver `npm test` tog pladser
 *     i den pulje hans 5-12 chats deler, og hans koerende Chrome-udvidelse forbandt til
 *     proevens server og blev afvist igen og igen.
 *  2. `upload-graenser` (19965-19969) og `skaermbillede-sti` (19990-19994) bandt FASTE
 *     spaend. To samtidige suiter - to chats - ramte derfor hinanden: den ene koersels
 *     falske udvidelse besvarede den andens server, og resultaterne blev blandet. En proeve
 *     kunne blive roed ELLER falsk groen af en fremmed koersel.
 *
 * Et tilfaeldigt, verificeret ledigt spaend pr. koersel fjerner begge. Spaendet starter over
 * 19100, saa det aldrig overlapper 9876-9895.
 */
import { createServer } from 'node:net';

function ledigPort(port) {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.once('listening', () => s.close(() => ok(true)));
    s.listen(port, '127.0.0.1');
  });
}

/** Giver et basis-portnummer hvor base..base+bredde-1 alle er ledige. */
export async function ledigtSpaend(bredde = 5, forsoeg = 40) {
  for (let i = 0; i < forsoeg; i++) {
    const base = 19100 + Math.floor(Math.random() * 800) * 8;
    const porte = Array.from({ length: bredde }, (_, n) => base + n);
    if ((await Promise.all(porte.map(ledigPort))).every(Boolean)) return base;
  }
  throw new Error(`fandt intet frit portspaend paa ${forsoeg} forsoeg`);
}
