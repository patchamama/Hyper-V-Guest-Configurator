#!/bin/bash
# Dedicated input seat in WSL ("multi-seat" for Windows): an Xorg server on a virtual (dummy) screen whose
# ONLY input devices are the chosen evdev nodes (USB keyboard/mouse attached to WSL with usbipd), shown on
# the Windows desktop through a view-only VNC viewer (WSLg), so Windows' own keyboard/mouse cannot act on
# it. Inside it runs an RDP session to a Hyper-V VM or a browser in kiosk mode.
#
# Usage (as root):
#   seat.sh start <display> <mouse-event> <kbd-event> rdp <host:port> <[domain\]user> <pass>
#   seat.sh start <display> <mouse-event> <kbd-event> browser <firefox|google-chrome|microsoft-edge> <url>
#   seat.sh start <display> <mouse-event> <kbd-event> docker [image] [build-context-dir] [desktop]
#     image hvc-seat-desktop:<desktop> is built on first use (xfce|mate|kde|gnome|lxqt|lxde|openbox|icewm|fluxbox|jwm|i3)
#   (env SEAT_MONITOR=<index from "monitors">: full screen on that monitor at its resolution)
#   seat.sh monitors           # Windows monitors as seen by WSLg (index|WxH|X|Y|name)
#   seat.sh stop <display>
#   seat.sh devices            # input devices attached to WSL (name | handlers | phys)
#   seat.sh status <display>
set -u
CMD=${1:-}; shift || true

# Input devices attached through usbipd (vhci_hcd): "eventN|vid:pid|type|name", type = mouse|keyboard|other.
devices() {
  for e in /sys/class/input/event*; do
    local d=$e/device ev; ev=$(basename "$e")
    case "$(cat "$d/phys" 2>/dev/null)" in *vhci_hcd*) ;; *) continue ;; esac
    local props type=other
    props=$(udevadm info -q property -n "/dev/input/$ev" 2>/dev/null)
    if grep -q '^ID_INPUT_MOUSE=1' <<<"$props"; then type=mouse
    elif grep -q '^ID_INPUT_KEYBOARD=1' <<<"$props"; then type=keyboard; fi
    echo "$ev|$(cat "$d/id/vendor"):$(cat "$d/id/product")|$type|$(cat "$d/name")"
  done
}

# Programs the seat needs and browsers available in this distro.
check() {
  for c in Xorg x11vnc xtigervncviewer xfreerdp3 openbox udevadm; do command -v "$c" >/dev/null || echo "missing:$c"; done
  [ -f /usr/lib/xorg/modules/drivers/dummy_drv.so ] || echo "missing:xserver-xorg-video-dummy"
  [ -f /usr/lib/xorg/modules/input/libinput_drv.so ] || echo "missing:xserver-xorg-input-libinput"
  for b in firefox google-chrome microsoft-edge chromium; do command -v "$b" >/dev/null && echo "browser:$b"; done
  echo "gateway:$(ip route | awk '/^default/ {print $3; exit}')"
  # Docker Engine inside this distro (/usr/bin/docker; Docker Desktop's Windows shim does not count).
  if [ -x /usr/bin/docker ]; then
    echo "docker:$(systemctl is-active docker 2>/dev/null)"
    docker image ls hvc-seat-desktop --format 'image:hvc-seat-desktop:{{.Tag}}' 2>/dev/null
  else echo "docker:missing"; fi
}

stop_seat() {
  local D=$1
  pkill -f "xtigervncviewer.*127.0.0.1:$((5900 + D))" 2>/dev/null
  pkill -f "x11vnc -display :$D " 2>/dev/null
  # Apps of this seat: any process whose environment has DISPLAY=:<D>.
  for p in $(grep -l -z -x "DISPLAY=:$D" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3); do kill "$p" 2>/dev/null; done
  pkill -f "Xorg :$D " 2>/dev/null
  [ -x /usr/bin/docker ] && docker rm -f "hvc-seat-$D" >/dev/null 2>&1
  sleep 1
}

# Monitors of the Windows desktop as WSLg exposes them: "index|WxH|X|Y|name".
monitors() {
  DISPLAY=:0 xrandr --listmonitors 2>/dev/null | awk 'NR>1 { split($3,a,/[\/x+]/); print $1 "|" a[1] "x" a[3] "|" a[5] "|" a[6] "|" $4 }' | tr -d ':'
}

