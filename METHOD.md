# Method

How the bird models are made. Flapping 3D birds for GeoLocator Explorer's bird view, one per species, made from the
[huashu-bird-sticker](https://github.com/alchaincyf/huashu-bird-sticker) illustrations (CC BY 4.0)
with [Meshy](https://www.meshy.ai) and Blender. What worked and what didn't: [LESSONS.md](LESSONS.md).

## Files

| Path | What |
|---|---|
| `tools/species.py` | Builds `species.csv` (the to-do list) from the latest [Master GeoLocator Data Package](https://doi.org/10.5281/zenodo.18187092) on Zenodo (or `$GEOLOCATOR_MASTER`, a local `data/master`), merged with `status.csv` |
| `status.csv` | Hand-kept progress per species: status, method, credits, notes |
| `species.csv` | Generated: tier, tag count, sticker URL, status. Don't edit, rerun `species.py` |
| `prompts/flight.txt` | Prompt template for the in-flight image |
| `prompts/species_notes.csv` | Per species: plumage seen in flight, underside (texture prompt), flight style |
| `tools/make_bird.py` | `image` → `model` → `rig` → `publish` (→ `site`), logging task ids and credits |
| `tools/rig_flap.py` | Blender: weld, level (roll and pitch), centre on the body, (single-image models only: remove legs by thickness), slim belly, decimate, skeleton, wing beat, export in standard glTF axes (back +Y, head +Z); `--static=1` for the model as generated |
| `tools/render_bird.py` | Blender: previews (bird view, side, below), close-ups, gallery poster |
| `tools/sheet.sh` | Review sheets for a batch: `images` (sticker vs flight image) or `previews` |
| `models/`, `static/`, `images/`, `posters/`, `models.json` | Published: flapping model, model as generated, in-flight image, poster, index |
| `raw/` | Full-quality Meshy GLBs (13–50 MB). Not in git, archived on Zenodo |
| `work/<Genus_species>/` | Sticker, flight image, previews, `log.jsonl` (task ids, prompts, credits). Not in git |

GeoLocator Explorer reads `models.json` from jsDelivr
(`https://cdn.jsdelivr.net/gh/GeoPressure/bird-models@<tag>/`) and loads `models/<Genus_species>.glb`
for each listed species, the generic bird otherwise (`BIRD_MODELS_BASE` in `src/pages/Tag.vue`).

## Priority

`species.py` sorts species by tier, then by number of tags:

1. in an open, single-species data package
2. only in open multi-species packages
3. only in embargoed or restricted packages

The list follows the master data, so rerun `species.py` after the master is updated.

## Making one bird

Needs the Meshy CLI signed in (`npm exec --yes --package=meshy-cli@0.4.0 -- meshy auth status`,
a paid plan: the free plan can't create tasks through the API) and `blender` on the PATH.

```bash
python3 -I tools/species.py --todo
# fix or add the row in prompts/species_notes.csv after looking at the sticker
python3 -I tools/make_bird.py image "Oenanthe oenanthe"     #  9 credits: flight image (check vs sticker)
python3 -I tools/make_bird.py views "Oenanthe oenanthe"     #  9 credits: top (first), underside, side; no legs
python3 -I tools/make_bird.py model "Oenanthe oenanthe"     # 20 credits: untextured shape from the views
python3 -I tools/make_bird.py texture "Oenanthe oenanthe"   # 10 credits: colours from the flight image + views
python3 -I tools/make_bird.py rig "Oenanthe oenanthe"       # free: flapping + static, previews, CHECK lines
python3 -I tools/make_bird.py publish "Oenanthe oenanthe"   # then status.csv, quality pending, user check
```

The procedure with all checks is in `.claude/skills/bird-3d-model/SKILL.md`.

## Releasing to the Explorer

```bash
git add -A && git commit -m "Add <species>"
git tag -a v1.2.0 -m "..." && git push --follow-tags
gh release create v1.2.0 --notes "..."
# GeoLocatorExplorer: set BIRD_MODELS_BASE in src/pages/Tag.vue to ...@v1.2.0/, check the bird view
```

Pinning a tag keeps the Explorer stable while the repository changes; jsDelivr caches `@main` for
up to 12 hours, tags permanently.

Rig options (after `--`): `--amp` wing-beat amplitude, `--legs=delete|fold|keep`, `--belly` max body depth/length, `--head=follow`,
`--bob`, `--pitch`, `--sweep`, `--faces`, `--tex`; see the header of `rig_flap.py`.

## Licence

Stickers are CC BY 4.0 (huashu-bird-sticker, Huashu); the models derived from them are shared
under CC BY 4.0 with that credit.
