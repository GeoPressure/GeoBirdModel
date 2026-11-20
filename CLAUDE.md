# bird-models

Flapping 3D bird models for GeoLocator Explorer's bird view, one per species tracked in the Master
GeoLocator Data Package. Public repository GeoPressure/bird-models, gallery on GitHub Pages
(https://geopressure.org/bird-models/), files served to the Explorer by jsDelivr.

Use the `bird-3d-model` skill for any work here (new species, fixes, releases). Read
`METHOD.md` (steps, files) and `LESSONS.md` (default settings, costs, pitfalls) first, and keep
LESSONS.md current.

## Layout
- `tools/` scripts: `species.py` (to-do list from the Master on Zenodo), `make_bird.py`
  (image → model → rig → publish → site), `rig_flap.py` and `render_bird.py` (Blender),
  `sheet.sh` (review sheets).
- `prompts/` flight-image prompt and per-species notes; `status.csv` progress (by hand);
  `species.csv` generated.
- Published: `models/` flapping GLB, `static/` model as generated, `images/` in-flight image,
  `posters/`, `models.json`, `index.html` (gallery).
- Not in git: `raw/` full-quality Meshy GLBs (archived on Zenodo), `work/` per-species working files.

## Releases and the Explorer
GeoLocator Explorer loads `models.json` and the GLBs from
`https://cdn.jsdelivr.net/gh/GeoPressure/bird-models@<tag>/`, pinned in
`src/pages/Tag.vue` (`BIRD_MODELS_BASE`). After publishing birds: commit, tag a new version
(`vX.Y.Z`), create the GitHub release, then bump the tag in the Explorer.

**v1.0.0 → v2.0.0 is breaking**: v1 GLBs use the map's axes (head +Y, back +Z); from v2 they
use standard glTF axes (back +Y, head +Z, origin at the body centre). The Explorer bump to v2
must, in the same change, wrap `model.model`'s children (bird-models GLBs only) in a
`THREE.Group` rotated 180° about (0, 1, 1)/√2 in the `loadObj` callback. The Explorer session
working on PR #5 was told this (2026-11-19); coordinate with it before editing `Tag.vue`.

## Tools needed
Meshy CLI (`npm exec --yes --package=meshy-cli@0.4.0 -- meshy`, signed in, Pro plan: the free
plan cannot create tasks through the API), Blender on the PATH, ImageMagick (`magick`).
Credits: check `meshy balance` before and after, spend one species at a time.
