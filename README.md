# Bird models

Flapping 3D models of the bird species tracked with multi-sensor geolocators, made for the bird
view of [GeoLocator Explorer](https://geopressure.org/GeoLocatorExplorer/).

**Gallery:** <https://geopressure.org/bird-models/> — see each bird fly, turn it around, download it.

| | |
|---|---|
| `models/<Genus_species>.glb` | glTF binary, ~2 MB: 20 000 triangles, 2048 px base colour + 1024 px normal map (WebP), skeleton, one looping animation `Fly` (1 s) |
| `posters/<Genus_species>.webp` | Still image of the model (transparent background) |
| `models.json` | Birds approved for GeoLocator Explorer (quality good or ok): names, files, size, source sticker, licence |
| `gallery.json` | Every species, with its status (used by the gallery) |

Orientation (v2.0.0 and later): standard glTF axes, back +Y, head +Z, origin at the centre of the body; wingspan about 0.5 units. v1.0.0 used head +Y, back +Z.

## Use

Files are served by the jsDelivr CDN (CORS enabled). Pin a release for stable URLs:

```
https://cdn.jsdelivr.net/gh/GeoPressure/bird-models@v1.0.0/models/Upupa_epops.glb
```

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js"></script>
<model-viewer src="https://cdn.jsdelivr.net/gh/GeoPressure/bird-models@v1.0.0/models/Upupa_epops.glb"
  animation-name="Fly" autoplay camera-controls></model-viewer>
```

In three.js: load with `GLTFLoader` (supports `EXT_texture_webp`) and play `gltf.animations[0]`
with an `AnimationMixer`.

## How they are made

Sticker illustration ([huashu-bird-sticker](https://github.com/alchaincyf/huashu-bird-sticker))
→ in-flight image (Meshy image-to-image, nano-banana-pro) → textured 3D model (Meshy 7 image-to-3d)
→ Blender: levelled, legs removed, belly slimmed if plump, reduced, skeleton and wing beat with a
stabilised head. Scripts, settings and lessons learned:
[GeoLocatorExplorer/bird-models](https://github.com/GeoPressure/GeoLocatorExplorer/tree/main/bird-models).
The full-quality static models (Meshy output, 13–50 MB each) are archived on Zenodo.

These are AI-generated illustrations: plumage and shape follow the source illustrations and are not
checked by experts in every detail. Parts not visible in the source (undersides) are guessed.

## Licence

[CC BY 4.0](LICENSE.md). Please credit: *Bird models: GeoPressure/bird-models (Raphaël Nussbaumer),
from huashu-bird-sticker illustrations by Huashu, CC BY 4.0*, with a link to this repository.
