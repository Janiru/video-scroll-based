#!/usr/bin/env bash
#
# Explode footage into a JPEG sequence for CONFIG.mode = 'frames'.
#
# Slower to load, larger over the wire, and completely immune to decoder
# behaviour. Use it when the video mode still is not clean enough on the
# devices you care about, or when the sequence is short (a few seconds).
#
#   ./tools/extract-frames.sh source.mov          -> assets/frames/frame_0001.jpg ...
#   ./tools/extract-frames.sh source.mov 1600 24  -> width 1600, 24fps
#
set -euo pipefail

INPUT="${1:?usage: extract-frames.sh <input> [width] [fps] [quality]}"
WIDTH="${2:-1280}"
FPS="${3:-30}"
QUALITY="${4:-6}"   # ffmpeg -q:v, 2 = best, 31 = worst. 5-8 is the useful range.
OUTDIR="assets/frames"

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"

ffmpeg -y -i "$INPUT" \
  -vf "fps=${FPS},scale=${WIDTH}:-2:flags=lanczos" \
  -q:v "$QUALITY" \
  "${OUTDIR}/frame_%04d.jpg"

COUNT=$(find "$OUTDIR" -name 'frame_*.jpg' | wc -l | tr -d ' ')
echo
echo "Wrote ${COUNT} frames to ${OUTDIR}/ ($(du -sh "$OUTDIR" | cut -f1) total)"
echo
echo "Now set these in js/main.js:"
echo "    mode: 'frames',"
echo "    frameCount: ${COUNT},"
