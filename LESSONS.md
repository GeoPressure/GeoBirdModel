# Lessons learned

What works, what doesn't, and why the defaults are what they are. The procedure itself is in the
`bird-3d-model` skill (`.claude/skills/bird-3d-model/SKILL.md`); this file is the reasoning
behind it. Keep it current: every surprise, test or changed default gets a dated line in the
right section (not appended at the end). Costs are Meshy credits.

## Current method (v4 + GPT Image 2.5, since 2026-11-20)

| Step | Command | Setting | Credits |
|---|---|---|---|
| Flight image | `image` | image-to-image, `gpt-image-2-5-sunburst`, sticker as reference, `prompts/flight.txt` + notes `flight_features` | 12 |
| Underside view | `views` | image-to-image from the flight image + sticker, prompt quotes the notes' `underside` text, no feet | 12 |
| Shape | `model` | multi-image-to-3d, flight image **first** + underside view, untextured | 20 |
| Colours | `texture` | retexture of the shape from the same two images, 2k, no PBR | 10 |
| Orientation | `orient` | head from geometry, back from colours vs the flight image | 0 |
| Rig | `rig` | levelled, centred, 20 000 faces, skeleton, wing beat, head rigid with the body; static 100 000 faces | 0 |
| Picker options | `options` | belly x wing-beat variants; the user picks, `choose` saves `rig_args` | 0 |
| Publish | `publish`, `site` | `models/`, `static/`, `images/`, `posters/`, `gallery.json`; `models.json` only good/ok | 0 |

**54 credits per bird** when every step works the first time. A new shape alone (model +
texture) is 30; underside view + shape 42. Batch of 2026-11-20 (1 600 credits): 13 remakes and
15 new species, i.e. ~57 per bird with redos.

Why this route:
- **Flight image + underside only.** Extra views (top, side, three-quarter) disagree on the eye
  position and give two eyes per side (Robin-Chat, v3). The underside view is what stops Meshy
  inventing a leg-filled belly.
- **Flight image first.** Meshy takes the first image as the front; the shape usually comes out
  head -Y, back +Z, like single-image models. "Usually": `orient` is still required.
- **Shape and colours separately.** The retexture uses the sharp 1024 px images directly, so the
  head pattern survives (it did not in textured multi-view models, v2).
- **GPT Image 2.5** (Rosefinch, Jack Snipe, Song Thrush first, then all of the 2026-11-20 batch):
  sharper plumage than nano-banana-pro and far fewer feet in the underside view.

## Defects and their fix

Grouped by the step that causes them. "Free" = re-rig from `raw/`; paid fixes name the steps.

### Notes and flight image

| Defect | Cause | Fix |
|---|---|---|
| Wrong plumage (White-chested Alethe: olive back instead of rufous) | Notes written from memory; the image follows the notes | Notes describe the **sticker**: look at it first |
| Spiky crown tufts that survive a new shape (Great Reed Warbler, user 2026-11-20) | The sticker's raised crest is drawn in the flight image | Notes "smooth sleek rounded crown, head feathers lying flat (no raised crest, no spiky tufts)"; new image + view + shape |
| Tail bent sideways (Siberian Rubythroat, 2026-11-20) | Twisted body in the flight image | New image (and shape) |
| Two eyes per side from a bold eyebrow / eye-stripe (Sedge Warbler, user 2026-11-20) | Pale eyebrow + dark stripe read as a second eye | Notes "a single dark eye on each side sitting in the eye stripe (no other dark spots on the face)"; check the eye in the flight image before paying for the shape |
| Owl head wrong twice (Eurasian Scops Owl, user: "head not correct at all", 2026-11-20) | The standard view from above and behind hides an owl's face, so Meshy guessed the head (face up, horn tufts) | Flight image "three-quarter view from above and from the side, slightly in front, face visible, head straight forward in line with the body" + notes describing the round facial disc and forward eyes; underside from the flight image only. Third version: correct round face, two forward eyes, hooked bill |
| Face bars read as a second eye (Spotted Ground Thrush, user 2026-11-20) | Round black blobs on the white face | Notes "a single large dark eye; the black face marks are thin vertical bars, stripes, not round spots": the new image drew curved stripes and the model has one clear eye per side |

### Underside view

