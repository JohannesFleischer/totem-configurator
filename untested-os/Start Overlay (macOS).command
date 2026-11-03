#!/bin/bash
# Starts TOTEM Overlay. The first time, it downloads the app's runtime (Electron 44.9.0, about
# 120 MB) from GitHub into the "runtime" folder next to this script and checks it against the
# SHA-256 Electron publishes. Run it again while the overlay runs to open its settings.
# The first time, macOS may ask: right-click this file → Open.
set -euo pipefail
VER=44.9.0
DIR="$(cd "$(dirname "$0")" && pwd)"
case "$(uname -m)" in
    arm64) ARCH=arm64 SHA=12d873a5ae98a6598e730402e9278c5d132e97ea1a4405a7713bec2a3e83921f ;;
    x86_64) ARCH=x64 SHA=fd9d60a1d6cbe98105c3cdd345f7dcca0961364650e6fbbf49d13e58b0f34786 ;;
    *) echo "TOTEM Overlay: no Electron build for this Mac ($(uname -m))." >&2; exit 1 ;;
esac
NAME="electron-v$VER-darwin-$ARCH"
RT="$DIR/runtime/$NAME"
BIN="$RT/Electron.app/Contents/MacOS/Electron"
if [ ! -x "$BIN" ]; then
    mkdir -p "$DIR/runtime"
    ZIP="$DIR/runtime/$NAME.zip"
    echo "Downloading the overlay's runtime, Electron $VER (about 110 MB, only this once)…"
    curl -fL --progress-bar -o "$ZIP.part" "https://github.com/electron/electron/releases/download/v$VER/$NAME.zip"
    if [ "$(shasum -a 256 "$ZIP.part" | cut -d' ' -f1)" != "$SHA" ]; then
        rm -f "$ZIP.part"
        echo "The download doesn't match Electron's published checksum; nothing was installed." >&2
        exit 1
    fi
    mv "$ZIP.part" "$ZIP"
    rm -rf "$RT.tmp" && mkdir -p "$RT.tmp"
    ditto -x -k "$ZIP" "$RT.tmp" # keeps the app bundle's links and signature intact
    mv "$RT.tmp" "$RT"
    rm -f "$ZIP"
fi
nohup "$BIN" "$DIR/app" "$@" > "$DIR/runtime/overlay.log" 2>&1 &
echo "TOTEM Overlay is running: its icon is in the menu bar. You can close this window."
