#!/usr/bin/env bash
# Build "Archives 47.app" (the standalone Archives app) and install it to /Applications.
#
#   npm run archives:app                 build and install
#   npm run archives:app -- --build-only build only; print the bundle path
#
# Archives 47 has its own bundle id (com.lucaorion.archives47), its own library at
# ~/Library/Application Support/com.lucaorion.archives47 and its own Keychain
# service. It never reads or writes Orion Terminal's data.
set -euo pipefail
# The frosted window needs macOS private APIs (transparent window + vibrancy). The feature is
# passed here, not in Cargo.toml, so Orion Terminal builds are unchanged.

cd "$(dirname "$0")/.."
NAME="Archives 47"
BUNDLE_ID="com.lucaorion.archives47"
DEST="/Applications/$NAME.app"
build_only=0
[[ "${1:-}" == "--build-only" ]] && build_only=1

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

step "$NAME.app (UI + native, release)"
ORION_APP_TARGET=archives npx tauri build --bundles app --features tauri/macos-private-api --config src-tauri/tauri.archives.conf.json
built="src-tauri/target/release/bundle/macos/$NAME.app"
[[ -d "$built" ]] || { echo "no bundle at $built" >&2; exit 1; }

if [[ $build_only == 1 ]]; then
  echo "built $(du -sh "$built" | cut -f1) at $PWD/$built"
  exit 0
fi

step "Install to $DEST"
# Quit a running copy so the new build is what opens next.
was_running=0
if pgrep -f "$DEST/Contents/MacOS/archives-47" >/dev/null; then
  was_running=1
  osascript -e "quit app id \"$BUNDLE_ID\"" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "$DEST/Contents/MacOS/archives-47" >/dev/null || break; sleep 0.5; done
fi
rm -rf "$DEST"
ditto "$built" "$DEST"
echo "installed $(du -sh "$DEST" | cut -f1) at $DEST"
[[ $was_running == 1 ]] && open "$DEST"

echo
echo "Open $NAME from /Applications, Spotlight or the Dock."
