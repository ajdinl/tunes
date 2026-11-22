#!/bin/zsh
# Double-click this file to start Tunes and open it in your browser.
# With --phone the server is also reachable from other devices on your home network.
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  echo "Tunes needs Node.js 22.18 or newer: https://nodejs.org  (or: brew install node)"
  read -k1 "?Press any key…"; exit 1
fi
[ -d node_modules ] || npm install --omit=dev

PORT=${PORT:-4545}
if [[ "$1" == "--phone" || "$1" == "--telefon" ]]; then export HOST=0.0.0.0; fi

if curl -s -o /dev/null "http://localhost:$PORT/api/state"; then
  echo "Tunes is already running."
  open "http://localhost:$PORT"
  exit 0
fi

(sleep 1.2 && open "http://localhost:$PORT") &
exec node server.ts
