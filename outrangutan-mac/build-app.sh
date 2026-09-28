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

# Sign it for this Mac. Good enough to run on your own machines.
codesign --force --sign - "$APP"

echo "Built $APP"
