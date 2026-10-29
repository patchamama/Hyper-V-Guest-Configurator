# Desktop seat container: Ubuntu + XFCE on an Xorg dummy screen whose only input devices are the evdev nodes
# passed with --device (MOUSE/KBD env), exported read-only over VNC on VNC_PORT (host network).
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      xserver-xorg-core xserver-xorg-video-dummy xserver-xorg-input-libinput x11-xserver-utils x11-utils \
      x11vnc xfce4 xfce4-terminal dbus-x11 adwaita-icon-theme fonts-dejavu-core locales \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -s /bin/bash seat
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh
ENV DISPLAY_NUM=3 VNC_PORT=5903 MOUSE=none KBD=none
ENTRYPOINT ["/entrypoint.sh"]
