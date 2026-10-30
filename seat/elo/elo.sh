#!/bin/bash
# ELO test stack on Docker (official ECK images). Run as root in Linux / the WSL distro, from this directory.
#   elo.sh env [--force]   create .env (values from the environment, random passwords otherwise) + license
#   elo.sh pull            get the images: local Docker → local cache backup/*.tar → registry (login needed only then)
#   elo.sh cache           save the stack's images to the local cache backup/ (for offline installs)
#   elo.sh sources         which stack images the cache sources (CACHE_SOURCES) contain
#   elo.sh up              start the stack (sets vm.max_map_count for Elasticsearch)
#   elo.sh status          container states and ELO URLs
#   elo.sh stats           memory/CPU per container (JSON lines)
#   elo.sh stop|start|restart <service...>   manage single services (server, search, as, flows, tr2, ...)
#   elo.sh enable|disable <as|flows|pgadmin> optional services (persisted in COMPOSE_PROFILES)
#   elo.sh license [file]  apply a new license (re-runs ix-setup, restarts the server)
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
  # .env may have been edited on Windows: keep it LF-only so sed/compose read clean values.
  sed -i 's/\r//g' .env
  # The license goes in verbatim (multi-line); docker compose reads it from the environment.
  export ELO_LIC; ELO_LIC=$(tr -d '\r' < "$LIC")
  echo "license: $LIC"
}

# Cache sources (CACHE_SOURCES, ";"-separated): ftp:// http(s):// URLs (curl), unc:\\server\share\dir (mounted with
# drvfs in WSL, Windows credentials of the user) or a Linux directory. Each holds <ref>.tar files named like backup/.
src_dir() {   # directory for a source (mounts UNC shares once)
  case "$1" in
    unc:*) local mp=/mnt/elo-src-$(echo "$1" | md5sum | cut -c1-8); mkdir -p "$mp"
           mountpoint -q "$mp" || mount -t drvfs "${1#unc:}" "$mp" 2>/dev/null || return 1; echo "$mp" ;;
    *) echo "$1" ;;
  esac
}
src_has() {   # prints the first source that has file $1
  local IFS=';' s d
  for s in ${CACHE_SOURCES:-}; do
    [ -z "$s" ] && continue
    case "$s" in
      ftp://*|http://*|https://*) curl -fsSI --max-time 20 "${s%/}/$1" >/dev/null 2>&1 && { echo "$s" | sed -E 's#//[^:/@]+:[^@]+@#//***@#'; return 0; } ;;
      *) d=$(src_dir "$s") && [ -f "$d/$1" ] && { echo "${s#unc:}"; return 0; } ;;
    esac
  done; return 1
}
src_get() {   # copies file $1 from the first source that has it into backup/
  local IFS=';' s d
  for s in ${CACHE_SOURCES:-}; do
    [ -z "$s" ] && continue
    case "$s" in
      ftp://*|http://*|https://*)
        if curl -fsS --max-time 3600 -o "backup/$1.part" "${s%/}/$1" 2>/dev/null; then mv "backup/$1.part" "backup/$1"
          echo "source  $(echo "$s" | sed -E 's#//[^:/@]+:[^@]+@#//***@#')/$1"; return 0; fi; rm -f "backup/$1.part" ;;
      *) d=$(src_dir "$s") && [ -f "$d/$1" ] && cp "$d/$1" "backup/$1" && { echo "source  ${s#unc:}/$1"; return 0; } ;;
    esac
  done; return 1
}

cmd=${1:-}; shift || true
# Commands that need the Docker engine start it if it was stopped (e.g. from the Administration panel).
case "$cmd" in pull|cache|up|start|restart|license|enable|sources)
  docker info >/dev/null 2>&1 || { echo "starting the Docker engine"; systemctl start docker 2>/dev/null || service docker start >/dev/null 2>&1; sleep 3; } ;;
