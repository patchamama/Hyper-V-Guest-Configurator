#!/bin/bash
# ELO 25 test stack on Docker (official ECK images). Run as root in the WSL distro, from this directory.
#   elo.sh env       create .env with random internal passwords (once) and the license from elo-license.lic
#   elo.sh pull      pull the images (docker login registry.elo.com first)
#   elo.sh up        start the stack (sets vm.max_map_count for Elasticsearch)
#   elo.sh status    container states and ELO URLs
#   elo.sh down      stop the stack (volumes are kept)
set -eu
cd "$(dirname "$0")"
ELO_TAG=${ELO_TAG:-v25-0.30.1}; ELO_SEARCH_TAG=${ELO_SEARCH_TAG:-v25-0.7}; REPO=${REPO:-repository}
rnd() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16; }

make_env() {
  [ -f elo-license.lic ] || { echo "ERROR: put the ELO 25 license into $(pwd)/elo-license.lic"; exit 1; }
  if [ ! -f .env ]; then
    local svc; svc=$(rnd)
    command -v htpasswd >/dev/null || apt-get install -y -qq apache2-utils >/dev/null
    # search needs the service password also as bcrypt; "$" doubled for docker compose interpolation.
    local bc; bc=$(htpasswd -nbBC 4 x "$svc" | cut -d: -f2 | sed 's/\$/$$/g')
    cat > .env <<EOF
ELO_TAG=$ELO_TAG
ELO_SEARCH_TAG=$ELO_SEARCH_TAG
REPO=$REPO
DATABASE_PASSWORD=$(rnd)
KEYSTORE_PASSWORD=$(rnd)
AUTH_TOMCAT_PASSWORD=$(rnd)
AUTH_SERVICE_PASSWORD=$svc
AUTH_SERVICE_PASSWORD_BCRYPT=$bc
AUTH_ADMIN_PASSWORD=$(rnd)
AUTH_KARAF_PASSWORD=$(rnd)
EOF
    chmod 600 .env
    echo ".env created (ELO Administrator password: AUTH_ADMIN_PASSWORD in .env)"
  fi
  # The license goes in verbatim (multi-line); docker compose reads it from the environment.
  export ELO_LIC; ELO_LIC=$(tr -d '\r' < elo-license.lic)
}

case "${1:-}" in
  env)    make_env ;;
  pull)   make_env; docker compose pull ;;
  up)     make_env; sysctl -w vm.max_map_count=262144 >/dev/null; docker compose up -d ;;
  status) docker compose ps --format 'table {{.Name}}\t{{.State}}\t{{.Status}}'
          echo "Web Client:   http://localhost:9090/$REPO/plugin/de.elo.ix.plugin.proxy/web/"
          echo "Admin Console: http://localhost:9090/$REPO/plugin/de.elo.ix.plugin.proxy/ac/" ;;
  down)   docker compose down ;;
  *) echo "usage: elo.sh env|pull|up|status|down"; exit 2 ;;
esac
