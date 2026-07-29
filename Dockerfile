# browser-mcp — MCP-server til registry-introspektion (Glama m.fl.)
#
# HVORFOR DEN HER FIL FINDES:
# browser-mcp er en bro mellem en MCP-klient (stdio) og en Chrome-extension (WebSocket).
# Det lyder som noget der ikke kan køre i en container — og tool-KALD kan det heller ikke:
# uden en browser i den anden ende fejler de. Men registries som Glama kræver kun at serveren
# STARTER og svarer på introspektion (tools/list), og den vej rører aldrig Chrome.
#
# Målt 2026-07-28: en initialize + tools/list mod `node index.js` uden nogen browser
# returnerede alle 41 værktøjer. Derfor er det her nok til at bestå tjekket og få en score.
#
# Hvad billedet IKKE er: en måde at bruge browser-mcp på. Til rigtig brug skal serveren køre
# på samme maskine som Chrome, så extensionen kan nå WebSocket-porten (9876-9885).
# Se README for den rigtige installation.

FROM node:20-alpine

WORKDIR /app

# Afhængigheder først — separat lag, så de kun geninstalleres når manifestet ændrer sig.
# `npm ci` (ikke `install`) fordi lockfilen er sandheden: samme input skal give samme billede,
# ellers tjekker registryet noget andet end det vi har testet.
COPY mcp-server/package.json mcp-server/package-lock.json ./
RUN npm ci --omit=dev

COPY mcp-server/ ./

# stdio-transport: ingen port at eksponere. Klienten taler til processens stdin/stdout.
CMD ["node", "index.js"]
