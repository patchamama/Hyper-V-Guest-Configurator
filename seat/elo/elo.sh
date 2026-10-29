#!/bin/bash
# ELO test stack on Docker (official ECK images). Run as root in Linux / the WSL distro, from this directory.
#   elo.sh env [--force]   create .env (values from the environment, random passwords otherwise) + license
#   elo.sh pull            pull the images (docker login registry.elo.com first)
#   elo.sh up              start the stack (sets vm.max_map_count for Elasticsearch)
#   elo.sh status          container states and ELO URLs
#   elo.sh stats           memory/CPU per container (JSON lines)
#   elo.sh stop|start|restart <service...>   manage single services (server, search, as, flows, tr2, ...)
#   elo.sh logs <service> [lines]
#   elo.sh down [--volumes] stop the stack (--volumes also deletes the repository data)
#
# Install-time settings (environment, written to .env): ELO_TAG ELO_SEARCH_TAG REPO REPO_LANGUAGE ELO_DISPLAY_NAME
# ELO_LICENSE_TYPE AUTH_ADMIN_USERNAME AUTH_ADMIN_PASSWORD AUTH_SERVICE_USERNAME AUTH_SERVICE_PASSWORD
# DATABASE_USERNAME DATABASE_PASSWORD KEYSTORE_PASSWORD AUTH_TOMCAT_PASSWORD AUTH_KARAF_PASSWORD IX_URL_PUBLIC
# COMPOSE_PROFILES LICENSE_FILE
set -eu
cd "${ELO_DIR:-$(dirname "$0")}"   # ELO_DIR: when run from a copy (e.g. CRLF-stripped in /tmp)
rnd() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16; }

# License: LICENSE_FILE, elo-license.lic, or the ELO private key (*.pk; ELO then fetches the license from
# license.services.elo.cloud / license.elo.com, which must be reachable).
license_file() {
  if [ -n "${LICENSE_FILE:-}" ]; then echo "$LICENSE_FILE"; return; fi
  [ -f elo-license.lic ] && { echo elo-license.lic; return; }
  ls -t ELO_25*.pk 2>/dev/null | head -1
}

make_env() {
  LIC=$(license_file)
  [ -n "$LIC" ] && [ -f "$LIC" ] || { echo "ERROR: no license: put elo-license.lic or the ELO .pk into $(pwd)"; exit 1; }
  if [ ! -f .env ] || [ "${1:-}" = --force ]; then
    local svc=${AUTH_SERVICE_PASSWORD:-$(rnd)} repo=${REPO:-repository}
    command -v htpasswd >/dev/null || apt-get install -y -qq apache2-utils >/dev/null
    # search needs the service password also as bcrypt; "$" doubled for docker compose interpolation.
    local bc; bc=$(htpasswd -nbBC 4 x "$svc" | cut -d: -f2 | sed 's/\$/$$/g')
    cat > .env <<EOF
ELO_TAG=${ELO_TAG:-v25-0.30.1}
ELO_SEARCH_TAG=${ELO_SEARCH_TAG:-v25-0.7}
REPO=$repo
REPO_LANGUAGE=${REPO_LANGUAGE:-en}
ELO_DISPLAY_NAME=${ELO_DISPLAY_NAME:-$repo}
ELO_LICENSE_TYPE=${ELO_LICENSE_TYPE:-0}
COMPOSE_PROFILES=${COMPOSE_PROFILES:-as,flows}
AUTH_ADMIN_USERNAME=${AUTH_ADMIN_USERNAME:-Administrator}
AUTH_ADMIN_PASSWORD=${AUTH_ADMIN_PASSWORD:-$(rnd)}
AUTH_SERVICE_USERNAME=${AUTH_SERVICE_USERNAME:-ELO Service}
AUTH_SERVICE_PASSWORD=$svc
AUTH_SERVICE_PASSWORD_BCRYPT=$bc
DATABASE_USERNAME=${DATABASE_USERNAME:-elodb}
DATABASE_PASSWORD=${DATABASE_PASSWORD:-$(rnd)}
KEYSTORE_PASSWORD=${KEYSTORE_PASSWORD:-$(rnd)}
AUTH_TOMCAT_PASSWORD=${AUTH_TOMCAT_PASSWORD:-$(rnd)}
AUTH_KARAF_PASSWORD=${AUTH_KARAF_PASSWORD:-$(rnd)}
IX_URL_PUBLIC=${IX_URL_PUBLIC:-http://localhost:9090/$repo/ix}
EOF
    chmod 600 .env
    echo ".env written"
  fi
  # The license goes in verbatim (multi-line); docker compose reads it from the environment.
  export ELO_LIC; ELO_LIC=$(tr -d '\r' < "$LIC")
  echo "license: $LIC"
}

cmd=${1:-}; shift || true
case "$cmd" in
  env)     make_env "${1:-}" ;;
  pull)    make_env; docker compose pull ;;
  up)      make_env; sysctl -w vm.max_map_count=262144 >/dev/null; docker compose up -d ;;
  status)  . ./.env; docker compose ps -a --format 'table {{.Name}}\t{{.State}}\t{{.Status}}'
           echo "Web Client:    http://localhost:9090/$REPO/plugin/de.elo.ix.plugin.proxy/web/"
           echo "Admin Console: http://localhost:9090/$REPO/plugin/de.elo.ix.plugin.proxy/ac/" ;;
  stats)   docker stats --no-stream --format '{{json .}}' $(docker compose ps -q) ;;
  stop|start|restart) make_env >/dev/null; docker compose "$cmd" "$@" ;;
  logs)    docker compose logs --no-color --tail "${2:-200}" "$1" ;;
  down)    if [ "${1:-}" = --volumes ]; then docker compose down -v; else docker compose down; fi ;;
  *) echo "usage: elo.sh env|pull|up|status|stats|stop|start|restart|logs|down"; exit 2 ;;
esac
