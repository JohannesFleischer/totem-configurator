#!/bin/bash
# Run the overlay app (Electron, Linux x64) against the simulated TOTEM under a virtual display.
#   test/overlay-app.sh <path to unpacked electron-v44.9.0-linux-x64> [output dir]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$(cd "$ROOT/../untested-os/app" && pwd)"  # built by build.ts
ELECTRON="$1/electron"
OUT="${2:-$(mktemp -d)}"
mkdir -p "$OUT"
export TOTEM_OVERLAY_TEST_MOCK="$ROOT/test/mock-totem.js"
export TOTEM_OVERLAY_TEST_SCRIPT="$ROOT/test/overlay-app-test.cjs"
export TOTEM_OVERLAY_TEST_OUT="$OUT"
export ELECTRON_DISABLE_SECURITY_WARNINGS=1
HOME_DIR="$(mktemp -d)"  # a fresh profile: first start
unset NODE_OPTIONS; timeout 120 xvfb-run -a -s "-screen 0 1600x1000x24" env HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" \
    "$ELECTRON" --no-sandbox "$APP" 2>&1 > "$OUT/app-log.txt" 2>&1 || true
grep -E "^  ok|FAILED" "$OUT/app-log.txt" || true
python3 -c "import json,sys; r=json.load(open('$OUT/app-results.json')); print('ALL', len(r['results']), 'APP CHECKS PASSED' if r['ok'] else 'FAILED: ' + r['error']); sys.exit(0 if r['ok'] else 1)"

# The same app as users run it: sandboxed pages and real WebHID (no keyboard attached here).
HOME_DIR="$(mktemp -d)"
unset TOTEM_OVERLAY_TEST_MOCK
export TOTEM_OVERLAY_TEST_SCRIPT="$ROOT/test/overlay-app-prod.cjs"
timeout 120 xvfb-run -a -s "-screen 0 1600x1000x24" env HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" \
    "$ELECTRON" --no-sandbox "$APP" > "$OUT/prod-log.txt" 2>&1 || true
python3 -c "import json,sys; r=json.load(open('$OUT/prod-results.json')); [print('  ok -', x) for x in r['results']]; print('ALL', len(r['results']), 'PRODUCTION-MODE CHECKS PASSED' if r['ok'] else 'FAILED: ' + r['error']); sys.exit(0 if r['ok'] else 1)"

# The configurator: "electron app --editor".
HOME_DIR="$(mktemp -d)"
export TOTEM_OVERLAY_TEST_SCRIPT="$ROOT/test/overlay-app-editor.cjs"
timeout 120 xvfb-run -a -s "-screen 0 1600x1000x24" env HOME="$HOME_DIR" XDG_CONFIG_HOME="$HOME_DIR/.config" \
    "$ELECTRON" --no-sandbox "$APP" --editor > "$OUT/editor-log.txt" 2>&1 || true
python3 -c "import json,sys; r=json.load(open('$OUT/editor-results.json')); [print('  ok -', x) for x in r['results']]; print('ALL', len(r['results']), 'EDITOR-MODE CHECKS PASSED' if r['ok'] else 'FAILED: ' + r['error']); sys.exit(0 if r['ok'] else 1)"
