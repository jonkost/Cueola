#!/bin/bash
# Builds Outrangutan.app into the build folder next to this script.
# Run it from Terminal:  ./build-app.sh
set -euo pipefail
cd "$(dirname "$0")"

# Use the full Xcode even if the Mac is set to the smaller command line tools.
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

swift build -c release

APP="build/Outrangutan.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/Outrangutan "$APP/Contents/MacOS/Outrangutan"
cp Info.plist "$APP/Contents/Info.plist"
cp Resources/Outrangutan.icns "$APP/Contents/Resources/Outrangutan.icns"

# Sign it for this Mac. Good enough to run on your own machines.
codesign --force --sign - "$APP"

# Tell the Mac the app changed, so Finder and the Dock show the current icon
# instead of one they remembered from an older build.
touch "$APP"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"

echo "Built $APP"
