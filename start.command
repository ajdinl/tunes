#!/bin/zsh
# Dvoklik na ovaj fajl pokreće Tunes i otvara je u browseru.
# Sa opcijom --telefon server je dostupan i drugim uređajima u kućnoj mreži.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Potreban je Node.js 22 ili noviji: https://nodejs.org  (ili: brew install node)"
  read -k1 "?Pritisni bilo koji taster…"; exit 1
fi
[ -d node_modules ] || npm install --omit=dev

PORT=${PORT:-4545}
if [[ "$1" == "--telefon" ]]; then export HOST=0.0.0.0; fi

if curl -s -o /dev/null "http://localhost:$PORT/api/state"; then
  echo "Tunes već radi."
  open "http://localhost:$PORT"
  exit 0
fi

(sleep 1.2 && open "http://localhost:$PORT") &
exec node server.js
