# Lessons learned

Newest first within each section. Costs are Meshy credits (Pro: 1000 credits/month for €19).

## Current default method (2026-11-19, v3: views for the shape, flight image for the colours)

v3 replaces the textured multi-view model of v2 by an untextured shape (20) + retexture from the
flight image and views (10); see the skill for the procedure. The v2 table below is kept for context.

### v2

| Step | Command | Setting | Credits |
|---|---|---|---|
| In-flight image | `make_bird.py image` | image-to-image, `nano-banana-pro`, sticker as reference, `prompts/flight.txt` | 9 |
| Views | `make_bird.py views` | image-to-image `--generate-multi-view` from the flight image: front, underside, top of the same bird, legs hidden | 9 |
| 3D model | `make_bird.py model` | multi-image-to-3d from the views, textured 2k, `--enable-pbr false`, underside as `--texture-prompt` | 30 |
| Rig | `make_bird.py rig` | levelled, centred on the body, no leg removal needed; flapping (20 000 faces) + static (100 000 faces), WebP | 0 |
| Publish | `make_bird.py publish` | `models/`, `static/`, `images/`, `posters/`, `models.json` | 0 |

About **48 credits per species**. Files are standard glTF: **back +Y, head +Z, origin at the
centre of the body** (any viewer orbits around the bird); the Explorer turns them on load.

**Why multi-view (the global leg fix):** from a single top-down flight image, Meshy has to guess
the underside and adds legs (and paints leg stumps into the belly texture). Every attempt to cut
the legs off afterwards (slices, thickness, smoothing, retexture of a cleaned mesh) left stumps,
lumps or holes on some species. With a view of the underside showing no legs, Meshy makes none:
Red-backed Shrike, the worst case, came out with a clean belly and no geometry surgery.

Known: some heads point slightly down after levelling (Barred Warbler most); acceptable for now.

## Tests

| Test | Species | Result | Decision |
|---|---|---|---|
| A. Baseline from the CLI | Great Reed Warbler | Good image and model on the first try; underside correct with the texture prompt; Meshy still added legs | Default pipeline |
| B. + real flight photo as 2nd reference | Northern Wheatear (photo: Stephan Sprinz, Commons, CC BY 4.0) | Sticker-only image already had the white rump and black tail T; the photo changed the pose, not the plumage | Not worth it for well-known species; try only for rarely photographed ones (e.g. White-chested Alethe) |
| C. Multi-view image → multi-image-to-3d | (only if undersides stay wrong; the texture prompt fixed it so far) | | |
| D. `smart-topology` low-poly (Meshy t2, 8000 triangles) from the same image as A | Northern Wheatear | 15 credits instead of 30, 37 s, 3 MB raw instead of 13 MB, clean underside; feathers painted on a smooth wing instead of modelled: the same at map scale, flatter up close | Kept as an option; the user chose quality (standard) |

`make_bird.py image --ref photo.jpg` adds the photo; `model --from IMAGE_TASK_ID` builds from a
chosen image when several were made.

## Problems the user found, and the fix (2026-11-19, single-image pipeline v1)

| Problem | Cause | Fix in `rig_flap.py` |
|---|---|---|
| Hoopoe bill turned into a black wedge | The long down-curved bill reached below the belly line and was dragged in with the legs | Leg search limited to the body: never the head (front 60% of the head side) or the tail |
| Wheatear belly too big | Meshy built a plump, perched-looking body | Body depth/length measured in the middle third; above 0.28 the lower body is squeezed (wheatear 0.31 → -10%; ring ouzel 0.27, reed warbler 0.26, hoopoe 0.19 untouched) |
| Strange cracks and specks up close (reed warbler) | Meshy duplicates vertices along UV seams; decimation moved each side on its own and opened cracks | Weld seam vertices before decimating; 20 000 faces instead of 8000; 2048 px texture + normal map |
| Legs still visible (stick, toe marks) | Pushing legs into the body leaves stubs; splayed toes were the widest slice so the belly line was not found | Belly line found from the widest slice of the *upper* lower body; legs below it are deleted, loose bits dropped, each opening closed by merging its rim (the surrounding texture stretches over it) |
| Batch of 12: belly cut away (star-shaped smear underneath) on 3 birds, legs missed on 4 | Any "belly line" from horizontal slices fails on some body shape: gradually tapering bellies, feet tucked high, thin legs that keep few vertices after decimation | **Legs found by thickness** on the dense mesh, before decimation: a ray from each lower-body vertex inward to the opposite surface; < 0.05 half-span = leg or toe. Search window: under the body (|x| < 0.22 half-span, z < 0), behind the neck and *in front of the undertail coverts* (thin feather sheets, 0.45 of the tail length) |
| Barred Warbler model came out banked (one wing up, one down) | Meshy reproduced a rolled pose | Roll correction: main axis of the far wing vertices levelled about the body axis (39° here) |

