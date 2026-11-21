#!/usr/bin/env python3
"""Map entries for species without a track (habitats/manual_species.csv): one breeding,
wintering or resident position with its habitat, written in the same form as the tracked
species (habitats/geo/<Genus_species>.json, habitats/geo/index.json, habitats/places.json),
so the gallery shows a dot on the map and the matching scene instead of a fixed default.
Run after tools/species_habitats.R (which rewrites index.json and places.json):
  python3 -I tools/manual_habitats.py
"""
import csv, json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
H = HERE / "habitats"
index = json.loads((H / "geo" / "index.json").read_text())
places = json.loads((H / "places.json").read_text())
gallery = {b["scientific_name"]: b for b in json.loads((HERE / "gallery.json").read_text())["birds"]}
hab = {h["label"]: i for i, h in enumerate(index["habitats"])}
tracked = {s["scientific_name"] for s in index["species"] if not s.get("manual")}
index["species"] = [s for s in index["species"] if not s.get("manual")]
n = 0
for r in csv.DictReader(open(H / "manual_species.csv")):
    sp = r["scientific_name"]
    if sp in tracked:
        continue  # a real track exists now: the manual entry is no longer needed
    lon, lat, hi = float(r["lon"]), float(r["lat"]), hab[r["habitat"]]
    scene = index["habitats"][hi]["scene"]
    name = sp.replace(" ", "_")
    b = gallery.get(sp, {})
    where = ", ".join(x for x in (r["town"], r["country"]) if x)
    geo = {
        "scientific_name": sp, "english_name": b.get("english_name", ""), "tag_id": None, "n_tags": 0,
        "manual": True, "start": None, "end": None,
        "bbox": [round(lon - 22, 2), round(lat - 14, 2), round(lon + 22, 2), round(lat + 14, 2)],
        "default_scene": scene,
        "default_reason": f"no track yet: {r['season']} area ({where}, {r['habitat'].lower()})",
        "path": [], "stops": [], "landmarks": [],
    }
    (H / "geo" / f"{name}.json").write_text(json.dumps(geo, ensure_ascii=False) + "\n")
    index["species"].append({"scientific_name": sp, "english_name": b.get("english_name", ""),
                             "file": f"geo/{name}.json", "model": b.get("model"), "n_tags": 0,
                             "tag_id": None, "default_scene": scene, "manual": True})
    places[sp] = [{"kind": r["season"], "lon": lon, "lat": lat, "days": None, "habitat": hi, "order": 1,
                   "town": r["town"], "town_km": 0, "region": "", "country": r["country"],
                   "ecoregion": "", "manual": True, "source": r["source"]}]
    n += 1
(H / "geo" / "index.json").write_text(json.dumps(index, ensure_ascii=False) + "\n")
(H / "places.json").write_text(json.dumps(places, ensure_ascii=False) + "\n")
print(f"{n} species without a track placed by hand")
