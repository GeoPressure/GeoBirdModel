#!/usr/bin/env bash
# GeoBirdModel logo and favicons, in geopressure.org colours: a songbird (Luscinia megarhynchos) in flight,
# side view, rendered by tools/render_logo.py and flattened to a silhouette.
#   assets/logo.png, logo.webp: silhouette with a sky (#0ea5e9) -> amber (#f59e0b) gradient
#   assets/favicon.ico, favicon-32.png, favicon-180.png: white silhouette on a slate (#0f172a) disc
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
blender -b --python tools/render_logo.py -- models/Luscinia_megarhynchos.glb "$tmp/bird.png" 6 1,-0.1,0.2 0f172a 1024 > /dev/null 2>&1
magick "$tmp/bird.png" -trim +repage -resize 512x512 "$tmp/bird.png"
wh=$(magick identify -format "%wx%h" "$tmp/bird.png")
magick -size "$wh" -define gradient:direction=SouthEast gradient:'#0ea5e9-#f59e0b' \( "$tmp/bird.png" -alpha extract \) \
  -alpha off -compose CopyOpacity -composite assets/logo.png
magick assets/logo.png -resize 256x -quality 90 -define webp:alpha-quality=95 assets/logo.webp
magick -size 512x512 xc:'#0f172a' -alpha set \( -size 512x512 xc:none -fill white -draw "circle 256,256 256,4" \) -compose DstIn -composite \
  \( "$tmp/bird.png" -alpha extract -background white -alpha shape -resize 330x330 \) -compose over -gravity center -composite "$tmp/badge.png"
magick "$tmp/badge.png" -resize 180x180 assets/favicon-180.png
magick "$tmp/badge.png" -resize 32x32 assets/favicon-32.png
magick "$tmp/badge.png" -define icon:auto-resize=48,32,16 assets/favicon.ico
echo "assets/logo.png logo.webp favicon.ico favicon-32.png favicon-180.png"
