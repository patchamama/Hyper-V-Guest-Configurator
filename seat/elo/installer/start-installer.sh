#!/bin/bash
# ELO Docker installer on Linux (Ubuntu/Debian): needs Node.js 18+ and root (Docker, sysctl).
# Playwright (for the EULA/Web Client tests) is optional: npm i playwright && npx playwright install --with-deps chromium
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 18+ first (e.g. apt install nodejs npm)"; exit 1; }
[ -d node_modules/express ] || npm install --no-fund --no-audit express
[ "$(id -u)" = 0 ] || exec sudo -E "$0" "$@"
echo "ELO installer: http://localhost:${ELO_INSTALLER_PORT:-3200}"
exec node server.js