# Seat geometry: SEAT_MONITOR=<index> puts the seat full screen on that WSLg monitor at its resolution;
# otherwise a 1280x800 window. Sets W, H, GEOM, FULL.
seat_geometry() {
  W=1280; H=800; GEOM="1280x800"; FULL=""
  if [ -n "${SEAT_MONITOR:-}" ]; then
    local m; m=$(monitors | awk -F'|' -v i="$SEAT_MONITOR" '$1==i')
    if [ -n "$m" ]; then
      IFS='|' read -r _ wh mx my _ <<<"$m"; W=${wh%x*}; H=${wh#*x}
      GEOM="${W}x${H}+${mx}+${my}"; FULL=1
    fi
  fi
}

# Xorg Monitor modeline for WxH (cvt ships with xserver-xorg-core).
modeline() { cvt "$1" "$2" 60 2>/dev/null | awk '/^Modeline/ { $2="\"" W "x" H "\""; print }' W="$1" H="$2"; }

# Viewer for seat <D>: view-only TigerVNC on the Windows desktop (WSLg), uncompressed (local link); full screen on
# the seat's monitor when one was chosen.
start_viewer() {
  local D=$1 PORT=$((5900 + $1))
  seat_geometry
  for i in $(seq 1 40); do timeout 1 bash -c "</dev/tcp/127.0.0.1/$PORT" 2>/dev/null && break; sleep 0.5; done
  DISPLAY=:0 setsid xtigervncviewer -ViewOnly -RemoteResize=0 -DesktopSize="${W}x${H}" \
    -AutoSelect=0 -PreferredEncoding=Raw -NoJPEG=1 -FullColor=1 \
    ${FULL:+-FullScreen -FullScreenMode=Current -FullScreenSystemKeys=0} \
    -geometry "$GEOM" "127.0.0.1:$PORT" >"/tmp/hvc-viewer-$D.log" 2>&1 < /dev/null &
}

# Docker mode: a desktop container that gets only the seat's devices (--device) and serves its screen over VNC.
# Its X display number is offset by 20: with --network host it shares the abstract X socket namespace.
start_docker_seat() {
  local D=$1 MOUSE=$2 KBD=$3 IMAGE=${4:-hvc-seat-desktop:xfce} CTX=${5:-} DESKTOP=${6:-}
  [ -x /usr/bin/docker ] || { echo "ERROR: Docker Engine is not installed in this distro"; return 1; }
  if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    [ -n "$CTX" ] && [ -d "$CTX" ] || { echo "ERROR: image $IMAGE not found and no build context"; return 1; }
    # hvc-seat-desktop:<desktop> images are built on first use with that desktop.
    [ -z "$DESKTOP" ] && case "$IMAGE" in hvc-seat-desktop:*) DESKTOP=${IMAGE#hvc-seat-desktop:} ;; esac
    docker build -q ${DESKTOP:+--build-arg "DESKTOP=$DESKTOP"} -t "$IMAGE" "$CTX" >"/tmp/hvc-build-$D.log" 2>&1 \
      || { echo "ERROR: docker build failed"; tail -5 "/tmp/hvc-build-$D.log"; return 1; }
  fi
  local devs=()
  [ "$MOUSE" != none ] && devs+=(--device "/dev/input/$MOUSE")
  [ "$KBD" != none ] && devs+=(--device "/dev/input/$KBD")
  seat_geometry
  docker run -d --name "hvc-seat-$D" --network host "${devs[@]}" -v /run/udev:/run/udev:ro \
    -e MOUSE="$MOUSE" -e KBD="$KBD" -e DISPLAY_NUM=$((D + 20)) -e VNC_PORT=$((5900 + D)) \
    -e SEAT_W="$W" -e SEAT_H="$H" "$IMAGE" >/dev/null \
    || { echo "ERROR: docker run failed"; return 1; }
  start_viewer "$D"
  sleep 3
  docker ps --filter "name=hvc-seat-$D" --format 'container {{.Names}} {{.Image}} {{.Status}}'
  pgrep -af "xtigervncviewer.*:$((5900 + D))" | cut -c1-140
}

status_seat() {
  local D=$1
  pgrep -af "Xorg :$D |x11vnc -display :$D |xtigervncviewer.*:$((5900 + D))" | cut -c1-140
  [ -x /usr/bin/docker ] && docker ps --filter "name=hvc-seat-$D" --format 'container {{.Names}} {{.Image}} {{.Status}}'
  for p in $(grep -l -z -x "DISPLAY=:$D" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3); do ps -o pid=,args= -p "$p" | cut -c1-140; done
}

start_seat() {
  local D=$1 MOUSE=$2 KBD=$3 MODE=$4; shift 4
  local PORT=$((5900 + D)) CONF=/tmp/hvc-seat-$D.conf
  stop_seat "$D"
  if [ "$MODE" = docker ]; then start_docker_seat "$D" "$MOUSE" "$KBD" "$@"; return; fi
  seat_geometry
  local ML; ML=$(modeline "$W" "$H"); [ -n "$ML" ] || { W=1280; H=800; ML='Modeline "1280x800" 83.50 1280 1352 1480 1680 800 803 809 831 -hsync +vsync'; }
  local inputs="" layout=""
  if [ -n "$MOUSE" ] && [ "$MOUSE" != none ]; then
    inputs+=$'Section "InputDevice"\n  Identifier "seat-mouse"\n  Driver "libinput"\n  Option "Device" "/dev/input/'"$MOUSE"$'"\nEndSection\n'
    layout+=$'  InputDevice "seat-mouse" "CorePointer"\n'
  fi
  if [ -n "$KBD" ] && [ "$KBD" != none ]; then
    inputs+=$'Section "InputDevice"\n  Identifier "seat-kbd"\n  Driver "libinput"\n  Option "Device" "/dev/input/'"$KBD"$'"\nEndSection\n'
    layout+=$'  InputDevice "seat-kbd" "CoreKeyboard"\n'
  fi
  cat > "$CONF" <<EOF
Section "ServerFlags"
  Option "AutoAddDevices" "false"
  Option "AutoEnableDevices" "false"
  Option "AllowEmptyInput" "true"
  Option "DontVTSwitch" "true"
EndSection
Section "Device"
  Identifier "dummy"
  Driver "dummy"
  VideoRam 256000
EndSection
Section "Monitor"
  Identifier "mon"
  HorizSync 5.0-1000.0
  VertRefresh 5.0-200.0
  $ML
EndSection
Section "Screen"
  Identifier "scr"
  Device "dummy"
  Monitor "mon"
  DefaultDepth 24
  SubSection "Display"
    Depth 24
    Modes "${W}x${H}"
  EndSubSection
EndSection
$inputs
Section "ServerLayout"
  Identifier "layout"
  Screen "scr"
$layout
EndSection
EOF
  setsid Xorg ":$D" -config "$CONF" -noreset -novtswitch -sharevts -nolisten tcp -logfile "/tmp/hvc-xorg-$D.log" \
    >/dev/null 2>&1 < /dev/null &
  # In WSLg /tmp/.X11-unix belongs to WSLg, so Xorg only gets its abstract socket: probe with xdpyinfo.
  for i in $(seq 1 30); do xdpyinfo -display ":$D" >/dev/null 2>&1 && break; sleep 0.5; done
  if ! xdpyinfo -display ":$D" >/dev/null 2>&1; then echo "ERROR: Xorg :$D failed"; grep -E '\(EE\)' "/tmp/hvc-xorg-$D.log" | tail -5; return 1; fi

  # Seat apps must not see WSLg's Wayland session (x11vnc refuses to run, browsers would open on Windows).
  local X="env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 DISPLAY=:$D"
  $X setsid openbox >/dev/null 2>&1 < /dev/null &
  # "host" stands for the Windows host as seen from WSL (NAT gateway), e.g. host:13389 or http://host:9090/...
  local GW; GW=$(ip route | awk '/^default/ {print $3; exit}')
  if [ "$MODE" = rdp ]; then
    case "$1" in host) set -- "$GW" "${@:2}" ;; host:*) set -- "$GW:${1#host:}" "${@:2}" ;; esac
  else
    case "$2" in *://host[:/]*|*://host) set -- "$1" "${2/:\/\/host/://$GW}" ;; esac
  fi
  if [ "$MODE" = rdp ]; then
    local U=$2 DOM=""
    case "$U" in *\\*) DOM=${U%%\\*}; U=${U#*\\};; esac
    # NLA is off on exposed VMs: plain TLS avoids Kerberos/NTLM negotiation for a workgroup machine.
    $X setsid xfreerdp3 "/v:$1" "/u:$U" ${DOM:+"/d:$DOM"} "/p:$3" /sec:tls /cert:ignore /f +clipboard \
      >"/tmp/hvc-app-$D.log" 2>&1 < /dev/null &
  else
    # Browsers run as the distro's regular user (uid 1000) with a throwaway profile per seat.
    local SU; SU=$(getent passwd 1000 | cut -d: -f1)
    local PROF="/tmp/hvc-browser-$D"; rm -rf "$PROF"; mkdir -p "$PROF"; chown "$SU" "$PROF"
    case "$1" in
      firefox) runuser -u "$SU" -- $X HOME="/home/$SU" setsid firefox --kiosk --new-instance --profile "$PROF" "$2" \
                 >"/tmp/hvc-app-$D.log" 2>&1 < /dev/null & ;;
      *)       runuser -u "$SU" -- $X HOME="/home/$SU" setsid "$1" --kiosk --no-first-run --user-data-dir="$PROF" "$2" \
                 >"/tmp/hvc-app-$D.log" 2>&1 < /dev/null & ;;
    esac
  fi
  # -nocursorshape/-cursorpos: paint the seat's cursor into the framebuffer, because a view-only viewer
  # does not draw a separately sent cursor shape (the pointer would be invisible).
  env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 setsid x11vnc -display ":$D" -localhost -rfbport "$PORT" -nopw -viewonly \
    -forever -shared -cursor most -nocursorshape -cursorpos -wait 5 -defer 5 >"/tmp/hvc-vnc-$D.log" 2>&1 < /dev/null &
  start_viewer "$D"
  sleep 3
  status_seat "$D"
}

case "$CMD" in
  start)   start_seat "$@" ;;
  stop)    stop_seat "$1"; echo "STOPPED :$1" ;;
  status)  status_seat "$1" ;;
  devices) devices ;;
  check)   check ;;
  monitors) monitors ;;
  logs)    D=$1; for f in xorg vnc viewer app; do echo "--- $f"; tail -c 800 "/tmp/hvc-$f-$D.log" 2>/dev/null | tr -cd '[:print:]\n' | tail -4; done ;;
  *) echo "usage: seat.sh start|stop|status|devices|logs ..."; exit 2 ;;
esac
