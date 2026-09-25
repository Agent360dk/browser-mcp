#!/usr/bin/env python3
"""Spoerg npm om GitHub maa udgive pakken - FOER noget uigenkaldeligt sker.

25/9: udgivelsen tager butikken (trin 3) og GitHub-tagget (trin 4) foer npm (trin 5). Mangler
trusted publisher paa npmjs.com, eller er den sat med et andet repo, en anden workflow-fil eller et
andet miljoe, opdager npm det foerst i trin 5 - og saa ligger 1.30.x allerede i butikkens koe og som
tag paa GitHub, men ikke paa npm. En halv udgivelse.

Tjekket goer praecis det npm selv goer (npm/lib/utils/oidc.js, npm 12.1.0): hent et id-token fra
GitHub med audience npm:<registry-vaert>, og byt det hos registret paa
/-/npm/v1/oidc/token/exchange/package/<escaped navn>. Et token tilbage = npm accepterer udgiveren.
Tokenet bruges ikke og skrives aldrig ud; det udloeber af sig selv.

Kan kun maales i det job der faktisk udgiver: er trusted publisher bundet til miljoeet «udgivelse»,
afviser npm et id-token fra et job uden det miljoe. Proevekoersler springer det derfor over.

Brug: npm-oidc-tjek.py <pakkenavn>   (exit 0 = npm siger ja, 1 = nej/fejl, grunden paa stdout)
Miljoe: ACTIONS_ID_TOKEN_REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN, NPM_REGISTRY (valgfri)
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def main() -> int:
    if len(sys.argv) != 2:
        print("brug: npm-oidc-tjek.py <pakkenavn>")
        return 1
    navn = sys.argv[1]
    registry = os.environ.get("NPM_REGISTRY", "https://registry.npmjs.org").rstrip("/")
    try:
        token_url = os.environ["ACTIONS_ID_TOKEN_REQUEST_URL"]
        token_noegle = os.environ["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
    except KeyError as mangler:
        print(f"intet id-token fra GitHub ({mangler.args[0]} mangler - kraever permissions: id-token: write)")
        return 1

    vaert = urllib.parse.urlsplit(registry).hostname
    adskil = "&" if "?" in token_url else "?"
    try:
        svar = urllib.request.urlopen(urllib.request.Request(
            f"{token_url}{adskil}audience={urllib.parse.quote(f'npm:{vaert}')}",
            headers={"Authorization": f"Bearer {token_noegle}", "Accept": "application/json"},
        ), timeout=20)
        id_token = json.load(svar).get("value")
        if not id_token:
            print("GitHub svarede uden id-token")
            return 1
        # npm-package-arg's escapedName: '/' bliver til %2f, '@' bevares.
        sti = urllib.parse.quote(navn, safe="@").replace("%2F", "%2f")
        svar = urllib.request.urlopen(urllib.request.Request(
            f"{registry}/-/npm/v1/oidc/token/exchange/package/{sti}",
            data=b"", method="POST",
            headers={"Authorization": f"Bearer {id_token}", "Accept": "application/json"},
        ), timeout=20)
        if json.load(svar).get("token"):
            print("ok")
            return 0
        print("npm svarede uden token")
        return 1
    except urllib.error.HTTPError as fejl:
        besked = fejl.read()[:300].decode("utf-8", "replace").strip()
        print(f"HTTP {fejl.code} fra {urllib.parse.urlsplit(fejl.url).hostname}: {besked}")
        return 1
    except Exception as fejl:  # netvaerk, JSON - grunden skal frem, aldrig et token
        print(f"{type(fejl).__name__}: {fejl}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
