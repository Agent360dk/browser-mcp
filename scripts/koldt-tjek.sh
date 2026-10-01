#!/bin/bash
# koldt-tjek.sh <version> - hent den UDGIVNE pakke med npx i et TOMT miljoe og kraev et gyldigt svar paa MCP initialize.
#
# Findes som eget script (1/10, Astra runde 3) fordi det koerer i jobbet «efter» i udgivelses-workflowet: UDEN udgivelsesrettigheder,
# uden hemmeligheder, uden skrivbart token. npx opsloeser afhaengighederne efter INTERVAL paa udgivelsesdagen; den kode maa ikke koere i
# det job der kan udgive. Samme logik som trin 5c i runbrowsermcpupdate.sh (som stadig bruges ved en udgivelse fra en anden maskine).
#
#   bash scripts/koldt-tjek.sh 1.30.1        # KOLDT_PAUSE=30 (sekunder mellem forsoeg; 0 i proever)
# Exit 0 = pakken svarer. Exit 1 = den svarede ikke efter seks forsoeg: se raadet om tilbagerulning nederst.
set -uo pipefail
V="${1:?brug: koldt-tjek.sh <version>}"
PAUSE="${KOLDT_PAUSE:-30}"
# MAALT 13/9 (Fable): kaldet havde ingen tidsgraense. npx henter fra registret, og et haengende download ville staa her for evigt.
# MAALT 19/9: en TOM bash-array udvidet som "${ARR[@]}" fejler under `set -u` paa macOS' bash 3.2 - brug ${ARR[@]+"${ARR[@]}"}.
if command -v timeout >/dev/null 2>&1; then TIMEOUT_CMD=(timeout 90)
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT_CMD=(gtimeout 90)
else TIMEOUT_CMD=(); echo "  ! ingen timeout(1) paa maskinen - det kolde tjek kan haenge"; fi
for forsoeg in 1 2 3 4 5 6; do
  HJEM="$(mktemp -d)"
  echo "  npx @agent360/browser-mcp@${V} (frisk HOME, tomt miljoe, forsoeg ${forsoeg}/6)"
  SVAR="$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"koldt-tjek","version":"1"}}}' \
    | env -i HOME="$HJEM" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" LANG="${LANG:-C}" npm_config_ignore_scripts=true ${TIMEOUT_CMD[@]+"${TIMEOUT_CMD[@]}"} npx -y "@agent360/browser-mcp@${V}" 2>"$HJEM/fejl.log" | head -1 || true)"
  if [[ "$SVAR" == *'"serverInfo"'* && "$SVAR" == *'agent360-browser'* ]]; then
    rm -rf "$HJEM" 2>/dev/null || true
    echo "  ✓ den udgivne pakke svarer paa MCP-haandtrykket"
    exit 0
  fi
  [[ -s "$HJEM/fejl.log" ]] && tail -5 "$HJEM/fejl.log" | sed 's/^/    /'
  rm -rf "$HJEM" 2>/dev/null || true
  # MAALT 13/9 under den AEGTE udgivelse: tre forsoeg a 15 s var for lidt (npm skrev selv «may take a few minutes»).
  [[ $forsoeg -lt 6 ]] && { echo "  registret har maaske ikke indekseret endnu - venter ${PAUSE} s"; sleep "$PAUSE"; }
done
echo "  sidste svar: ${SVAR:0:200}"
echo "  ⛔ TILBAGERULNING - og den er smal:"
echo "     npm unpublish @agent360/browser-mcp@${V}   # kun inden for 72 timer, og kun uden dependents"
echo "     Versionsnummeret er braendt for evigt. Vaelg ÉN vej: a) unpublish (latest falder selv tilbage), eller"
echo "     b) udgiv en rettelse og flyt kun latest tilbage hvis du IKKE udgiver en ny:  npm dist-tag add @agent360/browser-mcp@<forrige> latest"
exit 1
