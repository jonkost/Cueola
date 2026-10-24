#!/bin/bash
# Builds Vixel.app into the build folder next to this script.
# Run it from Terminal:  ./build-app.sh
set -euo pipefail
cd "$(dirname "$0")"

# Use the full Xcode when its license has been agreed to. Xcode asks again
# after every update; until then, the smaller command line tools build the
# app just as well.
XCODE=/Applications/Xcode.app/Contents/Developer
TOOLS=/Library/Developer/CommandLineTools
if [ -z "${DEVELOPER_DIR:-}" ]; then
  if DEVELOPER_DIR="$XCODE" xcrun swift --version >/dev/null 2>&1; then
    export DEVELOPER_DIR="$XCODE"
  elif [ -d "$TOOLS" ]; then
    export DEVELOPER_DIR="$TOOLS"
  fi
fi

swift build -c release

APP="build/Vixel.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/Vixel "$APP/Contents/MacOS/Vixel"
cp Info.plist "$APP/Contents/Info.plist"
cp Resources/Vixel.icns "$APP/Contents/Resources/Vixel.icns"

# Sign it for this Mac. Good enough to run on your own machines.
codesign --force --sign - "$APP"

# Tell the Mac the app changed, so Finder and the Dock show the current icon
# instead of one they remembered from an older build.
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

echo "Built $APP"
