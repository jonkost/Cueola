#!/bin/zsh
# Double-click this file in Finder to start the Cueola → QLab bridge.
# It just runs bridge.py (plain Python — already on your Mac).
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  osascript -e 'display alert "Python not found" message "This Mac does not have python3 available. Open the App Store and install Xcode, or run: xcode-select --install" as critical'
  exit 1
fi

exec python3 bridge.py
