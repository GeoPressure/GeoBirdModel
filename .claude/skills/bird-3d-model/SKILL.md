---
name: bird-3d-model
description: Make, fix, review, publish or release the 3D bird models of GeoPressure/bird-models used in GeoLocator Explorer's bird view (one per species, from huashu-bird-sticker illustrations via Meshy and Blender). Use when asked to make the next bird, redo a bird marked rerun, improve the flight animation (wing beat, belly, head), change model settings, update the gallery or quality status, release a version for the Explorer, check credits, or update the species list.
---

# Bird 3D models

Repository GeoPressure/bird-models. Background and history: `METHOD.md`, `LESSONS.md` (keep it
current: every surprise, test or changed default gets a dated line). This file is the procedure:
follow it exactly, it already contains the lessons.

## One bird at a time
Make **one** species, show it to the user in the local gallery, record their verdict in
`status.csv` (`quality`: good / ok / rerun, with `quality_notes`), and only then start the next.
Never batch new species unless the user asks.

## Pipeline (v4, 48 credits)
All commands from the repo root: `python3 -I tools/make_bird.py <step> "Genus species"`.

1. **Pick**: `python3 -I tools/species.py --todo` (from the latest Master GeoLocator Data Package
   on Zenodo; never edit `species.csv`). Reruns: species with `quality` = rerun.
2. **Notes**: add or fix the row in `prompts/species_notes.csv` (flight plumage, underside, flight
   style). Download and **look at the sticker first** (`work/<Genus_species>/sticker.webp`): the
   notes must describe the sticker's plumage, not a field guide from memory.
3. **`image`** (9): flight image, 1024 px. Check next to the sticker: same plumage and colours,
   wings spread, seen from above and behind, whole bird, white background. Wrong → `image` again.
4. **`views`** (9): one underside view, 1024 px, from the flight image. Check `views.png`, zoomed
   on the belly and vent: **no feet, toes, claws or dark marks**. Wrong → `views` again.
   Never edit, crop or rescale it by hand.
5. **`model`** (20): untextured shape from the **flight image first + the underside view**
   (multi-image-to-3d). Flight image first makes the orientation predictable (head -Y, back +Z,
   like single-image models); the underside view stops Meshy from inventing legs. Do not add top or
   side views: views that disagree on the eye position give a bird with two eyes per side.
6. **`texture`** (10): colours from the same two images (retexture of the shape).
7. **`orient`** (free, required): Meshy's orientation is not predictable (flight image first
   usually gives head -Y, back +Z, but not always). `orient` measures it and `rig` uses it. With a
   colour margin < 1.5× look at `orient_*.png`; in any case confirm in the review that the bird
   flies away from the camera in the bird-view row.
8. **`rig`**: flapping (20 000 faces, skeleton, wing beat, steady head) and static (100 000
   faces). Read every printed line (`CHECK WARNING` → stop). Then **look at all three sheets**:
   - `preview.png`, rows: bird view (tail nearest, flying away), **head-on** (the whole wing hinges
     at the shoulder, nothing else moves; the rig prints the wings' rest angle), side (belly
     steady, no legs, the downstroke does not cover the belly), below (clean belly);
   - `head.png`: **exactly one eye per side**, crown and face as in the flight image, bill intact;
   - `closeup.png`: no cracks, stumps or smears;
   - the **downstroke** (wings at their lowest) from the side and front-below: the flank under the
     wing root stays closed (no notch, dent or hole).
   `review.png` combines preview and head: open it at full size and check every row before
   showing the bird; in the side row also check the belly stays still (only wings move).
   `rig` measures it too (`tools/deform.py`): `CHECK body steady (x)` must be below 0.005
   half-span; `CHECK WARNING body moves` → stop and fix the rig. **Any change to the rig** (an
   option, a new correction) means re-running `rig` and reading this line and the side row
   again before showing the bird: the levelling added for one bird broke its belly.
   **Per-species rig options** go in `prompts/species_notes.csv`, column `rig_args`, never in a
   new default. Before changing a default for all birds, render the old and new rig side by side
   on two or three birds and show them.
9. **`options`** (free, ~10 min in the background): `make_bird.py options "Genus species"` builds
   every belly x wing-beat combination (B0 as generated, B1-B3 10/20/30% slimmer; W0 as
   generated, W1 half levelled, W2 levelled, W3 half levelled with a smaller beat; Bc/Wc the
   previous choice) in `work/<sp>/options/`. The user picks in the **picker**,
   `http://localhost:8091/tools/picker.html#Genus_species` (◀ ▶ per setting, speed, side /
   head-on / behind / below views; keys ← → ↑ ↓). **The user picks** (e.g. "B0 W1"), never me:
   body shape is a matter of taste per species (the kingfisher is pot-bellied; slimming it
   looked wrong). Save with `make_bird.py choose "Genus species" B0 W1`, then `rig` and `publish`.
10. **`publish`**: copies flapping, static, flight image and poster, rebuilds `models.json`. Set
   `status.csv`: status done, method, credits (`make_bird.py credits`), quality `pending`
   (only the user sets good / ok / rerun). Open the local gallery
   (`http://localhost:8090/?internal#Genus_species`: `?internal` shows status, notes, missing and planned species; without it the page is the public gallery, which must stay free of internal terms such as tier, method or version) for the user's check. Posters are rendered by `tools/render_poster.py` (field-guide three-quarter view, auto-framed).
11. **Quality gate**: `site` writes `models.json` (what the Explorer loads) with only the birds
   the user marked **good** or **ok**; `gallery.json` (the gallery) has every bird with its badge.
   Pending and rerun birds never reach the Explorer; it shows the generic bird for them.
12. **Release** (only when the user asks): commit, tag `vX.Y.Z`, `gh release create`, push; then
   bump `BIRD_MODELS_BASE` in GeoLocatorExplorer `src/pages/Tag.vue` and check the bird view.

## What costs credits
Paid (Meshy): `image` 9, `views` 9, `model` 20, `texture` 10, and any redo of them. Free (local
Blender, from `raw/`): `orient`, `rig`, `publish`, gallery; i.e. wing beat, belly, head motion,
joints, levelling, centring, size, proportions, file size. A rig defect is fixed once and all
birds are rebuilt for free; pay only when the shape or texture itself is wrong (legs fused or
painted, two eyes, wrong pattern): redo `views` + `model` + `texture` (39) with the same flight image.

## Rules
- Report credits (`meshy balance`) before and after; ask before spending beyond the user's plan.
- A defect the user reports is fixed in the tools for every bird (rig defects: rebuild all with
  `rig` + `publish`, no credits) and added to the problem table in `LESSONS.md`.
- Files are standard glTF: back +Y, head +Z, origin at the centre of the body.
- Credit the stickers: CC BY 4.0, huashu-bird-sticker (Huashu).
- The free Meshy plan cannot create tasks through the API (Pro needed). Retexture and
  multi-image tasks made in the Meshy web app are not visible to the API.
