#!/usr/bin/env bash
#
# Re-encode footage for scroll scrubbing.
#
# This is not an optional polish step. A normal web export places a keyframe
# every 2-10 seconds, and seeking to an arbitrary time means decoding forward
# from the previous keyframe. That work is why scrubbed video stutters. Here we
# ask for an all-intra file: every frame is a keyframe, so every seek is one
# decode. The file gets several times larger, which is the trade you are making.
#
#   ./tools/encode.sh source.mov            -> assets/video.mp4
#   ./tools/encode.sh source.mov 1920 30 20 -> width 1920, 30fps, crf 20
#
set -euo pipefail

INPUT="${1:?usage: encode.sh <input> [width] [fps] [crf]}"
WIDTH="${2:-1280}"
FPS="${3:-30}"
CRF="${4:-22}"
OUTPUT="assets/video.mp4"

mkdir -p assets

ffmpeg -y -i "$INPUT" \
  -an \
  -vf "fps=${FPS},scale=${WIDTH}:-2:flags=lanczos" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -g 1 -keyint_min 1 -sc_threshold 0 \
  -crf "$CRF" -preset slow \
  -movflags +faststart \
  "$OUTPUT"

echo
echo "Wrote $OUTPUT"
ls -lh "$OUTPUT" | awk '{print "Size: " $5}'
echo
echo "The whole file is downloaded into memory before the first seek, so aim"
echo "for under ~30 MB. If you are over: shorten the clip, drop to 24fps, or"
echo "raise CRF before you reach for a smaller width."
echo
echo "Too big even then? Swap -g 1 for -g 4 -keyint_min 4. Roughly a third the"
echo "size, and seeks decode at most 3 frames forward - still smooth on"
echo "desktop, slightly softer on a loaded mobile CPU."
