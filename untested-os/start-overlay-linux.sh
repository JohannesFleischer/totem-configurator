#!/usr/bin/env bash
# Starts TOTEM Overlay. The first time, it downloads the app's runtime (Electron 44.9.0, about
# 120 MB) from GitHub into the "runtime" folder next to this script and checks it against the
# SHA-256 Electron publishes. Run it again while the overlay runs to open its settings.
#
#   start-overlay-linux.sh                         the overlay
#   start-overlay-linux.sh --editor                the configurator (editor window)
#   start-overlay-linux.sh --add-to-launcher       add both to your app launcher (this user)
#   start-overlay-linux.sh --remove-from-launcher  take them out again
set -euo pipefail
VER=44.9.0
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

if [ "${1:-}" = "--remove-from-launcher" ]; then
    rm -f "$APPS/totem-keybard.desktop" "$APPS/totem-overlay.desktop"
    command -v update-desktop-database > /dev/null && update-desktop-database "$APPS" 2> /dev/null || true
    echo "Removed TOTEM keybard and TOTEM Overlay from the app launcher."
    exit 0
fi

case "$(uname -m)" in
    x86_64 | amd64) ARCH=x64 SHA=ecced7ecb55697f92ca870939c5988557faa8acd8c222c232cae5913d318c8b9 ;;
    aarch64 | arm64) ARCH=arm64 SHA=37fe4dfc34a6dd35d65816864cc6ba9484565cda5ad6d29022e0ee3969e0ea15 ;;
    *) echo "TOTEM Overlay: no Electron build for this CPU ($(uname -m))." >&2; exit 1 ;;
esac
NAME="electron-v$VER-linux-$ARCH"
RT="$DIR/runtime/$NAME"
if [ ! -x "$RT/electron" ]; then
    mkdir -p "$DIR/runtime"
    ZIP="$DIR/runtime/$NAME.zip"
    URL="https://github.com/electron/electron/releases/download/v$VER/$NAME.zip"
    echo "Downloading the overlay's runtime, Electron $VER (about 120 MB, only this once)…"
    if command -v curl > /dev/null; then curl -fL --progress-bar -o "$ZIP.part" "$URL"
    else wget -q --show-progress -O "$ZIP.part" "$URL"; fi
    if ! echo "$SHA  $ZIP.part" | sha256sum -c --quiet -; then
        rm -f "$ZIP.part"
        echo "The download doesn't match Electron's published checksum; nothing was installed." >&2
        exit 1
    fi
    mv "$ZIP.part" "$ZIP"
    rm -rf "$RT.tmp" && mkdir -p "$RT.tmp"
    if command -v unzip > /dev/null; then unzip -q "$ZIP" -d "$RT.tmp"
    else
        # no unzip: Python keeps the files' permissions this way
        python3 - "$ZIP" "$RT.tmp" <<'PY'
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    for i in z.infolist():
        p = z.extract(i, sys.argv[2])
        mode = i.external_attr >> 16
        if mode & 0o777: os.chmod(p, mode & 0o777)
PY
    fi
    mv "$RT.tmp" "$RT"
    rm -f "$ZIP"
fi

if [ "${1:-}" = "--add-to-launcher" ]; then
    # desktop entries that start this script where it is now (move the folder: run this again)
    quoted() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/[\\"`$]/\\&/g' -e 's/%/%%/g')"; }
    entry() { # file (= its window class), name, comment, extra argument
        cat > "$APPS/$1.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=$2
Comment=$3
Exec=$(quoted "$DIR/start-overlay-linux.sh")$4
Icon=$DIR/app/icon.png
Categories=Utility;
StartupWMClass=$1
Terminal=false
EOF
    }
    mkdir -p "$APPS"
    entry totem-keybard "TOTEM keybard" "Remap your GEIST TOTEM keyboard" " --editor"
    entry totem-overlay "TOTEM Overlay" "Your TOTEM layout on top of every app, following the layer you're on" ""
    command -v update-desktop-database > /dev/null && update-desktop-database "$APPS" 2> /dev/null || true
    echo "Added TOTEM keybard and TOTEM Overlay to the app launcher ($APPS)."
    exit 0
fi

# Electron's own sandbox needs a setuid helper or user namespaces, which some distributions
# (Ubuntu 24.04 and later) restrict. The overlay only ever shows its own local page, so it
# runs without that sandbox.
nohup "$RT/electron" --no-sandbox "$DIR/app" "$@" > "$DIR/runtime/overlay.log" 2>&1 &
if [ "${1:-}" = "--editor" ]; then echo "TOTEM keybard (the configurator) is starting. Log: $DIR/runtime/overlay.log"
else
    echo "TOTEM Overlay is running (tray icon; without one, its settings window opens)."
    echo "Run this again to open its settings. Log: $DIR/runtime/overlay.log"
fi
[ -e "$APPS/totem-overlay.desktop" ] || echo "To start it from your app launcher: $0 --add-to-launcher"
