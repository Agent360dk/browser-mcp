/**
 * Skaerer ÉN `case '<navn>'`-blok ud af en kilde ved dens EGNE graenser.
 *
 * Findes fordi et fast antal tegn har bidt mindst fire gange (9/9 tre gange paa én dag,
 * 19/9, 21/9), og fordi rettelsen fra 8/9 aldrig virkede: den ledte efter `case '` med
 * SEKS mellemrums indrykning, og der er nul af dem i background.js - 38 har fire. Soegningen
 * returnerede -1 hver eneste gang, og koden faldt tavst tilbage til laengde-loftet.
 *
 * To veje at fejle, og de er ikke lige farlige:
 *   for KORT -> assertionen fejler -> ROED. Irriterende, men selv-annoncerende.
 *   for LANG -> nabo-blokkens tekst kommer med -> assertionen kan blive GROEN paa kode der
 *               staar et helt andet sted. Tavs. MAALT 21/9: fem kaldesteder gjorde netop det.
 *
 * ⛔ Kaster hellere end at afkorte. En halv blok der ser hel ud, er praecis problemet.
 */
export function caseBlok(kilde, navn) {
  const start = kilde.indexOf(`case '${navn}'`);
  if (start < 0) throw new Error(`caseBlok('${navn}'): fandt ikke case'et i kilden`);

  // Naeste case paa samme indrykning er den praecise graense.
  const naeste = kilde.indexOf("\n    case '", start + 10);
  if (naeste > start) return kilde.slice(start, naeste);

  // Sidste case i switch'en: graensen er switch'ens egen afslutning.
  const slut = kilde.slice(start).search(/\n {4}\}/);
  if (slut < 0) {
    throw new Error(
      `caseBlok('${navn}'): hverken et naeste case eller switch'ens afslutning kunne findes. ` +
      'Et fast antal tegn her ville afkorte blokken TAVST.');
  }
  return kilde.slice(start, start + slut);
}
