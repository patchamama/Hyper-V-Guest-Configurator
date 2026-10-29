# Desktop seat container: Ubuntu 24.04 with a chosen desktop/window manager on an Xorg dummy screen whose only input
# devices are the evdev nodes passed with --device (MOUSE/KBD env), exported read-only over VNC on VNC_PORT
# (host network). Build one tag per desktop:
#   docker build --build-arg DESKTOP=lxqt -t hvc-seat-desktop:lxqt seat/docker
# DESKTOP: xfce | mate | kde | gnome (Flashback, no 3D needed) | lxqt | lxde | openbox | icewm | fluxbox | jwm | i3
FROM ubuntu:24.04
ARG DESKTOP=xfce
ENV DEBIAN_FRONTEND=noninteractive
RUN set -e; \
    case "$DESKTOP" in \
      xfce)    P="xfce4 xfce4-terminal";                          S="startxfce4" ;; \
      mate)    P="mate-desktop-environment-core mate-terminal";   S="mate-session" ;; \
      kde)     P="kde-plasma-desktop konsole";                    S="startplasma-x11" ;; \
      gnome)   P="gnome-session-flashback gnome-terminal";        S="gnome-session --builtin --session=gnome-flashback-metacity" ;; \
      lxqt)    P="lxqt-core openbox qterminal";                   S="startlxqt" ;; \
      lxde)    P="lxde-core lxterminal";                          S="startlxde" ;; \
      openbox) P="openbox tint2 xterm";                           S="sh -c 'tint2 & exec openbox-session'" ;; \
      icewm)   P="icewm xterm";                                   S="icewm-session" ;; \
      fluxbox) P="fluxbox xterm";                                 S="startfluxbox" ;; \
      jwm)     P="jwm xterm";                                     S="jwm" ;; \
      i3)      P="i3-wm i3status dmenu xterm";                    S="i3" ;; \
      *) echo "unknown DESKTOP=$DESKTOP"; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      xserver-xorg-core xserver-xorg-video-dummy xserver-xorg-input-libinput x11-xserver-utils x11-utils \
      x11vnc dbus-x11 adwaita-icon-theme fonts-dejavu-core locales $P; \
    rm -rf /var/lib/apt/lists/*; \
    useradd -m -s /bin/bash seat; \
    echo "$S" > /etc/seat-session; echo "$DESKTOP" > /etc/seat-desktop
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENV DISPLAY_NUM=3 VNC_PORT=5903 MOUSE=none KBD=none
ENTRYPOINT ["/entrypoint.sh"]