| Defect | Cause | Fix |
|---|---|---|
| View drawn as the back (Swainson's, Barred Warbler; 2026-11-20) | The prompt had only the flight image (the back) and "keep the same plumage" | Prompt quotes the notes' `underside` ("NOT the colour of the back") and adds the sticker. Check the view's colours against the notes |
| Tucked feet at the vent (Reed Bunting, Yellow Wagtail; Song Thrush 3x with nano-banana) | The sticker (2nd reference) shows long legs | `views --nosticker` (notes text only); GPT Image 2.5 rarely does it |
| Owl's face drawn looking at the viewer (Eurasian Scops Owl) | Same, from the sticker's facial disc; the shape then put the face on the underside | Underside notes "head points straight ahead, from below only chin and throat show" + `--nosticker` |
| Dark vignette instead of a white background (8 of ~30 GPT Image 2.5 views, 2026-11-20) | The model darkens the background around pale bellies; "(#FFFFFF), no vignette, no gradient" in the prompt helps only partly | **Harmless**: all eight shapes and textures were clean. Never redo a view for the background alone; never edit a view by hand |

### Shape (Meshy)

| Defect | Cause | Fix |
|---|---|---|
| Legs (about half of the v4 shapes) | Meshy adds them even with a clean underside | Free: `--legs=delete` in `rig_args` (removes them cleanly, openings <= 0.08 half-span) |
| `--legs=delete` cuts the undertail (Tree Pipit, Savi's Warbler, Horned Lark) or a long tail (Long-tailed Nightjar) | The thickness search takes thin tail feathers for legs (`CHECK WARNING legs: large region`) | Leg-free shape: `--legs=keep` (the default). Legs **and** a long tail: no free fix (`--legs=fold` is the same code path as delete); new shape (30) |
| Head turned, eye on the crown (Thrush Nightingale); two eyes per side (Eastern Olivaceous Warbler, Sedge Warbler v4) | The flight image's three-quarter head pose ends up in the shape | New shape (30) from the same images usually fixes it; if the eye problem is in the image, new image first |
| Flat blade-like bill (Tawny Pipit), crown spikes (Great Reed Warbler) | Meshy detail; `--smoothhead=N` barely moves thin spikes | New shape (30); crown spikes from the image need a new image (above) |
| Body moves with the wing beat that `--shoulder` does not fix (Rubythroat v2: 0.018, body half-width 0.23-0.32 at the rear) | Shape with very wide rear body/wing roots | New shape (30); the next one passed (0.0000) |
| Banked shape, one wing up (Barred Warbler) | Meshy reproduced a rolled pose | Free: the rig rolls the wings level (prints `rolled wings level by N deg`) |
| Leg lumps painted into the texture (old single-image models) | Shading baked in the texture | Paid redo; `--smoothvent` barely helps. Dark painted spots: `--cleanbelly=1` (free) |

### Orientation

| Defect | Cause | Fix |
|---|---|---|
| Bird flies backwards or upside down in the review (Barred Warbler, Mangrove Kingfisher 3.1x margin) | `orient.py` guesses the head from the geometry (round end); a colour margin < 1.5x is a weak back/belly guess | Append a manual entry to `work/<sp>/log.jsonl`, e.g. `{"step": "orient", "forward": "-Y", "up": "+Z", "manual": true}`, and re-rig. Look at `orient_*.png` to read the axes. Check the bird-view row of **every** bird |

### Rig and animation (all free)

| Defect (user reports first) | Cause | Fix now in `rig_flap.py` |
|---|---|---|
| Head looked split mid-way, long bills bent (2026-11-20; snipe, hoopoe worst) | The stabilised head counter-moved from a neck joint inside the head on long-billed birds | Head rigid with the body by default; `--head=stable` for the old behaviour |
| "Head movements not natural" on many birds (user, 2026-11-20, after the head fix) | 32 published birds were rigged before the default changed and still had the stabilised head (head bone counter-rotating 1.5 deg) | Re-rigged and republished all 32 (free). Check any GLB's head bone animation: it should not rotate relative to the body |
| Hole in the flank on the downstroke, almost every bird (2026-11-20) | Belly fixes narrowed the wing/body blend and pinned the skin by height | Wide blend (0.2 half-span) starting at each slice's body edge, hinge in its middle. When a fix for one part changes another, compare with the version the user liked |
| Belly and breast moved with the beat (Swainson's, Myrtle Warbler, Nightjar, Kingfisher; 2026-11-19) | Shoulder too close to the body centre; neck joint too far back | Shoulder measured per bird (thick part of the cross-section); belly stays with the body out to 1.15x the body half-width; `deform.py` runs in every `rig` (`CHECK body steady` < 0.005 half-span) |
| Wings beating around a raised V (Mangrove Kingfisher) | Meshy built the wings raised 33-35 deg | Not a global fix: automatic levelling swept the downstroke over the belly ("very bad"). Per species via the picker (W1-W3) or `rig_args` (`--bias`, `--amp`, `--levelwings=1`) |
| Belly too slim or too round (Kingfisher: -31% "too small", -13% still wrong, the user chose as generated) | Body shape is taste, per species | `options` + picker; the user picks, `choose` saves it. Never guess belly settings one at a time |
| Cracks and specks up close | Meshy duplicates vertices on UV seams; decimation opened them | Weld seams before decimating; 20 000 faces |
| Orbiting the gallery model was awkward | v1 files used the map's axes | Standard glTF axes (back +Y, head +Z), origin at the body centre (v2.0.0, breaking) |

General rule: a defect for one bird goes in that species' `rig_args`; a default changes only
after a side-by-side render of old and new on two or three birds.

### Meshy API and running batches

| Problem | Fix |
|---|---|
| Texture paid twice (Meadow Pipit, 10 credits): the wait failed after the submit and a piped chain hid the error | Every paid task is logged `pending` on submit; `model` and `texture` resume it unless `--new`. Use `set -o pipefail`; never pipe a paid step |
| 429 "NoMorePendingTasks" with more than ~10 tasks pending (not charged) | Keep paid steps to ~8 at once; rerun the refused ones |
| 401 "Invalid access token" mid-batch (transient: `meshy auth status` verified a minute later) | Run `texture` / `model` again **without** `--new`: it resumes the logged task |
| Blender exits 0 when a script fails (a crash left the old GLB in place) | `make_bird.py rig` stops on a Traceback |
| Free plan cannot create tasks through the API (HTTP 402) | Pro plan. Agent credits (Meshy web Agent chat) do work: its tasks show in the API lists (`image-to-image list`, `multi-image-to-3d list`, `retexture list`) and download with the CLI; log the step by hand in `log.jsonl` |
| Making a step with Agent credits (2026-11-20: Spotted Ground Thrush and Scops Owl remakes, 54 Agent credits each) | The Agent is the **Agent Mode** box on meshy.ai (`/agent` alone is a 404). Attach images through the page's hidden file input, wait until they finish uploading, then click in the text box and type (text typed during an upload is lost). One exact step per message with the exact prompt; check the card (model, references, cost; Multi-View to 3D with Generate Texture off is 20) and click **Approve** only. Agent tasks appear first in `meshy <resource> list` with `consumed_credits` 0: download with `meshy download`, log by hand in `log.jsonl` (route, agent_credits), then `orient`, `rig`, `publish` as usual. The texture card's default PBR texture model is fine (the rig drops PBR maps) |
| Agent limits (2026-11-20) | The Agent cannot use an API model by task id, and its file input takes images only (no GLB), so an existing API shape cannot be retextured there: make a new shape + texture (30). For Multi-View Texture, name the default texture model or it may ask which texture model and view tags to use. Agent-made shapes still need `orient` checked (Pygmy Kingfisher flew backwards) and sometimes `--legs=delete` |

## History (why not the older routes)

- **v1, single image (2026-11-19):** sticker → flight image (nano-banana-pro) → textured
  image-to-3d (30) → Blender leg removal. Meshy invented legs and painted stumps on the belly;
  every geometric removal (slices, thickness, smoothing) left stumps, lumps or holes on some
  species. Some v1/v2 models were later remade.
- **v2, textured multi-view (2026-11-19):** Meshy's own multi-view generator gave small,
  inconsistent views (head ~50 px) and lost the head pattern.
- **v3, three separate views + retexture (Red-capped Robin-Chat, 102 credits):** no legs, but
  two eyes per side from views that disagree.
- **v4, flight image + underside (2026-11-19):** one eye, no legs (mostly), predictable
  orientation, 48 credits with nano-banana-pro; GPT Image 2.5 since 2026-11-20 (54).

Tests kept for reference: a real flight photo as a 2nd image reference (Northern Wheatear)
changed the pose, not the plumage; `smart-topology` low-poly (15 credits, 8000 triangles) looked
the same at map scale but flatter up close: not used.

## Meshy facts

- Raw models: 0.8–1.3 M faces, 2k base colour + metallic-roughness + normal maps, 13–50 MB.
- Asking for a view "from above and slightly behind" (what the bird-view camera sees) gives a
  shape pitched head-up by that angle; the rig levels it.
- Meshy invents what the images don't show; describe the underside in the notes.

## Blender and three.js

- Drop Meshy's metallic-roughness texture *and* unlink its inputs: a dangling Separate Color node
  makes the exporter write `metallicFactor 1`, and the bird renders almost black without an
  environment map.
- Blender exports WebP directly (`export_image_format="WEBP"`): 4.7 → 1.9 MB per bird. Threebox's
  GLTFLoader reads `EXT_texture_webp` and `KHR_mesh_quantization` without setup; Draco and
  Meshopt would need a decoder (not used).
- Level the body before any slice-based measurement; compare slices with the bird's own widest
  body slice, never a fixed width (slim birds such as wheatear and hoopoe).
- Skinned meshes with an armature animate fine through Threebox `loadObj` and an `AnimationMixer`.
