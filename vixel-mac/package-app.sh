#!/bin/bash
# Makes a disk image of the built app, to carry to another Mac.
# Run it from Terminal after ./build-app.sh:  ./package-app.sh
# The image lands in build/Vixel.dmg.
set -euo pipefail
cd "$(dirname "$0")"

APP="build/Vixel.app"
DMG="build/Vixel.dmg"
[ -d "$APP" ] || { echo "Build the app first: ./build-app.sh"; exit 1; }

# Take the version from the app, so the image says which build it is.
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo "dev")

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/Vixel.app"
# A shortcut to Applications, so the other Mac can drag the app across.
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/Read me first.txt" <<'EOF'
Vixel for Mac

1. Drag Vixel into Applications.
2. Open it once. If the Mac says it cannot check the app for malware,
   open System Settings, Privacy & Security, scroll down, and click
   "Open Anyway" next to Vixel. Then open it again.
   (The app is signed for Jon's own Macs, not through Apple's notary.)
3. It needs macOS 14 (Sonoma) or newer.

Vixel remembers its surfaces on each Mac by itself. A setup does not
travel between Macs yet.
EOF

rm -f "$DMG"
hdiutil create -quiet -volname "Vixel $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
echo "Made $DMG"