esac
case "$cmd" in
  env)     make_env "${1:-}" ;;
  # Local first: an image already in Docker is kept, one in the local cache (backup/<ref>.tar) is loaded, one found in a
  # cache source (CACHE_SOURCES) is copied into the local cache and loaded; only the rest comes from the registry.
  # backup/ file name = ref with "/"→"~" and ":"→"@".
  pull)    make_env; mkdir -p backup
           for img in $(docker compose config --images | sort -u); do
             if docker image inspect "$img" >/dev/null 2>&1; then echo "local   $img"; continue; fi
             name="$(echo "$img" | tr '/:' '~@').tar"
             if [ -f "backup/$name" ]; then echo "cache   $img (docker load backup/$name)"; docker load -q -i "backup/$name" >/dev/null && continue; fi
             if src_get "$name"; then echo "        → $img loaded from the source"; docker load -q -i "backup/$name" >/dev/null && continue; fi
             echo "pull    $img"; docker pull -q "$img" >/dev/null || { echo "ERROR pulling $img"; exit 1; }
           done ;;
  # Which images of the stack (current .env versions) each cache source has.
  sources) make_env >/dev/null
           for img in $(docker compose --profile as --profile flows --profile pgadmin config --images | sort -u); do
             name="$(echo "$img" | tr '/:' '~@').tar"; where=$(src_has "$name") || true
             if [ -n "$where" ]; then echo "found   $img  @ $where"; else echo "missing $img"; fi
           done ;;
  # Save the stack's images (current .env versions) into the local cache backup/ (offline install / own repository).
  cache)   make_env >/dev/null; mkdir -p backup
           for img in $(docker compose --profile as --profile flows --profile pgadmin config --images | sort -u); do
             tar="backup/$(echo "$img" | tr '/:' '~@').tar"
             [ -f "$tar" ] && { echo "cached  $img"; continue; }
             docker image inspect "$img" >/dev/null 2>&1 || docker pull -q "$img" >/dev/null || { echo "ERROR pulling $img"; exit 1; }
             docker save -o "$tar" "$img" && echo "saved   $img ($(du -h "$tar" | cut -f1))"
           done ;;
  up)      make_env; sysctl -w vm.max_map_count=262144 >/dev/null; docker compose up -d ;;
  status)  . ./.env; docker compose ps -a --format 'table {{.Name}}\t{{.State}}\t{{.Status}}'
           echo "Web Client:    http://localhost:9090/$REPO/plugin/de.elo.ix.plugin.proxy/web/"
           echo "Admin Console: http://localhost:9090/$REPO/plugin/de.elo.ix.plugin.proxy/ac/" ;;
  stats)   docker stats --no-stream --format '{{json .}}' $(docker compose ps -q) ;;
  stop|start|restart) make_env >/dev/null; docker compose "$cmd" "$@" ;;
  # Optional services by profile (as | flows | pgadmin): enable = add to COMPOSE_PROFILES and start; disable = stop + remove.
  enable)  make_env >/dev/null; p=$1; . ./.env
           grep -q "^COMPOSE_PROFILES=.*\b$p\b" .env || sed -i "s/^COMPOSE_PROFILES=\(.*\)/COMPOSE_PROFILES=\1,$p/; s/^COMPOSE_PROFILES=,/COMPOSE_PROFILES=/; s/^COMPOSE_PROFILES=none,/COMPOSE_PROFILES=/" .env
           docker compose --profile "$p" up -d --no-deps $(docker compose --profile "$p" config --services | grep -x -E "$p|$p-worker") ;;
  disable) make_env >/dev/null; p=$1
           sed -i "s/^\(COMPOSE_PROFILES=.*\)\b$p\b,\?/\1/; s/^\(COMPOSE_PROFILES=.*\),$/\1/" .env
           for s in $(docker compose --profile "$p" config --services | grep -x -E "$p|$p-worker"); do docker compose --profile "$p" rm -sf "$s"; done ;;
  # New license: re-run the ELO setup container with it (writes the license into the repository), then restart the server.
  license) LICENSE_FILE=${1:-${LICENSE_FILE:-}} make_env >/dev/null
           docker compose up -d --force-recreate --no-deps ix-setup
           for i in $(seq 1 60); do s=$(docker inspect -f '{{.State.Status}}/{{.State.ExitCode}}' elo-ix-setup); case "$s" in exited/0) break ;; exited/*) docker logs --tail 30 elo-ix-setup; exit 1 ;; esac; sleep 5; done
           docker logs elo-ix-setup 2>&1 | grep -i -E 'license|customer1' | tail -5
           docker compose restart server ;;
  logs)    docker compose logs --no-color --tail "${2:-200}" "$1" ;;
  down)    if [ "${1:-}" = --volumes ]; then docker compose down -v; else docker compose down; fi ;;
  *) echo "usage: elo.sh env|pull|cache|sources|up|status|stats|stop|start|restart|enable|disable|license|logs|down"; exit 2 ;;
esac
