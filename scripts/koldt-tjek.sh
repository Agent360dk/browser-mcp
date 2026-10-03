#!/bin/bash
# koldt-tjek.sh <version> - hent den UDGIVNE pakke med npx i et TOMT miljoe og kraev et gyldigt svar paa MCP initialize.
#
# Findes som eget script (1/10, Astra runde 3) fordi det koerer i jobbet «efter» i udgivelses-workflowet: UDEN udgivelsesrettigheder,
# uden hemmeligheder, uden skrivbart token. npx opsloeser afhaengighederne efter INTERVAL paa udgivelsesdagen; den kode maa ikke koere i
# det job der kan udgive. Selve forsoeget er scripts/koldt-forsoeg.mjs (Astra runde 5): det holder pakken i live efter svaret, draeber hele
# procesgruppen ved frist og validerer svaret strengt. Dette script staar for de seks forsoeg og pauserne.
#
#   bash scripts/koldt-tjek.sh 1.30.1        # KOLDT_PAUSE=30 (sekunder mellem forsoeg; 0 i proever)
# Exit 0 = pakken svarer. Exit 1 = den svarede ikke efter seks forsoeg: se raadet nederst.
set -uo pipefail
V="${1:?brug: koldt-tjek.sh <version>}"
PAUSE="${KOLDT_PAUSE:-30}"
FORSOEG_PROGRAM="$(cd "$(dirname "$0")" && pwd)/koldt-forsoeg.mjs"
SIDSTE=""
for forsoeg in 1 2 3 4 5 6; do
  HJEM="$(mktemp -d)"
  echo "  npx @agent360/browser-mcp@${V} (frisk HOME, tomt miljoe, forsoeg ${forsoeg}/6)"
  if SIDSTE="$(node "$FORSOEG_PROGRAM" "$V" "$HJEM" 2>&1)"; then
    rm -rf "$HJEM" 2>/dev/null || true
    echo "  ✓ den udgivne pakke svarer paa MCP-haandtrykket og lever videre"
    echo "    $SIDSTE"
    exit 0
  fi
  printf '%s\n' "$SIDSTE" | sed 's/^/    /' | tail -6
  rm -rf "$HJEM" 2>/dev/null || true
  # MAALT 13/9 under den AEGTE udgivelse: tre forsoeg a 15 s var for lidt (npm skrev selv «may take a few minutes»).
  [[ $forsoeg -lt 6 ]] && { echo "  registret har maaske ikke indekseret endnu - venter ${PAUSE} s"; sleep "$PAUSE"; }
done
echo "  Seks forsoeg gav ikke et gyldigt MCP-svar fra ${V} (ca. 150 s pause i alt). Det kan ogsaa vaere registret eller nettet, ikke pakken:"
echo "     proev SELV foer du ruller noget tilbage:  npx -y @agent360/browser-mcp@${V}   (og send et initialize)"
echo "  ⛔ Hvis pakken ER brudt, er tilbagerulningen smal:"
echo "     npm unpublish @agent360/browser-mcp@${V}   # kun inden for 72 timer, og kun uden dependents"
echo "     Versionsnummeret er braendt for evigt. Vaelg ÉN vej: a) unpublish (latest falder selv tilbage), eller"
echo "     b) udgiv en rettelse og flyt kun latest tilbage hvis du IKKE udgiver en ny:  npm dist-tag add @agent360/browser-mcp@<forrige> latest"
exit 1
