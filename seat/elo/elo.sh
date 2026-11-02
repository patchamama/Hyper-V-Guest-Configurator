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
#   elo.sh delete [--images] remove the instance: containers, data volumes, its configuration (and its images unless used elsewhere)
#   elo.sh diagnose        memory, kernel OOM events and per-container state (why something did not start); ends with __RESULT__
#
# Several versions side by side: ELO_INSTANCE=<name> (elo, elo23, elo25b …: letters/digits, starts with "elo"). The default
# instance "elo" keeps its settings in .env; others in instances/<name>/.env. The instance is the compose project, the
# container prefix and the network; host ports come from PORT_SERVER PORT_AS PORT_FLOWS PORT_SEARCH PORT_SEARCH_T PORT_PGADMIN.
#
# Install-time settings (environment, written to .env): ELO_TAG ELO_SEARCH_TAG REPO REPO_LANGUAGE ELO_DISPLAY_NAME
# ELO_LICENSE_TYPE AUTH_ADMIN_USERNAME AUTH_ADMIN_PASSWORD AUTH_SERVICE_USERNAME AUTH_SERVICE_PASSWORD
# DATABASE_USERNAME DATABASE_PASSWORD KEYSTORE_PASSWORD AUTH_TOMCAT_PASSWORD AUTH_KARAF_PASSWORD IX_URL_PUBLIC
# COMPOSE_PROFILES LICENSE_FILE
set -eu
cd "${ELO_DIR:-$(dirname "$0")}"   # ELO_DIR: when run from a copy (e.g. CRLF-stripped in /tmp)
INST=${ELO_INSTANCE:-elo}
case "$INST" in elo|elo[a-z0-9]*) ;; *) echo "ERROR: instance name must start with 'elo' (letters/digits)"; exit 2 ;; esac
if [ "$INST" = elo ]; then ENVF=.env; else ENVF=instances/$INST/.env; mkdir -p "instances/$INST"; fi
export ELO_INSTANCE=$INST COMPOSE_PROJECT_NAME=$INST COMPOSE_ENV_FILES=$ENVF
rnd() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16; }

# License: LICENSE_FILE, elo-license.lic, or the ELO private key (*.pk; ELO then fetches the license from
# license.services.elo.cloud / license.elo.com, which must be reachable).
license_file() {
  if [ -n "${LICENSE_FILE:-}" ]; then echo "$LICENSE_FILE"; return; fi
  local tag=${ELO_TAG:-$(grep -s '^ELO_TAG=' "$ENVF" | cut -d= -f2)}
  # ELO 23 (and older) use their license text (ELO_23*.txt); ELO 25 the private key (*.pk) or a license file
  case "$tag" in v23*|v21*|v20*) ls -t ELO_23*.txt 2>/dev/null | head -1; return ;; esac
  [ -f elo-license.lic ] && { echo elo-license.lic; return; }
  ls -t ELO_25*.pk 2>/dev/null | head -1
}

