#!/bin/bash
# Prepare a WSL Ubuntu/Debian distro for dedicated input seats (run as root):
# Xorg on a dummy screen + libinput, x11vnc + TigerVNC viewer, openbox, FreeRDP 3, udev tools and
# Firefox from Mozilla's APT repository (.deb, no snap). Optional: google-chrome / microsoft-edge.
# Usage: setup.sh [chrome] [edge]
set -e
export DEBIAN_FRONTEND=noninteractive
for m in vhci-hcd usbhid hid-generic evdev; do modprobe "$m" 2>/dev/null || true; done

if ! grep -qs packages.mozilla.org /etc/apt/sources.list.d/mozilla.list; then
  install -d -m 0755 /etc/apt/keyrings
  wget -q https://packages.mozilla.org/apt/repo-signing-key.gpg -O /etc/apt/keyrings/packages.mozilla.org.asc
  echo "deb [signed-by=/etc/apt/keyrings/packages.mozilla.org.asc] https://packages.mozilla.org/apt mozilla main" \
    > /etc/apt/sources.list.d/mozilla.list
  printf 'Package: *\nPin: origin packages.mozilla.org\nPin-Priority: 1000\n' > /etc/apt/preferences.d/mozilla
fi
for opt in "$@"; do
  case "$opt" in
    chrome)
      wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor --yes -o /etc/apt/keyrings/google-chrome.gpg
      echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
        > /etc/apt/sources.list.d/google-chrome.list ;;
    edge)
      wget -qO- https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor --yes -o /etc/apt/keyrings/microsoft-edge.gpg
      echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/microsoft-edge.gpg] https://packages.microsoft.com/repos/edge stable main" \
        > /etc/apt/sources.list.d/microsoft-edge.list ;;
  esac
done
apt-get update -qq
PKGS="xserver-xorg-core xserver-xorg-video-dummy xserver-xorg-input-libinput x11vnc tigervnc-viewer openbox
      freerdp3-x11 x11-utils udev usbutils firefox"
for opt in "$@"; do
  case "$opt" in chrome) PKGS+=" google-chrome-stable" ;; edge) PKGS+=" microsoft-edge-stable" ;; esac
done
apt-get install -y -qq $PKGS >/dev/null
echo "SETUP_OK"
