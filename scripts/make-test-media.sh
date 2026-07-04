#!/bin/sh
# Generates the CUEOLA MASTER PLAN §4 smoke-test media set into test-media/
# (gitignored — regenerate anywhere with ffmpeg installed).
#   16:9, 4:3, 9:16 H.264 videos · still images · audio tone (SFX)
#   plus two deliberately unplayable files for graceful-failure drills.
set -e
cd "$(dirname "$0")/.."
mkdir -p test-media
FF="ffmpeg -hide_banner -loglevel error -y"

# playable H.264 + AAC videos, 6 s, three aspect ratios
$FF -f lavfi -i "smptebars=size=640x360:rate=30"  -f lavfi -i "sine=frequency=440:duration=6" \
   -t 6 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -c:a aac -shortest test-media/bars-16x9.mp4
$FF -f lavfi -i "smptebars=size=640x480:rate=30"  -f lavfi -i "sine=frequency=550:duration=6" \
   -t 6 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -c:a aac -shortest test-media/bars-4x3.mp4
$FF -f lavfi -i "smptebars=size=360x640:rate=30"  -f lavfi -i "sine=frequency=660:duration=6" \
   -t 6 -c:v libx264 -pix_fmt yuv420p -profile:v baseline -c:a aac -shortest test-media/bars-9x16.mp4

# still images
$FF -f lavfi -i "smptebars=size=1280x720" -frames:v 1 test-media/still-16x9.png
$FF -f lavfi -i "testsrc=size=800x600"    -frames:v 1 test-media/still-4x3.jpg

# short SFX tone
$FF -f lavfi -i "sine=frequency=880:duration=1" -c:a pcm_s16le test-media/sfx-ding.wav

# deliberately unplayable in Chromium: ProRes .mov (codec unsupported)
$FF -f lavfi -i "smptebars=size=640x360:rate=30" -t 4 -c:v prores_ks -profile:v 0 test-media/unplayable-prores.mov
# deliberately corrupt: valid start, truncated mid-stream
head -c 20000 test-media/bars-16x9.mp4 > test-media/corrupt-truncated.mp4

ls -la test-media/
