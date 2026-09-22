#!/usr/bin/env bash
# Én vagt, to udgivelses-veje.
#
# ⛔ MAALT 21/9 af et modstander-review: SPRUNGET-gaten og `unset FLOW_KUN_BAGGRUND` blev
# skrevet i runbrowsermcpupdate.sh alene. `publish-cws.sh` - som ogsaa er et udgivet
# npm-script og lægger zip'en i Chrome Web Store - taeller kun FEJL. Saa
# `FLOW_KUN_BAGGRUND=1 npm run publish:cws` udgav paa en koersel hvor 17 vaerktoejer aldrig
# blev roert. Praecis den fejl der lige var rettet, ét script til venstre.
#
# Og ingen af dem laeste `UDAEKKET`. Et vaerktoej uden resultat er hverken OK, FEJL eller
# SPRUNGET - saa 35 af 40 roert med 0 fejl meldte «groen paa den kode der udgives».
#
# Huset 8/9: ret moenstret, ikke fundet. Derfor ligger reglen ÉT sted.

# Nulstil arvede flag der kan goere en koersel mindre end den ser ud.
flow_nulstil_arv() {
  unset BMCP_FLOW_OK
  unset FLOW_KUN_BAGGRUND
}

# flow_daekning_ok <fil-med-koerselsudskrift>
# Skriver en begrundelse til stdout og returnerer 1 hvis koerslen ikke daekker alt.
flow_daekning_ok() {
  local ud="$1" linje sprunget beroert total
  linje="$(grep -m1 '^DAEKNING:' "$ud" 2>/dev/null || true)"
  if [[ -z "$linje" ]]; then
    echo "flow-spaerren skrev ingen DAEKNING-linje - koerslen kan ikke bedoemmes"
    return 1
  fi

  sprunget="$(printf '%s' "$linje" | sed -n 's/.*· \([0-9]\{1,\}\) SPRUNGET.*/\1/p')"
  beroert="$(printf '%s' "$linje" | sed -n 's/^DAEKNING: \([0-9]\{1,\}\)\/[0-9]\{1,\}.*/\1/p')"
  total="$(printf '%s' "$linje" | sed -n 's/^DAEKNING: [0-9]\{1,\}\/\([0-9]\{1,\}\).*/\1/p')"

  # ⛔ Kunne tallene ikke laeses, er svaret NEJ - ikke ja. En formatændring i koerslen maa
  # aldrig blive til et groent lys via en tom streng.
  if [[ -z "$sprunget" || -z "$beroert" || -z "$total" ]]; then
    echo "DAEKNING-linjen kunne ikke laeses ($linje) - spaerren tier hellere end at sige groent"
    return 1
  fi
  if [[ "$sprunget" -gt 0 ]]; then
    echo "$sprunget vaerktoejer blev sprunget over. Nul fejl er ikke det samme som daekket."
    return 1
  fi
  if [[ "$beroert" -ne "$total" ]]; then
    echo "kun $beroert af $total vaerktoejer blev roert$(grep -m1 '^UDAEKKET:' "$ud" 2>/dev/null | sed 's/^UDAEKKET:/ - udaekket:/')"
    return 1
  fi
  return 0
}
