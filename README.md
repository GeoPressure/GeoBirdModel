# GeoBirdModel

Flapping 3D models of the bird species tracked with multi-sensor geolocators, made for the bird
view of [GeoLocator Explorer](https://geopressure.org/GeoLocatorExplorer/).

**Gallery:** <https://geopressure.org/GeoBirdModel/> — see each bird fly, turn it around, download it.

| | |
|---|---|
| `models/<Genus_species>.glb` | glTF binary, ~2 MB: 20 000 triangles, 2048 px base colour + 1024 px normal map (WebP), skeleton, one looping animation `Fly` (1 s) |
| `posters/<Genus_species>.webp` | Still image of the model (transparent background) |
| `models.json` | Birds approved for GeoLocator Explorer (quality good or ok): names, files, size, source sticker, licence |
| `gallery.json` | Every species, with its status (used by the gallery) |

Orientation (v2.0.0 and later): standard glTF axes, back +Y, head +Z, origin at the centre of the body; wingspan about 0.5 units. v1.0.0 used head +Y, back +Z.


## Using the models in an application

Load the index and the resolver from jsDelivr, pinned to the **major** version only, so new birds
and better matching arrive with every GeoBirdModel release, while a breaking change (a new major,
e.g. `@3`) is adopted on purpose:

```js
const BASE = "https://cdn.jsdelivr.net/gh/GeoPressure/GeoBirdModel@2/";
const bm = await import(/* @vite-ignore */ BASE + "client/bird-models.js");
const index = await bm.loadIndex(BASE);              // null on any failure -> use your own generic bird
const m = bm.resolve(index, "Turdus philomelos");     // { url, match, bird, attribution, animation, quaternion }
if (m.url) { /* load m.url (glTF), play m.animation ("Fly"), turn it by m.quaternion */ }
```

- **Is a species there?** `bm.has(index, name)`: true only for the species itself or a synonym.
- **Fallback:** `resolve` tries the species, a synonym (e.g. *Schoeniclus schoeniclus* for
  *Emberiza schoeniclus*), the same genus, then the same family (from the index's taxonomy, or
  `{ family }` passed in), preferring good over ok models; `match` says which. With `minMatch:
  "species"` it never substitutes a relative. `url: null` means: use your own generic bird.
- **Axes:** files use standard glTF axes (back +Y, head +Z, origin at the body centre, wingspan
  about 0.5). `resolve(…, { frame: "map-y-forward" })` returns the quaternion for head +Y, back +Z
  (Threebox/Mapbox, Z up); apply it to a group holding the model's content.
- **Credit:** show `m.attribution` (CC BY 4.0) while a model is on screen; for a relative, say so.
- **Index (`models.json`, schema `bird-models/2`):** `birds` (released models: name, file, genus,
  family, order, synonyms, quality, size), `taxonomy` (tracked or planned species without a model),
  `axes`, `animation`, `fallback_order`. Fields may be added within a major version, never removed
  or renamed.
- **Updates:** jsDelivr resolves `@2` to the newest 2.x tag within about 12 hours (browsers may
  cache up to 7 days). Local testing: point your base at a local server of this repo.

## Use

Files are served by the jsDelivr CDN (CORS enabled). Pin a release for stable URLs:

```
https://cdn.jsdelivr.net/gh/GeoPressure/GeoBirdModel@v2.0.0/models/Upupa_epops.glb
```

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js"></script>
<model-viewer src="https://cdn.jsdelivr.net/gh/GeoPressure/GeoBirdModel@v2.0.0/models/Upupa_epops.glb"
  animation-name="Fly" autoplay camera-controls></model-viewer>
```

In three.js: load with `GLTFLoader` (supports `EXT_texture_webp`) and play `gltf.animations[0]`
with an `AnimationMixer`.

## How they are made

Sticker illustration ([huashu-bird-sticker](https://github.com/alchaincyf/huashu-bird-sticker))
→ in-flight image and an underside view (Meshy image-to-image, GPT Image 2.5) → untextured 3D
shape from both images (Meshy multi-image-to-3d) → colours from the same images (Meshy retexture)
→ Blender: levelled, centred, legs removed where needed, reduced, skeleton and wing beat. Each
model is checked by eye (one eye per side, no legs, steady body) before it is published, and only
models rated good or ok go to GeoLocator Explorer. Scripts and method: [METHOD.md](METHOD.md);
lessons learned: [LESSONS.md](LESSONS.md). The full-quality static models (Meshy output,
13–50 MB each) are archived on Zenodo.

These are AI-generated illustrations: plumage and shape follow the source illustrations and are not
checked by experts in every detail. Parts not visible in the source (undersides) are guessed.

## The gallery: GeoBirdModel

The gallery shows each bird flying over a procedural landscape of its migration (`scenes/`,
three.js): 12 habitats (desert, savanna, wetland, rainforest, Mediterranean, sea, mountains,
farmland, steppe, taiga, tundra, city), by day or by night, or with no background. The migration
map shows one tracked bird of the species over a habitat map, with its breeding and wintering sites
and long stopovers (zoom and pan): click a place, a sea or desert, the track or any habitat to fly
there, or press ▶ to follow the whole track. *As flown* shows day or night as the bird flew there.
The default scene is the track's main barrier. The species strip is grouped by family; hovering a
species plays its flapping loop (`loops/`, made by `tools/flap_loops.sh`).

The data in `habitats/` come from `tools/species_habitats.R` (GeoLocator Explorer tracks intersected
with RESOLVE Ecoregions 2017, Dinerstein et al. 2017, CC BY 4.0, and Natural Earth seas, deserts,
ranges, urban areas and cities, public domain) and `tools/name_places.R` (nearest town, country and
ecoregion of each key place).

## Licence

[CC BY 4.0](LICENSE.md). Please credit: *GeoBirdModel: GeoPressure/GeoBirdModel (Raphaël Nussbaumer),
from huashu-bird-sticker illustrations by Huashu, CC BY 4.0*, with a link to this repository.
