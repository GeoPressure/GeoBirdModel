# GeoBirdModel (repository GeoPressure/GeoBirdModel, formerly bird-models)

Flapping 3D bird models for GeoLocator Explorer's bird view, one per species tracked in the Master
GeoLocator Data Package. Public repository GeoPressure/GeoBirdModel, gallery on GitHub Pages
(https://geopressure.org/GeoBirdModel/), files served to the Explorer by jsDelivr.

Use the `bird-3d-model` skill for any work here (new species, fixes, releases): it is the
procedure. `METHOD.md` lists the files and commands; `LESSONS.md` explains the defaults and has
the defect -> fix tables. Keep LESSONS.md current (dated rows, in the right table).

## Layout
- `tools/` scripts: `species.py` (to-do list from the Master on Zenodo), `make_bird.py`
  (image → views → model → texture → orient → rig → publish → options → site), Blender scripts
  (`rig_flap.py`, `orient.py`, `deform.py`, `render_*.py`), `picker.html`, `sheet.sh`.
- `prompts/` flight-image prompt and per-species notes; `status.csv` progress (by hand);
  `species.csv` generated.
- Published: `models/` flapping GLB, `static/` model as generated, `images/` in-flight image,
  `posters/`, `models.json`, `index.html` (gallery).
- Not in git: `raw/` full-quality Meshy GLBs (archived on Zenodo),
  `work/` per-species working files (loose test files in `work/_scratch/`), `.vite/` cache.
- Gallery (GeoBirdModel, `index.html`): the bird flies over a procedural habitat scene
  (`scenes/main.js` renderer, `presets.js` one preset per habitat + `<key>_night`, `shaders.js` terrain),
  driven by `scenes/gallery.js`; the migration map card is `scenes/habitat-map.js`. Light page only;
  `?internal` adds status badges, filters, missing and planned species.
- `loops/` hover loops + `loops/boxes.json` (poster position in each loop): `tools/flap_loops.sh`
  (re-run after publishing birds; skips loops newer than their model).
- `habitats/` map data: `tools/species_habitats.R` (Rscript, ~2 min; downloads cached in `work/habitats/`)
  then `tools/name_places.R` (`places.json`: breeding, wintering, long stopovers);
  `habitats/habitat_scenes.csv` (habitat -> scene) is edited by hand.
- `assets/` logo and favicons (`tools/make_logo.sh`), GeoLocator Explorer logo.

## Releases and the Explorer
GeoLocator Explorer loads `models.json` and the GLBs from
`https://cdn.jsdelivr.net/gh/GeoPressure/GeoBirdModel@<tag>/`, pinned in
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
Credits: check `meshy balance` before and after; one species at a time unless the user asks for
a batch (then follow the batch rules in the skill).