make_env() {
  LIC=$(license_file)
  [ -n "$LIC" ] && [ -f "$LIC" ] || { echo "ERROR: no license: put elo-license.lic or the ELO .pk into $(pwd)"; exit 1; }
  if [ ! -f "$ENVF" ] || [ "${1:-}" = --force ]; then
    local svc=${AUTH_SERVICE_PASSWORD:-$(rnd)} repo=${REPO:-repository}
    command -v htpasswd >/dev/null || apt-get install -y -qq apache2-utils >/dev/null
    # search needs the service password also as bcrypt; "$" doubled for docker compose interpolation.
    local bc; bc=$(htpasswd -nbBC 4 x "$svc" | cut -d: -f2 | sed 's/\$/$$/g')
    cat > "$ENVF" <<EOF
ELO_INSTANCE=$INST
PORT_SERVER=${PORT_SERVER:-9090}
PORT_AS=${PORT_AS:-9060}
PORT_FLOWS=${PORT_FLOWS:-9010}
PORT_SEARCH=${PORT_SEARCH:-9200}
PORT_SEARCH_T=${PORT_SEARCH_T:-9204}
PORT_PGADMIN=${PORT_PGADMIN:-5050}
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
IX_URL_PUBLIC=${IX_URL_PUBLIC:-http://localhost:${PORT_SERVER:-9090}/$repo/ix}
EOF
    chmod 600 "$ENVF"
    echo "$ENVF written (instance $INST)"
  fi
  # The env file may have been edited on Windows: keep it LF-only so sed/compose read clean values.
  sed -i 's/\r//g' "$ENVF"
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
             echo "pull    $img"; ok=0
             for try in 1 2 3 4; do docker pull -q "$img" >/dev/null && { ok=1; break; }; echo "  attempt $try failed, retrying in $((try*10)) s"; sleep $((try*10)); done
             [ "$ok" = 1 ] || { echo "ERROR pulling $img"; exit 1; }
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
  status)  REPO=$(grep -h '^REPO=' "$ENVF" | cut -d= -f2-); PORT_SERVER=$(grep -h '^PORT_SERVER=' "$ENVF" | cut -d= -f2-)   # not sourced: values may hold spaces
           docker compose ps -a --format 'table {{.Name}}\t{{.State}}\t{{.Status}}'
           echo "Web Client:    http://localhost:${PORT_SERVER:-9090}/$REPO/plugin/de.elo.ix.plugin.proxy/web/"
           echo "Admin Console: http://localhost:${PORT_SERVER:-9090}/$REPO/plugin/de.elo.ix.plugin.proxy/ac/" ;;
  stats)   docker stats --no-stream --format '{{json .}}' $(docker compose ps -q) ;;
  stop|start|restart) make_env >/dev/null; docker compose "$cmd" "$@" ;;
  # Optional services by profile (as | flows | pgadmin): enable = add to COMPOSE_PROFILES and start; disable = stop + remove.
  enable)  make_env >/dev/null; p=$1
           grep -q "^COMPOSE_PROFILES=.*\b$p\b" "$ENVF" || sed -i "s/^COMPOSE_PROFILES=\(.*\)/COMPOSE_PROFILES=\1,$p/; s/^COMPOSE_PROFILES=,/COMPOSE_PROFILES=/; s/^COMPOSE_PROFILES=none,/COMPOSE_PROFILES=/" "$ENVF"
           docker compose --profile "$p" up -d --no-deps $(docker compose --profile "$p" config --services | grep -x -E "$p|$p-worker") ;;
  disable) make_env >/dev/null; p=$1
           sed -i "s/^\(COMPOSE_PROFILES=.*\)\b$p\b,\?/\1/; s/^\(COMPOSE_PROFILES=.*\),$/\1/" "$ENVF"
           for s in $(docker compose --profile "$p" config --services | grep -x -E "$p|$p-worker"); do docker compose --profile "$p" rm -sf "$s"; done ;;
  # New license: re-run the ELO setup container with it (writes the license into the repository), then restart the server.
  license) LICENSE_FILE=${1:-${LICENSE_FILE:-}} make_env >/dev/null
           docker compose up -d --force-recreate --no-deps ix-setup
           for i in $(seq 1 60); do s=$(docker inspect -f '{{.State.Status}}/{{.State.ExitCode}}' $INST-ix-setup); case "$s" in exited/0) break ;; exited/*) docker logs --tail 30 $INST-ix-setup; exit 1 ;; esac; sleep 5; done
           docker logs $INST-ix-setup 2>&1 | grep -i -E 'license|customer1' | tail -5
           docker compose restart server ;;
  logs)    docker compose logs --no-color --tail "${2:-200}" "$1" ;;
  down)    if [ "${1:-}" = --volumes ]; then docker compose down -v; else docker compose down; fi ;;
  # Remove the instance for good: containers, data volumes, network, configuration; its images only if nothing else uses them.
  delete)  imgs=""; [ -f "$ENVF" ] && imgs=$(docker compose --profile as --profile flows --profile pgadmin config --images 2>/dev/null | sort -u || true)
           [ -f "$ENVF" ] && { docker compose --profile as --profile flows --profile pgadmin down -v --remove-orphans || true; }
           if [ "${1:-}" = --images ]; then for i in $imgs; do if docker rmi "$i" >/dev/null 2>&1; then echo "removed image $i"; else echo "kept image $i (in use or missing)"; fi; done; fi
           if [ "$INST" = elo ]; then rm -f .env; else rm -rf "instances/$INST"; fi; echo "instance $INST removed" ;;
  # Why did it (not) start: memory, kernel OOM events, state of every container of the instance.
  diagnose) echo "memory: $(free -m | awk '/Mem:/{print "total " $2 " MB, available " $7 " MB"}')"
           echo "kernel OOM events: $(dmesg 2>/dev/null | grep -ci -E 'out of memory|oom-kill' || true)"
           bad=0
           for c in $(docker ps -a --filter "label=com.docker.compose.project=$INST" --format '{{.Names}}'); do
             f=$(docker inspect -f '{{.State.Status}}|{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{.State.Error}}' "$c")
             IFS='|' read -r st ec oom rc err <<<"$f"; why=""
             case "$st/$ec" in running/*|exited/0) ;; *) why="state $st, exit code $ec" ;; esac
             [ "$ec" = 137 ] && why="killed (exit 137: usually out of memory, or stopped from outside)"
             [ "$oom" = true ] && why="killed: out of memory (OOMKilled)"
             [ "$st" = created ] && why="never started: ${err:-a dependency or a published port is not available}"
             # restarted but running now: worth knowing (usually a slow first start), not a failure
             [ "$rc" != 0 ] && [ -z "$why" ] && echo "note    $c restarted $rc time(s) by Docker, running now"
             if [ -n "$why" ]; then bad=$((bad+1)); echo "PROBLEM $c: $why"; docker logs --tail 5 "$c" 2>&1 | sed 's/^/    /'; else echo "ok      $c ($st)"; fi
           done
           [ "$bad" = 0 ] && echo "__RESULT__ ok" || echo "__RESULT__ problems $bad" ;;
  *) echo "usage: elo.sh env|pull|cache|sources|up|status|stats|stop|start|restart|enable|disable|license|logs|down|delete|diagnose"; exit 2 ;;
esac
