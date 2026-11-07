#!/bin/sh
# Resize the photos in assets/photos into assets/memories/01.jpg, 02.jpg, ... for the
# memories burst. Order is the filenames' sort order (the photos were named in date
# order), and the last one is the finale, kept larger because it's held on screen.
# macOS only (uses sips). Run with `pnpm build-memories`.
set -eu
cd "$(dirname "$0")/.."

SRC=assets/photos
OUT=assets/memories
rm -rf "$OUT"
mkdir -p "$OUT"

total=$(find "$SRC" -maxdepth 1 -iname '*.jpg' | wc -l | tr -d ' ')
i=0
find "$SRC" -maxdepth 1 -iname '*.jpg' | LC_ALL=C sort | while IFS= read -r photo; do
  i=$((i + 1))
  size=1280 quality=78
  [ "$i" -eq "$total" ] && size=1600 quality=85
  out="$OUT/$(printf '%02d' "$i").jpg"
  long=$(sips -g pixelWidth -g pixelHeight "$photo" | awk '/pixel/ { if ($2 > m) m = $2 } END { print m }')
  if [ "$long" -gt "$size" ]; then
    sips -s format jpeg -s formatOptions "$quality" -Z "$size" "$photo" --out "$out" >/dev/null
  else
    cp "$photo" "$out" # already small (Facebook-compressed); re-encoding only grows it
  fi
done

echo "$total photos -> $OUT (set MEMORY_COUNT in script.js to $total)"
