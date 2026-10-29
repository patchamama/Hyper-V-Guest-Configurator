#!/bin/bash
# Start Xorg (dummy screen, only the given evdev devices), an XFCE session as user "seat" and a view-only VNC server.
set -u
D=${DISPLAY_NUM:-3}
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
  Modeline "1280x800" 83.50 1280 1352 1480 1680 800 803 809 831
EndSection
Section "Screen"
  Identifier "scr"
  Device "dummy"
  Monitor "mon"
  DefaultDepth 24
  SubSection "Display"
    Depth 24
    Modes "1280x800"
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
su seat -c "DISPLAY=:$D dbus-launch --exit-with-session startxfce4" >/tmp/xfce.log 2>&1 &
exec x11vnc -display ":$D" -localhost -rfbport "${VNC_PORT:-5903}" -nopw -viewonly -forever -shared \
  -cursor most -nocursorshape -cursorpos -wait 5 -defer 5 -quiet
