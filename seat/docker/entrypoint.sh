#!/bin/bash
# Start Xorg (dummy screen, only the given evdev devices), the image's desktop session as user "seat" and a view-only
# VNC server.
set -u
D=${DISPLAY_NUM:-3}
# Screen size (the seat's monitor resolution, or 1280x800); modeline from cvt (xserver-xorg-core).
W=${SEAT_W:-1280}; H=${SEAT_H:-800}
ML=$(cvt "$W" "$H" 60 2>/dev/null | awk '/^Modeline/ { $2="\"" W "x" H "\""; print }' W="$W" H="$H")
[ -n "$ML" ] || { W=1280; H=800; ML='Modeline "1280x800" 83.50 1280 1352 1480 1680 800 803 809 831 -hsync +vsync'; }
inputs=""; layout=""
if [ "${MOUSE:-none}" != none ]; then
  inputs+=$'Section "InputDevice"\n  Identifier "seat-mouse"\n  Driver "libinput"\n  Option "Device" "/dev/input/'"$MOUSE"$'"\nEndSection\n'
  layout+=$'  InputDevice "seat-mouse" "CorePointer"\n'
fi
if [ "${KBD:-none}" != none ]; then
  inputs+=$'Section "InputDevice"\n  Identifier "seat-kbd"\n  Driver "libinput"\n  Option "Device" "/dev/input/'"$KBD"$'"\nEndSection\n'
  layout+=$'  InputDevice "seat-kbd" "CoreKeyboard"\n'
fi
cat > /tmp/seat.conf <<EOF
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
Xorg ":$D" -config /tmp/seat.conf -noreset -novtswitch -sharevts -nolisten tcp -logfile /tmp/xorg.log &
for i in $(seq 1 30); do xdpyinfo -display ":$D" >/dev/null 2>&1 && break; sleep 0.5; done
xdpyinfo -display ":$D" >/dev/null 2>&1 || { echo "Xorg failed"; grep '(EE)' /tmp/xorg.log; exit 1; }
DISPLAY=":$D" xhost +SI:localuser:seat >/dev/null
# Session command chosen at build time (DESKTOP build arg).
su seat -c "DISPLAY=:$D XDG_SESSION_TYPE=x11 dbus-launch --exit-with-session $(cat /etc/seat-session)" >/tmp/session.log 2>&1 &
exec x11vnc -display ":$D" -localhost -rfbport "${VNC_PORT:-5903}" -nopw -viewonly -forever -shared \
  -cursor most -nocursorshape -cursorpos -wait 5 -defer 5 -quiet