| Gallery: hard to orbit around the bird | Models were exported in the Explorer's Z-up map axes (head up, back facing the camera), so a glTF viewer turned the bird about its own length; origin at the bounding-box centre | Standard glTF axes (back +Y, head +Z) via a 180 deg parent node written into the file (Blender ignores the armature's own rotation for skinned meshes); origin at the body centre; Explorer rotates on load |
| Belly moved with the wing beat (Swainson's, Myrtle Warbler) | Fixed shoulder at 0.18 of the half-span: on wide-bodied birds the flanks and belly fell inside the wing's influence | Shoulder measured on each bird (body half-width below the wing roots); vertices below the wing-root plane and inside the body width stay with the body, with a soft blend so the wing roots don't tear |
| Nightjar belly and breast moved with the beat (after the Robin-Chat fix) | 1. the wing blend was centred on the shoulder (±0.10 half-span) and reached the centre line of slim birds; 2. the neck joint at 45% of the way to the bill made the breast stretch while the head is held still | Wing influence starts at 0.85 × the shoulder distance; neck joint at 70% with a short blend. Measured with `tools/deform.py`: breast deformation 0.023 → 0.003 half-span |
| Mangrove Kingfisher beat stayed above the body | Meshy built the wings raised in a 35 deg V; the beat swung around that pose | Tried automatic levelling for all birds: it made the downstroke sweep below and over the belly (user: "very bad", 2026-11-19). Levelling is now opt-in per species (`--levelwings=1` in `rig_args`); default beats around Meshy's pose, which looked best |
| Mangrove Kingfisher belly horrible in flight (user, 2026-11-19) | (1) levelling by beating around a -35 deg shoulder bias swung the wing roots through the breast (0.065 half-span); baked, a shoulder bend over ~10 deg still did. (2) Below the wing roots the belly sides went to the wing from 0.75x the body half-width out, so a wide, deep body's lower flanks swung with every beat (0.05-0.07). (3) I re-measured only before adding the levelling, and `deform.py` used the posed span (numbers ~1.4x too small) | Levelling opt-in (split shoulder/elbow when used); belly stays with the body out to 1.15x the body half-width measured per slice along the body; `deform.py` uses the rig's span and prints BODY; `make_bird.py rig` runs it every time and prints CHECK WARNING above 0.005. All birds rebuilt |
| Flight image first did not fix the orientation | Mangrove Kingfisher shape came head +Z, back +Y | `orient` is required for every model; its result drives `rig` |
| Nightjar proportions felt off | Meshy's wings slightly short for the body: length/wingspan 0.53 vs 0.44–0.52 real | Free to fix in Blender (stretch wings); AVONET wing/tail lengths are in huashu `species.json` (`traits`) for a future automatic check |
| Swainson's head pattern lost, body too full (multi-view) | Meshy's multi-view images are small (bird 380–500 px, head ~50 px) and not exactly consistent with each other; a hand-rescaled view adds mismatch | Planned: take the shape from the views but the colours from the 1024 px flight image (retexture, 10 credits); never rescale views by hand |
| Legs still wrong on 7 species after the thickness fix | Removing geometry after the fact is fragile (leg roots are thick, textures already painted) | Multi-view generation (above); leg removal kept only for single-image models |

## First v3 bird: Red-capped Robin-Chat (2026-11-19, 102 credits instead of 48)

- Meshy's combined multi-view generator failed twice: tucked feet on the belly, wings in a
  different pose in each view, two top views and no side view. Replaced by three separate 1024 px
  image-to-image calls (top, underside, side) from the flight image: sharp, fixed order, and a bad
  view can be redone alone. The underside still showed tucked claws once; a more explicit prompt
  ("one continuous area of smooth feathers, no dark marks") fixed it.
- The untextured shape from three views had no legs at all; retexture from the flight image gave
  a sharp head and plumage.
- Multi-image orientation is not stable even with the top view first (Swainson's: head -Y;
  Robin-Chat: head +Y, 44 deg pitch). `orient` reads it from the model: colour of each side vs the
  flight image (clear for the Robin-Chat, 4.4×; fails for birds dark on both sides, Ring Ouzel)
  and head from the geometry (wrong for the Robin-Chat). Next test: put the flight image first in
  the multi-image inputs, since single-image models always came out head -Y, back +Z (14/14).

## v4: flight image + underside only (2026-11-19, Robin-Chat after the user's check)

The user found two problems the v3 Robin-Chat previews didn't show clearly: **two eyes per side**
and a **broken wing beat**.
- Two eyes: the shape from three generated views (top, underside, three-quarter) had two eye
  sockets, because each view put the eye in a slightly different place; retexturing from the
  flight image alone still showed the second bump. Building the shape from the flight image +
  the underside view only gave one clean eye, the predictable orientation of single-image models
  (head -Y, back +Z; orient agreed, colour margin 6.6×), no legs, and costs 48 credits.
- Wing beat: the body half-width was measured as "everything below the wing roots", which
  counted drooping wings as body (0.79 of the half-span); the shoulder went to its limit and the
  belly rule held most of the wing. Now measured as the thick part of the cross-section in the
  middle of the bird (0.10–0.18 on all birds).
- Checks added so this can't slip again: `head.png` (both sides, one eye each) and a head-on row
  in `preview.png` (wing hinge), produced by every `rig`.

## Species notes

- The notes must match the **sticker**, not a field guide from memory: the White-chested Alethe
  notes said "olive-brown back", the sticker has a rufous back and tail, and the flight image
  followed the notes. Check notes against the sticker before the image step (9 credits lost).
- Review all flight images of a batch on one sheet (`tools/sheet.sh images ...`) before any
  3D step; 1 of 12 needed a redo.

## Meshy

- **The free plan cannot create tasks through the API** (HTTP 402 "Task creation on the free
  plan is no longer supported"), but the web app can, and downloads are Pro only. Free-plan
  models are public and CC BY 4.0.
- On the web, clicking "Image to 3D" on an image starts the job at once with the panel's current
  settings (it does not open a form). Texture is then a separate 10-credit step.
- The CLI does both in one `image-to-3d` call (`--should-texture true`, 30 credits).
- `nano-banana-pro` keeps the sticker's plumage and style and follows the pose instructions; one
  reference was enough for ring ouzel, hoopoe, great reed warbler and wheatear, including flight
  patterns the perched sticker hides.
- Ask for a view "from above and slightly behind": that is what the bird-view camera sees.
  The 3D model then comes out pitched (head up) by the same angle; `rig_flap.py` levels it.
- Meshy invents the parts the image doesn't show. The ring ouzel's white bib became a white
  belly; a `--texture-prompt` describing the underside fixed this for the reed warbler.
- Meshy adds legs even when the image shows none ("legs tucked" in the prompt doesn't stop it),
  so `rig_flap.py` removes them.
- Raw models: 0.8–1.3 M faces, 2k base colour + metallic-roughness + normal maps, 13–50 MB.

## Blender / three.js (Threebox)

- Drop Meshy's metallic-roughness texture *and* unlink the inputs: a dangling Separate Color
  node makes the exporter write `metallicFactor 1`, and with no environment map the bird renders
  almost black in the map.
- Threebox's GLTFLoader reads `EXT_texture_webp` and `KHR_mesh_quantization` without extra
  setup; Draco and Meshopt need a decoder configured (not done). Blender exports WebP directly
  (`export_image_format="WEBP"`): 4.7 MB → 1.9 MB for the same bird.
- Level the body first (principal axis of the body in the y-z plane): otherwise leg detection
  by horizontal slices lands in the wrong place on pitched models.
- Slim birds (wheatear, hoopoe) have narrow bodies for their wingspan: compare slices with the
  bird's own widest body slice, never a fixed width.
- Head: birds keep the head still in flight while the body bobs, so the rig bobs and pitches the
  body with the beat and a head bone cancels it (`--head=stable`).
- Skinned meshes with an armature load and animate fine through Threebox `loadObj` and the
  page's `AnimationMixer`.
| One rig for all species | Species differ (raised wings, wide bodies, gliders); a global auto-fix for one bird broke others | `prompts/species_notes.csv` column `rig_args` holds per-species rig options (e.g. `--amp=22 --levelwings=1`); defaults stay conservative; compare variants side by side before changing a default |
| Mangrove Kingfisher a round sack from behind and head-on, wings folding into a vertical V (user, 2026-11-19) | Meshy's shape (also as generated): deep, round belly; the depth check divides by the full length *with bill and tail*, so a long-billed bird passed (0.22 < 0.30). Wings raised 33 deg, so the upstroke reached ~65 deg | Per-species `rig_args` `--belly=0.19 --bias=-15 --amp=28`: belly -13% (-31% was too thin for the user: a kingfisher is a bit pot-bellied), beat centred at +18 deg. Look at every new bird from behind and head-on too, not only the review rows. Idea: measure depth against the body without bill and tail |
| Kingfisher belly: 31% slimmer "too small", 13% still not right; the user chose as generated (2026-11-20) | Body shape is a matter of taste and species; I guessed settings one at a time | `make_bird.py options` builds every belly x wing-beat combination; the user picks in `tools/picker.html` (the static sheet was "quite hard" to read: animated 3D with ◀ ▶ per setting and a speed control); `choose` saves them in `rig_args`. Part of every new bird |
| Meadow Pipit texture paid twice (10 credits lost, 2026-11-20) | The retexture task was submitted, then waiting/downloading failed; my `&&` chain piped through `sed`, so the error didn't stop it and the next step crashed. The task id was not logged | Every paid task is logged as `pending` on submit; `model` and `texture` resume an unfinished one (`--new` to pay for a new one). Never pipe a paid step's output in a chain without `set -o pipefail` |
| Free fixes for rerun birds (2026-11-20) | Painted dark spots: `--cleanbelly=1` repaints them with the surrounding colour (Alethe, Northern Wheatear: gone). Leg lumps of old single-image models: `--smoothvent=N` barely helps, the lumps are mostly shading painted in the texture | Lumps need the paid redo (views + model + texture, 39). Blender exits 0 when a script fails: `make_bird.py rig` now stops on a Traceback (a crash had left the old GLB in place) |
| Hole in the flank on the downstroke, almost every bird (user, 2026-11-20): "it used to be good on the first run" | My belly fixes narrowed the wing/body blend to ~0.1 half-span and pinned the skin below the wing root by height; on the downstroke the skin above the cut beat and tore the flank open | Back to the first rig's wide blend (0.2 half-span) but starting at each slice's body edge, no height cut; hinge in the middle of the blend. Checked on the nightingale and pipit (downstroke side and front-below): notch gone, body steady. When a fix for one part (belly) changes another (wing joint), compare against the version the user liked before |
| Swainson's Warbler underside view came out as a top view (2026-11-20, 9 credits) | The `views` underside prompt returned the back (olive, rufous crown) for a bird whose flight image shows mostly the back | Always check the view's colours against the notes' underside text before `model`/`texture`. A shape with good legs can be retextured (10 credits) instead of a full rerun (39), reusing an older underside view if needed |
| Underside view drawn as the back again (Barred Warbler, after Swainson's; 18 credits lost, 2026-11-20) | The `views` prompt said "keep exactly the same plumage" with only the flight image (the back) as reference, and never passed the notes' underside text | The underside prompt now quotes the `underside` notes ("NOT the colour of the back") and adds the sticker (breast and belly) as a second reference. Check the view before paying for the shape |
| Barred Warbler orient: head guessed backwards (2026-11-20) | `orient.py` takes the round end of the body as the head; this shape's tail end was rounder. The back (colours) was right (6.5x) | Always confirm in the review that the bird flies away from the camera and the head close-ups show a head; if not, log a manual orient entry (`forward=-Y`) and re-rig (free) |
| v4 models with legs again: 5 of 10 in the 2026-11-20 batch (Sedge Warbler, Japanese Nightjar, Redwing, Bluethroat, Yellow Wagtail), with clean underside views | Meshy still adds legs sometimes from flight image + underside; `rig` passes `--legs=keep` for every views model | Per-species `rig_args` `--legs=delete` removed them cleanly on all five (span 0.48-0.55, openings <= 0.08). Yellow Wagtail kept a small dark painted triangle at the vent even with `--cleanbelly=1`. Idea: make `--legs=delete` the default for v4 models after a side-by-side check on the leg-free ones |
| Reed Bunting underside view drew tucked feet at the vent (2026-11-20, 9 credits) | The sticker (2nd reference) shows legs | Second try was clean; Yellow Wagtail needed a redo for the same reason |
