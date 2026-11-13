#!/usr/bin/env bash
# vagt-besked.sh - en roed planlagt koersel skal naa et menneske, og en groen skal lukke sagen igen.
#
# Findes fordi (maalt 13/11-2026): `tal` var roed 32 af 32 dage, `svartid` 9 dage i traek med to
# bidragydere over fristen, og ingen af dem naaede nogen. Et roedt kryds paa Actions-fanen er ikke en
# besked - det er en fil ingen aabner.
#
#   bash scripts/vagt-besked.sh <vagt> <ok|roed> [fil med fund, en pr. linje]
#
# Én aaben issue pr. vagt, titel «vagt roed: <vagt>», tildelt VAGT_EJER (standard GLouv). Tildelingen
# er det der sender mailen.
#   roed, ingen aaben issue         -> opret den
#   roed, ANDRE fund end sidst      -> skriv de nye fund ind og kommentér (ny mail)
#   roed, SAMME fund som sidst      -> intet. Sidst sete fund staar fastholdt i issuen (aftrykket) og
#                                      sammenlignes, saa en kendt tilstand ikke bliver daglig stoej,
#                                      der laerer os at overse den.
#   ok, aaben issue                 -> luk den med et link til den groenne koersel
# Fejler selve beskeden (fx manglende `issues: write`), fejler trinnet - saa er koerslen stadig roed.
set -euo pipefail

vagt=$1
status=$2
fil=${3:-}
repo=$GITHUB_REPOSITORY
ejer=${VAGT_EJER:-GLouv}
titel="vagt roed: $vagt"
koersel="$GITHUB_SERVER_URL/$repo/actions/runs/$GITHUB_RUN_ID"

# Review #107 R4: kun issues, som Actions-botten selv har oprettet - en fremmeds issue med samme titel overtages aldrig.
nr=$(gh issue list --repo "$repo" --state open --limit 200 --author "app/github-actions" --json number,title \
       --jq "[.[] | select(.title == \"$titel\")][0].number // empty")

if [ "$status" = ok ]; then
  if [ -n "$nr" ]; then
    gh issue close "$nr" --repo "$repo" --comment "Groen igen: $koersel"
  fi
  exit 0
fi

fund=""
if [ -n "$fil" ] && [ -s "$fil" ]; then fund=$(sort -u "$fil"); fi
[ -n "$fund" ] || fund="(ingen fund-linjer - aabn koerslen)"
aftryk=$(printf '%s' "$fund" | git hash-object --stdin | cut -c1-16)
krop=$(printf 'Koersel: %s\n\nSidst sete fund. Der skrives kun igen, naar de aendrer sig; issuen lukker sig selv, naar vagten er groen.\n\n```\n%s\n```\n\n<!-- aftryk:%s -->\n' \
         "$koersel" "$fund" "$aftryk")

if [ -z "$nr" ]; then
  gh issue create --repo "$repo" --title "$titel" --assignee "$ejer" --body "$krop"
elif gh issue view "$nr" --repo "$repo" --json body --jq .body | grep -qF "<!-- aftryk:$aftryk -->"; then
  echo "samme fund som sidst (aftryk $aftryk, issue #$nr) - ingen ny besked"
else
  # Review #107 R1: kommentér FØR redigering - fejler kommentaren efter en redigering, er det nye aftryk gemt og beskeden tabt for altid.
  gh issue comment "$nr" --repo "$repo" --body "Fundene har aendret sig: $koersel"
  gh issue edit "$nr" --repo "$repo" --body "$krop"
fi
