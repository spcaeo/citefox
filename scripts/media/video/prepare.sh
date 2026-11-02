#!/usr/bin/env bash
# Run inside the media container by scripts/media/make-video.mjs (from the repo root):
# encodes the footage clips that tests/media/video.spec.ts wrote, then fills the
# Revideo project's public/ folder with them, the stills, the engine logos, the fox
# icon and the app's fonts.
#   bash scripts/media/video/prepare.sh <raw video dir>
set -euo pipefail
raw="$1"
pub=scripts/media/video/public
rm -rf "$pub"
mkdir -p "$pub/film/clips" "$pub/film/stills" "$pub/assets/engines" "$pub/fonts"
for list in "$raw"/clips/*.ffconcat; do
  name=$(basename "$list" .ffconcat)
  # Frames carry their own durations; fps=30 makes them a constant-rate clip.
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" \
    -vf "fps=30,scale=1920:1200:flags=lanczos,format=yuv420p" \
    -c:v libx264 -preset medium -crf 16 -movflags +faststart -an "$pub/film/clips/$name.mp4"
done
cp "$raw"/stills/*.jpg "$pub/film/stills/"
cp "$raw/film.json" scripts/media/video/src/footage.json
cp src/renderer/src/assets/engines/* "$pub/assets/engines/"
cp build/icon.svg "$pub/assets/icon.svg"
cp src/renderer/src/assets/fonts/inter-tight-latin-wght.woff2 \
   src/renderer/src/assets/fonts/inter-latin-wght.woff2 \
   src/renderer/src/assets/fonts/jetbrains-mono-latin-wght.woff2 "$pub/fonts/"
ls "$pub/film/clips"
