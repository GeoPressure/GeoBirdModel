---
name: bird-3d-model
description: Make, fix, review, publish or release the 3D bird models of GeoPressure/GeoBirdModel used in GeoLocator Explorer's bird view (one per species, from huashu-bird-sticker illustrations via Meshy and Blender). Use when asked to make the next bird, redo a bird marked rerun, improve the flight animation (wing beat, belly, head), change model settings, update the gallery or quality status, release a version for the Explorer, check credits, or update the species list.
---

# Bird 3D models

Repository GeoPressure/GeoBirdModel. This file is the procedure: follow it exactly. Why the
defaults are what they are, and the known defects with their fix: `LESSONS.md` (read the
"Defects and their fix" tables before a batch; add a dated row for every new surprise, in the
right table). Files and commands: `METHOD.md`.

## One bird at a time, unless the user asks for a batch
Default: make **one** species, show it to the user in the local gallery, record their verdict in
`status.csv` (`quality`: good / ok / rerun, with `quality_notes`), then start the next.

When the user asks for a batch (e.g. "use all the credits"):
- Run species in parallel: paid steps at most ~8 at once (Meshy refuses more than ~10 pending
  tasks), Blender rigs at most 3 at once. zsh arrays (`L=(a b c)`), `set -o pipefail`.
- Still check every image, view and review yourself before the next paid step.
- At most **one redo per paid step per species** for a defect you saw; then move on and report.
- Publish each bird with quality `pending`; never set good / ok / rerun.
- Report credits before and after, and the list of birds with gallery links.

## Pipeline (v4 + GPT Image 2.5, 54 credits)
All commands from the repo root: `python3 -I tools/make_bird.py <step> "Genus species"`.

1. **Pick**: `python3 -I tools/species.py --todo` (from the latest Master GeoLocator Data Package
   on Zenodo; never edit `species.csv`). Reruns: species with `quality` = rerun. If the sticker
   download fails on jsDelivr (403), fetch it from `raw.githubusercontent.com` (same path).
2. **Notes**: add or fix the row in `prompts/species_notes.csv` (`flight_features`, `underside`,
   `flight_style`, `rig_args`). **Look at the sticker first** (`work/<Genus_species>/sticker.webp`):
   the notes describe the sticker's plumage, not a field guide from memory. Ask for a smooth
   crown if the sticker shows a raised crest, and one clear eye if the face has bold stripes.
   A remake starts with empty `rig_args` (old fixes were for the old shape).
3. **`image`** (12, `gpt-image-2-5-sunburst`): flight image, 1024 px. Check next to the sticker:
   same plumage, wings spread, seen from above and behind, whole bird, straight body and tail,
   one clear eye. Wrong → `image` again.
4. **`views`** (12): one underside view from the flight image + sticker. Check it zoomed on belly
   and vent: **underside colours of the notes (not the back), no feet, toes or claws**. Feet or a
   face looking at the viewer → `views --nosticker`. A dark background (vignette) is harmless:
   don't redo for it. Never edit, crop or rescale a view by hand.
5. **`model`** (20, `--new` to pay for a fresh shape): untextured shape from the **flight image
   first + the underside view**. Never add top or side views (two eyes per side).
6. **`texture`** (10, `--new` likewise): colours from the same two images.
   Both steps log the task as `pending` on submit and resume it if waiting or downloading fails
   (also after a transient 401): rerun **without** `--new`.
7. **`orient`** (free, required): measures where head and back point; `rig` uses it. With a
   colour margin < 1.5x look at `orient_*.png`. In every case confirm in the review that the bird
   flies away from the camera, back up. If not, append a manual entry to `work/<sp>/log.jsonl`
   (`{"step": "orient", "forward": "-Y", "up": "+Z", "manual": true}` with the right axes) and
   rig again.
8. **`rig`** (free): flapping (20 000 faces, skeleton, wing beat, head rigid with the body) and
   static (100 000 faces). Read every printed line; `CHECK WARNING` → stop. Then open
   `review.png` at full size and check every row:
   - bird view: tail nearest, flying away, back up, wings symmetric;
   - head-on: the whole wing hinges at the shoulder; rest angle printed (steeply raised wings →
     note it for the picker);
   - side: belly steady, **no legs or stubs**, the downstroke does not open the flank;
   - below: clean belly;
   - head left/right/top/front (`h_*.png`): **exactly one eye per side**, no eye on the crown, bill
     centred and intact, crown as in the flight image.
   `CHECK body steady (x)` must be below 0.005 half-span.

   Free fixes go in the species' `rig_args`, then `rig` again and re-check: legs →
   `--legs=delete` (if it cuts the tail or undertail, back to keep and pay for a new shape);
   painted dark spots → `--cleanbelly=1`. Paid fixes (`LESSONS.md` tables): new shape
   (`model --new` + `texture --new`, 30) for two eyes, turned head, bad bill, a body that moves;
   new image first when the defect is in the flight image.
   **Never change a rig default** without rendering old and new side by side on two or three
   birds and showing the user.
9. **`publish`**: copies flapping, static, flight image and poster; rebuilds `models.json`. Set
   `status.csv`: status done, method, credits (`make_bird.py credits`), quality `pending`, a note
   on redos and fixes. Show the user `http://localhost:8090/?internal#Genus_species` (`?internal`
   shows status and notes; the public page must stay free of internal terms such as tier, method
   or version).
10. **`options`** (free, ~10 min, background): every belly x wing-beat combination in
    `work/<sp>/options/`; the user picks in `http://localhost:8091/tools/picker.html#Genus_species`
    (e.g. "B0 W1"), never me. Save with `make_bird.py choose "Genus species" B0 W1`, then `rig`
    and `publish`.
11. **Quality gate**: `make_bird.py site all` writes `models.json` (what the Explorer loads) with
    only good and ok birds, and `gallery.json` with every bird and its badge.
12. **Release** (only when the user asks): commit, tag `vX.Y.Z`, `gh release create`, push; then
    bump `BIRD_MODELS_BASE` in GeoLocatorExplorer `src/pages/Tag.vue` and check the bird view.

## What costs credits
Paid (Meshy): `image` 12, `views` 12, `model` 20, `texture` 10, and every redo. A new shape from
the same images is 30, view + shape 42, a whole bird 54. Free (local Blender, from `raw/`):
`orient`, `rig`, `options`, `publish`, `site`: wing beat, belly, legs, levelling, size, file size.
Never pay for a redo without a defect you saw yourself. Check
`npm exec --yes --package=meshy-cli@0.4.0 -- meshy balance --output-schema v1 --format json --no-update-check`
before and after.

## Rules
- A defect the user reports is fixed in the tools for every bird when it is a rig defect
  (rebuild all with `rig` + `publish`, free), and added to `LESSONS.md`.
- Files are standard glTF: back +Y, head +Z, origin at the centre of the body.
- Credit the stickers: CC BY 4.0, huashu-bird-sticker (Huashu).
- Meshy needs the Pro plan for API tasks. Agent credits (Meshy web Agent chat) can make a step
  by hand; its tasks download with the CLI (see `LESSONS.md`).
- Keep the repo tidy: scratch files go in `work/_scratch/`. `model`/`texture` rename the previous
  raw GLB to `__old<time>`; once the new bird is published and checked, the old ones can go (ask
  the user before deleting).
