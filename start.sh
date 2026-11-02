#!/usr/bin/env bash
# Hyper-V Guest Configurator - web UI (Node.js) on http://localhost:3000
# Hyper-V management itself only works on Windows: use start.bat there (it asks for administrator rights).
# On Linux / macOS this starts the same web server for the sections that do not need Hyper-V.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 18+ first (https://nodejs.org)."; exit 1; }
[ -d node_modules/express ] || npm install --no-fund --no-audit
URL=http://localhost:3000
( sleep 2; command -v xdg-open >/dev/null && xdg-open "$URL" >/dev/null 2>&1 || command -v open >/dev/null && open "$URL" >/dev/null 2>&1 || true ) &
echo "Hyper-V Guest Configurator: $URL"
exec node web/server.js
