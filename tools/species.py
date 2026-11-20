#!/usr/bin/env python3
"""Build the species to-do list for bird models from the Master GeoLocator Data Package.

The list follows the latest published release of the Master GeoLocator Data Package on Zenodo
(https://doi.org/10.5281/zenodo.18187092, built by GeoPressure/GeoLocatorMaster), so it changes
when packages are added. Only datapackages.csv, tags.csv and species.csv are downloaded (cached in
work/master/<version>/).

  tier 1  species in an open, single-species data package
  tier 2  species only in open multi-species packages
  tier 3  species only in embargoed or restricted packages

Within a tier, species with more tags come first. Progress lives in status.csv (kept by hand)
and is merged in; this script never overwrites it.

  python3 -I tools/species.py            # print the table
  python3 -I tools/species.py --todo     # only species without a model
  GEOLOCATOR_MASTER=/path/to/GeoLocatorMaster/data/master python3 -I tools/species.py   # local build
"""
import csv
import json
import os
import sys
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
MASTER_CONCEPT = "18187092"  # Zenodo concept record of the Master GeoLocator Data Package
MASTER_FILES = ("datapackages.csv", "tags.csv", "species.csv")
STATUS = HERE / "status.csv"
OUT = HERE / "species.csv"
STICKERS_URL = "https://cdn.jsdelivr.net/gh/alchaincyf/huashu-bird-sticker@main/data/stickers.json"
STICKERS_CACHE = HERE / "work" / "stickers.json"


def binomial(name):
    return " ".join(name.split()[:2])


def master():
    """Folder with the master tables: $GEOLOCATOR_MASTER, or the latest Zenodo release (cached)."""
    if os.environ.get("GEOLOCATOR_MASTER"):
        return Path(os.environ["GEOLOCATOR_MASTER"]), "local"
    rec = json.load(urllib.request.urlopen(f"https://zenodo.org/api/records/{MASTER_CONCEPT}/versions/latest"))
    version = f"{rec['metadata'].get('version', '')} (record {rec['id']})"
    d = HERE / "work" / "master" / str(rec["id"])
    d.mkdir(parents=True, exist_ok=True)
    files = {f["key"]: f["links"]["self"] for f in rec["files"]}
    for name in MASTER_FILES:
        if not (d / name).exists():
            urllib.request.urlretrieve(files[name], d / name)
    return d, version


def stickers():
    if not STICKERS_CACHE.exists():
        STICKERS_CACHE.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(STICKERS_URL, STICKERS_CACHE)
    idx = json.loads(STICKERS_CACHE.read_text())
    # by scientific name, and by English name for genus changes (huashu uses Schoeniclus for
    # Emberiza schoeniclus / spodocephala)
    out = {s["scientificName"]: idx["cdn"] + s["file"] for s in idx["stickers"]}
    out.update({"en:" + s.get("en", "").lower(): idx["cdn"] + s["file"] for s in idx["stickers"] if s.get("en")})
    return out


def main():
    MASTER, version = master()
    print(f"master: {version}", file=sys.stderr)
    packages = {d["datapackage_id"]: d for d in csv.DictReader(open(MASTER / "datapackages.csv"))}
    tags = list(csv.DictReader(open(MASTER / "tags.csv")))
    names = {binomial(r["Scientific_name"]): r["English_name_AviList"] for r in csv.DictReader(open(MASTER / "species.csv"))}

    per_package = defaultdict(Counter)
    for t in tags:
        per_package[t["datapackage_id"]][binomial(t["scientific_name"])] += 1

    # one example tag per species for a link to GeoLocator Explorer: only tags the Explorer shows
    # (its data/tags.json; the Master's tag ids are not all there)
    example = {}
    try:
        ex = json.load(urllib.request.urlopen("https://geopressure.org/GeoLocatorExplorer/data/tags.json", timeout=30))
        for t in ex:
            example.setdefault(binomial(t.get("scientific_name", "")), (t["tag_id"], True))
    except Exception as e:  # offline: no links
        print(f"note: GeoLocator Explorer tag list not available ({e})", file=sys.stderr)
    tier, ntags = {}, Counter()
    for pid, counts in per_package.items():
        access = packages.get(pid, {}).get("access_status", "")
        level = 3 if access != "open" else (1 if len(counts) == 1 else 2)
        for sp, n in counts.items():
            tier[sp] = min(tier.get(sp, 9), level)
            ntags[sp] += n

    # Species the user does not want a model for (prompts/exclude_species.csv)
    excl = HERE / "prompts" / "exclude_species.csv"
    for r in (csv.DictReader(open(excl)) if excl.exists() else []):
        tier.pop(r["scientific_name"], None)
    status = {r["scientific_name"]: r for r in csv.DictReader(open(STATUS))} if STATUS.exists() else {}
    sticker = stickers()
    rows = []
    for sp in sorted(tier, key=lambda s: (tier[s], -ntags[s], s)):
        st = status.get(sp, {})
        rows.append({
            "scientific_name": sp,
            "english_name": names.get(sp, ""),
            "tier": tier[sp],
            "n_tags": ntags[sp],
            "tag_id": example.get(sp, ("", False))[0],
            "sticker": sticker.get(sp) or sticker.get("en:" + names.get(sp, "").lower(), ""),
            "status": st.get("status", "todo"),
            "quality": st.get("quality", ""),
            "method": st.get("method", ""),
            "credits": st.get("credits", ""),
            "notes": st.get("notes", ""),
        })
    # Planned species (GeoCollab projects starting or running in the coming years, kept by hand in
    # prompts/planned_species.csv): tier "P", after the Master's species, unless already there.
    planned = HERE / "prompts" / "planned_species.csv"
    if planned.exists():
        for r in csv.DictReader(open(planned)):
            sp = r["scientific_name"]
            if sp in tier:
                continue
            st = status.get(sp, {})
            rows.append({"scientific_name": sp, "english_name": r["english_name"], "tier": "P", "n_tags": 0, "tag_id": "",
                         "sticker": sticker.get(sp) or sticker.get("en:" + r["english_name"].lower(), ""), "status": st.get("status", "todo"),
                         "quality": st.get("quality", ""), "method": st.get("method", ""),
                         "credits": st.get("credits", ""), "notes": f"planned: {r['project']} ({r['note']})"})
            tier[sp] = "P"
    for sp in status:
        if sp not in tier:
            print(f"note: {sp} has a model but is no longer in the master data", file=sys.stderr)

    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    todo = "--todo" in sys.argv
    for r in rows:
        if todo and r["status"] == "done":
            continue
        flag = "" if r["sticker"] else "  (no sticker)"
        print(f"{r['tier']}  {r['n_tags']:>5}  {r['status']:<6} {r['quality']:<6} {r['scientific_name']:<28} {r['english_name']}{flag}")
    qc = {k: sum(r["quality"] == k for r in rows) for k in ("good", "ok", "rerun")}
    print(f"{len(rows)} species, {sum(r['status'] == 'done' for r in rows)} done "
          f"(good {qc['good']}, ok {qc['ok']}, rerun {qc['rerun']}) -> {OUT.relative_to(HERE)}")


if __name__ == "__main__":
    main()
