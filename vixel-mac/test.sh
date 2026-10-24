#!/bin/bash
# Runs Vixel's checks (the tests in Tests/VixelTests).
# Run it from Terminal:  ./test.sh
set -euo pipefail
cd "$(dirname "$0")"

# Use the full Xcode when its license has been agreed to. Xcode asks again
# after every update; until then, the smaller command line tools run the
# checks just as well.
XCODE=/Applications/Xcode.app/Contents/Developer
TOOLS=/Library/Developer/CommandLineTools
if [ -z "${DEVELOPER_DIR:-}" ]; then
  if DEVELOPER_DIR="$XCODE" xcrun swift --version >/dev/null 2>&1; then
    export DEVELOPER_DIR="$XCODE"
  elif [ -d "$TOOLS" ]; then
    export DEVELOPER_DIR="$TOOLS"
  fi
fi

# The command line tools keep Apple's test kit in a folder Swift does not
# look in by itself, so point it there.
if [ "${DEVELOPER_DIR:-}" = "$TOOLS" ]; then
  KIT="$TOOLS/Library/Developer"
  swift test -Xswiftc -F"$KIT/Frameworks" \
    -Xlinker -F"$KIT/Frameworks" \
    -Xlinker -rpath -Xlinker "$KIT/Frameworks" \
    -Xlinker -rpath -Xlinker "$KIT/usr/lib" "$@"
else
  swift test "$@"
fi
