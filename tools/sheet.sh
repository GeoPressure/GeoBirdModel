#!/bin/zsh
# Review sheet for a batch: one labelled row per species.
#   tools/sheet.sh images  out.png "Genus species" ...   sticker | flight image
#   tools/sheet.sh previews out.png "Genus species" ...  bird view | side | below | close-ups
set -e
HERE=${0:a:h:h}
mode=$1; out=$2; shift 2
rows=()
tmp=$(mktemp -d)
for sp in "$@"; do
  d="$HERE/work/${sp// /_}"
  if [[ $mode == images ]]; then
    magick "$d/sticker.webp" -resize 260x260 -background white -gravity center -extent 260x260 "$tmp/a.png"
    magick "$d/flight.png" -resize 260x260 -background white -gravity center -extent 260x260 "$tmp/b.png"
    magick "$tmp/a.png" "$tmp/b.png" +append "$tmp/r.png"
  else
    magick "$d/r_bird_01.png" "$d/r_side_01.png" "$d/r_below_01.png" -resize 50% +append "$tmp/p.png"
    magick "$d/closeup.png" -resize 50% "$tmp/c.png"
    magick "$tmp/p.png" "$tmp/c.png" +append "$tmp/r.png"
  fi
  magick "$tmp/r.png" -gravity north -background white -splice 0x22 -font /System/Library/Fonts/Supplemental/Arial.ttf -pointsize 16 -annotate +0+3 "$sp" "$tmp/row_${#rows}.png"
  rows+=("$tmp/row_${#rows}.png")
done
magick "${rows[@]}" -append "$out"
rm -r "$tmp"
echo "-> $out"
