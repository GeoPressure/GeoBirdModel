#!/usr/bin/env bash
# Hover loops for the gallery: loops/<Genus_species>.webp (+ loops/boxes.json, the poster's place in each loop), a short animated WebP of the bird
# flapping (tools/render_flap_loop.py, 14 frames, 300 px wide), for every bird in gallery.json
# that has a model. Skips loops newer than their model unless -f.
#   tools/flap_loops.sh [-f] [Genus_species ...]
set -euo pipefail
cd "$(dirname "$0")/.."
force=0; [[ "${1:-}" == "-f" ]] && { force=1; shift; }
N=14; W=300; DELAY=70; Q=68
if [[ $# -gt 0 ]]; then sps=("$@"); else
  sps=($(python3 -c "import json;[print(b['model'][7:-4]) for b in json.load(open('gallery.json'))['birds'] if b.get('model')]"))
fi
mkdir -p loops work/loops
for sp in "${sps[@]}"; do
  m="models/$sp.glb"; out="loops/$sp.webp"; tmp="work/loops/$sp"
  [[ -f "$m" ]] || { echo "no model: $sp"; continue; }
  [[ $force == 0 && -f "$out" && "$out" -nt "$m" ]] && continue
  rm -rf "$tmp"; mkdir -p "$tmp"
  blender -b --python tools/render_flap_loop.py -- "$m" "$tmp" $N $W > "$tmp/blender.log" 2>&1 || { echo "blender failed: $sp"; tail -5 "$tmp/blender.log"; continue; }
  for f in "$tmp"/f*.png; do magick "$f" -filter Lanczos -resize "${W}x" "${f%.png}_s.png"; done
  img2webp -loop 0 -lossy -q $Q -m 6 -d $DELAY "$tmp"/f*_s.png -o "$out" > /dev/null 2>&1
  printf "%-32s %s KB\n" "$sp" "$(( $(stat -f %z "$out") / 1024 ))"
done
# loops/boxes.json: where each poster lies in its loop (from work/loops/<sp>/box.json)
python3 - <<'PY'
import json, glob, os
boxes = {}
for f in sorted(glob.glob("work/loops/*/box.json")):
    sp = os.path.basename(os.path.dirname(f))
    if os.path.exists(f"loops/{sp}.webp"): boxes[sp] = json.load(open(f))
json.dump(boxes, open("loops/boxes.json", "w"), separators=(",", ":"))
print("loops/boxes.json:", len(boxes), "species")
PY
