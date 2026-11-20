# Method

How the bird models are made. Flapping 3D birds for GeoLocator Explorer's bird view, one per
species, made from the [huashu-bird-sticker](https://github.com/alchaincyf/huashu-bird-sticker)
illustrations (CC BY 4.0) with [Meshy](https://www.meshy.ai) and Blender. The step-by-step
procedure with all checks is the `bird-3d-model` skill (`.claude/skills/bird-3d-model/SKILL.md`);
what worked, what didn't and the known defects: [LESSONS.md](LESSONS.md).

## Files

| Path | What |
|---|---|
| `tools/species.py` | Builds `species.csv` (the to-do list) from the latest [Master GeoLocator Data Package](https://doi.org/10.5281/zenodo.18187092) on Zenodo (or `$GEOLOCATOR_MASTER`, a local `data/master`), merged with `status.csv`; `--todo` lists what is left |
| `tools/make_bird.py` | Every step (below), logging task ids, prompts and credits to `work/<sp>/log.jsonl` |
| `tools/orient.py` | Blender: which way a Meshy model points (head from geometry, back from colours) |
| `tools/rig_flap.py` | Blender: weld, level, centre, optional leg removal and belly slimming, decimate, skeleton, wing beat, export in standard glTF axes (back +Y, head +Z); `--static=1` for the model as generated. Options in its header |
| `tools/deform.py` | Blender: how much the body moves over the wing beat (`CHECK body steady`) |
| `tools/render_bird.py`, `render_head.py`, `render_poster.py` | Review sheets (bird view, head-on, side, below; head close-ups) and gallery posters |
| `tools/picker.html`, `render_options.py` | The picker where the user chooses among the belly x wing-beat options (`work/<sp>/options/`); the older static options sheet |
| `tools/render_flap_loop.py`, `flap_loops.sh` | Hover loops for the gallery (`loops/<Genus_species>.webp`, `loops/boxes.json`) |
| `tools/render_logo.py`, `make_logo.sh` | Site logo and favicons (`assets/`) |
| `tools/sheet.sh` | Review sheets for a batch (sticker vs flight image, previews) |
| `tools/species_habitats.R`, `name_places.R` | Habitat data for the gallery's scenes and map (`habitats/`), key places of each track (`habitats/places.json`) |
| `prompts/flight.txt` | Prompt template for the flight image |
| `prompts/species_notes.csv` | Per species: plumage seen in flight, underside, flight style, `rig_args` |
| `prompts/planned_species.csv`, `exclude_species.csv` | Species added to or removed from the to-do list by hand |
| `status.csv` | Progress per species (by hand): status, quality (set by the user), method, credits, notes |
| `species.csv` | Generated: tier, tag count, sticker URL, status. Don't edit, rerun `species.py` |
| `models/`, `static/`, `images/`, `posters/` | Published: flapping model, model as generated, flight image, poster |
| `models.json`, `gallery.json` | What the Explorer loads (good/ok birds only); what the gallery shows (every bird) |
| `index.html`, `scenes/`, `habitats/`, `loops/`, `assets/` | The gallery site (GeoBirdModel): page, 3D scenes and map, habitat data, hover loops, logo |
| `raw/` | Full-quality Meshy GLBs (13–50 MB). Not in git, archived on Zenodo |
| `work/<Genus_species>/` | Sticker, flight image, underside view, review sheets, `log.jsonl`; earlier attempts in `old/`, `try1/`... Not in git. `work/_scratch/` holds loose test files |

## Priority

`species.py` sorts species by tier, then by number of tags:

1. in an open, single-species data package
2. only in open multi-species packages
3. only in embargoed or restricted packages

plus planned species (tier P, `prompts/planned_species.csv`). Rerun `species.py` after the master
is updated.

## Making one bird

Needs the Meshy CLI signed in (`npm exec --yes --package=meshy-cli@0.4.0 -- meshy auth status`,
Pro plan: the free plan can't create tasks through the API), `blender` on the PATH and
ImageMagick (`magick`).

```bash
python3 -I tools/species.py --todo
# look at work/<Genus_species>/sticker.webp, then add or fix the row in prompts/species_notes.csv
python3 -I tools/make_bird.py image "Oenanthe oenanthe"     # 12: flight image (check vs sticker)
python3 -I tools/make_bird.py views "Oenanthe oenanthe"     # 12: underside view (no feet)
python3 -I tools/make_bird.py model "Oenanthe oenanthe"     # 20: untextured shape, flight image + underside
python3 -I tools/make_bird.py texture "Oenanthe oenanthe"   # 10: colours from the same two images
python3 -I tools/make_bird.py orient "Oenanthe oenanthe"    # free: which way it points
python3 -I tools/make_bird.py rig "Oenanthe oenanthe"       # free: flapping + static, review.png, CHECK lines
python3 -I tools/make_bird.py publish "Oenanthe oenanthe"   # then status.csv, quality pending
python3 -I tools/make_bird.py options "Oenanthe oenanthe"   # free: variants for the picker
python3 -I tools/make_bird.py choose "Oenanthe oenanthe" B0 W1   # the user's pick, then rig + publish
python3 -I tools/make_bird.py site all                      # models.json (good/ok) and gallery.json
```

54 credits per bird when every step works the first time.

## Releasing to the Explorer

```bash
git add -A && git commit -m "Add <species>"
git tag -a v2.1.0 -m "..." && git push --follow-tags
gh release create v2.1.0 --notes "..."
# GeoLocatorExplorer: set BIRD_MODELS_BASE in src/pages/Tag.vue to ...@v2.1.0/, check the bird view
```

Pinning a tag keeps the Explorer stable while the repository changes; jsDelivr caches `@main` for
up to 12 hours, tags permanently.

## Licence

Stickers are CC BY 4.0 (huashu-bird-sticker, Huashu); the models derived from them are shared
under CC BY 4.0 with that credit.
